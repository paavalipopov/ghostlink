#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::{cursor, set_overlay_visible};

#[cfg(not(windows))]
compile_error!("The Ghostlink Tauri prototype currently supports Windows only.");
