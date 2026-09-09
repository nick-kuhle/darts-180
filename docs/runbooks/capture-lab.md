# Data Lab: guided capture and private intake

**Status:** operational development runbook  
**Audience:** internal contributors, consented testers, data operations  
**Purpose:** create useful board-focused stills without silently transmitting camera media.

Data Lab is the separate guided development workspace in the Darts 180 web prototype. It is **not**
production auto-scoring, automated consent review, a truth machine, or a general public upload service.
It creates one board-focused JPEG, the capture manifest, and five-point manual-label sidecar in one
short flow. The operator chooses an explicit local download or (only after owner configuration) a
private same-origin Vercel Blob intake save. No audio or automatic background upload is involved.

Read this alongside the [field-capture protocol](field-capture.md),
[privacy and security plan](../08-security-privacy.md), [ML data plan](../04-ml-data-and-evaluation.md),
and [guided private Data Lab intake](../20-private-capture-lab.md).

## 1. Boundary and safety rules

Before opening the camera:

1. Use only a permitted location and a stable camera position outside the throw path.
2. Frame the board only. Exclude people, faces, reflections, screens, documents, addresses, family
   photos, and other identifying room detail. Prefer a tight crop with a neutral background.
3. Never record audio. Data Lab requests `video` only.
4. Do not represent a local export as approved training data. It starts `unlabeled-v0` and
   `unassigned`. A locally owned board-focused still receives `SELF-CAPTURE-DEVELOPMENT-V1` only
   after the contributor explicitly confirms authority to use it for development; otherwise its
   manifest stays `LOCAL-CAPTURE-NOT-YET-SHARED`.
5. If a capture contains a person or sensitive detail, delete the local JPEG and JSON. Do not try to
   crop/redact it casually and do not transfer it to Darts 180.

The checkbox in the interface is an operator attestation, not automated privacy detection or a
replacement for consent and data review.

## 2. Make one guided three-file record

1. Open the deployed web prototype over HTTPS and choose **DATA LAB**. Camera access is not requested
   until **Start rear camera** is selected. Do not use **LIVE SCORING** for collection/labels.
2. Grant camera permission only if the scene meets the rules above. The Lab requests video only; there
   is no microphone request.
3. Mount/reframe until the complete board, double ring, and number ring are visible and sharp. Start
   with **Blank board** for an anchor-only example; select **Dart test** only after one to three darts
   have settled visibly in the board.
4. Keep the displayed **setup session** ID for a continuous phone/mount/light setup. Choose the lighting
   band and optional board/camera notes. Start a new session after a meaningful change; never use a
   player name as the ID.
5. Select **Take this photo**. The bounded JPEG and its metadata snapshot are paired in this browser tab.
   Changing the plan afterward affects only the next photo.
6. Inspect the still. If it is unsafe or unusable, use **Discard and retake**. Otherwise complete both
   per-still confirmations: board-only/no sensitive detail, and authority to use the self-capture for
   development. Both reset for a new photo.
7. Tap the four shown outer-rim junctions in exact order: CAL 1 D5/D20, CAL 2 D17/D3, CAL 3 D8/D11,
   CAL 4 D13/D6. For a dart test, tap only clearly visible physical dart entry tips. A blank-board
   record intentionally has no dart tip.
8. Recheck the label statement and choose **Review save**. You can either:
   - download the matched trio—`darts-180-<captureId>-<intent>.jpg`, a manifest JSON, and an
     annotations JSON—to an approved local folder; or
   - explicitly save the three files to the configured private Blob store, after entering the
     operator's collection key in the current tab.
9. Stop/revoke camera permission when finished if desired.

The Data Lab sends nothing until the final explicit save. Private cloud storage is optional and
fail-closed; it never replaces the later manual screening, consent review, de-identification, or
training admission gate.

## 3. Local validation before transfer

Install the lightweight ML dependencies once, then validate the JSON on the same trusted machine:

```bash
cd ml
pip install -e '.[vision]'
PYTHONPATH=src python -m darts180_vision.data_contract \
  /safe/local/path/darts-180-<captureId>-manifest.json
```

A valid result is `"valid": true`. The validator requires a non-empty pseudonymous capture ID and
provenance fields, recognized capture/lighting values, plausible angle and distance, and an explicit
`containsFaces: false`. A labeled sidecar is also checked against canonical board geometry; it must
not be used to rubber-stamp a bad annotation near a wire.

Validation is necessary but not sufficient. It cannot inspect the pixels for faces, validate stated
measurements, prove consent, or establish annotation truth.

## 4. Approved handoff gate

Do **not** email, text, paste into a chat, place in a public drive, or commit raw capture files to
Git. The receiving data steward must first provide an approved encrypted intake location and a
capture batch identifier. At that gate, the steward should:

1. Verify explicit contributor authorization and the applicable consent version.
2. Review the local manifest and manually screen the image for people/identifiers/sensitive detail.
3. Confirm that JPEG and JSON have the same `captureId` and register the intake batch.
4. Copy only approved files into restricted raw storage with least-privilege access, encryption, and
   retention policy.
5. Retain a data-lineage record; move rejected files to secure deletion rather than train on them.
6. Keep all newly accepted records in `unassigned` until de-identification, annotation review, and
   leakage-safe train/validation/evaluation split assignment are complete.

No raw media belongs in this repository. Commit only schemas, non-sensitive fixtures, code, and
aggregate reports.

## 5. Synthetic and baseline limitations

The `ml` workspace includes deterministic synthetic board scenes plus OpenCV pose and temporal
change baselines. They are useful for testing file contracts, geometry, debug visualization, and
failure paths. They are **not** realistic enough to replace consented, device-diverse real capture;
they must never form the sacred evaluation set or support public accuracy claims.

Likewise, a successful Data Lab photo, a valid manifest, or a baseline proposal does not mean the
scene is auto-scorable. The runtime must still pass measured pose, framing, quality, uncertainty,
and human-review gates described in [the detection-engine specification](../03-detection-engine.md).

## 6. Troubleshooting

| Symptom                                           | Expected action                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser says camera is unavailable                | Use current Safari, Chrome, or Edge over HTTPS; verify browser/site permission; do not substitute an insecure upload.                                            |
| Preview is sideways, too dark, or blurry          | Stop, reframe/re-light/re-mount, and take a new still. Do not force a low-quality label.                                                                         |
| Next button is disabled                           | Take a still, inspect it, then complete both per-still privacy/authority confirmations only when they are true.                                                  |
| Review save is disabled                           | Place all four named rim junctions, add a visible dart tip for a dart test, then complete the label review statement.                                            |
| Private storage says setup needed                 | Use local backup. Configure the same existing Vercel project exactly as in [`20-private-capture-lab.md`](../20-private-capture-lab.md); do not make Blob public. |
| Private storage save fails                        | Download/keep the local trio, correct connectivity/key, and retry only the unsaved file. Inspect private storage before duplicating a record.                    |
| JSON validator rejects a downloaded sidecar       | Correct the context/label process on a new still; do not edit IDs or claim false conditions to force acceptance.                                                 |
| A face or sensitive detail was noticed after save | Securely delete local copies and ask the restricted storage operator to delete the private record; do not hand it off.                                           |
