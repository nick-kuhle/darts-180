# Security, privacy, and data governance

**Status:** baseline policy; obtain qualified legal review before launch  
**Principle:** a phone aimed at a dartboard may also see a home. Treat that as sensitive by design.

## 1. Privacy posture

- **On-device scoring by default.** A local game and vision session do not require cloud video.
- **Minimum collection.** Store score events and calibration metadata separately from raw media.
- **Explicit, granular consent.** Camera permission, account consent, analytics consent, and ML
  contribution consent are distinct decisions.
- **No ads / no data sale** as a product principle unless a future policy changes with explicit user
  disclosure and governance approval.
- **Human correction is not hidden telemetry.** It may improve a local model/session without any
  cloud sharing. Upload requires opt-in.

## 2. Data inventory and default handling

| Data category         | Examples                                  | Default           | Security / retention                                  |
| --------------------- | ----------------------------------------- | ----------------- | ----------------------------------------------------- |
| Gameplay              | scores, visits, rules, local player names | on device         | encrypted platform storage; user export/delete        |
| Camera permission     | device-level permission state             | device OS         | do not infer consent from it                          |
| Calibration           | homography, board profile, quality stats  | device            | no image necessary; expire/recalibrate                |
| Live frames           | preview/inference buffers                 | memory only       | no network; bounded ring buffer; erase on session end |
| Replay clip           | board crop around a disputed dart         | off by default    | local short-lived; share only explicit opt-in         |
| ML contribution       | redacted crop/label/prediction/correction | opt-in            | consent version, purpose, lifecycle, deletion path    |
| Account               | email/passkey subject/profile             | optional          | least privilege, encryption, access audit             |
| Operational telemetry | latency/error/quality aggregates          | policy controlled | no raw frames; sampled/aggregated                     |

Never collect audio for dart scoring. Avoid device advertising IDs. Do not attach raw room video to
an ordinary crash report or analytics event.

## 3. Consent design

### Layer 1 — camera access

Explain: “Darts 180 uses the camera to see the dartboard and suggest scores. Scoring happens on this
device by default.” Include manual scoring after denial.

### Layer 2 — optional account/sync

Explain the benefit (cross-device history/online play), fields stored, and how to use the local app
without it.

### Layer 3 — optional model improvement

A separate settings screen, never a dark pattern during first setup. It states:

- exact media scope: de-identified board crop / number of seconds, no faces or audio;
- why: improve angle/lighting/dart-type scoring;
- whether correction/quality metadata is shared;
- retention period / withdrawal and deletion behavior;
- destination/processor region where applicable;
- no gameplay penalty if declined.

Store consent version, timestamp, scope, and device installation pseudonym with every eligible
record. Re-prompt when materially changing scope; do not retroactively expand consent.

## 4. De-identification and media controls

Before any upload or labeling:

1. constrain capture to a board crop at source where possible;
2. run face/person/background detection and reject/quarantine suspect frames;
3. remove EXIF/GPS/serial metadata;
4. replace account identity with a rotating pseudonymous capture ID;
5. encrypt in transit and at rest; use pre-signed single-purpose upload URLs;
6. access through role-based, audited data workspace—not shared buckets;
7. retain lineage from object to consent/deletion request/model dataset.

No automated redaction system is perfect. Failure cases require manual privacy QA and an immediate
remove path.

## 5. Security architecture controls

| Layer          | Required control                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile         | platform secure storage for tokens/keys; certificate/TLS validation; no secrets in bundle; app integrity signals evaluated carefully, not as sole control |
| API            | OIDC/passkeys or vetted auth provider; short-lived access tokens; authorization per game; rate limits; schema validation; idempotency; audit logs         |
| Database       | encrypted storage/backups; least privilege; row/tenant isolation; migration review; tested restore                                                        |
| Object storage | private bucket; presigned limited uploads/downloads; encryption; lifecycle/retention/deletion; no public URLs                                             |
| ML workspace   | separate project/account; de-identified data; role-limited notebooks; training artifact provenance; secrets vault                                         |
| CI/CD          | protected branches, code review, dependency scanning, signed releases/artifacts, secret scanning, environment separation                                  |
| Staff          | MFA, least privilege, joiner/mover/leaver process, incident drills                                                                                        |

## 6. Threat model highlights

| Threat                                       | Consequence                          | Mitigation                                                                                                          |
| -------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Raw room/face video uploaded accidentally    | severe privacy breach                | local crop, pre-upload scan, explicit consent, bucket policy, deletion path                                         |
| Attacker changes score event / cheats online | unfair game, trust loss              | authenticated append-only events, per-game roles, server sequence, signed/attested device data only where justified |
| Replayed API requests                        | duplicated darts                     | UUID idempotency key + event ID + server uniqueness                                                                 |
| Exposed object URL                           | media disclosure                     | private object store, short presigned URLs, audit, key rotation                                                     |
| Model artifact tampering                     | unsafe/incorrect scoring             | immutable checksummed artifact, hash-bound public attestation/policy, registry approval, staged rollout/rollback    |
| AI overconfidence                            | wrong score silently accepted        | quality gate, calibrated confidence, review UI, provenance                                                          |
| Dependency compromise                        | client/server compromise             | lockfiles, SBOM, dependency review/scanning, release signing                                                        |
| Lost phone                                   | local history/possibly clips exposed | OS encryption, app lock/biometrics option, short media retention, remote account/session revoke                     |

## 7. Legal/compliance workstream

This is product guidance, not legal advice. Before public beta, counsel must map actual operations
against applicable laws/terms, including California privacy requirements (the team is based in Los
Angeles), GDPR/UK GDPR if serving those regions, children/age handling, biometric/privacy laws
where applicable, app-store disclosures, data-processing agreements, international transfers, and
sports/venue rules.

Recommended default for online/social features: age gate and region-aware policy. Do not market
Darts 180 as tournament adjudication until governance, accuracy, dispute policy, and liability
review explicitly approve that claim.

## 8. Data subject / player controls

- View/export game history in JSON/CSV or human-readable summary.
- Delete local data from settings; explain cloud/backup lifecycle separately.
- Delete account and cloud history according to policy.
- Revoke future ML contribution at any time; process deletion requests for contributed media/labels.
- See current model-contribution consent and all scopes.
- Report a privacy concern without creating a public issue.

## 9. Incident response

1. Stop unsafe upload/access path and preserve minimal evidence.
2. Triage severity with security/privacy/legal owners.
3. Identify scope using immutable access logs and data lineage.
4. Revoke credentials/URLs, contain data, fix root cause, and test the fix.
5. Notify affected people/regulators/partners according to legal obligations.
6. Conduct blameless postmortem; update controls/runbooks.

Use the repository `SECURITY.md` contact path until a dedicated security mailbox exists.

## 10. Non-negotiable launch checks

- Privacy policy, camera disclosures, consent screens, retention schedule, and subprocessor list
  match actual software behavior.
- Threat model review and penetration test appropriate to launch surface.
- Production account cannot list/read all media by default.
- Deletion/export workflow tested end-to-end.
- Model feedback path demonstrably rejects faces/audio/unknown-consent records.
- Support staff has scripts for camera privacy questions and incident escalation.
