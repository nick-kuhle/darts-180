# Guided Data Lab and consent-gated private Vercel capture intake

**Snapshot date:** 2026-09-09 (America/Los_Angeles)<br />
**Status:** deployed on the existing Vercel project with its connected private Blob store and explicit development access mode; records remain fail-closed if either condition is removed<br />
**Audience:** a Darts 180 development contributor and the restricted data operator

## Scope and non-goals

The web app has two deliberately separate front doors:

- **LIVE SCORING** is the player flow. It uses browser-local inference only when a real, verified
  model package is present. It never asks a player to tap calibration points, upload a photo, use a
  collection credential, or manually save a capture.
- **DATA LAB** is a consent-gated development workflow. It takes a board-only JPEG, guides the four
  source-compatible board anchors and physical dart-tip labels, then **automatically saves the
  completed-review JPEG, manifest, and annotation sidecar** to private storage.

Data Lab is not a model release, a prediction service, an automated privacy review, an identity
system, a general-purpose upload portal, or authorization for production auto-recording. It is
collection tooling while the data, model, and real-device evidence gates are incomplete.

## The required entry agreement

Opening **DATA LAB** first shows a notice and an unchecked agreement box. The camera controls, capture
screen, and private storage status are not rendered until the visitor explicitly selects:

> I understand and agree that completed board-only Data Lab records and related labels/metadata will
> be collected privately for Darts 180 product and model improvement. I will not include people,
> faces, audio, sensitive material, or content I lack permission to submit.

The notice also explains that a completed record contains a board-focused JPEG, manual board/tip labels,
and limited setup metadata: a pseudonymous setup ID, optional board/camera notes, estimated
angle/distance, and lighting. It states that the app does not publicly display or make records available,
and that records wait for manual privacy, quality, provenance, and training/evaluation review.

Every saved manifest and annotation sidecar carries:

```text
consentVersion: DEVELOPMENT-DATA-LAB-CONSENT-V1
consentAcceptedAt: <ISO-8601 timestamp>
admissionStatus: consented-development-unreviewed
```

The agreement is an honest contributor attestation and provenance marker. **It is not login,
authentication, identity verification, proof of image rights, spam protection, or a legal/privacy
program on its own.** A person who can reach an open development app can also attempt to send a
same-origin-looking request. Private storage protects reads; it does not magically make untrusted
writes trusted. The Data Lab intake and any future model handoff must retain manual review.

## Contributor flow

This small loop has no download, key-entry, or per-record Save control:

1. Open the direct HTTPS Darts 180 app and choose **DATA LAB**. Read the notice; leave through
   **Back to Live Scoring** if you do not agree. Check the entry agreement to reveal the Lab.
2. Wait for its same-origin intake Function to report **Ready**. The camera remains disabled until
   private storage is configured and reachable.
3. Choose **Blank board** or **Dart test**, frame only the board, and take one rear-camera still.
   The browser bounds the JPEG and holds it only in the current tab at this point.
4. Inspect the exact still. Confirm that it has no person, face, sensitive room detail, or audio and
   that you own or have permission to use the board-focused image. Discard and retake if either
   statement is not true.
5. Tap CAL 1 D5/D20, CAL 2 D17/D3, CAL 3 D8/D11, and CAL 4 D13/D6 in the shown order. For a dart
   test, tap each clearly visible physical entry tip (at most three); a blank-board record has no
   invented dart tip.
6. Recheck the label statement and choose **Complete review · Auto-save**. The app creates an opaque
   record ID and automatically sends `board.jpg`, `manifest.json`, then `annotations.json`.
7. Keep the tab open until all three status items say **Saved**. Only a failed asset exposes
   **Retry unsaved file**; confirmed immutable assets are skipped on retry.

The setup/session ID is pseudonymous. Keep it only while the phone, mount, board, and lighting stay
materially the same; start a new session after a move, lighting change, board change, or later
collection day. The local compiler assigns a complete session to only one train/validation/test split.

Blank-board examples are accepted as anchor-only examples. They supplement—not replace—dart tests:
the compiler still refuses a compilation with no dart entry labels at all.

## Private intake design

```text
Consent-gated development visitor
  └─ Browser Data Lab: same-origin PUT /api/capture-ingest (bounded JPEG or JSON; no credential)
       └─ Function: exact access mode + same-origin/Origin + size/type/ID/consent/pairing validation
            └─ Vercel Blob private object: darts180/capture-lab/v2/record_<opaque>/...
```

