#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{
    cursor, keep_overlay_above, set_click_handler, set_overlay_visible, window_area, window_at,
    WindowTarget,
};

#[cfg(not(windows))]
mod portable;
#[cfg(not(windows))]
pub use portable::{
    cursor, keep_overlay_above, set_click_handler, set_overlay_visible, window_area, window_at,
    WindowTarget,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowArea {
    // Magpie leaves the real mouse in the source window while displaying a scaled copy elsewhere.
    pub input: crate::geometry::Bounds,
    pub display: crate::geometry::Bounds,
}

pub type ClickHandler = Box<dyn Fn(crate::geometry::Point)>;

pub fn desktop_areas_available() -> bool {
    !cfg!(target_os = "linux")
        || (std::env::var_os("WAYLAND_DISPLAY").is_none()
            && std::env::var("XDG_SESSION_TYPE").as_deref() != Ok("wayland"))
}
