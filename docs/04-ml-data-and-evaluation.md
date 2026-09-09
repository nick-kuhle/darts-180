# ML data, labeling, evaluation, and model operations

**Status:** mandatory operating procedure before model claims  
**Owner:** ML/Data + Privacy + Vision Runtime

## 1. The data thesis

The durable advantage is not a single detector architecture. It is a legally collected, diverse,
well-labeled dataset of darts in realistic homes plus a correction loop that tells us exactly where
the model is wrong. A model trained only on face-on studio boards will demonstrate well and fail
where customers play.

## 2. Data classes

| Class                | Contents                                                      | Primary purpose       | Raw media policy             |
| -------------------- | ------------------------------------------------------------- | --------------------- | ---------------------------- |
| A: empty/calibration | board face, landmarks, board profile, pose/lighting           | board detector / pose | consented controlled capture |
| B: static dart-in    | 1–3 darts with tip/entry labels, full board, varied angles    | entrypoint model      | consented controlled capture |
| C: arrival sequence  | pre-impact / impact / settle frames, tracks, bounce-outs      | temporal tracker      | short clips only             |
| D: difficult/failure | glare, shadows, old boards, occlusion, robin hood, bounce-out | safety/abstention     | high value; strict review    |
| E: product feedback  | model prediction + player correction + quality metadata       | active learning       | opt-in only, de-identified   |
| F: synthetic         | rendered board/darts/backgrounds/camera/lens variations       | coverage/augmentation | no personal data             |

Never let synthetic data become the evaluation set or hide weakness on genuine hardware.

### 2.1 Third-party research datasets

A third-party public dataset may be useful for pretraining, ablation, or a non-production baseline,
but it never replaces Darts 180's consented field data or sacred evaluation set. Record the source
version, licence, derivative transformations, file hashes, class map, attribution, raw-data storage
location, and split lineage before training. Keep raw external media and weights out of Git.

The currently reviewed external lead is **DeepDarts YOLOv8 v2**. It is conditionally admitted only
for research intake: its official source dataset metadata identifies CC BY 4.0, while its Roboflow
export preserves only five numeric labels and uses 640×640 stretch/augmentation. The candidate has
no approved browser artifact and does not satisfy the current nine-landmark contract. See the
[dated candidate review](research/2026-09-deepdarts-yolov8-candidate.md) and run the local
aggregate-only audit before any experiment.

## 3. Capture matrix

The capture program must balance—not merely collect—the following dimensions:

| Dimension                                                | Initial target examples                               |
| -------------------------------------------------------- | ----------------------------------------------------- |
| Board brand/model, fresh/worn sisal, wire style/rotation | ≥10 profiles                                          |
| Dart barrel/flight/shaft color, length, finish           | ≥30 families                                          |
| Devices                                                  | current/mid/older iPhone + Android classes, ≥12 total |
| Pose                                                     | 0–15°, 15–30°, 30–45°, 45–55°                         |
| Distance                                                 | 0.5–0.8m, 0.8–1.2m, 1.2–2.0m                          |
| Lighting                                                 | diffuse, warm, low, side shadow, glare, mixed         |
| Dart count                                               | empty, one, two, three, stack/robin hood              |
| Scoring regions                                          | all wedges/rings, bulls, wires, miss                  |
| Motion/event                                             | clean arrival, wobble, hand occlusion, bounce-out     |

Target **coverage density**, not a vanity image count. Each release report must show examples and
accuracy for the matrix slices.

## 4. Capture protocol

1. Use the Darts 180 capture app or a controlled web workflow; write a manifest record before media.
2. Obtain explicit purpose-limited consent version and confirm that faces/audio are absent.
3. Record device/board/pose/distance/light metadata and a calibration artifact.
4. Capture empty board, one/two/three darts, then controlled arrival clips; include intentional
   boundary and failure cases under safe conditions.
5. Create or verify ground truth independently. Best options: calibrated multicam reference,
   high-resolution manual annotation by two trained labelers, or a controlled physical placement jig.
6. Store raw media encrypted with least-privilege access. Generate de-identified board crops before
   broad labeling/training access.
7. Run automated validation: all required labels, score/geometry agreement, face detector pass,
   duplicate/perceptual-hash checks, and manifest schema validation.

Raw board captures should be collected in a controlled workstream, not committed to Git. The
static web Capture Lab can create a local JPEG + starter manifest without uploading it; its paired
Annotation Lab creates a local four-anchor sidecar for clearly visible static tips. The Python
`data_contract.py` validator and synthetic generator exercise the same metadata/geometry path. See
`ml/data/manifest.schema.json`, the [field capture runbook](runbooks/field-capture.md), and the
[local annotation runbook](runbooks/local-annotation.md).

## 5. Label contract

Each dart label needs more than a score:

```json
{
  "captureId": "cap_…",
  "frameTimestampMs": 1340,
  "dartTrackId": "track_2",
  "tipPixel": [1234.2, 733.8],
  "entryPointBoardMm": [3.4, -103.1],
  "zone": { "ring": "T", "segment": 20, "score": 60 },
  "wireMarginMm": 3.9,
  "visibility": "clear",
  "occlusion": "none",
  "groundTruthMethod": "dual-human-adjudicated",
  "labelerVersion": "v1"
}
```

