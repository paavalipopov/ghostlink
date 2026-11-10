use crate::geometry::{Bounds, Point};

pub fn cursor(app: &tauri::AppHandle) -> Option<Point> {
    let point = app.cursor_position().ok()?;
    Some(Point {
        x: point.x.round() as i32,
        y: point.y.round() as i32,
    })
}

pub fn set_overlay_visible(window: &tauri::WebviewWindow, visible: bool) -> Result<(), String> {
    if visible {
        window.show()
    } else {
        window.hide()
    }
    .map_err(|error| error.to_string())
}

pub fn window_at(_: Point) -> Option<Bounds> {
    None
}

pub fn set_click_handler(handler: Option<super::ClickHandler>) -> Result<(), String> {
    if handler.is_some() {
        return Err("Sending desktop click pings is available on Windows.".into());
    }
    Ok(())
}
