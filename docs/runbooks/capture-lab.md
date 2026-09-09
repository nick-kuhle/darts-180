# Data Lab: owner-only guided capture and private intake

**Status:** owner collection runbook<br />
**Audience:** the Darts 180 owner/operator
**Purpose:** create useful board-focused stills without uploading camera media before a completed
review acknowledgement.

Data Lab is the separate development workspace in the Darts 180 web app. It is **not** production
auto-scoring, automated consent review, a truth machine, a public upload service, or a tester
workflow. It creates one board-focused JPEG, capture manifest, and five-point manual-label sidecar.
Once the owner completes the final label review, the matched trio saves automatically through the
same-origin private Vercel intake. There is no download, collection-key entry, or manual Save button.

Use this only on the existing **Vercel Deployment-Protected** Darts 180 deployment after the setup
in [guided private Data Lab intake](../20-private-capture-lab.md) has been completed. Read it with
the [field-capture protocol](field-capture.md), [privacy and security plan](../08-security-privacy.md),
and [ML data plan](../04-ml-data-and-evaluation.md).

## 1. Boundary and safety rules

Before opening the camera:

1. Confirm that you are signed in as the authorized owner and that the protected Data Lab shows its
   private collection as **Ready**. Camera controls must remain disabled otherwise.
2. Use only a permitted location and a stable camera position outside the throw path.
3. Frame the board only. Exclude people, faces, reflections, screens, documents, addresses, family
   photos, and other identifying room detail. Prefer a tight crop with a neutral background.
4. Never record audio. Data Lab requests `video` only.
5. A locally owned board-focused still receives `SELF-CAPTURE-DEVELOPMENT-V1` only after the owner
   explicitly attests to authority to use it for development. Until then it remains in browser
   memory with `LOCAL-CAPTURE-NOT-YET-SHARED` and is not sent.
6. If a still contains a person or sensitive detail, choose **Discard and retake** before label
   review. Do not casually crop/redact it or transfer it to Darts 180.

The UI statements are an operator attestation, not automated privacy detection or a replacement for
consent and data review.

## 2. Make one reviewed private record

1. Open the direct, deployed HTTPS app and choose **DATA LAB**. Do not use **LIVE SCORING** for
   collection or labels. Data Lab checks `/api/capture-ingest` before enabling the camera.
2. Select **Start rear camera** only after the scene satisfies the safety rules. The Lab requests
   video only; it never requests a microphone.
3. Mount/reframe until the complete board, double ring, and number ring are visible and sharp.
   Start with **Blank board** for an anchor-only example; select **Dart test** only after one to
   three darts have settled visibly in the board.
4. Keep the displayed pseudonymous **setup session** ID for a continuous phone/mount/light setup.
   Choose the lighting band and optional board/camera notes. Start a new session after a meaningful
   change; never use a player name as the ID.
5. Select **Take this photo**. The bounded JPEG and metadata snapshot are paired in this browser
   tab. Changing the plan afterward affects only the next photo.
6. Inspect the still. If it is unsafe or unusable, select **Discard and retake**. Otherwise complete
   both per-still confirmations: board-only/no sensitive detail, and authority to use the
   self-capture for development. Both reset for every new photo.
7. Tap the four shown outer-rim junctions in exact order: CAL 1 D5/D20, CAL 2 D17/D3, CAL 3 D8/D11,
   CAL 4 D13/D6. For a dart test, tap only clearly visible physical dart entry tips. A blank-board
   record intentionally has no dart tip.
8. Recheck the label statement and select **Complete review · Auto-save**. This final acknowledgement starts
   the automatic private save. Keep the tab open while the Board JPEG, Capture manifest, and
   Annotation sidecar each change to **Saved**.
9. Stop/revoke camera permission when finished if desired.

The Lab sends nothing until step 8. It does not replace later manual screening, consent review,
de-identification, or training admission.

## 3. Failed saves, sensitive captures, and retention

A failed upload marks only the current asset **Retry needed**. Keep the tab open, restore
connectivity or protected deployment setup, and select **Retry unsaved file**. Confirmed files are
immutable and are not uploaded again. There is no local backup/export: leaving or reloading before
all assets are confirmed discards the browser-held copy.

If the Lab says **Setup needed** or **Unavailable**, do not take a photo. Correct the existing
Vercel project’s Deployment Protection, exact owner-mode environment setting, and private Blob
connection as described in [`20-private-capture-lab.md`](../20-private-capture-lab.md). Do not make
Blob public, add a password/key to the browser, or use an insecure upload substitute.

If a face or sensitive detail is noticed after a save, identify the record from the current Lab
screen or restricted Blob dashboard and ask the authorized storage operator to delete the complete
private record. Do not hand it off for training. Incomplete `record_…` folders likewise need periodic
restricted review and secure deletion under the retention policy.

## 4. Authorized model-building handoff

No raw media belongs in this repository. When enough reviewed records exist, only an authorized
storage operator may retrieve matching JPEG/manifest/annotation triplets from private Blob into a
protected local training workspace. At that gate:

1. Verify each owner attestation and applicable consent version.
2. Screen the image for people, identifiers, and sensitive detail.
3. Confirm JPEG and JSON share the same `captureId`, preserve the matching record triplet, and
   register the intake batch.
4. Retain accepted files only in restricted raw storage with least-privilege access, encryption, and
   a deletion/retention policy.
5. Keep new records `unassigned` until de-identification, annotation review, and session-disjoint
   train/validation/evaluation assignment are complete.

On the trusted training machine, validate a retrieved manifest before compilation:

```bash
cd ml
pip install -e '.[vision]'
PYTHONPATH=src python -m darts180_vision.data_contract \
  /protected/path/darts-180-<captureId>-manifest.json
```

A valid result is `"valid": true`. Validation is necessary but not sufficient: it cannot inspect
pixels for faces, prove consent, validate stated measurements, or establish annotation truth.

## 5. Troubleshooting

| Symptom                                           | Expected action                                                                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protected collection is checking                  | Wait for the same-origin status check. Do not bypass disabled camera controls.                                                                             |
| Private collection says setup needed              | Correct the same existing Vercel project as described in [`20-private-capture-lab.md`](../20-private-capture-lab.md); preserve private Blob access.        |
| Browser says camera is unavailable                | Use current Safari, Chrome, or Edge over the direct protected HTTPS URL; verify browser/site permission. Do not substitute an insecure upload.             |
| Preview is sideways, too dark, or blurry          | Stop, reframe/re-light/re-mount, and take a new still. Do not force a low-quality label.                                                                   |
| Next button is disabled                           | Take and inspect a still, then complete both per-still privacy/authority confirmations only when true.                                                     |
| Complete review is disabled                       | Place all four named rim junctions, add a visible dart tip for a dart test, then complete the label review statement.                                      |
| A private save fails                              | Keep the tab open, inspect the protected deployment/connection, then retry only the unsaved file. Inspect private Blob before creating a duplicate record. |
| A face or sensitive detail was noticed after save | Delete the complete private record through the restricted storage process; do not train or share it.                                                       |
