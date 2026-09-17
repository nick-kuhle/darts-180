# Data Lab: consent-gated auto capture and private intake

**Status:** small-scale development collection runbook<br />
**Audience:** a Darts 180 development contributor and restricted data operator<br />
**Purpose:** create useful board-focused stills without sending camera media before the required
entry agreement; every record stays unreviewed until a restricted operator screens it.

Data Lab is the separate development workspace in the Darts 180 web app. It is **not** production
auto-scoring, automated consent review, a truth machine, an identity system, or a general-purpose
upload service. Once the collector agrees and starts the camera, the browser keeps one local
inference loop running against the board. When a newly thrown dart settles it automatically
captures one bounded board-only JPEG and saves the detected four semantic anchors plus visible
dart-tip labels; whenever the board is clear it saves one blank-board anchor record. If the private
collection is not ready, or the learned result cannot form a safe pose, the Lab says so and saves
nothing rather than inventing a point. The JPEG, manifest, and annotation sidecar are **saved
automatically** to private storage with no review step, and each record stays
`consented-development-unreviewed` until a restricted operator screens it. There is no download,
collection-key entry, browser credential, or manual Save button.

Use it only after the setup in [guided private Data Lab intake](../20-private-capture-lab.md) is
complete. Read that document with the [field-capture protocol](field-capture.md),
[privacy and security plan](../08-security-privacy.md), and [ML data plan](../04-ml-data-and-evaluation.md).

## 1. Boundary and safety rules

Before opening the camera:

1. Open **DATA LAB** and read the displayed development collection notice. It explains that completed
   board-only JPEGs, labels, and limited setup metadata are automatically collected privately for
   Darts 180 product/model improvement.
2. If you agree, select the required entry checkbox. It records
   `DEVELOPMENT-DATA-LAB-CONSENT-V1`, an ISO acceptance time, and
   `consented-development-unreviewed` with every auto-captured record. It is not login, identity
   verification, proof of rights, or permission to skip data review.
3. Wait until the private collection says **Ready**. Camera controls stay disabled until the private
   Blob connection and exact `DARTS180_CAPTURE_ACCESS_MODE=development-consent-v1` setting are ready.
4. Use only a permitted location and a stable camera position outside the throw path.
5. Frame the board only. Exclude people, faces, reflections, screens, documents, addresses, family
   photos, and other identifying room detail. Prefer a tight crop with a neutral background.
6. Never record audio. Data Lab requests `video` only.
7. Submit only board-focused stills you own or have clear permission to use. If the preview shows a
   person or sensitive detail, stop and reframe, or choose **Back to Live Scoring**; do not casually
   crop/redact it or transfer it to Darts 180.

The UI statements are contributor attestations, not automated privacy detection or a replacement for
consent and data review. The development access mode intentionally does not authenticate every visitor.
Private storage prevents public reads, but records must remain unreviewed until a restricted operator
has screened them.

## 2. Make one private auto-captured record

The camera loop has no download, key-entry, per-record Save, or review control:

1. Open the direct deployed HTTPS app and choose **DATA LAB**, not **LIVE SCORING**. The initial
   unchecked agreement is required before Data Lab checks `/api/capture-ingest` or enables the camera.
2. Select **Start auto capture** once—the only camera button—after the scene satisfies the safety
   rules and the private collection says **Ready**. The Lab requests video only; it never requests a
   microphone.
3. Mount/reframe until the complete board, double ring, and number ring are visible and sharp and the
   status shows **Board set**. Keep the whole number ring sharp and in frame; the Lab reads one local
   inference pass about every 0.9 seconds while running.
4. Keep the displayed pseudonymous **setup session** ID for a continuous phone/mount/light setup. The
   session rotates automatically when the camera moves to a materially different pose; never use a
   player name as the ID. There are no separate lighting or notes inputs.
5. Throw one to three darts and let them settle. When a newly thrown dart settles, Data Lab
   automatically captures one bounded board-only JPEG and records the detected CAL 1 D5/D20, CAL 2
   D17/D3, CAL 3 D8/D11, CAL 4 D13/D6 anchors plus the visible settled dart tips. A record saves only
   when a safe board pose is locked and, for a dart record, at least one settled tip is
   detected; otherwise that frame is skipped rather than inventing a point.
6. If **Board set** never appears, select **CALIBRATE SETUP**, centre the bull in the crosshair, and
   tap the top-left outer double-wire junction between **D5 and D20** once. The known 170 mm board
   geometry then derives all four anchors and locks the board; the learned path takes over whenever
   the model resolves all four anchors itself. Tapping the intersection counts as a setup lock, never
   a per-throw input.
7. Whenever the board is clear or the camera starts, Data Lab automatically saves one blank-board
   anchor record.
