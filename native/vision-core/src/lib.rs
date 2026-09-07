//! Shared, deterministic primitives for the iOS and Android vision adapters.
//!
//! This crate does not yet ship an ML runtime. Its job is to keep board geometry, confidence
//! policy, and eventual C/Swift/Kotlin bridge types identical across platforms. Model execution
//! should be injected behind platform adapters (Core ML / TensorFlow Lite / MediaPipe delegate).

const SEGMENT_ORDER: [u8; 20] = [
    20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ring {
    Single,
    Double,
    Triple,
    InnerBull,
    OuterBull,
    Miss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DartZone {
    pub ring: Ring,
    pub segment: Option<u8>,
    pub score: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoardPointMm {
    pub x_mm: f64,
    pub y_mm: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CameraQuality {
    pub overall: f32,
    pub board_diameter_pixels: u32,
    pub off_axis_degrees: f32,
    pub occlusion_risk: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QualityGate {
    pub min_overall: f32,
    pub min_board_diameter_pixels: u32,
    pub max_off_axis_degrees: f32,
    pub max_occlusion_risk: f32,
}

impl Default for QualityGate {
    fn default() -> Self {
        Self {
            min_overall: 0.70,
            min_board_diameter_pixels: 480,
            max_off_axis_degrees: 55.0,
            max_occlusion_risk: 0.70,
        }
    }
}

pub fn passes_quality_gate(quality: CameraQuality, gate: QualityGate) -> bool {
    quality.overall >= gate.min_overall
        && quality.board_diameter_pixels >= gate.min_board_diameter_pixels
        && quality.off_axis_degrees <= gate.max_off_axis_degrees
        && quality.occlusion_risk <= gate.max_occlusion_risk
}

/// Decode a dart point after pixel coordinates have been mapped onto the canonical board plane.
pub fn decode_board_point(point: BoardPointMm) -> DartZone {
    let radius = point.x_mm.hypot(point.y_mm);
    if radius <= 6.35 {
        return DartZone { ring: Ring::InnerBull, segment: None, score: 50 };
    }
    if radius <= 15.9 {
        return DartZone { ring: Ring::OuterBull, segment: None, score: 25 };
    }
    if radius > 170.0 {
        return DartZone { ring: Ring::Miss, segment: None, score: 0 };
    }

    let segment = segment_at(point);
    let (ring, score) = if radius < 99.0 {
        (Ring::Single, segment)
    } else if radius <= 107.0 {
        (Ring::Triple, segment * 3)
    } else if radius < 162.0 {
        (Ring::Single, segment)
    } else {
        (Ring::Double, segment * 2)
    };
    DartZone { ring, segment: Some(segment), score }
}

/// Clockwise, face-on segment selection with 20 centered at twelve o'clock.
pub fn segment_at(point: BoardPointMm) -> u8 {
    let degrees = point.x_mm.atan2(-point.y_mm).to_degrees().rem_euclid(360.0);
    let index = (((degrees + 9.0) / 18.0).floor() as usize) % SEGMENT_ORDER.len();
    SEGMENT_ORDER[index]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_top_triple_to_t20() {
        assert_eq!(
            decode_board_point(BoardPointMm { x_mm: 0.0, y_mm: -103.0 }),
            DartZone { ring: Ring::Triple, segment: Some(20), score: 60 }
        );
    }

    #[test]
    fn maps_bull_and_miss() {
        assert_eq!(
            decode_board_point(BoardPointMm { x_mm: 0.0, y_mm: 0.0 }),
            DartZone { ring: Ring::InnerBull, segment: None, score: 50 }
        );
        assert_eq!(
            decode_board_point(BoardPointMm { x_mm: 171.0, y_mm: 0.0 }),
            DartZone { ring: Ring::Miss, segment: None, score: 0 }
        );
    }
}
