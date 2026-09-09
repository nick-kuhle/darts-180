# Guided Data Lab and protected private Vercel capture intake

**Snapshot date:** 2026-09-08 (America/Los_Angeles)<br />
**Status:** implemented locally; deliberately fail-closed until the existing Vercel project is configured and Deployment-Protected<br />
**Audience:** the Darts 180 owner collecting the first consented, board-only camera corpus

## Scope and non-goals

The web app has two deliberately separate front doors:

- **LIVE SCORING** is the eventual player flow. It uses browser-local camera inference only when a
  real, verified model is available. It never asks a player to tap calibration points, upload a
  photo, use a collection credential, or manually save a capture.
- **DATA LAB** is an owner-only development workflow. It captures a board-only JPEG, guides the
  four source-compatible board anchors and real dart-tip labels, then **automatically saves the
  reviewed JPEG, manifest, and annotation sidecar** to the protected private collection.

Data Lab is not a model release, a prediction service, automated consent review, a general upload
portal, or authorization for production auto-recording. It remains collection tooling while the
separate model-evidence gates are incomplete.

## Owner collection flow

The intended loop is small and has no download, key-entry, or per-record Save control:

1. Open the **Deployment-Protected** Darts 180 URL while signed in as the owner. Data Lab first
   checks its same-origin intake Function. It keeps camera capture disabled unless that protected
   private collection reports ready.
2. Choose **Blank board** or **Dart test**, frame only the board, and take one rear-camera still.
   The browser bounds the JPEG and keeps it only in the current tab at this point.
3. Confirm for that exact still that it is board-only/no sensitive detail and that its use for
   Darts 180 development is authorized.
4. Tap CAL 1 D5/D20, CAL 2 D17/D3, CAL 3 D8/D11, and CAL 4 D13/D6 in the shown order. For a dart
   test, tap each clearly visible physical entry tip (at most three); a blank-board record has no
   made-up dart tip.
5. Recheck the label statement and choose **Complete review · Auto-save**. That completed acknowledgement
   creates an opaque record ID and automatically sends `board.jpg`, `manifest.json`, then
   `annotations.json` through the same-origin intake Function.
6. Keep the tab open until all three status items say **Saved**. Only a failed asset exposes
   **Retry unsaved file**; confirmed immutable assets are skipped on retry.

The setup/session ID is pseudonymous. Keep it only while the phone, mount, board, and lighting stay
materially the same; start a new session after a move, lighting change, board change, or later
collection day. The dataset compiler assigns a complete session to only one train/validation/test
split.

Blank-board examples are accepted as anchor-only examples. They supplement—not replace—dart tests:
the compiler still refuses a compilation with no dart entry labels at all.

## Private intake design

```text
Owner authenticated by Vercel Deployment Protection
  └─ Browser Data Lab: same-origin PUT /api/capture-ingest (bounded JPEG or JSON; no credential)
       └─ Function: same-origin + size/type/ID/consent/pairing validation
            └─ Vercel Blob private object: darts180/capture-lab/v1/record_<opaque>/...
```

Each completed review produces three immutable private objects below a random `record_…` folder:

- `board.jpg`
- `manifest.json`
- `annotations.json`

The Function accepts JPEG only for `board.jpg`, JSON only for the sidecars, limits an image to
3.5 MB and each JSON document to 192 KiB, checks JPEG framing, validates opaque capture/session/
record IDs, requires the completed consent attestation, derives the allowed pathname itself, and
rejects capture/intent/pairing inconsistencies. It returns a confirmation and SHA-256 digest, never
a Blob URL. There is no browser read/list/download endpoint in this app.

The Blob store must be **Private**. The browser does not receive a Blob read URL, Blob token,
direct-upload token, `VITE_` variable, password, or application collection secret. The JPEG goes
only to the same-origin Function, so the restrictive `connect-src 'self'` CSP remains appropriate.

### Authorization model and its boundary

This is a deliberately constrained **sole-owner collector**, not a reusable authentication design:

1. **Vercel Deployment Protection** is the sole owner-access gate. Configure it so an unauthenticated
   visitor cannot reach the deployed page or `/api/capture-ingest`; the owner's Vercel/identity
   session must be validated at Vercel's edge before the Function runs.
2. The Function requires exact server-only
   `DARTS180_CAPTURE_ACCESS_MODE=vercel-protected-owner-v1` and a non-empty `BLOB_STORE_ID` before
   it reports ready or accepts a write. The access-mode value is an explicit deployment
   acknowledgement, **not** a browser secret and not an independent authentication system.
