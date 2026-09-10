# Data Lab: consent-gated guided capture and private intake

**Status:** small-scale development collection runbook<br />
**Audience:** a Darts 180 development contributor and restricted data operator<br />
**Purpose:** create useful board-focused stills without sending camera media before the required
entry agreement and final review.

Data Lab is the separate development workspace in the Darts 180 web app. It is **not** production
auto-scoring, automated consent review, a truth machine, an identity system, or a general-purpose
upload service. It creates one board-focused JPEG, capture manifest, and five-point reviewed-label
sidecar. When a verified local five-point development package is installed, the Lab can prefill
editable detector suggestions for the held still; otherwise it deliberately keeps the manual path.
Once the contributor completes final label review, the matched trio saves automatically through the
same-origin private Vercel intake. There is no download, collection-key entry, browser
credential, or manual Save button.

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
   `consented-development-unreviewed` with every completed record. It is not login, identity
   verification, proof of rights, or permission to skip manual data review.
3. Wait until the private collection says **Ready**. Camera controls stay disabled until the private
   Blob connection and exact `DARTS180_CAPTURE_ACCESS_MODE=development-consent-v1` setting are ready.
4. Use only a permitted location and a stable camera position outside the throw path.
5. Frame the board only. Exclude people, faces, reflections, screens, documents, addresses, family
   photos, and other identifying room detail. Prefer a tight crop with a neutral background.
6. Never record audio. Data Lab requests `video` only.
7. Submit only a board-focused still you own or have clear permission to use. If it includes a person
   or sensitive detail, choose **Back to Live Scoring** or **Discard and retake**; do not casually
   crop/redact it or transfer it to Darts 180.

The UI statements are contributor attestations, not automated privacy detection or a replacement for
consent and data review. The development access mode intentionally does not authenticate every visitor.
Private storage prevents public reads, but records must remain unreviewed until a restricted operator
has screened them.

## 2. Make one reviewed private record

1. Open the direct deployed HTTPS app and choose **DATA LAB**, not **LIVE SCORING**. The initial
   unchecked agreement is required before Data Lab checks `/api/capture-ingest` or enables the camera.
2. Select **Start rear camera** only after the scene satisfies the safety rules. The Lab requests
   video only; it never requests a microphone.
3. Mount/reframe until the complete board, double ring, and number ring are visible and sharp.
   Start with **Blank board** for an anchor-only example; select **Dart test** only after one to
   three darts have settled visibly in the board.
4. Keep the displayed pseudonymous **setup session** ID for a continuous phone/mount/light setup.
   Choose the lighting band and optional board/camera notes. Start a new session after a meaningful
   change; never use a player name as the ID.
5. Select **Take this photo**. The bounded JPEG and metadata snapshot are paired in this browser tab.
   Changing the plan afterward affects only the next photo.
6. Inspect the still. If it is unsafe or unusable, select **Discard and retake**. Otherwise complete
   both per-still confirmations: board-only/no sensitive detail, and authority to use the photo for
   Darts 180 development. Both reset for every new photo.
7. After **Take this photo**, the held still automatically receives one local pass if a verified
   five-point development model is installed. After the per-still checks, select
   **Next · Review camera suggestions** to see any prefilled four named anchors plus up to three
   visible class-0 tips. A missing/invalid model, unsupported browser, or incomplete learned pose says
   **Manual labeling ready** rather than inventing a point.
8. Review every marker. Keep a correct marker, or select an anchor/tip row and tap the image to move
   it. Remove a false tip; add every missed clearly visible physical entry tip. For manual anchors use
   CAL 1 D5/D20, CAL 2 D17/D3, CAL 3 D8/D11, CAL 4 D13/D6. A blank-board record intentionally has no
   dart tip.
9. Recheck the label statement and select **Confirm review · Auto-save**. This starts the automatic
   private save. Keep the tab open while the Board JPEG, Capture manifest, and Annotation sidecar each
   change to **Saved**.
10. Stop/revoke camera permission when finished if desired.

The Lab sends nothing until step 9. It does not replace later privacy screening, provenance review,
de-identification, duplicate control, annotation QA, or training admission.

## 3. Failed saves, sensitive captures, and retention

A failed upload marks only the current asset **Retry needed**. Keep the tab open, restore connectivity
or private collection setup, and select **Retry unsaved file**. Confirmed files are immutable and are
not uploaded again. There is no local backup/export: leaving or reloading before all assets are confirmed
discards the browser-held copy.

If the Lab says **Setup needed** or **Unavailable**, do not take a photo. Correct the existing Vercel
project's private Blob connection and exact development-consent environment setting as described in
[`20-private-capture-lab.md`](../20-private-capture-lab.md). Do not make Blob public, add a password/key
to the browser, or use an insecure upload substitute.

If a face or sensitive detail is noticed after a save, identify the record from the current Lab screen
or restricted Blob dashboard and ask the authorized storage operator to delete the complete private
record. Do not hand it off for training. Incomplete `record_…` folders likewise need periodic restricted
review and secure deletion under the retention policy.

## 4. Authorized model-building handoff

No raw media belongs in this repository. When enough reviewed records exist, only an authorized storage
operator may retrieve matching JPEG/manifest/annotation triplets from private Blob into a protected local
training workspace. At that gate:

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

| Symptom                                           | Expected action                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Continue to Data Lab** is disabled              | Read the notice and select the entry agreement only if every statement is true. Otherwise return to Live Scoring.                                   |
| Private collection is checking                    | Wait for the same-origin status check. Do not bypass disabled camera controls.                                                                      |
| Private collection says setup needed              | Correct the same existing Vercel project as described in [`20-private-capture-lab.md`](../20-private-capture-lab.md); preserve private Blob access. |
| Browser says camera is unavailable                | Use current Safari, Chrome, or Edge over the direct HTTPS URL; verify browser/site permission. Do not substitute an insecure upload.                |
| Preview is sideways, too dark, or blurry          | Stop, reframe/re-light/re-mount, and take a new still. Do not force a low-quality label.                                                            |
| Next button is disabled                           | Take and inspect a still, then complete both per-still privacy/authority confirmations only when true.                                              |
| Manual labeling ready                             | No verified local model result was safe or available. Complete the manual review; do not infer a hidden camera prediction.                          |
| Confirm review is disabled                        | Finish all four named rim junctions, keep/add a visible dart tip for a dart test, then complete the explicit review statement.                      |
| A private save fails                              | Keep the tab open, inspect the deployment/connection, then retry only the unsaved file. Inspect private Blob before creating a duplicate record.    |
| A face or sensitive detail was noticed after save | Delete the complete private record through the restricted storage process; do not train or share it.                                                |
