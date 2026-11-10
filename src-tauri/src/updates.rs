use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum UpdateState {
    Unsupported,
    Idle,
    Checking,
    Offered { version: String },
    Downloading { version: String, percent: u8 },
    Installing { version: String },
    UpToDate { version: String },
    Error { message: String },
}

pub type Service = Mutex<UpdateState>;

impl Default for UpdateState {
    fn default() -> Self {
        Self::Unsupported
    }
}

pub fn setup(app: &AppHandle) {
    let has_key = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(serde_json::Value::as_str)
        .is_some_and(|key| !key.trim().is_empty());
    let supported = has_key && app.updater().is_ok();
    if supported {
        transition(app, UpdateState::Idle);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(8)).await;
            check(&app, false).await;
        });
    }
}

fn publish(app: &AppHandle, state: UpdateState) {
    let _ = app.emit_to(EventTarget::webview_window("panel"), "update-state", state);
}

fn transition(app: &AppHandle, state: UpdateState) {
    *app.state::<Service>().lock().unwrap() = state.clone();
    publish(app, state);
}

fn fail(app: &AppHandle, message: &str, error: impl std::fmt::Display) {
    eprintln!("Ghostlink updater: {error}");
    transition(
        app,
        UpdateState::Error {
            message: message.into(),
        },
    );
}

async fn check(app: &AppHandle, install: bool) {
    {
        let service = app.state::<Service>();
        let mut updates = service.lock().unwrap();
        let can_check = match *updates {
            UpdateState::Idle => true,
            UpdateState::Offered { .. }
            | UpdateState::UpToDate { .. }
            | UpdateState::Error { .. } => install,
            _ => false,
        };
        if !can_check {
            return;
        }
        *updates = UpdateState::Checking;
    }
    publish(app, UpdateState::Checking);

    let result = match app
        .updater_builder()
        .timeout(Duration::from_secs(45))
        .build()
    {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    let update = match result {
        Ok(Some(update)) => update,
        Ok(None) => {
            transition(
                app,
                UpdateState::UpToDate {
                    version: app.package_info().version.to_string(),
                },
            );
            return;
        }
        Err(error) => {
            fail(app, "Could not check for updates", error);
            return;
        }
    };

    let version = update.version.clone();
    if !install {
        transition(app, UpdateState::Offered { version });
        return;
    }
    let mut downloaded = 0u64;
    let mut last_percent = None;
    let result = update
        .download(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                let percent = total.filter(|total| *total > 0).map_or(0, |total| {
                    (downloaded.saturating_mul(100) / total).min(100) as u8
                });
                if last_percent != Some(percent) {
                    last_percent = Some(percent);
                    transition(
                        app,
                        UpdateState::Downloading {
                            version: version.clone(),
                            percent,
                        },
                    );
                }
            },
            || {},
        )
        .await;

    let bytes = match result {
        Ok(bytes) => bytes,
        Err(error) => {
            fail(app, "Could not download or verify the update", error);
            return;
        }
    };
    transition(app, UpdateState::Installing { version });
    // On Windows, the installer restarts the app after the handoff.
    if let Err(error) = update.install(bytes) {
        fail(
            app,
            "Could not install the update. Check for updates to retry.",
            error,
        );
        return;
    }
    app.restart();
}

#[tauri::command]
pub async fn get_update_state(window: WebviewWindow) -> Result<UpdateState, String> {
    crate::require_panel(&window)?;
    let state = window
        .app_handle()
        .state::<Service>()
        .lock()
        .unwrap()
        .clone();
    Ok(state)
}

#[tauri::command]
pub async fn check_for_updates(window: WebviewWindow) -> Result<(), String> {
    crate::require_panel(&window)?;
    check(window.app_handle(), true).await;
    Ok(())
}
