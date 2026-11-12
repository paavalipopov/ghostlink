// SPDX-License-Identifier: GPL-3.0-or-later
use super::Status;
use crate::platform::WindowTarget;
use serde::Deserialize;
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::windows::process::CommandExt,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        mpsc::{self, Receiver},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
    UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, ClipCursor, GetAncestor, GetClientRect, GetForegroundWindow,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, GA_ROOT,
    },
};

#[derive(Deserialize)]
struct Reply {
    protocol: u32,
    state: String,
    error: i32,
    target: usize,
}

struct Session {
    child: Child,
    input: ChildStdin,
    replies: Receiver<Result<Reply, String>>,
    target: usize,
    cleanup_needed: bool,
}

#[link(name = "Magnification")]
unsafe extern "system" {
    fn MagInitialize() -> i32;
    fn MagShowSystemCursor(show: i32) -> i32;
    fn MagUninitialize() -> i32;
}

fn restore_cursor() {
    unsafe {
        ClipCursor(std::ptr::null());
        let name: Vec<u16> = "user32.dll".encode_utf16().chain(Some(0)).collect();
        if let Some(show) = GetProcAddress(
            GetModuleHandleW(name.as_ptr()),
            c"ShowSystemCursor".as_ptr().cast(),
        ) {
            let show: unsafe extern "system" fn(i32) = std::mem::transmute(show);
            show(1);
        } else if MagInitialize() != 0 {
            MagShowSystemCursor(1);
            MagUninitialize();
        }
    }
}

impl Session {
    fn receive(&self) -> Result<Reply, String> {
        let reply = self
            .replies
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "Fullscreen helper did not respond within two seconds.".to_string())??;
        if reply.protocol != 1
            || ![
                "ready", "starting", "scaling", "waiting", "idle", "failed", "rejected", "stopping",
            ]
            .contains(&reply.state.as_str())
            || (reply.target != 0 && reply.target != self.target)
        {
            return Err("Invalid fullscreen helper response.".into());
        }
        Ok(reply)
    }

    fn request(&mut self, command: &str) -> Result<Reply, String> {
        writeln!(self.input, "{command}")
            .and_then(|_| self.input.flush())
            .map_err(|e| e.to_string())?;
        self.receive()
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = writeln!(self.input, "quit");
        let _ = self.input.flush();
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => break,
                _ if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
                _ => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    break;
                }
            }
        }
        // The engine normally restores this itself. Also recover after a crash or forced timeout.
        if self.cleanup_needed {
            restore_cursor();
        }
    }
}

#[derive(Default)]
struct Controller {
    session: Option<Session>,
    status: Status,
}

#[derive(Clone, Default)]
pub struct Service(Arc<Mutex<Controller>>);

impl Service {
    pub fn setup(&self, _: &tauri::AppHandle) {
        let service = self.clone();
        thread::Builder::new()
            .name("fullscreen-watchdog".into())
            .spawn(move || loop {
                thread::sleep(Duration::from_millis(250));
                let Ok(mut control) = service.0.try_lock() else {
                    continue;
                };
                let Some(session) = control.session.as_mut() else {
                    continue;
                };
                let result = match session.child.try_wait() {
                    Ok(Some(code)) => Err(if code.success() {
                        String::new()
                    } else {
                        format!("Fullscreen helper exited: {code}")
                    }),
                    Ok(None) => session.request("status").and_then(|r| {
                        if r.state == "failed" || r.error != 0 {
                            Err(format!(
                                "Magpie could not scale this window (code {}).",
                                r.error
                            ))
                        } else {
                            Ok(r.state)
                        }
                    }),
                    Err(e) => Err(e.to_string()),
                };
                match result {
                    Ok(state) => {
                        if state == "idle" {
                            control.session.take();
                        }
                        control.status = Status {
                            state,
                            ..Status::default()
                        }
                    }
                    Err(error) => {
                        control.session.take();
                        control.status = Status {
                            state: if error.is_empty() {
                                "idle".into()
                            } else {
                                "failed".into()
                            },
                            error: (!error.is_empty()).then_some(error),
                            ..Status::default()
                        };
                    }
                }
            })
            .expect("fullscreen watchdog thread");
    }

    pub fn status(&self) -> Status {
        self.0.lock().unwrap().status.clone()
    }

