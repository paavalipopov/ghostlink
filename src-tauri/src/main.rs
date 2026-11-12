#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod fullscreen;
mod geometry;
mod peer;
mod platform;
mod preview;
mod updates;

use geometry::{Bounds, Drag, Point, Sample};
use peer::{PeerInput, PeerPointer, QueuedClick};
use preview::{PadInput, TestPad};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewWindow,
};

#[derive(Default)]
struct Selection {
    area: Option<Bounds>,
    input_area: Option<Bounds>,
    tracked_window: Option<platform::WindowTarget>,
    frame_hidden: bool,
    drag: Option<Bounds>,
    test_pad: TestPad,
    peer_session: Option<u32>,
    pick_displays: Option<Arc<[Display]>>,
    pad_code: Option<String>,
}

impl Selection {
    fn sharing_area(&self) -> Option<Bounds> {
        if self.area.is_none()
            || self.drag.is_some()
            || self.test_pad.open
            || self.peer_session.is_none()
        {
            return None;
        }
        self.input_area
    }

    fn update_window_mapping(&mut self, mapping: Option<platform::WindowArea>) -> bool {
        let area = mapping.map(|area| area.display);
        let input = mapping.map(|area| area.input);
        if self.area == area && self.input_area == input {
            return false;
        }
        self.area = area;
        self.input_area = input;
        self.test_pad.preview = None;
        true
    }
}

type Capture = Mutex<Selection>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Display {
    name: String,
    bounds: Bounds,
    scale_factor: f64,
    primary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Controls {
    app_version: String,
    displays: Vec<Display>,
    desktop_areas: bool,
    pick_window: bool,
}

#[derive(Clone, Serialize)]
struct AreaChange {
    area: Option<Bounds>,
    error: Option<String>,
    tracking: bool,
}

fn list_displays(window: &WebviewWindow) -> tauri::Result<Vec<Display>> {
    let primary = window.primary_monitor()?.map(|monitor| *monitor.position());
    Ok(window
        .available_monitors()?
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| Display {
            name: monitor
                .name()
                .cloned()
                .unwrap_or_else(|| format!("Display {}", index + 1)),
            bounds: Bounds {
                x: monitor.position().x,
                y: monitor.position().y,
                width: monitor.size().width,
                height: monitor.size().height,
            },
            scale_factor: monitor.scale_factor(),
            primary: primary.as_ref() == Some(monitor.position()),
        })
        .collect())
}

fn require_panel(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "panel" {
        Ok(())
    } else {
        Err("Only the control panel can change the capture area.".into())
    }
}

#[tauri::command]
fn controls(window: WebviewWindow) -> Result<Controls, String> {
    require_panel(&window)?;
    Ok(Controls {
        app_version: window.app_handle().package_info().version.to_string(),
        displays: list_displays(&window).map_err(|error| error.to_string())?,
        desktop_areas: platform::desktop_areas_available(),
        pick_window: cfg!(windows),
    })
}

fn place_window(window: &WebviewWindow, area: Bounds) -> Result<(), String> {
    let position = PhysicalPosition::new(area.x, area.y);
    let size = PhysicalSize::new(area.width, area.height);
    let actual = (|| -> tauri::Result<Bounds> {
        window.set_position(position)?;
        // Set the size after crossing monitors, where Windows can suggest a DPI-rescaled size.
        window.set_size(size)?;
        window.set_position(position)?;
        let origin = window.inner_position()?;
        let size = window.inner_size()?;
        Ok(Bounds {
            x: origin.x,
            y: origin.y,
            width: size.width,
            height: size.height,
        })
    })()
    .map_err(|error| error.to_string())?;
    if actual != area {
        return Err(format!(
            "Could not place the frame at {area:?}. The window manager placed it at {actual:?}."
        ));
    }
    Ok(())
}

