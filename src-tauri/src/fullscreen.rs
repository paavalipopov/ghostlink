// SPDX-License-Identifier: GPL-3.0-or-later
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

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
    pub fn setup(&self, _: &AppHandle) {}
    pub fn stop(&self) {}
    pub fn stop_request(&self) -> Result<Status, String> {
        self.stop();
        Ok(self.status())
    }
    pub fn status(&self) -> Status {
        Status {
            state: "unavailable".into(),
            ..Status::default()
        }
    }
    pub fn start(&self, _: &AppHandle, _: crate::platform::WindowTarget) -> Result<Status, String> {
        Err("The bundled fullscreen helper requires Windows.".into())
    }
    pub fn toggle(&self, _: &AppHandle) -> Result<Status, String> {
        Err("The bundled fullscreen helper requires Windows.".into())
    }
    pub fn note_failure(&self, _: &str) {}
    pub fn publish(&self, _: &Status) {}
}

pub const HELPER_PIPE_CLOSED: &str = "helper-pipe-closed";
pub const TOGGLE_BUSY: &str = "A fullscreen change is already in progress.";

pub const TOGGLE_SHORTCUT: &str = "Alt+Shift+A";

pub fn exit_hint_shortcut(status: &Status) -> Option<&'static str> {
    // A scaling warning can include a failed app-wide hotkey registration.
    // The helper's own exit shortcut is guaranteed before capture starts.
    (status.state == "scaling").then_some(if status.error.is_none() {
        TOGGLE_SHORTCUT
    } else {
        status.hotkey
    })
}

pub fn session_is_active(state: &str) -> bool {
    matches!(state, "starting" | "scaling" | "waiting" | "stopping")
}

pub fn shortcut_conflict(code: u32) -> String {
    if code == 1409 {
        format!("{TOGGLE_SHORTCUT} is already in use.")
    } else {
        format!("{TOGGLE_SHORTCUT} could not be registered (code {code}).")
    }
}

/// A lost status poll is idle after a clean process exit and failed otherwise.
pub fn lost_poll_error(
    poll_error: &str,
    exit_success: Option<bool>,
    crash_message: &str,
) -> String {
    match exit_success {
        Some(true) => String::new(),
        Some(false) if !crash_message.is_empty() => crash_message.to_string(),
        None if poll_error == HELPER_PIPE_CLOSED => {
            "Fullscreen helper closed its control pipe.".into()
        }
        _ => poll_error.to_string(),
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
        .ok_or("Pick a window before entering fullscreen.")?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || app.state::<Service>().start(&app, target))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fullscreen_stop(window: WebviewWindow) -> Result<Status, String> {
    crate::require_panel(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || app.state::<Service>().stop_request())
        .await
        .map_err(|e| e.to_string())?
}

pub fn run_toggle(app: &AppHandle) -> Result<Status, String> {
    let service = app.state::<Service>();
    match service.toggle(app) {
        Ok(status) => {
            service.publish(&status);
            Ok(status)
        }
        Err(error) => {
            service.note_failure(&error);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn fullscreen_toggle(window: WebviewWindow) -> Result<Status, String> {
    crate::require_panel(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || run_toggle(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn fullscreen_status(window: WebviewWindow) -> Result<Status, String> {
    crate::require_panel(&window)?;
    Ok(window.state::<Service>().status())
}

#[tauri::command]
pub fn fullscreen_exit_hint(window: WebviewWindow) -> Result<Option<&'static str>, String> {
    if window.label() != "overlay" {
        return Err("Only the overlay can read the fullscreen exit hint.".into());
    }
    Ok(exit_hint_shortcut(&window.state::<Service>().status()))
}

#[cfg(test)]
mod tests {
    use super::lost_poll_error;

    #[test]
    fn exit_hint_only_shows_during_actual_scaling() {
        let mut status = super::Status::default();
        for state in [
            "idle",
            "starting",
            "waiting",
            "stopping",
            "failed",
            "unavailable",
        ] {
            status.state = state.into();
            assert_eq!(super::exit_hint_shortcut(&status), None);
        }
        status.state = "scaling".into();
        assert_eq!(super::exit_hint_shortcut(&status), Some("Alt+Shift+A"));
    }

    #[test]
    fn exit_hint_uses_the_helper_exit_when_the_toggle_shortcut_is_unavailable() {
        let status = super::Status {
            state: "scaling".into(),
            error: Some(super::shortcut_conflict(1409)),
            ..super::Status::default()
        };
        assert_eq!(super::exit_hint_shortcut(&status), Some("Ctrl+Alt+F11"));
    }

    #[test]
    fn clean_exit_during_status_poll_is_idle() {
        let error = lost_poll_error(
            "Fullscreen helper did not respond within two seconds.",
            Some(true),
            "Fullscreen helper exited: exit code: 0",
        );
        assert!(error.is_empty());
    }

    #[test]
    fn nonzero_exit_during_status_poll_stays_failed() {
        let error = lost_poll_error(
            "Fullscreen helper did not respond within two seconds.",
            Some(false),
            "Fullscreen helper exited: exit code: 1",
        );
        assert_eq!(error, "Fullscreen helper exited: exit code: 1");
    }

    #[test]
    fn timeout_while_helper_is_running_stays_failed() {
        let error = lost_poll_error(
            "Fullscreen helper did not respond within two seconds.",
            None,
            "",
        );
        assert_eq!(
            error,
            "Fullscreen helper did not respond within two seconds."
        );
    }

    #[test]
    fn closed_pipe_without_an_exit_code_is_failed() {
        let error = lost_poll_error(super::HELPER_PIPE_CLOSED, None, "");
        assert_eq!(error, "Fullscreen helper closed its control pipe.");
    }

    #[test]
    fn occupied_shortcut_is_reported_without_replacing_the_helper_exit() {
        assert_eq!(
            super::shortcut_conflict(1409),
            "Alt+Shift+A is already in use."
        );
        assert_eq!(
            super::shortcut_conflict(5),
            "Alt+Shift+A could not be registered (code 5)."
        );
        assert!(super::session_is_active("scaling"));
        assert!(!super::session_is_active("idle"));
    }
}
