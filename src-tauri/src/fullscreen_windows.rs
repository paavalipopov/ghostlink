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
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, EventTarget, Manager};
use windows_sys::Win32::{
    Foundation::{GetLastError, HWND, RECT},
    System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
    UI::{
        Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_NOREPEAT, MOD_SHIFT,
        },
        WindowsAndMessaging::{
            AllowSetForegroundWindow, ClipCursor, GetAncestor, GetClientRect, GetForegroundWindow,
            GetMessageW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
            GA_ROOT, MSG, WM_HOTKEY,
        },
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

fn observe_exit(session: &mut Session, pipe_closed: bool) -> Option<bool> {
    let success = |session: &mut Session| match session.child.try_wait() {
        Ok(Some(code)) => Some(code.success()),
        _ => None,
    };
    if let Some(done) = success(session) {
        return Some(done);
    }
    if !pipe_closed {
        return None;
    }
    let deadline = Instant::now() + Duration::from_millis(400);
    while Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
        if let Some(done) = success(session) {
            return Some(done);
        }
    }
    success(session)
}

#[derive(Default)]
struct Controller {
    session: Option<Session>,
    status: Status,
    hotkey_error: Option<String>,
}

struct BusyGuard(Arc<AtomicBool>);

impl BusyGuard {
    fn try_acquire(flag: &Arc<AtomicBool>) -> Result<Self, String> {
        if flag
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            Err("A fullscreen change is already in progress.".into())
        } else {
            Ok(Self(flag.clone()))
        }
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone)]
pub struct Service {
    control: Arc<Mutex<Controller>>,
    busy: Arc<AtomicBool>,
    app: Arc<Mutex<Option<AppHandle>>>,
}

impl Default for Service {
    fn default() -> Self {
        Self {
            control: Arc::new(Mutex::new(Controller::default())),
            busy: Arc::new(AtomicBool::new(false)),
            app: Arc::new(Mutex::new(None)),
        }
    }
}

impl Service {
    pub fn setup(&self, app: &AppHandle) {
        *self.app.lock().unwrap() = Some(app.clone());
        self.spawn_shortcut(app.clone());
        let service = self.clone();
        thread::Builder::new()
            .name("fullscreen-watchdog".into())
            .spawn(move || loop {
                thread::sleep(Duration::from_millis(250));
                let Ok(mut control) = service.control.try_lock() else {
                    continue;
                };
                let result = {
                    let Some(session) = control.session.as_mut() else {
                        continue;
                    };
                    match session.child.try_wait() {
                        Ok(Some(code)) => Err(if code.success() {
                            String::new()
                        } else {
                            format!("Fullscreen helper exited: {code}")
                        }),
                        Ok(None) => match session.request("status") {
                            Ok(reply) => {
                                if reply.state == "failed" || reply.error != 0 {
                                    Err(format!(
                                        "Magpie could not scale this window (code {}).",
                                        reply.error
                                    ))
                                } else {
                                    Ok(reply.state)
                                }
                            }
                            Err(error) => {
                                let pipe_closed = error == super::HELPER_PIPE_CLOSED;
                                let exit_success = observe_exit(session, pipe_closed);
                                let crash = session
                                    .child
                                    .try_wait()
                                    .ok()
                                    .flatten()
                                    .map(|code| format!("Fullscreen helper exited: {code}"))
                                    .unwrap_or_default();
                                Err(super::lost_poll_error(&error, exit_success, &crash))
                            }
                        },
                        Err(e) => Err(e.to_string()),
                    }
                };
                let published = match result {
                    Ok(state) => {
                        if state == "idle" {
                            control.session.take();
                        }
                        control.status = Status {
                            state,
                            ..Status::default()
                        };
                        present(&control)
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
                        present(&control)
                    }
                };
                drop(control);
                service.publish(&published);
            })
            .expect("fullscreen watchdog thread");
    }

