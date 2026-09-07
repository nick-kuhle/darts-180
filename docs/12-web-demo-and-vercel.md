# Web demo and Vercel deployment

**Purpose:** put a polished, honest Darts 180 prototype in front of testers today without exposing
an unfinished camera API or claiming live AI scoring.

## What deploys now

`apps/web/` is a static React/Vite web demo that includes:

- interactive accurate standard dartboard manual input;
- 501 and Cricket game flows using the shared deterministic rules package;
- editable three-dart review cards;
- simulated camera candidates that demonstrate safe `LOCKED` versus `CHECK` behavior;
- quality-gate examples for a good view, a board that is too far away, and a view too oblique;
- an experimental browser-local **Camera Score** field-test flow: fixed-camera preview, manual
  four-double-bed calibration, transparent setup gate, in-memory clear-board reference, temporal
  dart-shape proposals, visible-tip fallback, and DartCard review;
- event-style visit history;
- a browser **Capture Lab** that can take a board-focused still and download a local JPEG + manifest
  without uploading it anywhere;
- a browser **Annotation Lab** that pairs that local JPEG/manifest, solves a manually clicked
  four-anchor homography, and downloads a local deterministic-label sidecar.

It has **no account, database, raw camera upload, or trained CV model**. Camera Score includes an
inspectable fixed-camera frame-difference heuristic for controlled field testing, but it is not a
trained entry-point model or an auto-scoring claim. The Capture and Annotation Labs keep their
media/labels browser-local until their user explicitly downloads them. Camera access is requested
only after a click. That is intentional: it is safe to share as a product/UX prototype and deploy as
a static site.

## Fastest Vercel path — founder steps

The initial foundation is merged in
[PR #1](https://github.com/nick-kuhle/darts-180/pull/1). The browser Camera Score field-test update
is prepared on `camera-field-test` for a separate review before a production deployment. Review each
diff and its GitHub Actions result before merging. No delivery credential is stored in source, Git
configuration, or the remote URL; revoke any short-lived delivery token once the PR is confirmed.

### 1. Import the repository into Vercel

1. Sign in to Vercel.
2. Click **Add New → Project**.
3. Import `nick-kuhle/darts-180`.
4. Keep **Root Directory** as the repository root.
5. Vercel will read root `vercel.json`, which runs:
   - install: `npm ci`
   - build: `npm run build --workspace=@darts-180/web`
   - output: `apps/web/dist`
6. Click **Deploy**.

No environment variables are required for the static demo. `vercel.json` also sets static privacy
headers: camera access is same-origin only, microphone/geolocation are disabled, and the CSP permits
only app-owned assets plus the local `data:`/`blob:` media used for the still preview. Do not deploy
`services/api` as a Vercel function in its current development/in-memory form.

For a mounted-device test, use the deployed HTTPS URL and follow the
[Browser camera field-test guide](14-browser-camera-field-test.md). The feature runs locally in the
browser and must stay in its stated fixed-mount, review-required envelope.

### 2. Share the preview URL

Use it with a small group for UX feedback. Say: “This is the Darts 180 scoring-flow prototype; camera
results are simulated while we collect and label real dartboard data.” Avoid saying “AI scoring is
live” until it is true.

## Vercel CLI option

```bash
npm install -g vercel
vercel login
cd darts-180
vercel
```

Accept the detected static settings. For production, use `vercel --prod` only after the working name,
legal notices, and preview content are approved.

## Custom domain / public launch checklist

Do **not** buy/publish the final brand before counsel clears `Darts 180`. Once cleared:

- add domain in Vercel project settings;
- set domain/DNS exactly as Vercel requests;
- add privacy/contact pages before collecting user details;
- decide whether the private GitHub source link should remain visible to public testers;
- set up basic uptime/analytics that do not capture raw gameplay media;
- protect `main` and require the CI workflow to pass;
- create a simple feedback form with no video upload by default.

## Future architecture

Vercel can continue hosting this landing/demo/site and a future authenticated dashboard. The
realtime event API and media/ML services should run in an environment designed for long-lived
WebSockets, managed Postgres, background workers, and privacy controls. Keep those systems separate
from the static demo until their security/design gates are met.
