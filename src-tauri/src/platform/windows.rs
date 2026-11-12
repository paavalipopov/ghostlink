use super::{ClickHandler, WindowArea};
use crate::geometry::{Bounds, Point};
use std::cell::RefCell;
use windows_sys::Win32::{
    Foundation::{HWND, POINT, RECT},
    Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::{
        CallNextHookEx, FindWindowW, GetAncestor, GetForegroundWindow, GetPhysicalCursorPos,
        GetPropW, GetShellWindow, GetWindow, GetWindowRect, GetWindowTextLengthW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetWindowPos, SetWindowsHookExW,
        UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, GW_HWNDPREV, HHOOK, HWND_TOPMOST,
        MSLLHOOKSTRUCT, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        SWP_SHOWWINDOW, WH_MOUSE_LL, WM_LBUTTONDOWN,
    },
};

struct MouseHook {
    handle: HHOOK,
    on_click: ClickHandler,
}

impl Drop for MouseHook {
    fn drop(&mut self) {
        unsafe { UnhookWindowsHookEx(self.handle) };
    }
}

// The panel command and the low-level hook run on the same Windows message loop.
thread_local! {
    static MOUSE_HOOK: RefCell<Option<MouseHook>> = const { RefCell::new(None) };
}

pub fn set_click_handler(handler: Option<ClickHandler>) -> Result<(), String> {
    MOUSE_HOOK.with(|slot| {
        slot.replace(None);
        if let Some(on_click) = handler {
            let handle = unsafe {
                SetWindowsHookExW(
                    WH_MOUSE_LL,
                    Some(mouse_event),
                    GetModuleHandleW(std::ptr::null()),
                    0,
                )
            };
            if handle.is_null() {
                return Err(format!(
                    "Could not capture desktop clicks: {}",
                    std::io::Error::last_os_error()
                ));
            }
            slot.replace(Some(MouseHook { handle, on_click }));
        }
        Ok(())
    })
}

unsafe extern "system" fn mouse_event(code: i32, message: usize, data: isize) -> isize {
    if code == 0 && message == WM_LBUTTONDOWN as usize && data != 0 {
        let point = unsafe { (*(data as *const MSLLHOOKSTRUCT)).pt };
        MOUSE_HOOK.with(|slot| {
            if let Ok(slot) = slot.try_borrow() {
                if let Some(hook) = slot.as_ref() {
                    (hook.on_click)(Point {
                        x: point.x,
                        y: point.y,
                    });
                }
            }
        });
    }
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, message, data) }
}

