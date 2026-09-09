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

/// Learned camera-quality evidence after a platform adapter has decoded the model output.
///
/// This mirrors `ModelQualityObservation` in `@darts-180/contracts`. `off_axis_degrees` is the
/// model's normalized `offAxisFraction` multiplied by 90. A native adapter must not synthesize
/// these values from image heuristics or substitute board-pixel diameter for learned coverage.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CameraQuality {
    pub overall: f32,
    pub board_coverage: f32,
    pub sharpness: f32,
    pub glare_risk: f32,
    pub off_axis_degrees: f32,
    pub occlusion_risk: f32,
    pub board_diameter_pixels: f32,
}

/// Geometry evidence calculated from the complete nine-landmark learned pose.
///
/// `minimum_landmark_confidence` is the lowest confidence among bull, D20, D6, D3, D11, and the
/// four outer-cardinal landmarks. `maximum_secondary_landmark_residual_mm` is the largest residual
/// for bull/outer-cardinal validation after fitting the named double anchors.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PoseMetrics {
    pub has_complete_named_landmarks: bool,
    pub minimum_landmark_confidence: f32,
    pub maximum_secondary_landmark_residual_mm: f32,
}

/// Numeric policy copied exactly from a verified schema-v2 browser model manifest's
/// `decisionPolicy` object. Rust uses snake_case at the bridge boundary, but every field has a
/// one-to-one camelCase manifest counterpart.
///
/// There is deliberately no `Default`: a native adapter must receive the reviewed release policy,
/// not silently install a device-local threshold set.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelDecisionPolicy {
    pub auto_record_enabled: bool,
    pub min_auto_score_probability: f32,
    pub min_auto_score_wire_margin_mm: f32,
    pub min_review_probability: f32,
    pub min_zone_posterior_margin: f32,
    pub min_landmark_confidence: f32,
    pub max_pose_validation_residual_mm: f32,
    pub max_quality_off_axis_degrees: f32,
    pub min_board_diameter_pixels: f32,
    pub min_overall_quality: f32,
    pub min_board_coverage: f32,
    pub min_sharpness: f32,
    pub max_glare_risk: f32,
    pub max_occlusion_risk: f32,
    pub tip_track_match_distance_mm: f32,
    pub tip_track_settle_ms: f32,
    pub tip_track_stale_after_ms: f32,
    pub max_tip_track_spread_mm: f32,
    pub confidence_temperature: f32,
    pub confidence_bias: f32,
}

/// Release evidence is verified by the platform's manifest/package verifier before it enters this
/// crate. The booleans are intentionally explicit so auto-recording cannot be enabled merely by
/// passing a numerically valid policy to the native bridge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelReleaseStage {
    Unavailable,
    Development,
    Evaluation,
    Production,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerifiedReleaseEvidence {
    pub stage: ModelReleaseStage,
    pub held_out_evaluation_present: bool,
    pub training_data_present: bool,
    pub license_review_present: bool,
    pub evaluation_timestamp_present: bool,
    pub attestation_verified: bool,
    pub approval_id_present: bool,
}

/// Returns false for malformed learned evidence or policy. This intentionally fails closed; a
/// platform adapter must surface review/abstention rather than guess a score.
pub fn passes_quality_policy(quality: CameraQuality, policy: ModelDecisionPolicy) -> bool {
    decision_policy_is_valid(policy)
        && probability(quality.overall)
        && probability(quality.board_coverage)
        && probability(quality.sharpness)
        && probability(quality.glare_risk)
        && probability(quality.occlusion_risk)
        && degrees(quality.off_axis_degrees)
        && finite_non_negative(quality.board_diameter_pixels)
        && quality.overall >= policy.min_overall_quality
        && quality.board_coverage >= policy.min_board_coverage
        && quality.sharpness >= policy.min_sharpness
        && quality.glare_risk <= policy.max_glare_risk
        && quality.off_axis_degrees <= policy.max_quality_off_axis_degrees
        && quality.occlusion_risk <= policy.max_occlusion_risk
        && quality.board_diameter_pixels >= policy.min_board_diameter_pixels
}

/// Returns false unless every named landmark is present/confident and independent pose validation
/// agrees with the oriented homography.
pub fn passes_pose_policy(metrics: PoseMetrics, policy: ModelDecisionPolicy) -> bool {
    decision_policy_is_valid(policy)
        && metrics.has_complete_named_landmarks
        && probability(metrics.minimum_landmark_confidence)
        && finite_non_negative(metrics.maximum_secondary_landmark_residual_mm)
        && metrics.minimum_landmark_confidence >= policy.min_landmark_confidence
        && metrics.maximum_secondary_landmark_residual_mm <= policy.max_pose_validation_residual_mm
}

/// A capture is admissible only when both learned quality and complete learned geometry pass the
/// same reviewed policy. Tip-specific occlusion must be checked separately for each candidate.
pub fn passes_capture_policy(
    quality: CameraQuality,
    pose: PoseMetrics,
    policy: ModelDecisionPolicy,
) -> bool {
    passes_quality_policy(quality, policy) && passes_pose_policy(pose, policy)
}