fn configure_overlay(overlay: &WebviewWindow, area: Option<Bounds>) -> Result<(), String> {
    platform::set_overlay_visible(overlay, false)?;
    if let Some(bounds) = area {
        place_window(overlay, bounds)?;
        overlay
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        platform::set_overlay_visible(overlay, true)?;
    }
    Ok(())
}

fn apply_area(app: &AppHandle, area: Option<Bounds>) -> Result<AreaChange, String> {
    let overlay = app
        .get_webview_window("overlay")
        .ok_or("Overlay is missing.")?;
    let state = app.state::<Capture>();
    let (previous, previous_input, previous_target) = {
        let state = state.lock().unwrap();
        (state.area, state.input_area, state.tracked_window)
    };
    let (area, error) = match configure_overlay(&overlay, area) {
        Ok(()) => (area, None),
        Err(error) => match configure_overlay(&overlay, previous) {
            Ok(()) => (previous, Some(error)),
            Err(restore) => (
                None,
                Some(format!(
                    "{error} Could not restore the previous area. {restore}"
                )),
            ),
        },
    };
    {
        let mut state = state.lock().unwrap();
        state.area = area;
        if error.is_some() && area == previous {
            state.input_area = previous_input;
            state.tracked_window = previous_target;
        } else {
            state.input_area = area;
            state.tracked_window = None;
        }
        if area != previous {
            state.test_pad.preview = None;
        }
    }
    if area != previous {
        let _ = app.emit_to(EventTarget::webview_window("test-pad"), "test-area", area);
    }
    app.state::<fullscreen::Service>().stop();
    Ok(AreaChange {
        area,
        error,
        tracking: false,
    })
}

fn refresh_window_area(app: &AppHandle) {
    let capture = app.state::<Capture>();
    let (target, previous, dragging) = {
        let state = capture.lock().unwrap();
        (state.tracked_window, state.area, state.drag.is_some())
    };
    let Some(target) = target else { return };
    if dragging {
        return;
    }
    let Some(overlay) = app.get_webview_window("overlay") else {
        return;
    };
    let mut mapping = platform::window_area(target);
    let mut area = mapping.map(|area| area.display);
    let mut error = None;
    if area != previous {
        if let Err(message) = configure_overlay(&overlay, area) {
            let _ = platform::set_overlay_visible(&overlay, false);
            area = None;
            mapping = None;
            error = Some(message);
        }
    }
    let changed = capture.lock().unwrap().update_window_mapping(mapping);
    if changed {
        let _ = app.emit_to(EventTarget::webview_window("test-pad"), "test-area", area);
        let _ = app.emit_to(
            EventTarget::webview_window("panel"),
            "area-change",
            AreaChange {
                area,
                error,
                tracking: true,
            },
        );
    }
    if area.is_some() {
        platform::keep_overlay_above(&overlay, target);
    }
}

fn require_selection(window: &WebviewWindow) -> Result<(), String> {
    require_panel(window)?;
    if !platform::desktop_areas_available() {
        return Err("Desktop area selection is unavailable in this session.".into());
    }
    if window.state::<Capture>().lock().unwrap().drag.is_some() {
        return Err("Finish or cancel the current drag first.".into());
    }
    Ok(())
}

fn require_display(window: &WebviewWindow, bounds: Bounds) -> Result<(), String> {
    let displays = list_displays(window).map_err(|error| error.to_string())?;
    if displays.iter().any(|display| display.bounds == bounds) {
        Ok(())
    } else {
        Err("The display layout changed. Reopen Ghostlink to refresh the list.".into())
    }
}

#[tauri::command]
fn select_display(window: WebviewWindow, bounds: Option<Bounds>) -> Result<AreaChange, String> {
    require_selection(&window)?;
    if let Some(bounds) = bounds {
        require_display(&window, bounds)?;
    }
    apply_area(window.app_handle(), bounds)
}

