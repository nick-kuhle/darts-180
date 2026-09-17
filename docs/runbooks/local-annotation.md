# Data Lab auto-capture: five-point bootstrap labels

**Status:** consent-gated development collection aid<br />
**Audience:** an agreeing Data Lab contributor and authorized data operations<br />
**Use only for:** an approved, board-focused static JPEG paired with its Data Lab manifest.

The visible **DATA LAB** workspace auto-captures the source-compatible five-point JSON sidecar needed
by the first editable development scorer. It keeps the JPEG, capture manifest, and labels together in
one guided flow instead of asking a collector to switch to an ordinary player screen. When a genuine,
verified local five-point development package is installed, one local inference loop runs on the live
preview and records learned semantic anchors and visible dart tips for each settled record; no
model/package failure stays plainly manual rather than deriving points from geometry or a pixel
threshold. It uses a four-point projective transform and the deterministic canonical-board decoder only
after the points exist. It does **not** validate privacy from pixels, establish legal consent, or
replace two-person annotation/adjudication. On the configured consent-gated development deployment, the
auto-captured record saves to private Blob after the required entry agreement; every record stays
`consented-development-unreviewed` until a restricted operator screens it. The agreement records
`DEVELOPMENT-DATA-LAB-CONSENT-V1`, its acceptance time, and an unreviewed admission marker; it is not
identity verification. The Lab has no local-download, collection-key, browser credential, or manual Save
option. That narrow intake design is covered by [`20-private-capture-lab.md`](../20-private-capture-lab.md).

Follow the [Data Lab capture and private intake runbook](capture-lab.md) and the
[controlled field-capture runbook](field-capture.md) first.

## 1. Prerequisites and exclusions

Use a record only when all conditions hold:

- It has a matching Data Lab manifest with `containsFaces: false`, `imageMime: image/jpeg`, and
  `imageFile` exactly equal to the stored JPEG name.
- The image is board-focused. In Data Lab it is held only in the current tab until the automatic save;
  after automatic save, only an authorized operator may retrieve it into a protected local workspace.
- The full double ring is visible in the captured still. The selected profile's four named
  points must be visible; see the profile tables below.
- Each dart tip to be labeled is visibly resolvable. Do not rely on a record for a robin hood, hidden
  tip, bounce-out, motion blur, severe glare, or ambiguous shaft intersection.
- You understand that a skipped record is not saved: the Lab never manufactures a point where the
  actual point is not known.

Do not use an arbitrary image, a synthetic image as real-data evidence, an arrival clip, a file with
a mismatched name, or a screenshot derived from a sensitive room. The filename check is a useful
pairing guard, **not** a cryptographic proof that two files belong together; the secure intake batch
and human review remain authoritative.

## 2. Use the fixed five-point profile

Data Lab fixes the bootstrap profile to **Five-point development model labels** when building Darts
180's first own-throw model. These are intentionally **not** double-bed centres. The auto-captured
anchors use these outer-double-rim junctions in order:

| Model class | Visible location                |
| ----------: | ------------------------------- |
| CAL 1 / `1` | rim junction between D5 and D20 |
| CAL 2 / `2` | rim junction between D17 and D3 |
| CAL 3 / `3` | rim junction between D8 and D11 |
| CAL 4 / `4` | rim junction between D13 and D6 |

This profile matches the isolated development model convention: class `0` is the dart entry, and
classes `1`–`4` are these four ordered landmarks. It is not interchangeable with general board
geometry labels. The local compiler rejects a sidecar with a different profile for five-point training.

Four non-degenerate image ↔ board correspondences solve an image-to-canonical-board homography.
A false junction, an arbitrary outer edge, a number wire, or a similarly colored but wrong
bed/junction changes the transform and can corrupt every label. If the board is rotated in the
image, the labels follow the _numbered location_, not the screen cardinal direction.

