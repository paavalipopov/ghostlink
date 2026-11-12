// SPDX-License-Identifier: GPL-3.0-or-later
use serde::Serialize;
use tauri::{Manager, WebviewWindow};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: String,
    pub error: Option<String>,
    pub hotkey: &'static str,
}

impl Default for Status {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            error: None,
            hotkey: "Ctrl+Alt+F11",
        }
    }
}

#[cfg(windows)]
#[path = "fullscreen_windows.rs"]
mod native;
#[cfg(windows)]
pub use native::Service;

#[cfg(not(windows))]
#[derive(Default)]
pub struct Service;
#[cfg(not(windows))]
impl Service {
    pub fn setup(&self, _: &tauri::AppHandle) {}
    pub fn stop(&self) {}
    pub fn status(&self) -> Status {
        Status {
            state: "unavailable".into(),
            ..Status::default()
        }
    }
    pub fn start(
        &self,
        _: &tauri::AppHandle,
        _: crate::platform::WindowTarget,
    ) -> Result<Status, String> {
        Err("The bundled fullscreen helper requires Windows.".into())
    }
}

pub fn setup(app: &tauri::AppHandle) {
    app.state::<Service>().setup(app);
}

#[tauri::command]
pub async fn fullscreen_start(window: WebviewWindow) -> Result<Status, String> {
    crate::require_selection(&window)?;
    let target = window
        .state::<crate::Capture>()
        .lock()
        .unwrap()
        .tracked_window
        .ok_or("Use Pick window before starting the developer fullscreen helper.")?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || app.state::<Service>().start(&app, target))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fullscreen_stop(window: WebviewWindow) -> Result<Status, String> {
    crate::require_panel(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let service = app.state::<Service>();
        service.stop();
        service.status()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fullscreen_status(window: WebviewWindow) -> Result<Status, String> {
    crate::require_panel(&window)?;
    Ok(window.state::<Service>().status())
}
