use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum UpdateState {
    Unsupported,
    Idle,
    Checking,
    Available { version: String },
    Downloading { version: String, percent: u8 },
    Ready { version: String },
    Installing { version: String },
    UpToDate { version: String },
    Error { message: String },
}

pub struct Updates {
    state: UpdateState,
    staged: Option<(Update, Vec<u8>)>,
}

pub type Service = Mutex<Updates>;

impl Default for Updates {
    fn default() -> Self {
        Self {
            state: UpdateState::Unsupported,
            staged: None,
        }
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
            if matches!(
                app.state::<Service>().lock().unwrap().state,
                UpdateState::Idle
            ) {
                check(&app).await;
            }
        });
    }
}

fn publish(app: &AppHandle, state: UpdateState) {
    let _ = app.emit_to(EventTarget::webview_window("panel"), "update-state", state);
}

fn transition(app: &AppHandle, state: UpdateState) {
    app.state::<Service>().lock().unwrap().state = state.clone();
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

async fn check(app: &AppHandle) {
    {
        let service = app.state::<Service>();
        let mut updates = service.lock().unwrap();
        if !matches!(
            updates.state,
            UpdateState::Idle | UpdateState::UpToDate { .. } | UpdateState::Error { .. }
        ) {
            return;
        }
        updates.state = UpdateState::Checking;
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
    transition(
        app,
        UpdateState::Available {
            version: version.clone(),
        },
    );
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

    match result {
        Ok(bytes) => {
            let state = UpdateState::Ready { version };
            {
                let service = app.state::<Service>();
                let mut updates = service.lock().unwrap();
                updates.staged = Some((update, bytes));
                updates.state = state.clone();
            }
            publish(app, state);
        }
        Err(error) => fail(app, "Could not download or verify the update", error),
    }
}

#[tauri::command]
pub async fn get_update_state(window: WebviewWindow) -> Result<UpdateState, String> {
    crate::require_panel(&window)?;
    let state = window
        .app_handle()
        .state::<Service>()
        .lock()
        .unwrap()
        .state
        .clone();
    Ok(state)
}

#[tauri::command]
pub async fn check_for_updates(window: WebviewWindow) -> Result<(), String> {
    crate::require_panel(&window)?;
    check(window.app_handle()).await;
    Ok(())
}

#[tauri::command]
pub async fn restart_and_update(window: WebviewWindow) -> Result<bool, String> {
    crate::require_panel(&window)?;
    let app = window.app_handle();
    let (update, bytes, state) = {
        let service = app.state::<Service>();
        let mut updates = service.lock().unwrap();
        let Some((update, bytes)) = updates.staged.take() else {
            return Ok(false);
        };
        let state = UpdateState::Installing {
            version: update.version.clone(),
        };
        updates.state = state.clone();
        (update, bytes, state)
    };
    publish(app, state);

    // Windows hands off to the installer, which restarts the app. Other platforms return here.
    if let Err(error) = update.install(bytes) {
        fail(
            app,
            "Could not install the update. Check for updates to retry.",
            error,
        );
        return Ok(false);
    }
    app.restart();
}
