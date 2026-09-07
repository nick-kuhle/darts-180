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
- an experimental browser-local **Camera Play** field-test flow: touch-fitted outer-board guide with
  a clear 20 orientation marker; drag/tap, pinch, twist, and individual edge-handle adjustment;
  one-tap baseline capture via **Calibrate & Play**; automatic temporal dart-shape proposals; and
  ordinary DartCard correction when needed;
- event-style visit history;
- a browser **Capture Lab** that can take a board-focused still and download a local JPEG + manifest
  without uploading it anywhere;
- a browser **Annotation Lab** that pairs that local JPEG/manifest, solves a manually clicked
  four-anchor homography, and downloads a local deterministic-label sidecar.

It has **no account, database, raw camera upload, or trained CV model**. Camera Play uses an
inspectable fixed-camera frame-difference heuristic for controlled field testing, but it is not a
trained entry-point model or a proven auto-scoring claim. The normal flow makes an internal,
deterministic best endpoint/candidate estimate rather than asking a player to identify a steel or
soft dart tip; correction remains available for every score. Capture and Annotation Labs keep their
media/labels browser-local until their user explicitly downloads them. Camera access is requested
only after a click. That is intentional: it is safe to share as a product/UX prototype and deploy as
a static site.

## Fastest Vercel path — founder steps

The initial foundation, browser field test, and Vercel/mobile camera deployment preparation are
merged in [PR #1](https://github.com/nick-kuhle/darts-180/pull/1),
[PR #2](https://github.com/nick-kuhle/darts-180/pull/2), and
[PR #3](https://github.com/nick-kuhle/darts-180/pull/3). Review each diff and its GitHub Actions
result before using a build for external testing. No delivery credential is stored in source, Git
configuration, or the remote URL; revoke any short-lived delivery token once the delivery is
confirmed.

### 1. Import the repository into Vercel

1. Sign in to Vercel.
2. Click **Add New → Project**.
3. Import `nick-kuhle/darts-180`.
4. When Vercel shows several deployable folders, click **`apps/web`**. This is the website.
   Do **not** choose `services` or `ml`.
5. Check that **Root Directory** says `apps/web`. If it does not, click **Edit** beside Root
   Directory and choose `apps/web`.
6. Turn on **Include files outside the Root Directory**. The website needs the shared game-rule
   packages and base TypeScript configuration from the repository.
7. If Vercel asks for a framework, choose **Vite**. It reads `apps/web/vercel.json`, which runs:
   - install: `cd ../.. && npm ci`
   - build: `cd ../.. && npm run build --workspace=@darts-180/web`
   - output: `dist`
8. Leave Environment Variables empty and click **Deploy**.

The app-level `apps/web/vercel.json` sets static privacy headers: camera access is same-origin only,
microphone/geolocation are disabled, and the CSP permits only app-owned assets plus the local
`data:`/`blob:`/`mediastream:` media used by browser-local capture. Do not deploy `services/api` as a
Vercel function in its current development/in-memory form.

### 2. Create the HTTPS field-test preview

After Vercel is connected to GitHub, open the production deployment for `main` or a Preview
Deployment for the current Camera Play pull request. Use the Vercel deployment’s **Visit** link.

> **Do not use an embedded development preview for this test.** Arena’s preview iframe—and many
> in-app browsers—cannot show a normal camera permission prompt. Open the resulting
> `https://…vercel.app` URL directly in Safari or Chrome on the mounted phone/tablet.

Camera permission is requested only after tapping **START REAR CAMERA**. In **CAMERA PLAY**, fit the
20-oriented guide around the outer double wire, then use **CALIBRATE & PLAY** with an empty board. If
a direct HTTPS tab does not prompt, use that browser’s lock/camera controls to set Camera to
**Allow**, reload the page, and try again. On iOS, check Safari’s website camera setting; on Android
Chrome, check the site settings behind the lock icon.

For the full mounted-device workflow, follow the
[Browser camera field-test guide](14-browser-camera-field-test.md). The feature runs locally in the
browser and must stay in its stated fixed-mount, review-required envelope.

### 3. Share the preview URL

Use it with a small group for controlled UX feedback. Say: “This is the Darts 180 experimental,
browser-local camera field test; every score remains correctable.” Avoid saying “AI scoring is live”
or publishing an accuracy claim until held-out real-device evidence supports it.

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
