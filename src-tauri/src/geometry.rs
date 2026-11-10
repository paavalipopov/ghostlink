use serde::{Deserialize, Serialize};

#[derive(Clone, Copy)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
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

#[derive(Deserialize)]
pub struct Drag {
    pub start: Fraction,
    pub end: Fraction,
}

#[derive(Deserialize)]
pub struct Fraction {
    x: f64,
    y: f64,
}

impl Bounds {
    pub fn from_edges(left: i32, top: i32, right: i32, bottom: i32) -> Option<Self> {
        (right > left && bottom > top).then(|| Self {
            x: left,
            y: top,
            width: (i64::from(right) - i64::from(left)) as u32,
            height: (i64::from(bottom) - i64::from(top)) as u32,
        })
    }

    pub fn intersect(self, other: Self) -> Option<Self> {
        Self::from_edges(
            self.x.max(other.x),
            self.y.max(other.y),
            (i64::from(self.x) + i64::from(self.width))
                .min(i64::from(other.x) + i64::from(other.width)) as i32,
            (i64::from(self.y) + i64::from(self.height))
                .min(i64::from(other.y) + i64::from(other.height)) as i32,
        )
    }

    pub fn drag_area(self, drag: Drag) -> Option<Self> {
        let edge = |origin: i32, size: u32, fraction: f64| {
            (f64::from(origin) + f64::from(size) * fraction.clamp(0.0, 1.0)).round() as i32
        };
        let x1 = edge(self.x, self.width, drag.start.x);
        let x2 = edge(self.x, self.width, drag.end.x);
        let y1 = edge(self.y, self.height, drag.start.y);
        let y2 = edge(self.y, self.height, drag.end.y);
        Self::from_edges(x1.min(x2), y1.min(y2), x1.max(x2), y1.max(y2))
            .filter(|area| area.width >= 40 && area.height >= 40)
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
            (
                Bounds {
                    x: -2000,
                    y: 0,
                    width: 2000,
                    height: 1250,
                },
                1.25,
            ),
            (
                Bounds {
                    x: 0,
                    y: -1500,
                    width: 2400,
                    height: 1500,
                },
                1.5,
            ),
        ] {
            let area = display;
            let sample = area.sample(Point {
                x: area.x + 150,
                y: area.y + 75,
            });
            assert!(sample.inside);
            // The marker is positioned as a percentage of the overlay's CSS viewport.
            assert!((sample.x * f64::from(area.width) / scale - 150.0 / scale).abs() < 1e-9);
            assert!((sample.y * f64::from(area.height) / scale - 75.0 / scale).abs() < 1e-9);
        }
    }

    #[test]
    fn includes_first_and_last_pixel_but_excludes_other_pixels() {
        let area = Bounds {
            x: -100,
            y: -40,
            width: 60,
            height: 24,
        };
        assert!(area.sample(Point { x: -100, y: -40 }).inside);
        assert!(area.sample(Point { x: -41, y: -17 }).inside);
        for (x, y) in [(-101, -40), (-100, -41), (-40, -40), (-100, -16)] {
            assert_eq!(area.sample(Point { x, y }), Sample::default());
        }
    }

    #[test]
    fn reversed_drag_clips_to_the_display_and_rejects_tiny_selections() {
        let display = Bounds {
            x: -1600,
            y: -900,
            width: 1600,
            height: 900,
        };
        let area = display.drag_area(Drag {
            start: Fraction { x: 1.1, y: 0.75 },
            end: Fraction { x: 0.25, y: -0.1 },
        });
        assert_eq!(area, Bounds::from_edges(-1200, -900, 0, -225));
        assert!(display
            .drag_area(Drag {
                start: Fraction { x: 0.5, y: 0.5 },
                end: Fraction { x: 0.51, y: 0.51 },
            })
            .is_none());
    }
}