3. The Function also rejects cross-site browser writes. That protects the owner’s session from a
   foreign-site form/fetch attempt, but it does not make this safe for untrusted contributors.

Vercel Blob resolves its short-lived runtime OIDC access in the deployed Function context; this app
does not inspect or transmit a Blob credential. Vercel Deployment Protection complements—not
replaces—application authentication. Before permitting public, tester, or multi-user collection,
replace this narrow deployment assumption with reviewed application authentication, authorization,
rate limits, audit events, deletion tooling, and a governed data workspace.

## Configure the existing Vercel project after merge

Use the **same existing Darts 180 Vercel project and production URL**. Do not create a replacement
site. Do not place secrets or raw captures in GitHub, chat, source, browser storage, a committed
`.env` file, or a `VITE_` variable.

1. In the existing Vercel project, create or attach a Blob store named clearly, for example
   `darts180-private-captures`, with **Private** access. Connect it to the existing project’s
   Production and Preview environments. Preserve Vercel’s server-side storage configuration; never
   copy it into client variables.
2. In **Project Settings → Deployment Protection**, enable a mode that requires the owner’s
   authenticated Vercel/approved identity session for this collection deployment. Protect both the
   production deployment and any preview used for collection. Do not distribute bypass links,
   automation bypass secrets, or a protected preview URL to contributors.
3. Add exactly this server-only environment variable for Production and Preview:

   ```text
   DARTS180_CAPTURE_ACCESS_MODE=vercel-protected-owner-v1
   ```

   Ensure `BLOB_STORE_ID` is present from the linked Blob store. The app does not use a static
   browser collection credential or a `VITE_` Blob setting.

4. Merge and deploy through the existing project. In a fresh signed-out browser profile, verify the
   production URL and `/api/capture-ingest` are stopped by Deployment Protection before the app is
   served. In the owner’s signed-in profile, open **DATA LAB** and confirm its collection status
   becomes **Ready** before camera controls enable.
5. Make one safe blank-board record. After the automatic save reports all three assets confirmed,
   verify in the private Blob dashboard that exactly the three objects exist under a random
   `record_…` folder, are private, and have no public URL. Then test one dart-test record.

If the Lab shows **Setup needed** or **Unavailable**, it intentionally leaves camera capture disabled
and sends nothing. Correct Deployment Protection, the private store connection, or the two server
environment conditions above; do not make the store public or add a browser credential to bypass the
state.

## Failure, retry, retention, and retrieval

The save order is JPEG → manifest → annotations. A network or Function error marks only the current
asset failed. Keep the tab open and choose **Retry unsaved file** after connectivity or deployment
setup is restored. The retry reuses the same reviewed bytes and record ID; it never overwrites an
already confirmed object or substitutes different content.

There is deliberately no local download/export path. Closing or reloading the tab before an
unconfirmed record is retried discards the browser-held copy. A rare timeout can leave uncertainty
about whether the final immutable object reached Blob. Inspect the private dashboard before creating
a second record; do not assume a 409 collision is permission to replace an object.

A failed partial record has no automatic cleanup. A restricted storage operator should periodically
review incomplete `record_…` folders and securely delete rejected/partial records under the approved
retention policy. Treat the Vercel project and Blob dashboard as sensitive raw-data access; require
MFA and least privilege.

Only an authorized storage operator may later retrieve matching private objects into a protected
local training workspace. Keep the JPEG, manifest, and sidecar together outside this repository, run
the compiler described in [`19-build-the-first-camera-model.md`](19-build-the-first-camera-model.md),
and never commit, paste, or archive raw images/labels in this repository or chat.

## Verification and limits

Unit coverage exercises fail-closed owner-mode/store configuration, path/type/size/pairing policy,
same-origin credential-free browser requests, no browser Blob credential, and the SPA/API rewrite
boundary. The local compiler also covers explicit blank-board anchor labels and rejects empty
dart-test labels.

The UI statements are owner attestations, not an automated face/privacy detector. Intake validation
is not a complete schema, legal, or privacy review. Screen consent, images, labels, duplicates, and
session splits before model training. See [`08-security-privacy.md`](08-security-privacy.md),
[`19-build-the-first-camera-model.md`](19-build-the-first-camera-model.md), and the field-capture
runbooks for the wider governance controls.
