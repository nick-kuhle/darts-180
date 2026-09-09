# Guided Data Lab and private Vercel capture intake

**Snapshot date:** 2026-09-08 (America/Los_Angeles)

**Status:** implemented locally; intentionally disabled until this existing Vercel project is configured

**Audience:** Darts 180 owner/operator collecting the first consented board-only camera corpus

## What this adds — and what it does not

The web app now has two deliberately separate front-door choices:

- **LIVE SCORING** is the eventual player flow. It uses only browser-local camera inference when a
  real, verified model exists. It never asks a player to tap calibration points, upload a photo, or
  disclose a collection key.
- **DATA LAB** is a short, guided development workflow: choose **Blank board** or **Dart test**,
  take a board-only JPEG, tap four known rim junctions (and visible dart tips for a dart test), then
  explicitly choose a local backup or a private cloud save.

This document covers the optional private cloud save. It does **not** activate a model, make a
camera prediction, turn manually tapped labels into ground truth automatically, or authorize
production auto-recording. The current production model remains unavailable until the separate
model-evidence gates are met.

## Data Lab flow

The normal collection loop is intentionally small:

1. Choose **Blank board** first, or **Dart test** after darts have settled. Keep the full number
   ring visible and every person/personal room detail out of frame.
2. Use the rear camera to take one still. The browser resizes/compresses it to a bounded JPEG that
   fits the intake route; it is held only in page memory at this point.
3. Confirm the two statements for that exact still: it is board-only, and you own it or have
   permission to use it for Darts 180 development.
4. Tap the four source-compatible outer-rim junctions in the shown order: CAL 1 D5/D20, CAL 2
   D17/D3, CAL 3 D8/D11, CAL 4 D13/D6. For a dart test, tap each clearly visible physical tip (at
   most three). A blank-board example deliberately has **no** dart tip label.
5. Recheck the labels and select **Review save**. Either download the matched JPEG/manifest/sidecar
   locally, or explicitly save that trio to private storage.

The Data Lab starts with a pseudonymous setup/session ID. Keep it while the phone, mount, board,
and lighting stay materially the same; create a new one after a move, lighting change, board change,
or a later collection day. The compiler preserves whole sessions in only one of train, validation,
or test.

Blank-board examples are accepted by the local five-point compiler as anchor-only examples. They
supplement—not replace—dart tests; the compiler still refuses a compilation with no dart entry
labels at all.

## Private storage design

Raw captures are never public media. A cloud save uses this deliberately narrow path:

```text
Browser Data Lab
  └─ same-origin PUT /api/capture-ingest (operator collection key, bounded JPEG/JSON)
       └─ server validates file type, size, pseudonymous IDs, consent attestation, and pairing
            └─ Vercel Blob private object: darts180/capture-lab/v1/record_<random>/...
```

Each reviewed example has three immutable, private objects under a random record ID:

- `board.jpg`
- `manifest.json`
- `annotations.json`

The Function accepts only JPEG for `board.jpg` and JSON for the two sidecars, bounds image size to
3.5 MB and JSON to 192 KiB, checks JPEG framing, rejects mismatched capture IDs, and never accepts a
client-supplied full Blob pathname: the server fixes the prefix and filenames around a validated random
record ID. It returns only a confirmation/digest—not a Blob URL. This web app
has **no read/list/download endpoint** for these objects, so a browser visitor cannot use it to
browse stored photos. Vercel project/storage access remains the controlled retrieval path.

The Blob store must be **Private**. The browser never receives `BLOB_READ_WRITE_TOKEN`, a Blob read
URL, a direct-upload token, or a `VITE_` environment variable. The app sends the JPEG to its
same-origin Function rather than directly to a Blob hostname, so the existing restrictive
`connect-src 'self'` CSP remains appropriate.

### Collection authorization boundary

The app has no account system yet. Therefore the Function is fail-closed unless all of these are
true on the server:

1. a private Blob credential is present through the Vercel store connection (OIDC + store ID is
   preferred; the Vercel-provided static Blob token is an allowed fallback);
2. `DARTS180_CAPTURE_UPLOAD_SECRET` is set to a non-empty high-entropy value of at least 32
   characters; and