/// Tip occlusion uses the same calibrated cap as frame/board occlusion.
pub fn passes_tip_occlusion_policy(tip_occlusion_risk: f32, policy: ModelDecisionPolicy) -> bool {
    decision_policy_is_valid(policy)
        && probability(tip_occlusion_risk)
        && tip_occlusion_risk <= policy.max_occlusion_risk
}

/// Matches the browser's logit-temperature confidence calibration. `None` means raw evidence or
/// policy was malformed and must route to abstention rather than being clamped into confidence.
pub fn calibrated_confidence(raw: f32, policy: ModelDecisionPolicy) -> Option<f32> {
    if !decision_policy_is_valid(policy) || !raw.is_finite() {
        return None;
    }
    let bounded = raw.clamp(0.000_001, 0.999_999);
    let logit = (bounded / (1.0 - bounded)).ln();
    let calibrated =
        1.0 / (1.0 + (-(logit + policy.confidence_bias) / policy.confidence_temperature).exp());
    if calibrated.is_finite() {
        Some(calibrated.clamp(0.0, 1.0))
    } else {
        None
    }
}

/// Mirrors the browser's automatic-score conditions after deterministic geometry has ranked a
/// candidate. A one-view `MISS` is never auto-recorded.
pub fn can_auto_record(
    calibrated_confidence: f32,
    wire_margin_mm: f32,
    posterior_margin: f32,
    candidate_is_miss: bool,
    policy: ModelDecisionPolicy,
    evidence: VerifiedReleaseEvidence,
) -> bool {
    decision_policy_is_valid(policy)
        && release_evidence_allows_auto_record(policy, evidence)
        && probability(calibrated_confidence)
        && finite_non_negative(wire_margin_mm)
        && probability(posterior_margin)
        && !candidate_is_miss
        && calibrated_confidence >= policy.min_auto_score_probability
        && wire_margin_mm >= policy.min_auto_score_wire_margin_mm
        && posterior_margin >= policy.min_zone_posterior_margin
}

/// Mirrors the browser's review threshold. A possible `MISS` may be reviewed but not auto-recorded.
pub fn is_review_eligible(calibrated_confidence: f32, policy: ModelDecisionPolicy) -> bool {
    decision_policy_is_valid(policy)
        && probability(calibrated_confidence)
        && calibrated_confidence >= policy.min_review_probability
}

/// Checks numeric ranges and conservative ordering from the schema-v2 browser manifest parser.
pub fn decision_policy_is_valid(policy: ModelDecisionPolicy) -> bool {
    probability(policy.min_auto_score_probability)
        && finite_non_negative(policy.min_auto_score_wire_margin_mm)
        && probability(policy.min_review_probability)
        && policy.min_review_probability <= policy.min_auto_score_probability
        && probability(policy.min_zone_posterior_margin)
        && probability(policy.min_landmark_confidence)
        && finite_non_negative(policy.max_pose_validation_residual_mm)
        && degrees(policy.max_quality_off_axis_degrees)
        && finite_non_negative(policy.min_board_diameter_pixels)
        && probability(policy.min_overall_quality)
        && probability(policy.min_board_coverage)
        && probability(policy.min_sharpness)
        && probability(policy.max_glare_risk)
        && probability(policy.max_occlusion_risk)
        && finite_positive(policy.tip_track_match_distance_mm)
        && finite_non_negative(policy.tip_track_settle_ms)
        && finite_positive(policy.tip_track_stale_after_ms)
        && policy.tip_track_stale_after_ms >= policy.tip_track_settle_ms
        && finite_non_negative(policy.max_tip_track_spread_mm)
        && finite_positive(policy.confidence_temperature)
        && policy.confidence_bias.is_finite()
}

/// Production always needs a verified hash-bound attestation/approval. Automatic recording also
/// needs the held-out evaluation and complete provenance present in the browser manifest.
pub fn release_evidence_allows_auto_record(
    policy: ModelDecisionPolicy,
    evidence: VerifiedReleaseEvidence,
) -> bool {
    decision_policy_is_valid(policy)
        && policy.auto_record_enabled
        && evidence.stage == ModelReleaseStage::Production
        && evidence.held_out_evaluation_present
        && evidence.training_data_present
        && evidence.license_review_present
        && evidence.evaluation_timestamp_present
        && evidence.attestation_verified
        && evidence.approval_id_present
}

fn probability(value: f32) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

fn degrees(value: f32) -> bool {
    value.is_finite() && (0.0..=90.0).contains(&value)
}

fn finite_non_negative(value: f32) -> bool {
    value.is_finite() && value >= 0.0
}

fn finite_positive(value: f32) -> bool {
    value.is_finite() && value > 0.0
}

