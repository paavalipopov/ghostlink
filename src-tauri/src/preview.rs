use crate::geometry::Sample;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub sample: Sample,
    pub click_key: Option<u64>,
}

#[derive(Deserialize)]
pub struct PadInput {
    x: f64,
    y: f64,
    click: bool,
}

#[derive(Default)]
pub struct TestPad {
    pub open: bool,
    pub preview: Option<Preview>,
    clicks: u64,
}

impl TestPad {
    pub fn close(&mut self) {
        self.open = false;
        self.preview = None;
    }

    pub fn update(&mut self, input: Option<PadInput>) -> Result<(), &'static str> {
        if !self.open {
            return Ok(());
        }
        let Some(PadInput { x, y, click }) = input else {
            self.preview = None;
            return Ok(());
        };
        if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y) {
            return Err("Pointer is outside the test trackpad.");
        }

        let click_key = if click {
            self.clicks += 1;
            Some(self.clicks)
        } else {
            self.preview.and_then(|preview| preview.click_key)
        };
        self.preview = Some(Preview {
            sample: Sample { x, y, inside: true },
            click_key,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_click_restarts_the_blink_and_closing_clears_it() {
        let mut pad = TestPad {
            open: true,
            ..TestPad::default()
        };
        let input = |click| {
            Some(PadInput {
                x: 0.5,
                y: 0.5,
                click,
            })
        };
        pad.update(input(true)).unwrap();
        let first = pad.preview.unwrap().click_key;
        assert!(first.is_some());
        pad.update(input(false)).unwrap();
        assert_eq!(pad.preview.unwrap().click_key, first);
        pad.update(input(true)).unwrap();
        assert_ne!(pad.preview.unwrap().click_key, first);

        pad.update(None).unwrap();
        assert!(pad.preview.is_none());
        pad.update(input(true)).unwrap();
        pad.close();
        pad.update(input(true)).unwrap();
        assert!(pad.preview.is_none());
    }
}
