#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod geometry;
mod platform;

use geometry::{Bounds, Sample};
use serde::Serialize;
use std::{sync::Mutex, thread, time::Duration};
use tauri::{
    AppHandle, Emitter, EventTarget, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
};

#[derive(Default)]
struct Capture(Mutex<Option<Bounds>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Display {
    name: String,
    bounds: Bounds,
    scale_factor: f64,
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
fn displays(window: WebviewWindow) -> Result<Vec<Display>, String> {
    require_panel(&window)?;
    list_displays(&window).map_err(|error| error.to_string())
}

fn position_overlay(overlay: &WebviewWindow, area: Bounds) -> tauri::Result<Bounds> {
    let position = PhysicalPosition::new(area.x, area.y);
    let size = PhysicalSize::new(area.width, area.height);
    overlay.set_position(position)?;
    // Set the size again after crossing monitors, where Windows can suggest a DPI-rescaled size.
    overlay.set_size(size)?;
    overlay.set_position(position)?;
    let origin = overlay.inner_position()?;
    let actual = overlay.inner_size()?;
    Ok(Bounds {
        x: origin.x,
        y: origin.y,
        width: actual.width,
        height: actual.height,
    })
}

#[tauri::command]
fn select_area(window: WebviewWindow, index: Option<usize>) -> Result<Option<Bounds>, String> {
    require_panel(&window)?;
    let app = window.app_handle();
    let overlay = app
        .get_webview_window("overlay")
        .ok_or("Overlay is missing.")?;
    let state = app.state::<Capture>();
    *state.0.lock().unwrap() = None;
    platform::set_overlay_visible(&overlay, false)?;
    let Some(index) = index else {
        return Ok(None);
    };
    let displays = list_displays(&window).map_err(|error| error.to_string())?;
    let target = displays
        .get(index)
        .ok_or("Display is no longer available. Restart the prototype.")?
        .bounds
        .centered_area();
    let actual = position_overlay(&overlay, target).map_err(|error| error.to_string())?;
    if actual != target {
        return Err(format!(
            "Overlay client bounds differ from the selected area. Expected {target:?}, got {actual:?}."
        ));
    }
    platform::set_overlay_visible(&overlay, true)?;
    *state.0.lock().unwrap() = Some(actual);
    Ok(Some(actual))
}

fn watch_pointer(app: AppHandle) {
    let state = app.state::<Capture>();
    let mut last: Option<Sample> = None;
    loop {
        {
            let area = state.0.lock().unwrap();
            let sample = area
                .and_then(|bounds| platform::cursor().map(|point| bounds.sample(point)))
                .unwrap_or_default();
            if last != Some(sample) {
                let _ = app.emit_to(EventTarget::webview_window("overlay"), "pointer-sample", sample);
                last = Some(sample);
            }
        }
        thread::sleep(Duration::from_millis(16));
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Capture::default())
        .setup(|app| {
            let overlay = app.get_webview_window("overlay").expect("overlay config");
            overlay.set_ignore_cursor_events(true)?;
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
        })
        .invoke_handler(tauri::generate_handler![displays, select_area])
        .run(tauri::generate_context!())
        .expect("failed to run Ghostlink Tauri prototype");
}