3. the operator supplies that exact value in the Data Lab during the current browser tab.

The key is not saved in local/session storage, cookies, a URL, a downloaded JSON file, source code,
Vercel client environment, or telemetry. It is sent only over HTTPS in a same-origin request header
when the operator explicitly saves a reviewed record. The Function rejects cross-site browser
requests and compares key hashes in constant time.

This is an appropriate **single-owner development collection gate**, not a substitute for accounts,
per-user authorization, rate limits, audit events, deletion tooling, or a public beta upload system.
Before inviting anyone beyond a tightly controlled operator group, replace it with reviewed user
authentication/authorization and a governed data workspace.

## Configure the existing Vercel project after merge

Do this in the **same existing Darts 180 Vercel project and production URL**. Do not create a
replacement site/project and do not paste any secret into GitHub, chat, source, a `.env` file that
will be committed, or a `VITE_` variable.

1. In the Vercel project, open **Storage** → **Create** → **Blob**. Name it something unambiguous,
   such as `darts180-private-captures`, and choose **Private** access.
2. Connect it to the existing project for **Production** and **Preview**. Vercel adds server-side
   storage variables to those environments. Keep their names/values private. Prefer Vercel's
   short-lived OIDC/store-ID setup for server access; the SDK can use the store-provided fallback
   token where needed, but it must never be exposed to the browser.
3. Generate a random collection key in a password manager or on a trusted terminal, for example:

   ```bash
   openssl rand -base64 32
   ```

   Add the result as the server-only Vercel environment variable
   `DARTS180_CAPTURE_UPLOAD_SECRET` for **Production** and **Preview**. Do not use the example
   command output as a password; generate your own. The Function rejects values shorter than 32
   characters.

4. Turn on Vercel Deployment Protection / Vercel Authentication for the collection deployment as
   appropriate for the project team. This is defense in depth; the collection key is still required
   for a write.
5. Merge/deploy this branch through the existing project. Open the direct HTTPS production URL (not
   an iframe preview), choose **DATA LAB**, take a safe blank-board still, and enter the collection
   key only when the page says private storage is ready.
6. Confirm the three objects appear in the private Blob store's dashboard under a random `record_…`
   folder. Verify that they are marked private and that no public image link was produced. Then test
   one dart-test image in the same way.

If the page says **Setup needed**, it has deliberately detected that the Function lacks either a
Blob credential or the server-only collection secret. Use **Download local backup** until setup is
complete; do not weaken the route or make the store public to bypass this state.

## Failure, retry, and retrieval operations

Data Lab uploads JPEG → manifest → annotation sidecar in that order and shows the state of each
file. If a file fails, retain/download the local backup and choose **Retry unsaved file** after
fixing connectivity or the collection key. Completed assets are not overwritten. A rare timeout can
leave an operator unable to know whether the last immutable object reached Blob; preserve the local
backup and inspect the private store before creating a second record.

A failed partial record has no automatic cleanup yet. The storage operator should periodically find
incomplete `record_…` folders in the private Blob dashboard, preserve any needed local backup, then
delete rejected/partial records according to the approved retention policy. Treat the storage
operator dashboard as sensitive data access and require project MFA/least privilege.

To build a local training folder later, an authorized storage operator downloads the matching three
private objects, keeps the JPEG and `*-annotations.json` sidecar together in a protected folder
outside the repository, and runs the compiler described in
[`19-build-the-first-camera-model.md`](19-build-the-first-camera-model.md). Do not commit, paste, or
archive raw images/labels in this repository or chat.

## Verification and limits

The implementation has unit coverage for fail-closed configuration, path/type/size/pairing policy,
same-origin client requests, no browser Blob credential, and the existing SPA/API rewrite boundary.
It also adds compiler coverage for accepted explicit blank-board anchor labels and rejected empty
dart-test labels.

The UI checkbox is an operator attestation, not an automated face/privacy detector. The Function's
small metadata checks are intake guards, not a full schema/legal/privacy review. Review images,
consent, labels, duplicates, and session splits before model training. See
[`08-security-privacy.md`](08-security-privacy.md),
[`19-build-the-first-camera-model.md`](19-build-the-first-camera-model.md), and the existing
field-capture runbooks for the broader governance requirements.
