use crate::geometry::{Bounds, Sample};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PeerInput {
    Move {
        session: u32,
        sample: Option<Sample>,
    },
    Click {
        session: u32,
        sample: Sample,
    },
}

pub type QueuedClick = (u32, Bounds, Sample);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerPointer {
    id: String,
    name: String,
    color: String,
    pub x: f64,
    pub y: f64,
    click_key: Option<String>,
}
