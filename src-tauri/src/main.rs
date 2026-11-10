#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod geometry;
mod peer;
mod platform;
mod preview;

use geometry::{Bounds, Drag, Sample};
use peer::{PeerInput, PeerPointer, QueuedClick};
use preview::{PadInput, TestPad};
use serde::Serialize;
use std::{
    sync::{
        mpsc::{self, Receiver, SyncSender},
        Mutex,
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
    drag: Option<Bounds>,
    test_pad: TestPad,
    peer_session: Option<u32>,
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
    displays: Vec<Display>,
    desktop_areas: bool,
    pick_window: bool,
}

#[derive(Clone, Serialize)]
struct AreaChange {
    area: Option<Bounds>,
    error: Option<String>,
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
    let previous = state.lock().unwrap().area;
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
        if area != previous {
            state.test_pad.preview = None;
        }
    }
    if area != previous {
        let _ = app.emit_to(EventTarget::webview_window("test-pad"), "test-area", area);
    }
    Ok(AreaChange { area, error })
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
fn fit_panel(window: WebviewWindow, width: u32, height: u32) -> Result<(), String> {
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
fn set_pick_count(window: WebviewWindow, count: Option<u8>) -> Result<(), String> {
    require_panel(&window)?;
    window
        .app_handle()
        .emit_to(EventTarget::webview_window("overlay"), "pick-count", count)
        .map_err(|error| error.to_string())
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
    let display = list_displays(&window)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|display| display.bounds.sample(point).inside)
        .ok_or("Point at a window on a connected display and try again.")?;
    platform::set_overlay_visible(&overlay, false)?;
    let area = platform::window_at(point).and_then(|bounds| bounds.intersect(display.bounds));
    if let Some(area) = area {
        apply_area(app, Some(area))
    } else {
        let previous = app.state::<Capture>().lock().unwrap().area;
        let mut result = apply_area(app, previous)?;
        if result.error.is_none() {
            result.error = Some("Point at another app window and try again.".into());
        }
        Ok(result)
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
    let mut result = apply_area(app, drawn.or(previous))?;
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
fn open_test_pad(window: WebviewWindow) -> Result<(), String> {
    require_selection(&window)?;
    let app = window.app_handle();
    let state = app.state::<Capture>();
    if state.lock().unwrap().area.is_none() {
        return Err("Choose a shared area before opening the test trackpad.".into());
    }
    let pad = app
        .get_webview_window("test-pad")
        .ok_or("Test trackpad is missing.")?;
    pad.show().map_err(|error| error.to_string())?;
    state.lock().unwrap().test_pad.open = true;
    pad.set_focus().map_err(|error| error.to_string())
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
    window.state::<Capture>().lock().unwrap().test_pad.close();
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
            if state.peer_session != Some(session) || state.drag.is_some() || state.test_pad.open {
                return;
            }
            if let Some(area) = state.area {
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
    loop {
        let (area, test_open, test_preview, session) = {
            let state = state.lock().unwrap();
            let area = if state.drag.is_some() {
                None
            } else {
                state.area
            };
            (
                area,
                state.test_pad.open,
                state.test_pad.preview,
                state.peer_session,
            )
        };
        let sample = area
            .filter(|_| session.is_some() && !test_open)
            .and_then(|bounds| {
                let sample: Sample = bounds.sample(platform::cursor(&app)?);
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
            if session == Some(click_session) && area == Some(click_area) && !test_open {
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

fn main() {
    let (click_sender, clicks) = mpsc::sync_channel::<QueuedClick>(32);
    tauri::Builder::default()
        .manage(Capture::default())
        .manage(click_sender)
        .setup(move |app| {
            let handle = app.handle().clone();
            thread::Builder::new()
                .name("pointer-sampler".into())
                .spawn(move || watch_pointer(handle, clicks))?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "panel" && matches!(event, tauri::WindowEvent::Destroyed) {
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
            controls,
            select_display,
            select_window,
            begin_drag,
            finish_drag,
            open_test_pad,
            test_pad_area,
            test_pad_input,
            close_test_pad,
            set_peer_sharing,
            show_peer_pointers,
            restore_area,
            fit_panel,
            set_ghost_marks,
            set_pick_count
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ghostlink Tauri prototype");
}