The app rejects degenerate points but cannot measure learned-point error. A record with an
implausible mapping is skipped rather than saved with a guessed correction.

## 3. Auto-capture sequence

1. In the web prototype select **DATA LAB**, not **LIVE SCORING**.
2. Read and accept the Data Lab entry agreement only if it is true, wait for the private collection
   to say **Ready**, then select **Start auto capture** once. The integrated flow keeps the matching
   manifest automatically.
3. Frame the board; wait for **Board set**. If a verified local five-point package is installed, its
   local inference loop records the four named outer-rim junctions and the settled class-0 tips as
   records save; there is no marker-editing screen. A missing/invalid package, unsupported browser, or
   incomplete learned pose leaves **Auto capture stays off** and saves nothing invented.
4. The auto-captured anchors use the named outer-rim junctions in the displayed order (CAL 1 D5/D20,
   CAL 2 D17/D3, CAL 3 D8/D11, CAL 4 D13/D6). A dart record keeps each _visible physical dart entry
   point_ that has settled; a blank-board record is correct with no dart point. The app derives
   canonical mm coordinates, scoring zone, score, and nearest-wire margin only as a check on the
   captured points.
5. A record saves only when the four learned anchors form a safe pose and, for a dart record, at
   least one settled tip is detected; otherwise that frame is skipped. A small wire margin is a
   warning that the record should be re-examined and, for evaluation data, independently annotated
   before use.
6. Records auto-save to the private development collection with no confirmation and no review step;
   they remain `consented-development-unreviewed`. Keep the tab open until the **Saved / Saving /
   Failed** counters finish; failed assets retry automatically a few times.

The output records original capture metadata, image dimensions/name, the image-to-board homography,
fixed anchor profile/coordinates, captured image pixels, canonical entry points, deterministic zones,
wire margins, and auto-record tracking IDs. It also records per-point label sources and a
versioned local-model audit hint from the pass that produced them, with
`reviewMethod: learned-suggestion-auto-capture-v1` and
`deepdarts-four-cardinal-homography-v1` as annotation-method provenance. A blank-board sidecar has
its four anchors and an empty `darts` list; a dart record must have at least one clear tip.

## 4. Validate and hand off

Before any approved intake, run the dependency-light validator:

```bash
cd ml
PYTHONPATH=src python -m darts180_vision.data_contract \
  /protected/local/path/darts-180-<captureId>-annotations.json
```

The validator checks the nested capture manifest and recomputes every dart zone from the captured
canonical point. A green result confirms schema-like metadata and geometry coherence only; it does
not verify the JPEG, calibration accuracy, consent, or whether the auto-captured tip is the true
physical entry.

Use the approved encrypted handoff gate in
[Data Lab](capture-lab.md#4-authorized-model-building-handoff).
A completed private Blob save is controlled storage—not training admission. Keep the record in
`unassigned` until data operations has screened privacy, provenance, duplicate sessions, and split
leakage. For sacred evaluation records, obtain and preserve two independent annotations plus
adjudication rationale.

For the first self-capture development model, do not hand-copy YOLO labels. Keep screened five-point
pairs together outside Git and use `darts180_vision.local_five_point_dataset` to check pairing, session
splits, and duplicate bytes. The exact command is in
[`19-build-the-first-camera-model.md`](../19-build-the-first-camera-model.md).

## 5. Limits and next engineering work

This is intentionally a narrow bootstrap tool. It lacks image zoom/pan, anchor residual analysis,
board-profile selection, automatic occlusion taxonomy, dual-label merge, and cryptographic image hashes.
The learned auto-capture labels are not a replacement for those safeguards or for restricted operator
review. These remain planned annotation-platform work, not reasons to silently trust this version
beyond its controlled static-image use case.

Synthetic scenes and the OpenCV baselines remain useful for unit tests and workflow rehearsal, but
they cannot demonstrate real camera performance or replace consented device/board/angle-diverse
training and held-out evaluation data.
