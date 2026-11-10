#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{cursor, set_overlay_visible, window_at};

#[cfg(not(windows))]
mod portable;
#[cfg(not(windows))]
pub use portable::{cursor, set_overlay_visible, window_at};

pub fn desktop_areas_available() -> bool {
    !cfg!(target_os = "linux")
        || (std::env::var_os("WAYLAND_DISPLAY").is_none()
            && std::env::var("XDG_SESSION_TYPE").as_deref() != Ok("wayland"))
}