    pub fn stop(&self) {
        let mut control = self.0.lock().unwrap();
        control.session.take();
        control.status = Status::default();
    }

    pub fn start(&self, app: &tauri::AppHandle, target: WindowTarget) -> Result<Status, String> {
        let mut control = self.0.lock().unwrap();
        if control.session.is_some() {
            return Err("Stop the current fullscreen helper first.".into());
        }
        {
            let capture = app.state::<crate::Capture>();
            let selection = capture.lock().unwrap();
            if selection.tracked_window != Some(target) || selection.drag.is_some() {
                return Err("The selected window changed. Try again.".into());
            }
        }
        let (hwnd, pid, tid) = target.identity();
        let hwnd_native = hwnd as HWND;
        let mut actual_pid = 0;
        let mut rect = RECT::default();
        unsafe {
            if GetWindowThreadProcessId(hwnd_native, &mut actual_pid) != tid
                || actual_pid != pid
                || pid == std::process::id()
                || GetAncestor(hwnd_native, GA_ROOT) != hwnd_native
                || IsWindowVisible(hwnd_native) == 0
                || IsIconic(hwnd_native) != 0
                || GetClientRect(hwnd_native, &mut rect) == 0
                || rect.right < 16
                || rect.bottom < 16
                || rect.right > 16384
                || rect.bottom > 16384
            {
                return Err(
                    "The selected window is closed, minimized, or unsuitable for fullscreen."
                        .into(),
                );
            }
        }
        let resources = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("fullscreen");
        let helper = resources.join("ghostlink-fullscreen-host.exe");
        if !helper.is_file() {
            return Err("The bundled fullscreen helper is missing. Run npm run fullscreen:build and rebuild Ghostlink.".into());
        }
        let cache = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("fullscreen");
        let effects = cache.join("effects");
        fs::create_dir_all(&effects).map_err(|e| e.to_string())?;
        for effect in ["Bilinear.hlsl", "Bicubic.hlsl", "StubDefs.hlsli"] {
            fs::copy(resources.join("effects").join(effect), effects.join(effect))
                .map_err(|e| e.to_string())?;
        }
        let mut child = Command::new(helper)
            .current_dir(&cache)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        let input = child.stdin.take().unwrap();
        let output = child.stdout.take().unwrap();
        let (tx, replies) = mpsc::sync_channel(4);
        thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut line = String::new();
                // Bound memory even if a faulty helper never emits a newline.
                let result = reader.by_ref().take(513).read_line(&mut line);
                match result {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let response = if line.len() > 512 || !line.ends_with('\n') {
                            Err("Oversized helper reply.".into())
                        } else {
                            serde_json::from_str(&line).map_err(|e| e.to_string())
                        };
                        if tx.send(response).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        let mut session = Session {
            child,
            input,
            replies,
            target: hwnd,
            cleanup_needed: false,
        };
        let ready = session.receive()?;
        if ready.state != "ready" {
            return Err(format!(
                "Fullscreen helper unavailable (code {}). Ctrl+Alt+F11 must be free.",
                ready.error
            ));
        }
        // Do this after helper initialization, while the explicit panel click still
        // authorizes the parent to activate the selected source. A spawn-time grant
        // can expire on subsequent input, and cross-thread activation is asynchronous.
        unsafe {
            if GetForegroundWindow() != hwnd_native {
                AllowSetForegroundWindow(session.child.id());
                SetForegroundWindow(hwnd_native);
            }
        }
        session.cleanup_needed = true;
        let reply = session.request(&format!("start {hwnd} {pid} {tid}"))?;
        if reply.state != "starting" || reply.error != 0 {
            session.cleanup_needed = false;
            return Err(if reply.error == -3 {
                "Windows did not activate the selected window. Focus that window and retry Dev fullscreen.".into()
            } else {
                format!("Fullscreen start rejected (code {}). Check the helper log for capture details.", reply.error)
            });
        }
        {
            let capture = app.state::<crate::Capture>();
            let selection = capture.lock().unwrap();
            if selection.tracked_window != Some(target) || selection.drag.is_some() {
                return Err("The selected window changed. Try again.".into());
            }
        }
        control.status = Status {
            state: reply.state,
            ..Status::default()
        };
        control.session = Some(session);
        Ok(control.status.clone())
    }
}