    pub fn status(&self) -> Status {
        present(&self.control.lock().unwrap())
    }

    pub fn stop(&self) {
        let status = {
            let mut control = self.control.lock().unwrap();
            control.session.take();
            control.status = Status::default();
            present(&control)
        };
        self.publish(&status);
    }

    pub fn stop_request(&self) -> Result<Status, String> {
        let _busy = BusyGuard::try_acquire(&self.busy)?;
        self.stop();
        Ok(self.status())
    }

    pub fn note_failure(&self, error: &str) {
        let status = {
            let mut control = self.control.lock().unwrap();
            if control.session.is_some() {
                return;
            }
            control.status = Status {
                state: "failed".into(),
                error: Some(error.to_string()),
                ..Status::default()
            };
            present(&control)
        };
        self.publish(&status);
    }

    pub fn publish(&self, status: &Status) {
        let Some(app) = self.app.lock().unwrap().clone() else {
            return;
        };
        let _ = app.emit_to(
            EventTarget::webview_window("panel"),
            "fullscreen-status",
            status,
        );
    }

    pub fn toggle(&self, app: &AppHandle) -> Result<Status, String> {
        let active = self.is_active();
        match super::toggle_action(active, self.busy.load(Ordering::SeqCst)) {
            super::ToggleAction::Busy => Err("A fullscreen change is already in progress.".into()),
            super::ToggleAction::Stop => self.stop_request(),
            super::ToggleAction::Start => self.start(app, tracked_target(app)?),
        }
    }

    fn is_active(&self) -> bool {
        let control = self.control.lock().unwrap();
        control.session.is_some() || super::session_is_active(&control.status.state)
    }

    fn spawn_shortcut(&self, app: AppHandle) {
        let service = self.clone();
        thread::Builder::new()
            .name("fullscreen-shortcut".into())
            .spawn(move || unsafe {
                const VK_A: u32 = 0x41;
                let registered = RegisterHotKey(
                    std::ptr::null_mut(),
                    1,
                    MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
                    VK_A,
                );
                if registered == 0 {
                    service.note_shortcut(super::shortcut_conflict(GetLastError()));
                    return;
                }
                let mut message: MSG = std::mem::zeroed();
                while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                    if message.message == WM_HOTKEY {
                        let _ = super::run_toggle(&app);
                    }
                }
                let _ = UnregisterHotKey(std::ptr::null_mut(), 1);
            })
            .expect("fullscreen shortcut thread");
    }

    fn note_shortcut(&self, message: String) {
        {
            let mut control = self.control.lock().unwrap();
            control.hotkey_error = Some(message);
        }
        let status = self.status();
        self.publish(&status);
    }

    pub fn start(&self, app: &AppHandle, target: WindowTarget) -> Result<Status, String> {
        let _busy = BusyGuard::try_acquire(&self.busy)?;
        let mut control = self.control.lock().unwrap();
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
                    Ok(0) | Err(_) => {
                        let _ = tx.send(Err(super::HELPER_PIPE_CLOSED.into()));
                        break;
                    }
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
                "Windows did not activate the selected window. Focus that window and retry Fullscreen.".into()
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
        let status = present(&control);
        drop(control);
        self.publish(&status);
        Ok(status)
    }
}

fn present(control: &Controller) -> Status {
    let mut status = control.status.clone();
    if status.error.is_none() {
        status.error = control.hotkey_error.clone();
    }
    status
}

fn tracked_target(app: &AppHandle) -> Result<WindowTarget, String> {
    if !crate::platform::desktop_areas_available() {
        return Err("Desktop area selection is unavailable in this session.".into());
    }
    let capture = app.state::<crate::Capture>();
    let selection = capture.lock().unwrap();
    if selection.drag.is_some() {
        return Err("Finish or cancel the current drag first.".into());
    }
    selection
        .tracked_window
        .ok_or_else(|| "Pick a window before entering fullscreen.".into())
}