/// Decode a dart point after pixel coordinates have been mapped onto the canonical board plane.
pub fn decode_board_point(point: BoardPointMm) -> DartZone {
    let radius = point.x_mm.hypot(point.y_mm);
    if radius <= 6.35 {
        return DartZone {
            ring: Ring::InnerBull,
            segment: None,
            score: 50,
        };
    }
    if radius <= 15.9 {
        return DartZone {
            ring: Ring::OuterBull,
            segment: None,
            score: 25,
        };
    }
    if radius > 170.0 {
        return DartZone {
            ring: Ring::Miss,
            segment: None,
            score: 0,
        };
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
    DartZone {
        ring,
        segment: Some(segment),
        score,
    }
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
            decode_board_point(BoardPointMm {
                x_mm: 0.0,
                y_mm: -103.0
            }),
            DartZone {
                ring: Ring::Triple,
                segment: Some(20),
                score: 60
            }
        );
    }

    #[test]
    fn maps_bull_and_miss() {
        assert_eq!(
            decode_board_point(BoardPointMm {
                x_mm: 0.0,
                y_mm: 0.0
            }),
            DartZone {
                ring: Ring::InnerBull,
                segment: None,
                score: 50
            }
        );
        assert_eq!(
            decode_board_point(BoardPointMm {
                x_mm: 171.0,
                y_mm: 0.0
            }),
            DartZone {
                ring: Ring::Miss,
                segment: None,
                score: 0
            }
        );
    }

    fn safe_policy() -> ModelDecisionPolicy {
        ModelDecisionPolicy {
            auto_record_enabled: true,
            min_auto_score_probability: 0.90,
            min_auto_score_wire_margin_mm: 1.0,
            min_review_probability: 0.70,
            min_zone_posterior_margin: 0.20,
            min_landmark_confidence: 0.80,
            max_pose_validation_residual_mm: 8.0,
            max_quality_off_axis_degrees: 55.0,
            min_board_diameter_pixels: 480.0,
            min_overall_quality: 0.70,
            min_board_coverage: 0.80,
            min_sharpness: 0.70,
            max_glare_risk: 0.25,
            max_occlusion_risk: 0.30,
            tip_track_match_distance_mm: 12.0,
            tip_track_settle_ms: 320.0,
            tip_track_stale_after_ms: 1200.0,
            max_tip_track_spread_mm: 4.0,
            confidence_temperature: 1.0,
            confidence_bias: 0.0,
        }
    }

    fn clear_quality() -> CameraQuality {
        CameraQuality {
            overall: 0.90,
            board_coverage: 0.92,
            sharpness: 0.85,
            glare_risk: 0.10,
            off_axis_degrees: 20.0,
            occlusion_risk: 0.10,
            board_diameter_pixels: 700.0,
        }
    }

    fn complete_pose() -> PoseMetrics {
        PoseMetrics {
            has_complete_named_landmarks: true,
            minimum_landmark_confidence: 0.95,
            maximum_secondary_landmark_residual_mm: 2.0,
        }
    }

    fn approved_production_evidence() -> VerifiedReleaseEvidence {
        VerifiedReleaseEvidence {
            stage: ModelReleaseStage::Production,
            held_out_evaluation_present: true,
            training_data_present: true,
            license_review_present: true,
            evaluation_timestamp_present: true,
            attestation_verified: true,
            approval_id_present: true,
        }
    }

    #[test]
    fn accepts_complete_learned_capture_only_under_manifest_policy() {
        let policy = safe_policy();
        assert!(decision_policy_is_valid(policy));
        assert!(passes_capture_policy(
            clear_quality(),
            complete_pose(),
            policy
        ));
        assert!(passes_tip_occlusion_policy(0.20, policy));

        let incomplete = PoseMetrics {
            has_complete_named_landmarks: false,
            ..complete_pose()
        };
        assert!(!passes_capture_policy(clear_quality(), incomplete, policy));

        let blurry = CameraQuality {
            sharpness: 0.30,
            ..clear_quality()
        };
        assert!(!passes_capture_policy(blurry, complete_pose(), policy));
    }

    #[test]
    fn rejects_malformed_or_reversed_manifest_thresholds() {
        let invalid = ModelDecisionPolicy {
            min_review_probability: 0.95,
            min_auto_score_probability: 0.90,
            ..safe_policy()
        };
        assert!(!decision_policy_is_valid(invalid));
        assert!(!passes_capture_policy(
            clear_quality(),
            complete_pose(),
            invalid
        ));
    }

    #[test]
    fn auto_record_requires_production_evidence_and_never_auto_records_miss() {
        let policy = safe_policy();
        let evidence = approved_production_evidence();
        assert!(can_auto_record(0.95, 2.0, 0.40, false, policy, evidence));
        assert!(!can_auto_record(0.95, 2.0, 0.40, true, policy, evidence));

        let evaluation_only = VerifiedReleaseEvidence {
            stage: ModelReleaseStage::Evaluation,
            ..evidence
        };
        assert!(!can_auto_record(
            0.95,
            2.0,
            0.40,
            false,
            policy,
            evaluation_only
        ));
    }

    #[test]
    fn calibrates_confidence_with_browser_equivalent_logit_temperature() {
        let calibrated = calibrated_confidence(0.5, safe_policy()).expect("valid policy");
        assert!((calibrated - 0.5).abs() < 0.000_001);
    }
}
