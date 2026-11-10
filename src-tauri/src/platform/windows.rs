use crate::geometry::{Bounds, Point};
use windows_sys::Win32::{
    Foundation::{POINT, RECT},
    Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
    UI::WindowsAndMessaging::{
        GetAncestor, GetPhysicalCursorPos, GetShellWindow, GetWindowRect, GetWindowTextLengthW,
        GetWindowThreadProcessId, SetWindowPos, WindowFromPoint, GA_ROOT, SWP_HIDEWINDOW,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW,
    },
};

pub fn cursor(_: &tauri::AppHandle) -> Option<Point> {
    let mut point = POINT { x: 0, y: 0 };
    // The pointer is in signed physical desktop pixels, independent of the caller's DPI context.
    let ok = unsafe { GetPhysicalCursorPos(&mut point) };
    (ok != 0).then_some(Point {
        x: point.x,
        y: point.y,
    })
}

pub fn window_at(point: Point) -> Option<Bounds> {
    unsafe {
        let hwnd = GetAncestor(
            WindowFromPoint(POINT {
                x: point.x,
                y: point.y,
            }),
            GA_ROOT,
        );
        if hwnd.is_null() || hwnd == GetShellWindow() || GetWindowTextLengthW(hwnd) == 0 {
            return None;
        }
        let mut pid = 0;
        if GetWindowThreadProcessId(hwnd, &mut pid) == 0 || pid == std::process::id() {
            return None;
        }
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
        Bounds::from_edges(rect.left, rect.top, rect.right, rect.bottom)
    }
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
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | change,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}