pub fn cursor(_: &tauri::AppHandle) -> Option<Point> {
    let mut point = POINT { x: 0, y: 0 };
    // The pointer is in signed physical desktop pixels, independent of the caller's DPI context.
    let ok = unsafe { GetPhysicalCursorPos(&mut point) };
    (ok != 0).then_some(Point {
        x: point.x,
        y: point.y,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowTarget {
    hwnd: usize,
    pid: u32,
    thread: u32,
}

impl WindowTarget {
    pub fn identity(self) -> (usize, u32, u32) {
        (self.hwnd, self.pid, self.thread)
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

fn target(hwnd: HWND) -> Option<WindowTarget> {
    let mut pid = 0;
    let thread = unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    (thread != 0).then_some(WindowTarget {
        hwnd: hwnd as usize,
        pid,
        thread,
    })
}

fn valid_target(window: WindowTarget) -> bool {
    target(window.hwnd as HWND) == Some(window)
}

fn magpie_window() -> HWND {
    // Magpie uses this class for both windowed and fullscreen scaling (v0.13).
    unsafe {
        FindWindowW(
            wide("Window_Magpie_967EB565-6F73-4E94-AE53-00CC42592A22").as_ptr(),
            std::ptr::null(),
        )
    }
}

fn magpie_source(hwnd: HWND) -> HWND {
    unsafe { GetPropW(hwnd, wide("Magpie.SrcHWND").as_ptr()) as HWND }
}

fn magpie_bounds(hwnd: HWND, prefix: &str) -> Option<Bounds> {
    let edge = |name| unsafe {
        GetPropW(hwnd, wide(&format!("Magpie.{prefix}{name}")).as_ptr()) as isize as i32
    };
    Bounds::from_edges(edge("Left"), edge("Top"), edge("Right"), edge("Bottom"))
}

fn magpie_area(window: WindowTarget) -> Option<(HWND, WindowArea)> {
    magpie_area_for(magpie_window(), window)
}

fn magpie_area_for(hwnd: HWND, window: WindowTarget) -> Option<(HWND, WindowArea)> {
    if hwnd.is_null()
        || unsafe { IsWindowVisible(hwnd) } == 0
        || magpie_source(hwnd) != window.hwnd as HWND
    {
        return None;
    }
    let input = magpie_bounds(hwnd, "Src")?;
    let display = magpie_bounds(hwnd, "Dest")?;
    Some((hwnd, WindowArea { input, display }))
}

pub fn window_at(point: Point) -> Option<WindowTarget> {
    // The scaled view is deliberately non-activating / click-through. Hit testing can return
    // the original window, Magpie's renderer, or another window behind the displayed image.
    let hwnd = unsafe {
        GetAncestor(
            WindowFromPoint(POINT {
                x: point.x,
                y: point.y,
            }),
            GA_ROOT,
        )
    };
    let magpie = magpie_window();
    if !magpie.is_null() && unsafe { IsWindowVisible(magpie) } != 0 {
        if let Some(source) = target(magpie_source(magpie)) {
            if source.pid != std::process::id()
                && (hwnd == magpie || hwnd == source.hwnd as HWND)
                && magpie_area(source).is_some_and(|(_, area)| area.display.sample(point).inside)
            {
                return Some(source);
            }
        }
    }
    unsafe {
        if hwnd.is_null() || hwnd == GetShellWindow() || GetWindowTextLengthW(hwnd) == 0 {
            return None;
        }
        target(hwnd).filter(|window| window.pid != std::process::id())
    }
}

pub fn window_area(window: WindowTarget) -> Option<WindowArea> {
    if !valid_target(window) {
        return None;
    }
    let hwnd = window.hwnd as HWND;
    if unsafe { IsIconic(hwnd) } != 0 || unsafe { IsWindowVisible(hwnd) } == 0 {
        return None;
    }
    if let Some((_, area)) = magpie_area(window) {
        return Some(area);
    }
    unsafe {
        let mut rect = RECT::default();
        // DWM's frame excludes invisible resize margins and uses physical pixels.
        let status = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            (&mut rect as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        );
        if status < 0 && GetWindowRect(hwnd, &mut rect) == 0 {
            return None;
        }
        let bounds = Bounds::from_edges(rect.left, rect.top, rect.right, rect.bottom)?;
        Some(WindowArea {
            input: bounds,
            display: bounds,
        })
    }
}

pub fn keep_overlay_above(overlay: &tauri::WebviewWindow, window: WindowTarget) {
    if !valid_target(window) {
        return;
    }
    let foreground = unsafe { GetForegroundWindow() };
    let reference = magpie_area(window).map_or(window.hwnd as HWND, |(hwnd, _)| hwnd);
    if foreground != window.hwnd as HWND && foreground != reference {
        return;
    }
    let Ok(hwnd) = overlay.hwnd() else { return };
    let mut above = unsafe { GetWindow(reference, GW_HWNDPREV) };
    for _ in 0..1024 {
        if above == hwnd.0 {
            return;
        }
        if above.is_null() {
            break;
        }
        above = unsafe { GetWindow(above, GW_HWNDPREV) };
    }
    // Raise only when covered by the selected app; never take focus or fight another app.
    let _ = set_overlay_visible(overlay, true);
}

pub fn set_overlay_visible(window: &tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let change = if visible {
        SWP_SHOWWINDOW
    } else {
        SWP_HIDEWINDOW
    };
    // Tauri's Windows show path can activate this window even when configured as non-focusable.
    let ok = unsafe {
        SetWindowPos(
            hwnd.0,
            if visible {
                HWND_TOPMOST
            } else {
                std::ptr::null_mut()
            },
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE
                | SWP_NOMOVE
                | SWP_NOSIZE
                | if visible { 0 } else { SWP_NOZORDER }
                | change,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, SetPropW, ShowWindow, SW_SHOWNOACTIVATE, WS_EX_NOACTIVATE,
        WS_EX_TOOLWINDOW, WS_POPUP,
    };

    struct Fixture(HWND);

    impl Fixture {
        fn new() -> Self {
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
                    wide("STATIC").as_ptr(),
                    wide("Ghostlink coordinate test").as_ptr(),
                    WS_POPUP,
                    -30000,
                    -30000,
                    16,
                    16,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    GetModuleHandleW(std::ptr::null()),
                    std::ptr::null(),
                )
            };
            assert!(!hwnd.is_null());
            unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
            Self(hwnd)
        }

        fn property(&self, name: &str, value: isize) {
            assert_ne!(
                unsafe { SetPropW(self.0, wide(name).as_ptr(), value as _) },
                0
            );
        }

        fn rect(&self, prefix: &str, bounds: Bounds) {
            for (edge, value) in [
                ("Left", bounds.x),
                ("Top", bounds.y),
                ("Right", bounds.x + bounds.width as i32),
                ("Bottom", bounds.y + bounds.height as i32),
            ] {
                self.property(&format!("Magpie.{prefix}{edge}"), value as isize);
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            unsafe { DestroyWindow(self.0) };
        }
    }

    #[test]
    fn reads_synthetic_magpie_metadata_updates_including_negative_origins() {
        let source = Fixture::new();
        let scaled = Fixture::new();
        let target = target(source.0).unwrap();
        scaled.property("Magpie.SrcHWND", source.0 as isize);
        let input = Bounds::from_edges(-1400, -700, -1000, -400).unwrap();
        let display = Bounds::from_edges(-1920, -1080, 0, 0).unwrap();
        scaled.rect("Src", input);
        scaled.rect("Dest", display);
        assert_eq!(
            magpie_area_for(scaled.0, target).unwrap().1,
            WindowArea { input, display }
        );
        let sample = input.sample(Point { x: -1200, y: -550 });
        assert_eq!((sample.x, sample.y, sample.inside), (0.5, 0.5, true));

        // Exercise another snapshot of the HWND metadata, not an actual Magpie mode switch.
        let input = Bounds::from_edges(200, 100, 1000, 700).unwrap();
        let display = Bounds::from_edges(80, 0, 1520, 1080).unwrap();
        scaled.rect("Src", input);
        scaled.rect("Dest", display);
        assert_eq!(
            magpie_area_for(scaled.0, target).unwrap().1,
            WindowArea { input, display }
        );
        assert!(input.sample(Point { x: 999, y: 699 }).inside);
        assert!(!input.sample(Point { x: 1000, y: 700 }).inside);

        // Degenerate metadata must not become a zero-sized frame.
        scaled.rect(
            "Dest",
            Bounds {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            },
        );
        assert!(magpie_area_for(scaled.0, target).is_none());
    }

    #[test]
    fn rejects_valid_metadata_for_a_different_source() {
        let source = Fixture::new();
        let scaled = Fixture::new();
        let target = target(source.0).unwrap();
        scaled.rect("Src", Bounds::from_edges(100, 100, 500, 400).unwrap());
        scaled.rect("Dest", Bounds::from_edges(0, 0, 1600, 1200).unwrap());
        scaled.property("Magpie.SrcHWND", source.0 as isize);
        assert!(
            magpie_area_for(scaled.0, target).is_some(),
            "The fixture must be valid before testing rejection"
        );
        scaled.property("Magpie.SrcHWND", scaled.0 as isize);
        assert!(magpie_area_for(scaled.0, target).is_none());
    }

    #[test]
    fn stops_tracking_a_destroyed_native_window() {
        let source = Fixture::new();
        let target = target(source.0).unwrap();
        assert!(
            window_area(target).is_some(),
            "The fixture must be trackable before destruction"
        );
        drop(source);
        assert!(window_area(target).is_none());
    }
}