#[tauri::command]
fn restore_area(window: WebviewWindow, bounds: Bounds) -> Result<AreaChange, String> {
    require_selection(&window)?;
    let displays = list_displays(&window).map_err(|error| error.to_string())?;
    if bounds.width < 2
        || bounds.height < 2
        || !displays
            .iter()
            .any(|display| display.bounds.intersect(bounds) == Some(bounds))
    {
        return Err("The saved area is outside the current displays.".into());
    }
    apply_area(window.app_handle(), Some(bounds))
}

#[tauri::command]
async fn fit_panel(window: WebviewWindow, width: u32, height: u32) -> Result<(), String> {
    require_panel(&window)?;
    if !(240..=640).contains(&width) || !(200..=900).contains(&height) {
        return Err("Invalid panel size.".into());
    }
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_ghost_marks(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    require_panel(&window)?;
    window
        .app_handle()
        .emit_to(
            EventTarget::webview_window("overlay"),
            "ghost-marks",
            enabled,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_show_frame(window: WebviewWindow, show: bool) -> Result<(), String> {
    require_panel(&window)?;
    window.state::<Capture>().lock().unwrap().frame_hidden = !show;
    window
        .app_handle()
        .emit_to(EventTarget::webview_window("overlay"), "show-frame", show)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn overlay_frame_visible(window: WebviewWindow) -> Result<bool, String> {
    if window.label() != "overlay" {
        return Err("Only the overlay can read its frame state.".into());
    }
    Ok(!window.state::<Capture>().lock().unwrap().frame_hidden)
}

#[tauri::command]
async fn prepare_pick_marker(window: WebviewWindow) -> Result<(), String> {
    require_panel(&window)?;
    let app = window.app_handle();
    if app.get_webview_window("pick-marker").is_none() {
        let config = app
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == "pick-marker")
            .ok_or("Pick marker configuration is missing.")?;
        tauri::WebviewWindowBuilder::from_config(app, config)
            .and_then(|builder| builder.build())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_pick_count(window: WebviewWindow, count: Option<u8>) -> Result<(), String> {
    require_panel(&window)?;
    let app = window.app_handle();
    let marker = app
        .get_webview_window("pick-marker")
        .ok_or("Pick marker is missing.")?;
    let state = app.state::<Capture>();
    let marker_visible = state.lock().unwrap().pick_displays.is_some();
    if count.is_none() {
        state.lock().unwrap().pick_displays = None;
        platform::set_overlay_visible(&marker, false)?;
    } else if !marker_visible {
        let displays = list_displays(&window).map_err(|error| error.to_string())?;
        let point = platform::cursor(app).ok_or("Could not read the desktop pointer.")?;
        marker
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        marker
            .set_position(pick_marker_position(point, &displays))
            .map_err(|error| error.to_string())?;
        platform::set_overlay_visible(&marker, true)?;
        state.lock().unwrap().pick_displays = Some(displays.into());
    }
    window
        .app_handle()
        .emit_to(EventTarget::webview_window("overlay"), "pick-count", count)
        .map_err(|error| error.to_string())
}

fn pick_marker_position(point: Point, displays: &[Display]) -> PhysicalPosition<i32> {
    let display = displays
        .iter()
        .find(|display| display.bounds.sample(point).inside);
    let scale = display.map_or(1.0, |display| display.scale_factor);
    // Keep the glyph beside the arrow tip so both marks stay legible.
    let x = point.x + (6.0 * scale).round() as i32;
    let Some(bounds) = display.map(|display| display.bounds) else {
        return PhysicalPosition::new(x, point.y);
    };
    let size = (6.0 * scale).ceil() as i32;
    let right = bounds.x + bounds.width as i32;
    let bottom = bounds.y + bounds.height as i32;
    PhysicalPosition::new(
        x.min((right - size).max(bounds.x)),
        point.y.min((bottom - size).max(bounds.y)),
    )
}

#[tauri::command]
fn select_window(window: WebviewWindow) -> Result<AreaChange, String> {
    require_selection(&window)?;
    if !cfg!(windows) {
        return Err("Pick window is currently available on Windows.".into());
    }
    let app = window.app_handle();
    let point = platform::cursor(app).ok_or("Could not read the desktop pointer.")?;
    let overlay = app
        .get_webview_window("overlay")
        .ok_or("Overlay is missing.")?;
    list_displays(&window)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|display| display.bounds.sample(point).inside)
        .ok_or("Point at a window on a connected display and try again.")?;
    platform::set_overlay_visible(&overlay, false)?;
    let target = platform::window_at(point);
    let area = target.and_then(platform::window_area);
    if let Some(area) = area {
        let result = apply_area(app, Some(area.display))?;
        if result.error.is_none() {
            let capture = app.state::<Capture>();
            let mut state = capture.lock().unwrap();
            state.input_area = Some(area.input);
            state.tracked_window = target;
        }
        Ok(result)
    } else {
        let previous = app.state::<Capture>().lock().unwrap().area;
        configure_overlay(&overlay, previous)?;
        Ok(AreaChange {
            area: previous,
            error: Some("Point at another app window and try again.".into()),
            tracking: false,
        })
    }
}

#[tauri::command]
fn begin_drag(window: WebviewWindow, bounds: Bounds) -> Result<(), String> {
    require_selection(&window)?;
    require_display(&window, bounds)?;
    let app = window.app_handle();
    let picker = app
        .get_webview_window("picker")
        .ok_or("Frame picker is missing.")?;
    let overlay = app
        .get_webview_window("overlay")
        .ok_or("Overlay is missing.")?;
    place_window(&picker, bounds)?;
    platform::set_overlay_visible(&overlay, false)?;
    {
        let state = app.state::<Capture>();
        let mut state = state.lock().unwrap();
        state.drag = Some(bounds);
        state.test_pad.preview = None;
    }
    app.state::<fullscreen::Service>().stop();
    if let Err(error) = picker.show().and_then(|()| picker.set_focus()) {
        settle_drag(&picker, None)?;
        return Err(error.to_string());
    }
    Ok(())
}

fn settle_drag(picker: &WebviewWindow, drag: Option<Drag>) -> Result<(), String> {
    picker.hide().map_err(|error| error.to_string())?;
    let app = picker.app_handle();
    let state = app.state::<Capture>();
    let (bounds, previous) = {
        let mut state = state.lock().unwrap();
        (state.drag.take(), state.area)
    };
    let Some(bounds) = bounds else { return Ok(()) };
    let completed = drag.is_some();
    let drawn = drag.and_then(|drag| bounds.drag_area(drag));
    let mut result = if let Some(drawn) = drawn {
        apply_area(app, Some(drawn))?
    } else {
        let overlay = app
            .get_webview_window("overlay")
            .ok_or("Overlay is missing.")?;
        configure_overlay(&overlay, previous)?;
        AreaChange {
            area: previous,
            error: None,
            tracking: false,
        }
    };
    if completed && drawn.is_none() && result.error.is_none() {
        result.error = Some("Draw a frame at least 40 × 40 pixels.".into());
    }
    app.emit_to(EventTarget::webview_window("panel"), "area-change", result)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn finish_drag(window: WebviewWindow, drag: Option<Drag>) -> Result<(), String> {
    if window.label() != "picker" {
        return Err("Only the frame picker can finish a drag.".into());
    }
    settle_drag(&window, drag)
}

#[tauri::command]
fn open_test_pad(window: WebviewWindow, code: String) -> Result<(), String> {
    require_selection(&window)?;
    if !(6..=128).contains(&code.len()) {
        return Err("Invalid test secret.".into());
    }
    let app = window.app_handle();
    let state = app.state::<Capture>();
    if state.lock().unwrap().area.is_none() {
        return Err("Choose a shared area before opening the test trackpad.".into());
    }
    let pad = app
        .get_webview_window("test-pad")
        .ok_or("Test trackpad is missing.")?;
    pad.show().map_err(|error| error.to_string())?;
    {
        let mut state = state.lock().unwrap();
        state.test_pad.open = true;
        state.pad_code = Some(code.clone());
    }
    let _ = app.emit_to(
        EventTarget::webview_window("test-pad"),
        "test-session",
        Some(code),
    );
    let _ = pad.set_focus();
    Ok(())
}

fn require_test_pad(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "test-pad" {
        Ok(())
    } else {
        Err("Only the test trackpad can send test input.".into())
    }
}

#[tauri::command]
fn test_pad_area(window: WebviewWindow) -> Result<Option<Bounds>, String> {
    require_test_pad(&window)?;
    Ok(window.state::<Capture>().lock().unwrap().area)
}

#[tauri::command]
fn test_pad_session(window: WebviewWindow) -> Result<Option<String>, String> {
    require_test_pad(&window)?;
    Ok(window.state::<Capture>().lock().unwrap().pad_code.clone())
}

#[tauri::command]
fn test_pad_input(window: WebviewWindow, input: Option<PadInput>) -> Result<(), String> {
    require_test_pad(&window)?;
    let capture = window.state::<Capture>();
    let mut state = capture.lock().unwrap();
    if state.area.is_some() && state.drag.is_none() {
        state.test_pad.update(input)?;
    }
    Ok(())
}

fn hide_test_pad(window: &WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())?;
    {
        let capture = window.state::<Capture>();
        let mut state = capture.lock().unwrap();
        state.test_pad.close();
        state.pad_code = None;
    }
    let app = window.app_handle();
    let _ = app.emit_to(
        EventTarget::webview_window("test-pad"),
        "test-session",
        Option::<String>::None,
    );
    let _ = app.emit_to(EventTarget::webview_window("panel"), "test-pad-closed", ());
    Ok(())
}

#[tauri::command]
fn close_test_pad(window: WebviewWindow) -> Result<(), String> {
    require_test_pad(&window)?;
    hide_test_pad(&window)
}

#[tauri::command]
fn set_peer_sharing(window: WebviewWindow, session: Option<u32>) -> Result<Option<String>, String> {
    require_panel(&window)?;
    let app = window.app_handle();
    app.state::<Capture>().lock().unwrap().peer_session = session;
    let _ = app.emit_to(
        EventTarget::webview_window("overlay"),
        "peer-pointers",
        Vec::<PeerPointer>::new(),
    );

    let handler: Option<platform::ClickHandler> = session.map(|session| {
        let app = app.clone();
        let sender = app.state::<SyncSender<QueuedClick>>().inner().clone();
        let handler: platform::ClickHandler = Box::new(move |point| {
            let capture = app.state::<Capture>();
            let Ok(state) = capture.try_lock() else {
                return;
            };
            if state.peer_session != Some(session) {
                return;
            }
            if let Some(area) = state.sharing_area() {
                let sample = area.sample(point);
                if sample.inside {
                    let _ = sender.try_send((session, area, sample));
                }
            }
        });
        handler
    });
    Ok(platform::set_click_handler(handler).err())
}

#[tauri::command]
fn show_peer_pointers(
    window: WebviewWindow,
    session: u32,
    mut pointers: Vec<PeerPointer>,
) -> Result<(), String> {
    require_panel(&window)?;
    if window.state::<Capture>().lock().unwrap().peer_session != Some(session) {
        return Ok(());
    }
    pointers.retain(|pointer| (0.0..=1.0).contains(&pointer.x) && (0.0..=1.0).contains(&pointer.y));
    pointers.truncate(8);
    window
        .app_handle()
        .emit_to(
            EventTarget::webview_window("overlay"),
            "peer-pointers",
            pointers,
        )
        .map_err(|error| error.to_string())
}

fn watch_pointer(app: AppHandle, clicks: Receiver<QueuedClick>) {
    let state = app.state::<Capture>();
    let mut last = None;
    let mut last_shared = None;
    let mut last_marker_position = None;
    let tracking_pending = Arc::new(AtomicBool::new(false));
    let mut tick = 0;
    loop {
        tick = (tick + 1) % 6;
        if tick == 0 && !tracking_pending.swap(true, Ordering::Relaxed) {
            let pending = tracking_pending.clone();
            let handle = app.clone();
            if app
                .run_on_main_thread(move || {
                    refresh_window_area(&handle);
                    pending.store(false, Ordering::Relaxed);
                })
                .is_err()
            {
                tracking_pending.store(false, Ordering::Relaxed);
            }
        }
        let (area, input_area, test_open, test_preview, session, pick_displays) = {
            let state = state.lock().unwrap();
            let area = if state.drag.is_some() {
                None
            } else {
                state.area
            };
            (
                area,
                state.sharing_area(),
                state.test_pad.open,
                state.test_pad.preview,
                state.peer_session,
                state.pick_displays.clone(),
            )
        };
        let point =
            if pick_displays.is_some() || (area.is_some() && session.is_some() && !test_open) {
                platform::cursor(&app)
            } else {
                None
            };
        let marker_position = pick_displays
            .as_deref()
            .zip(point)
            .map(|(displays, point)| pick_marker_position(point, displays));
        if marker_position != last_marker_position {
            if let Some(position) = marker_position {
                if let Some(marker) = app.get_webview_window("pick-marker") {
                    let _ = marker.set_position(position);
                }
            }
            last_marker_position = marker_position;
        }
        let sample = input_area.and_then(|bounds| {
            let sample: Sample = bounds.sample(point?);
            sample.inside.then_some(sample)
        });
        let preview = if test_open && area.is_some() {
            test_preview
        } else {
            None
        };
        if last != preview {
            let _ = app.emit_to(
                EventTarget::webview_window("overlay"),
                "pointer-preview",
                preview,
            );
            last = preview;
        }
        for (click_session, click_area, sample) in clicks.try_iter() {
            if session == Some(click_session) && input_area == Some(click_area) && !test_open {
                let _ = app.emit_to(
                    EventTarget::webview_window("panel"),
                    "peer-input",
                    PeerInput::Click {
                        session: click_session,
                        sample,
                    },
                );
                last_shared = None;
            }
        }
        let shared = session.map(|session| (session, sample));
        if last_shared != shared {
            if let Some((session, sample)) = shared {
                let _ = app.emit_to(
                    EventTarget::webview_window("panel"),
                    "peer-input",
                    PeerInput::Move { session, sample },
                );
            }
            last_shared = shared;
        }
        thread::sleep(Duration::from_millis(16));
    }
}

#[cfg(test)]
mod selection_tests {
    use super::*;

    fn selected() -> Selection {
        Selection {
            area: Bounds::from_edges(80, 0, 1840, 1200),
            input_area: Bounds::from_edges(200, 100, 600, 400),
            peer_session: Some(7),
            ..Selection::default()
        }
    }

    #[test]
    fn shares_from_the_source_window_not_the_scaled_display_or_frame_visibility() {
        let mut state = selected();
        let input = state.sharing_area().unwrap();
        assert_eq!(input, Bounds::from_edges(200, 100, 600, 400).unwrap());
        assert_eq!(
            input.sample(Point { x: 300, y: 250 }),
            Sample {
                x: 0.25,
                y: 0.5,
                inside: true
            }
        );
        let only_in_scaled_view = Point { x: 1000, y: 900 };
        assert!(state.area.unwrap().sample(only_in_scaled_view).inside);
        assert!(!input.sample(only_in_scaled_view).inside);
        state.frame_hidden = true;
        assert_eq!(state.sharing_area(), Some(input));
    }

    #[test]
    fn suspends_desktop_sharing_without_a_session_or_area_and_while_picking_or_testing() {
        let cases: [fn(&mut Selection); 5] = [
            |state| state.peer_session = None,
            |state| state.area = None,
            |state| state.input_area = None,
            |state| state.drag = state.area,
            |state| state.test_pad.open = true,
        ];
        for change in cases {
            let mut state = selected();
            assert!(state.sharing_area().is_some());
            change(&mut state);
            assert!(state.sharing_area().is_none());
        }
    }

    #[test]
    fn updates_both_bounds_on_scaling_and_resumes_after_a_window_is_restored() {
        let mut state = selected();
        let fullscreen = platform::WindowArea {
            input: Bounds::from_edges(-1200, -700, -400, -100).unwrap(),
            display: Bounds::from_edges(-1920, -1080, 0, 0).unwrap(),
        };
        assert!(state.update_window_mapping(Some(fullscreen)));
        assert_eq!(state.area, Some(fullscreen.display));
        assert_eq!(state.sharing_area(), Some(fullscreen.input));
        // Magpie may move the original window while leaving the displayed image unchanged.
        let moved_source = platform::WindowArea {
            input: Bounds::from_edges(100, 100, 900, 700).unwrap(),
            ..fullscreen
        };
        assert!(state.update_window_mapping(Some(moved_source)));
        assert_eq!(state.area, Some(fullscreen.display));
        assert_eq!(state.sharing_area(), Some(moved_source.input));
        assert!(state.update_window_mapping(None));
        assert_eq!(state.area, None);
        assert_eq!(state.sharing_area(), None);
        assert!(!state.update_window_mapping(None));
        assert!(state.update_window_mapping(Some(moved_source)));
        assert_eq!(state.sharing_area(), Some(moved_source.input));
    }

    #[test]
    fn preserves_a_preview_on_unchanged_bounds_and_clears_it_after_a_geometry_change() {
        let mut state = selected();
        state.test_pad.preview = Some(preview::Preview {
            sample: Sample {
                x: 0.5,
                y: 0.25,
                inside: true,
            },
            click_key: Some(1),
        });
        let unchanged = platform::WindowArea {
            input: state.input_area.unwrap(),
            display: state.area.unwrap(),
        };
        assert!(!state.update_window_mapping(Some(unchanged)));
        assert!(state.test_pad.preview.is_some());
        let resized = platform::WindowArea {
            display: Bounds::from_edges(0, 0, 1600, 1200).unwrap(),
            ..unchanged
        };
        assert!(state.update_window_mapping(Some(resized)));
        assert!(state.test_pad.preview.is_none());
    }
}

fn main() {
    let (click_sender, clicks) = mpsc::sync_channel::<QueuedClick>(32);
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Service::default())
        .manage(Capture::default())
        .manage(fullscreen::Service::default())
        .manage(click_sender)
        .setup(move |app| {
            updates::setup(app.handle());
            fullscreen::setup(app.handle());
            let handle = app.handle().clone();
            thread::Builder::new()
                .name("pointer-sampler".into())
                .spawn(move || watch_pointer(handle, clicks))?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "panel" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<fullscreen::Service>().stop();
                window.app_handle().exit(0);
            }
            if let ("picker", tauri::WindowEvent::CloseRequested { api, .. }) =
                (window.label(), event)
            {
                api.prevent_close();
                if let Some(picker) = window.app_handle().get_webview_window("picker") {
                    let _ = settle_drag(&picker, None);
                }
            }
            if let ("test-pad", tauri::WindowEvent::CloseRequested { api, .. }) =
                (window.label(), event)
            {
                api.prevent_close();
                if let Some(pad) = window.app_handle().get_webview_window("test-pad") {
                    let _ = hide_test_pad(&pad);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            fullscreen::fullscreen_start,
            fullscreen::fullscreen_stop,
            fullscreen::fullscreen_status,
            controls,
            select_display,
            select_window,
            begin_drag,
            finish_drag,
            open_test_pad,
            test_pad_area,
            test_pad_session,
            test_pad_input,
            close_test_pad,
            set_peer_sharing,
            show_peer_pointers,
            restore_area,
            fit_panel,
            set_ghost_marks,
            set_show_frame,
            overlay_frame_visible,
            set_pick_count,
            prepare_pick_marker,
            updates::get_update_state,
            updates::check_for_updates
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Ghostlink Tauri prototype")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<fullscreen::Service>().stop();
            }
        });
}
