# Capture Lab: local capture and approved handoff

**Status:** operational development runbook  
**Audience:** internal contributors, consented testers, data operations  
**Purpose:** create useful board-focused stills without silently transmitting camera media.

Capture Lab is a static-browser helper in the Darts 180 web prototype. It is **not** an upload,
annotation, consent-signature, or production auto-scoring service. It takes one JPEG locally in the
browser and separately downloads a starter JSON manifest. No API route, account, analytics event,
audio stream, or cloud media upload is involved in this workflow.

Read this alongside the [field-capture protocol](field-capture.md),
[privacy and security plan](../08-security-privacy.md), and [ML data plan](../04-ml-data-and-evaluation.md).

## 1. Boundary and safety rules

Before opening the camera:

1. Use only a permitted location and a stable camera position outside the throw path.
2. Frame the board only. Exclude people, faces, reflections, screens, documents, addresses, family
   photos, and other identifying room detail. Prefer a tight crop with a neutral background.
3. Never record audio. Capture Lab requests `video` only.
4. Do not represent a local export as approved training data. Its manifest is intentionally marked
   `LOCAL-CAPTURE-NOT-YET-SHARED`, `unlabeled-v0`, and `unassigned`.
5. If a capture contains a person or sensitive detail, delete the local JPEG and JSON. Do not try to
   crop/redact it casually and do not transfer it to Darts 180.

The checkbox in the interface is an operator attestation, not automated privacy detection or a
replacement for consent and data review.

## 2. Capture a paired local artifact

1. Open the deployed web prototype over HTTPS and choose **Capture Lab**. Camera access will not be
   requested until **Start device camera** is pressed.
2. Grant the browser's camera permission only if the scene meets the rules above. Use the rear camera
   where available; no microphone is requested.
3. Mount/reframe until the full board, double ring, and number ring are visible and sharp. Record
   challenging cases deliberately, but set the matching angle, distance, and lighting metadata.
4. Choose the capture intent:
   - **Empty board / calibration** — board geometry and setup views;
   - **Static dart(s) in board** — later manually annotated dart entry points;
   - **Difficult or failure case** — glare, obstruction, extreme-but-safe angle, motion evidence, or
     another documented failure condition.
5. Enter useful board and device notes plus estimated off-axis angle, distance, and lighting band.
6. Select **Take board still**. The JPEG and the metadata snapshot are now paired. Editing the form
   afterward prepares the _next_ still and does not alter this one.
7. Inspect the local preview. If it is unsafe or unusable, discard it locally and take a new still.
8. Confirm the no-faces/no-sensitive-details attestation for this specific still. The confirmation is
   reset for every new still.
9. Download **both** files and retain their shared `captureId`:
   - `darts-180-<captureId>-<intent>.jpg`
   - `darts-180-<captureId>-manifest.json`
10. Stop the camera when finished and revoke browser permission if desired.

The JPEG and manifest deliberately download separately so a contributor, not a web server, controls
whether and when a file leaves the device.

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

Likewise, a successful Capture Lab photo, a valid manifest, or a baseline proposal does not mean the
scene is auto-scorable. The runtime must still pass measured pose, framing, quality, uncertainty,
and human-review gates described in [the detection-engine specification](../03-detection-engine.md).

## 6. Troubleshooting

| Symptom                                               | Expected action                                                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Browser says camera is unavailable                    | Use current Safari, Chrome, or Edge over HTTPS; verify browser/site permission; do not substitute an insecure upload. |
| Preview is sideways, too dark, or blurry              | Stop, reframe/re-light/re-mount, and take a new still. Record a difficult case only if metadata says so.              |
| Manifest download button is disabled                  | Take a still first, inspect it, then explicitly complete the privacy attestation.                                     |
| JSON validator rejects the manifest                   | Correct the context fields on the next still; do not edit identifiers or claim false conditions to force acceptance.  |
| A face or sensitive detail was noticed after download | Securely delete the local pair and do not hand it off.                                                                |
| Need a capture mode not in the form                   | Document the request with data operations; do not overload an existing category without an approved taxonomy update.  |
