# Private GitHub Actions development-model build

**Status:** operator-only implementation handoff

**Scope:** approved Darts 180 Data Lab records, a review-only five-point ONNX candidate, and no deployment

**Does not provide:** a public Blob reader, a browser download, a training-data archive, hosted inference, or production scoring approval

This runbook is for the data owner when a protected desktop ML machine is unavailable and the
operator is using the Vercel/GitHub web interfaces, including from a phone. It implements a
**manual-only** GitHub Actions job that retrieves only explicitly approved private Blob records,
uses them only in the runner's temporary directory, and deletes them at job end.

The workflow is `.github/workflows/private-development-model.yml`. It does not run on pushes,
pull requests, schedules, or deployments.

> Do not deploy a generic `get(pathname)` Vercel Function for this purpose. A route that takes an
> arbitrary pathname has to authenticate and authorize every request correctly; it would turn the
> private Data Lab store into a browser-readable export surface if that protection were missed.
> This workflow calls the private Blob SDK directly from a protected CI environment instead.

## Security properties

| Boundary         | Enforced behavior                                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blob selection   | The job requires `DARTS180_APPROVED_RECORD_IDS`, an exact allow-list of the owner-approved `record_...` folders. It **does not call Blob `list()`** and never scans all contributor records.                                                                            |
| Blob reads       | For each allow-listed folder, it requests only `board.jpg`, `manifest.json`, and `annotations.json`. It rejects incomplete triplets, changed content types, files over Data Lab limits, malformed JPEGs, and mismatched capture provenance.                             |
| Raw workspace    | JPEGs, JSON, compiled data, synthetic scenes, checkpoints, training plots, and intermediate weights live only under the GitHub runner's temporary directory, outside the repository. They are deleted in an always-run cleanup step.                                    |
| CI logs          | Private retrieval/compiler/training output is redirected away from public job logs. A failed stage prints only a generic status, never a Blob URL, record ID, capture filename, label, or credential.                                                                   |
| Artifacts        | The only uploaded artifact is a seven-day aggregate `review-summary.json`; a successful `train` run additionally contains the ONNX and its development manifest. It never contains raw records, labels, reports with record rows, checkpoints, or training run folders. |
| Telemetry        | The job disables Ultralytics `sync` before retrieval and disables common experiment integrations. No hosted inference is used.                                                                                                                                          |
| Release boundary | The artifact is development-only and is not copied into `apps/web/public/models`, committed, deployed, or able to enable production auto-recording.                                                                                                                     |

## One-time setup from Vercel and GitHub

### 1. Make an explicit record allow-list

Use the Vercel dashboard; you do **not** need to download photos to the phone.

1. Open the Darts 180 Vercel project, then **Storage** and its connected **private Blob** store.
2. Browse the `darts180/capture-lab/v2/` folders.
3. Identify only the `record_` folder IDs for the captures that you personally approved for this
   initial experiment. A valid ID looks like `record_` followed by 32 hexadecimal characters.
4. Keep one ID per line in a private note long enough to create the GitHub secret below. Do not put
   image URLs, JPEGs, JSON, a ZIP, or the list in the repository or chat.

The exact allow-list is intentional. Data Lab is consent-gated but development-open, so an owner
approval for one contributor must not become permission to retrieve every private record.

### 2. Create a protected GitHub Environment

In the **private** Darts 180 GitHub repository:

1. Open **Settings → Environments → New environment** and name it exactly
   `private-model-build`.
2. Enable required reviewer protection if available, with the data owner as reviewer.
3. Add these **environment secrets**—not repository files, workflow inputs, or Actions variables:

   | Secret name                      | Value                                                                            | Notes                                                                                                       |
   | -------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
   | `DARTS180_BLOB_READ_WRITE_TOKEN` | The existing private Blob read/write token from the Vercel project configuration | It stays server-side in Actions. Never paste it into chat, source, an issue, a commit, or a URL.            |
   | `DARTS180_APPROVED_RECORD_IDS`   | The exact approved `record_...` IDs, one per line                                | This is an allow-list, not a public collection key. It controls exactly which triplets the job may request. |

The static Blob token is powerful enough to read/write its store. Restrict it to this protected
environment, authorize each run, and remove the GitHub Environment secret after the job has
finished. Do not revoke the active Vercel token without first replacing the configuration used by
the deployed private intake service.

### 3. Run data preparation first

1. Open **Actions → Private development model build → Run workflow**.
2. Choose the reviewed branch and leave **Mode** set to `prepare`.
3. Use a stable non-secret split seed. The default is appropriate for this initial campaign.
4. Replace the review-ID defaults only with non-secret internal review identifiers. They are evidence
   labels, not passwords and not raw-record names.
5. Approve the protected-environment request and wait for the job to finish.

A successful `prepare` run uploads one short-lived artifact named
`darts180-private-model-build-<run-id>`. Its `review-summary.json` contains only aggregate counts
and safety flags. It is safe to use for the next approval decision, but it does not prove camera
accuracy and does not contain a model.

If it fails, the runner still removes its private working directory. The job intentionally avoids
showing label detail in logs. Correct selection/label issues in Data Lab or the protected storage
operation, then dispatch a new manual run; do not make a public Blob export route for debugging.

## Training mode is deliberately a second approval

Use **Mode: `train`** only after the aggregate preparation result is accepted and a legally reviewed,
YOLOv8-compatible starting checkpoint is available. The workflow then requires all three fields:

| Workflow field                 | Required property                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `checkpoint_license_review_id` | A short, non-secret record of the checkpoint's licence/provenance review.                                         |
| `checkpoint_url`               | An immutable direct `https://` download URL with no query string, fragment, embedded username/password, or token. |
| `checkpoint_sha256`            | The exact source publisher/reviewer-provided lowercase SHA-256 for the checkpoint bytes.                          |

The job refuses a missing/ambiguous source, a tokenized URL, a non-HTTPS redirect, an oversized
file, or an unexpected SHA-256. It hash-locks the checkpoint before training; the original local
training command still does not silently download a weight on its own.

Training then performs these fixed operations:

```text
explicit approved private triplets
  → five-point Data Lab validation + session-disjoint real compilation
  → deterministic 300-image procedural bootstrap
  → mixed train only (real + synthetic)
  → real-only validation and test
  → local CPU development training/export in the runner
  → hash-verified ONNX + development manifest as the only model artifact
  → mandatory raw-workspace deletion
```

The synthetic corpus remains training-only. A synthetic validation/test result never appears as a
physical-board metric. The model's JSON manifest says `releaseStage: development`, every proposal
must remain editable, and it does not satisfy the separate nine-landmark production ABI.

## After a successful training run

Do not deploy the ONNX automatically. Review all of the following before a separate artifact-install
change:

1. `review-summary.json` shows nonzero reviewed-real train, validation, and test partitions.
2. The mixed-data safety flags preserve real-only validation/test and `productionReady: false`.
3. The downloaded ONNX and manifest pass the browser artifact verifier (the workflow already runs it).
4. The candidate initializes and produces sensible **editable** anchor/tip suggestions on held-out
   real iPhone captures.
5. A reviewed installer places only the model and manifest in the existing Vercel web project. Raw
   records must never be added to that install change.

A successful first candidate may enable Data Lab's automatic local suggestions after a separate
reviewed install. It does **not** authorize Live Scoring to auto-record production scores. Continue
collecting and reviewing diverse real sessions, and preserve whole unseen sessions for the next
model's real-world evaluation.
