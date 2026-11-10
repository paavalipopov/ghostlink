#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod geometry;
mod platform;

use geometry::{Bounds, Drag, Sample};
use serde::Serialize;
use std::{sync::Mutex, thread, time::Duration};
use tauri::{
    AppHandle, Emitter, EventTarget, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

#[derive(Default)]
struct Selection {
    area: Option<Bounds>,
    drag: Option<Bounds>,
}

type Capture = Mutex<Selection>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Display {
    name: String,
    bounds: Bounds,
    scale_factor: f64,
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
    state.lock().unwrap().area = area;
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
    app.state::<Capture>().lock().unwrap().drag = Some(bounds);
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

fn watch_pointer(app: AppHandle) {
    let state = app.state::<Capture>();
    let mut last: Option<Sample> = None;
    loop {
        let area = {
            let state = state.lock().unwrap();
            if state.drag.is_some() {
                None
            } else {
                state.area
            }
        };
        let sample = area
            .and_then(|bounds| platform::cursor(&app).map(|point| bounds.sample(point)))
            .unwrap_or_default();
        if last != Some(sample) {
            let _ = app.emit_to(
                EventTarget::webview_window("overlay"),
                "pointer-sample",
                sample,
            );
            last = Some(sample);
        }
        thread::sleep(Duration::from_millis(16));
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Capture::default())
        .setup(|app| {
            let handle = app.handle().clone();
            thread::Builder::new()
                .name("pointer-sampler".into())
                .spawn(move || watch_pointer(handle))?;
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
        })
        .invoke_handler(tauri::generate_handler![
            controls,
            select_display,
            select_window,
            begin_drag,
            finish_drag
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ghostlink Tauri prototype");
}