Required labels: board center/pose landmarks, homography or canonical correspondences, dart tip and
entry point, score zone, visible/occluded/not-resolvable, and temporal state. Optional but valuable:
shaft direction, board damage, glare mask, hand mask, bounce-out, robin hood, and board profile.

**Two-labeler rule:** labelers work independently for sacred evaluation data. Disagreement routes to
an adjudicator, and inter-rater agreement is reported. If humans cannot confidently locate a dart
tip, the product should not treat the example as easy ground truth.

## 6. Splits and leakage controls

| Split             | Use                       | Rule                                                         |
| ----------------- | ------------------------- | ------------------------------------------------------------ |
| Train             | optimization              | broadest diversity; augmentation permitted                   |
| Validation        | model/threshold selection | separate captures, boards, and sessions                      |
| Sacred evaluation | release decision          | locked, two-human-labeled, never synthetic, no tuning access |
| Field shadow set  | production monitoring     | delayed labels; never silently reclassified as train         |

Split by **capture session, physical board, device, and contributor** where possible. Near-duplicate
frames in train and test inflate results disastrously. Hold out at least ~1,000 well-balanced dart
examples before a public accuracy claim; grow that set with each supported hardware/angle envelope.

## 7. Metrics that matter

| Metric                         | Definition                                  | Why aggregate accuracy is insufficient        |
| ------------------------------ | ------------------------------------------- | --------------------------------------------- |
| Exact zone accuracy            | ring + segment exactly correct              | player-visible correctness                    |
| Ring accuracy / wedge accuracy | error decomposition                         | tells pose vs radial failure apart            |
| Boundary accuracy              | examples within 0–1, 1–3, 3–6 mm of wire    | hardest trust cases                           |
| Auto-accept precision          | correctness only among accepted predictions | safety gate                                   |
| Auto-accept coverage           | accepted / eligible cases                   | prevents hiding behind abstention             |
| Top-2 / top-3 recall           | truth in ranked candidates                  | correction UX value                           |
| Calibration failure rate       | unable to establish/hold pose               | real setup usability                          |
| False-trigger rate             | proposed dart when no legal stable dart     | temporal quality                              |
| Proposal latency               | impact/settle to card p50/p95               | flow quality                                  |
| Correction rate                | manual correction by slice/model            | online quality signal, not ground truth alone |

All metrics are stratified by device, OS, board, dart count, pose band, distance, lighting, ring,
segment, wire margin, and known failure flags. Report confidence calibration/reliability diagrams;
a probability of .97 should empirically mean ~.97 or better reliability in the relevant slice.

## 8. Initial release gates

No exact numeric threshold is permanent; these are conservative starting gates:

| Gate                                       |     Private beta |                     Broader beta |    Auto-accept-enabled cohort |
| ------------------------------------------ | ---------------: | -------------------------------: | ----------------------------: |
| Exact zone accuracy, preferred mount       |             ≥90% |                             ≥97% |                   ≥99% target |
| Exact zone accuracy, full claimed envelope |      report only |                             ≥95% |                   ≥97% target |
| Auto-accept precision                      | n/a / review all |                             ≥99% |                 ≥99.5% target |
| Top-3 recall for review cases              |             ≥95% |                             ≥98% |                          ≥99% |
| P95 proposal latency                       |           ≤2.5 s |                           ≤1.5 s |                 ≤1.0 s target |
| No catastrophic slice                      |    manual review | no unexplained severe regression | signed vision/product release |

A statistically meaningful confidence interval and sample count accompany every gate. A high score
on a mixed set cannot mask a poor result for a supported device or angle band.

## 9. Active-learning flywheel

1. On-device model predicts candidates and quality; player confirms/corrects.
2. The app asks separately whether the de-identified board crop/short failure clip may improve the
   model. Default is no.
3. Consent service creates purpose/version/retention record. Remove faces/background, validate
   schema, and store least-privilege media/object key.
4. Select examples by uncertainty, correction, novelty, failure flag, and coverage gap—not just
   volume.
5. Label, QA, deduplicate, split, train, evaluate, then stage release.
6. A delete request removes training-eligible media/labels where technically possible and records
   lineage/retraining impact according to policy.

Player corrections are weak labels unless reviewed: a user can accidentally choose the wrong score.
Use correction data for prioritization and label it with provenance.

## 10. Model registry / reproducibility

Every candidate model must register:

- model and preprocessing code commit;
- dataset manifest/version and split hash;
- training config, seed, hardware/runtime;
- exact ONNX Runtime Web artifact checksum plus future Core ML/TFLite export targets;
- schema-v2 manifest/attestation hashes and an exact policy-binding record;
- full metrics + stratified reports + confidence calibration;
- evaluation approval, security/privacy review, rollout cohort, rollback owner.

Do not overwrite an artifact at the same semantic model version. Inference telemetry sends model
version, quality/candidate summary, and outcome only under applicable consent.

## 11. Bias, privacy, and misuse review

The model sees rooms, boards, hands, and sometimes people. The data team must audit unequal
performance by lighting/environment/device price point, not infer protected attributes. Avoid
collecting identity labels. Privacy review blocks any capture program that cannot exclude faces,
audio, or background identifiers from the training workflow.

See [privacy/security](08-security-privacy.md) for consent, deletion, and retention requirements.
