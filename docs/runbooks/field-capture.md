# Runbook: controlled field capture

**Audience:** Data collection lead, vision engineer, privacy reviewer, capture contributor  
**Purpose:** obtain legal, useful, diverse darts examples without turning a player's home into an
uncontrolled video dataset.

For a browser-local exploratory still, follow the more specific [Capture Lab local workflow and
approved handoff](capture-lab.md). It does not replace this controlled, consented field protocol and
must not be used as an informal upload path.

## Stop conditions

Stop the session and escalate if:

- consent is unclear, withdrawn, or not recorded;
- faces, children, identifying room information, or audio may be in frame;
- camera/mount placement is unsafe relative to throw line/players;
- board, dart, or participant setup cannot be described in the capture manifest;
- upload/access path is not the approved encrypted workspace.

## Before capture

1. Confirm training purpose, scope, retention, contact, deletion path, and contributor consent.
2. Disable audio capture and location tagging; use a board-focused camera crop.
3. Verify safe throwing area, fixed board, clear oche, and stable camera mount. Do not stand in
   throwing line to adjust a camera.
4. Assign a random capture ID. Do not use a player's name in filenames/labels.
5. Record board model/condition, dart configuration, device/OS/camera, pose/distance, and lighting.
6. Ensure approved storage credentials and manifest schema are available; no personal cloud folder.

## Capture sequence

1. Capture empty-board calibration frames from each planned pose/light condition.
2. Verify board fully visible and camera quality summary; record rejected setups too.
3. Capture controlled one-dart placements across ring/wedge/bull/miss coverage.
4. Capture two- and three-dart configurations, including benign shaft overlap but only safe staged
   robin-hood examples where appropriate.
5. Capture arrival sequences: pre-impact, impact, wobble, stable state, then board clear. Keep
   clips short and board-cropped.
6. Add difficult but representative cases: worn board, side shadow, glare, various darts, moderate
   obliqueness. Never manufacture unsafe throwing behavior.
7. Establish independent ground truth using a calibrated reference, placement jig, or two trained
   human annotators. Never assume an app prediction is truth.

## After capture

1. Run face/person/background screening and EXIF removal before annotation queue.
2. Validate manifest, frame timestamps, calibration/pose labels, dart labels, and score/geometry
   coherence.
3. Deduplicate near-identical examples. Do not split adjacent frames/session duplicates across train
   and evaluation.
4. Encrypt/upload only approved artifacts; record consent version and retention/deletion lineage.
5. Provide contributor confirmation and path to withdraw/delete according to privacy policy.
6. Update coverage dashboard: board/device/pose/light/ring/dart count/failure gaps.

## Required manifest facts

`captureId`, consent version, board model, device model, capture mode, off-axis degrees, distance,
lighting band, `containsFaces: false`, timestamp; see `ml/data/manifest.schema.json`.

## Label QA sampling

- Two independent labels for sacred evaluation records.
- At least 10% random audit of training labels initially; raise sampling for new labelers/failure
  classes.
- Reconcile disagreement with adjudication, preserving both initial labels and rationale.
- Flag unresolvable/occluded examples; do not force false precision.

## Safety and privacy reminder

No score accuracy metric justifies unsafe dart play or collecting a room/face without permission.