Each completed review produces three immutable private objects below a random `record_…` folder:

- `board.jpg`
- `manifest.json`
- `annotations.json`

The Function accepts JPEG only for `board.jpg`, JSON only for the sidecars, limits an image to 3.5 MB
and each JSON document to 192 KiB, checks JPEG framing, validates opaque capture/session/record IDs,
requires the recorded consent version/timestamp and unreviewed admission marker, derives the allowed
pathname itself, and rejects capture/intent/pairing inconsistencies. It returns a confirmation and
SHA-256 digest, never a Blob URL. There is no browser read/list/download endpoint in this app.

The Blob store must be **Private**. The browser does not receive a Blob read URL, Blob token,
direct-upload token, `VITE_` variable, password, application collection secret, or `Authorization`
header. The JPEG goes only to the same-origin Function, so the restrictive `connect-src 'self'` CSP
remains appropriate.

### Development access mode and its boundary

The requested development mode is exact and fail-closed:

```text
DARTS180_CAPTURE_ACCESS_MODE=development-consent-v1
```

The Function reports ready and accepts a write only when that exact non-secret value and a nonblank
`BLOB_STORE_ID` are available. A missing value, whitespace, typo, unknown mode, unavailable Function,
or missing Blob store keeps Data Lab camera capture disabled. The earlier
`vercel-protected-owner-v1` value remains a supported narrower deployment option, but it is not the
current setup instruction.

`development-consent-v1` intentionally allows an unaccounted visitor who reaches the deployment to use
the consent-gated Lab. The Function requires a matching browser `Origin` and rejects explicit
cross-site requests; those checks reduce ordinary cross-site writes but are not an authentication or
anti-abuse boundary. Do not describe this mode as protected owner-only collection.

Before using this with a meaningful outside tester group, add reviewed application authentication and
authorization, durable rate limits/quotas, abuse monitoring, contributor deletion handling, audit events,
and a governed data workspace. Keep all new records `consented-development-unreviewed` until a restricted
operator has screened them; nothing in this app automatically trains a model from Blob.

## Configure the existing Vercel project after merge

Use the **same existing Darts 180 Vercel project and production URL**. Do not create a replacement site.
Do not place secrets or raw captures in GitHub, chat, source, browser storage, a committed `.env` file,
or a `VITE_` variable.

1. In the existing Vercel project, create or attach a Blob store named clearly, for example
   `darts180-private-captures`, with **Private** access. Connect it to the environments where you
   deliberately want Data Lab collection. Preserve Vercel's server-side storage configuration; never
   copy it into client variables.
2. In **Project Settings → Environment Variables**, add this server-only value to the intended
   environment(s)—usually the current development production deployment, and Preview only if preview
   contributors should be able to collect records:

   ```text
   DARTS180_CAPTURE_ACCESS_MODE=development-consent-v1
   ```

   Confirm that Vercel supplies `BLOB_STORE_ID` through the linked private Blob store. Do not add a
   `BLOB_READ_WRITE_TOKEN`, a `VITE_` Blob value, a collection key, a bypass secret, or a password to
   the browser.

3. This mode does **not** require a paid Vercel All Deployments protection plan. If Vercel Authentication
   remains enabled, it can still restrict who can reach affected preview URLs; disable or retain that
   separate edge setting deliberately rather than claiming a checkbox supplies authentication.
4. Merge and deploy through the existing project. In a fresh browser profile, open **DATA LAB** and
   verify the agreement is initially unchecked and **Continue to Data Lab** is disabled. After agreeing,
   verify that the private collection becomes **Ready** before camera controls enable.
5. Make one safe blank-board record. After the automatic save reports all three assets confirmed,
   verify in the restricted private Blob dashboard that exactly the three objects exist below a random
   `darts180/capture-lab/v2/record_…` folder, remain private, and have no public URL. Then test one
   dart-test record.

If the Lab shows **Setup needed** or **Unavailable**, it intentionally leaves camera capture disabled and
sends nothing. Correct the private store connection or the two server environment conditions above; do
not make the store public or add a browser credential to bypass the state.

## Failure, retention, retrieval, and review

