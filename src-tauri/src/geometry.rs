use serde::Serialize;

#[derive(Clone, Copy)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
pub struct Sample {
    pub x: f64,
    pub y: f64,
    pub inside: bool,
}

impl Bounds {
    pub fn centered_area(self) -> Self {
        let inset_x = self.width / 5;
        let inset_y = self.height / 5;
        Self {
            x: self.x + inset_x as i32,
            y: self.y + inset_y as i32,
            width: self.width - 2 * inset_x,
            height: self.height - 2 * inset_y,
        }
    }

    pub fn sample(self, point: Point) -> Sample {
        let dx = i64::from(point.x) - i64::from(self.x);
        let dy = i64::from(point.y) - i64::from(self.y);
        if dx < 0 || dy < 0 || dx >= i64::from(self.width) || dy >= i64::from(self.height) {
            return Sample::default();
        }
        Sample {
            x: dx as f64 / f64::from(self.width),
            y: dy as f64 / f64::from(self.height),
            inside: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_relative_to_negative_origins_at_different_scales() {
        for (display, scale) in [
            (Bounds { x: -2000, y: 0, width: 2000, height: 1250 }, 1.25),
            (Bounds { x: 0, y: -1500, width: 2400, height: 1500 }, 1.5),
        ] {
            let area = display.centered_area();
            let sample = area.sample(Point { x: area.x + 150, y: area.y + 75 });
            assert!(sample.inside);
            // The marker is positioned as a percentage of the overlay's CSS viewport.
            assert!((sample.x * f64::from(area.width) / scale - 150.0 / scale).abs() < 1e-9);
            assert!((sample.y * f64::from(area.height) / scale - 75.0 / scale).abs() < 1e-9);
        }
    }

    #[test]
    fn includes_first_and_last_pixel_but_excludes_other_pixels() {
        let area = Bounds { x: -100, y: -40, width: 60, height: 24 };
        assert!(area.sample(Point { x: -100, y: -40 }).inside);
        assert!(area.sample(Point { x: -41, y: -17 }).inside);
        for (x, y) in [(-101, -40), (-100, -41), (-40, -40), (-100, -16)] {
            assert_eq!(area.sample(Point { x, y }), Sample::default());
        }
    }
}