8. Records save themselves to private storage without confirmation. Keep the tab open and watch the
   **Saved / Saving / Failed** counters until confirmed. A failed record is retried automatically a
   few times (there is no manual retry button); a 409 collision is treated as already confirmed, and
   confirmed immutable assets are never overwritten.
9. Select **Stop camera** when finished; the camera is the only control while running.

The Lab stores nothing until a safe pose and a settled record are available. Automatic save does not
replace later privacy screening, provenance review, de-identification, duplicate control, annotation
QA, or training admission.

## 3. Failed saves, sensitive captures, and retention

A failed upload marks only the affected asset, and the Lab retries the queue automatically a few
times, reusing the exact captured bytes and record ID. Confirmed files are immutable and are not
uploaded again. There is no local backup/export: leaving or reloading before all assets are confirmed
discards the browser-held copy, so inspect private Blob before creating a duplicate record.

If the Lab says **Setup needed** or **Unavailable**, do not start the camera. Correct the existing
Vercel project's private Blob connection and exact development-consent environment setting as
described in [`20-private-capture-lab.md`](../20-private-capture-lab.md). Do not make Blob public, add
a password/key to the browser, or use an insecure upload substitute.

If the preview is sideways, too dark, or blurry, stop and reframe/re-light/re-mount before restarting;
the Lab skips a frame rather than forcing a low-quality record.

If a face or sensitive detail is noticed after a save, identify the record from the current Lab screen
or restricted Blob dashboard and ask the authorized storage operator to delete the complete private
record. Do not hand it off for training. Incomplete `record_…` folders likewise need periodic restricted
review and secure deletion under the retention policy.

## 4. Authorized model-building handoff

No raw media belongs in this repository. When a restricted operator has screened enough auto-captured
(unreviewed) records, that operator may retrieve matching JPEG/manifest/annotation triplets from
private Blob into a protected local training workspace. At that gate:

1. Verify the recorded development agreement and any applicable source/rights information.
2. Screen the image for people, identifiers, and sensitive detail.
3. Confirm JPEG and JSON share the same `captureId`, preserve the matching triplet, and register the
   intake batch.
4. Retain accepted files only in restricted raw storage with least-privilege access, encryption, and a
   deletion/retention policy.
5. Keep browser records `unassigned` and `consented-development-unreviewed` until de-identification,
   annotation review, session-disjoint split assignment, and explicit training-admission review are complete.
6. Keep all synthetic content in a separately named synthetic dataset. It is not a substitute for a
   held-out real-device evaluation set.

On the trusted training machine, validate a retrieved manifest before compilation:

```bash
cd ml
pip install -e '.[vision]'
PYTHONPATH=src python -m darts180_vision.data_contract \
  /protected/path/darts-180-<captureId>-manifest.json
```

A valid result is `"valid": true`. Validation is necessary but not sufficient: it cannot inspect pixels
for faces, prove consent/rights, validate stated measurements, or establish annotation truth.

## 5. Troubleshooting

| Symptom                                           | Expected action                                                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Continue to Data Lab** is disabled              | Read the notice and select the entry agreement only if every statement is true. Otherwise return to Live Scoring.                                                                                                                    |
| Private collection is checking                    | Wait for the same-origin status check. Do not bypass disabled camera controls.                                                                                                                                                       |
| Private collection says setup needed              | Correct the same existing Vercel project as described in [`20-private-capture-lab.md`](../20-private-capture-lab.md); preserve private Blob access.                                                                                  |
| Browser says camera is unavailable                | Use current Safari, Chrome, or Edge over the direct HTTPS URL; verify browser/site permission. Do not substitute an insecure upload.                                                                                                 |
| Preview is sideways, too dark, or blurry          | Stop, reframe/re-light/re-mount, then start auto capture again. Frames without a readable board are skipped, never forced.                                                                                                           |
| Status never shows **Board set**                  | Keep the whole number ring sharp and in frame. If the learned anchors stay elusive, select **CALIBRATE SETUP**, centre the bull in the crosshair, and tap the D5/D20 outer double-wire rim junction once to lock the board geometry. |
| Auto capture saves nothing                        | A frame without a safe board pose—either the learned anchors or the setup lock—or, for a dart record, a settled tip is skipped. The Lab never invents a point.                                                                       |
| A private save fails                              | Keep the tab open; the Lab retries automatically a few times. Inspect private Blob before creating a duplicate record; a 409 means already confirmed.                                                                                |
| Camera moved to a new setup                       | The pseudonymous session rotates automatically on a materially different pose. Keep phone, mount, board, and light stable for a continuous session.                                                                                  |
| A face or sensitive detail was noticed after save | Delete the complete private record through the restricted storage process; do not train or share it.                                                                                                                                 |