The save order is JPEG → manifest → annotations. A network or Function error marks only the current
asset failed. Keep the tab open and choose **Retry unsaved file** after connectivity or deployment
setup is restored. The retry reuses the same reviewed bytes and record ID; it never overwrites an
already confirmed object or substitutes different content.

There is deliberately no local download/export path. Closing or reloading the tab before an
unconfirmed record is retried discards the browser-held copy. A rare timeout can leave uncertainty about
whether the final immutable object reached Blob. Inspect the private dashboard before creating a second
record; do not assume a 409 collision is permission to replace an object.

A failed partial record has no automatic cleanup. A restricted storage operator should periodically
review incomplete `record_…` folders and securely delete rejected/partial records under the approved
retention policy. If a saved image is later found to include a face, person, or sensitive detail, delete
the complete private triplet and do not hand it off for training. Treat the Vercel project and Blob
dashboard as sensitive raw-data access; require MFA and least privilege.

Only an authorized storage operator may later retrieve matching private objects into a protected local
training workspace. Keep the JPEG, manifest, and sidecar together outside this repository. A successful
capture/label review and recorded checkbox are not training admission: screen privacy, permission,
quality, duplicate/near-duplicate imagery, label correctness, session leakage, and real versus synthetic
provenance before assigning any split.

## Synthetic bootstrap: useful, but not real-device proof

The repository includes a local, procedural simulated-board generator and a new external-only
five-point YOLO bootstrap builder:

```bash
cd ml
PYTHONPATH=src python -m darts180_vision.synthetic_five_point_dataset \
  --output-directory /secure/local/path/darts180-synthetic-fivepoint-v1 \
  --count 300 \
  --seed 20260908
```

It writes generated JPEGs and numeric labels outside the repository, preserves five-point class roles,
checks the standard YOLO structure, and marks its report:

```text
consentVersion: SYNTHETIC-NO-USER-DATA
admissionStatus: synthetic-not-real-world-evaluation
realWorldEvaluationEligible: false
```

Use those fully labeled simulated dart throws only as a controlled pretraining/bootstrap experiment.
Never commit their raw archive, call synthetic validation/test results real-world validation, or claim
phone/board/dart scoring performance from them. Continue collecting consented real throws and reserve
real, independent held-out sessions for accuracy and safety evaluation.

An arbitrary AI-generated whole-board picture does **not** have trustworthy dart-tip and landmark labels
just because it looks photographic. Do not put one into supervised training unless it is explicitly
synthetic-provenanced and receives separately reviewed, geometry-consistent labels. Do not relabel it as
a real capture. The current bootstrap builder intentionally uses known procedural geometry rather than
inventing labels for an AI image.

### Mixed development model handoff

After a restricted operator has reviewed private Darts 180 records, compile those real pairs locally and
mix them with the procedural bootstrap using `darts180_vision.mixed_five_point_dataset`. Its fixed policy
puts reviewed real plus synthetic examples in `train`, but leaves `val` and `test` **real-only**. It
re-audits input pairs and duplicate bytes, writes an explicit `mixed-synthetic-and-real` provenance report,
and does not retrieve Blob records, automatically admit data, train, or deploy a model. A candidate still
must be trained and browser-tested as an editable development model before normal Live Scoring can make
learned anchor/tip suggestions without manual point taps.

See [`19-build-the-first-camera-model.md`](19-build-the-first-camera-model.md) for the model-building
gates and [`runbooks/capture-lab.md`](runbooks/capture-lab.md) for the operating sequence.

## Verification and limits

Unit coverage exercises fail-closed exact-mode/store configuration, consent timestamp/admission
validation, path/type/size/pairing policy, same-origin credential-free browser requests, no browser Blob
credential, automatic-review-save regression, synthetic provenance, and the SPA/API rewrite boundary.
The local synthetic builder additionally validates a fully paired numeric YOLO bootstrap and refuses to
write generated media inside the repository.

The UI statements are contributor attestations, not automated face/privacy detection. Intake validation
is not a complete schema, legal, privacy, provenance, or label review. Browser/unit/synthetic checks do
not demonstrate real phone accuracy, latency, battery, thermal behavior, soft-tip coverage, or robust
scoring across board/camera/light variation.

See [`08-security-privacy.md`](08-security-privacy.md),
[`19-build-the-first-camera-model.md`](19-build-the-first-camera-model.md), and
[`14-browser-camera-field-test.md`](14-browser-camera-field-test.md) before treating any learned model
as more than an editable development experiment.
