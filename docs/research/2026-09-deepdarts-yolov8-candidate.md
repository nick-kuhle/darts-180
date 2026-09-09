# DeepDarts YOLOv8 v2 candidate intake — research only

**Snapshot date:** 2026-09-08 (America/Los_Angeles)
**Status:** conditionally admitted for isolated research intake; **not** an approved Darts 180 model or deployment
**Owner:** ML/Data + Vision Runtime + Privacy/Release review

## 1. Decision and non-negotiable boundary

A public Roboflow export titled **DeepDarts YOLOv8 v2** is a plausible source of training/evaluation
research because it represents the published DeepDarts dart-entry-point plus board-calibration approach.
It is not a drop-in Darts 180 browser model.

This decision authorizes only the following:

- local, aggregate-only inspection of a lawfully obtained copy;
- clean-room experiments and reproducible evaluation planning on an isolated research branch;
- preservation of attribution and provenance records; and
- comparison against Darts 180's separately held-out, consented field data.

It does **not** authorize a live deployment, a Vercel manifest change, an ONNX package, a production
accuracy claim, use of Roboflow's hosted inference API, upload of Camera Play frames to a third party,
or copying the upstream DeepDarts source code. Darts 180 remains intentionally unavailable until a
separate release clears the model, data, browser, field-evaluation, and approval gates.

## 2. Intake evidence reviewed

The small metadata files supplied for review identify the export as:

| Field                           | Evidence                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Roboflow workspace/project      | `testing-zzmc9/deepdarts-yolov8`                                                                                                       |
| Dataset version                 | `2`                                                                                                                                    |
| Exported image count            | 1,397                                                                                                                                  |
| Export time in bundled README   | 2024-07-09 07:12 GMT                                                                                                                   |
| Export class declaration        | `nc: 5`, `names: ['0', '1', '2', '3', '4']`                                                                                            |
| Declared source                 | upstream [DeepDarts repository](https://github.com/wmcnally/deep-darts) and [IEEE DataPort record](https://doi.org/10.21227/05e7-xs69) |
| Export-license assertion        | CC BY 4.0                                                                                                                              |
| Export preprocessing            | EXIF orientation normalization, 640×640 **stretch** resize                                                                             |
| Export augmentation declaration | horizontal/vertical flips, 90-degree rotations, ±15° rotation/shear; three generated versions per source image                         |

The bundled text says “Devices are annotated.” That is generic Roboflow export metadata, not a
semantic class legend, and must not be used to infer the five labels.

No raw archive, sample image/annotation pair, model weights, model card, ONNX artifact, API credential,
or hosted-inference integration was accepted into the repository or application.

## 3. Licence and provenance finding

The Roboflow README's CC BY 4.0 assertion is corroborated by the official DOI metadata for the original
**DeepDarts Dataset**: its DataCite `rightsList` identifies **Creative Commons Attribution 4.0
International** ([DOI metadata](https://api.datacite.org/dois/10.21227/05e7-xs69), retrieved
2026-09-08). This is sufficient to advance the **data** candidate to controlled research intake,
provided the acquired material is traceable to that dataset/version and all attribution and licence
notices are retained.

Required attribution for data-derived research records and any permitted downstream release:

> McNally, William (2021). _DeepDarts Dataset_. IEEE DataPort. https://doi.org/10.21227/05e7-xs69.
> Licensed under CC BY 4.0.

This is a provenance finding, not legal advice or a full freedom-to-operate opinion. Before a public
commercial release, retain counsel/release review for the precise acquired derivative, all notices,
brand clearance, privacy requirements, and distribution method.

The upstream **code** is a separate matter. As of this review, the upstream GitHub repository did not
publish a detectable repository licence (its public GitHub licence endpoint returned `404`). Therefore:

- the data may be researched under the documented dataset licence;
- Darts 180 must not copy, redistribute, or incorporate upstream code or weight files under an assumed
  code licence; and
- any experiment must use Darts 180's independent implementation and document only high-level published
  method ideas and data provenance.

## 4. Five-class mapping — sample-confirmed roles, source order still audited

The Roboflow export stores only numeric label names. Its README states that it converted DeepDarts
annotations. The upstream [classes file](https://raw.githubusercontent.com/wmcnally/deep-darts/master/classes)
and [label conversion code](https://raw.githubusercontent.com/wmcnally/deep-darts/master/dataloader.py)
provide this likely source order:

| Export ID | Upstream name | Likely interpretation                                              |
| --------: | ------------- | ------------------------------------------------------------------ |
|       `0` | `dart`        | dart scoring/entry-point keypoint encoded as a small detection box |
|       `1` | `cal1`        | first ordered board calibration anchor                             |
|       `2` | `cal2`        | second ordered board calibration anchor                            |
|       `3` | `cal3`        | third ordered board calibration anchor                             |
|       `4` | `cal4`        | fourth ordered board calibration anchor                            |

The upstream scorer needs all four ordered calibration anchors to fit an image-to-board transform, then
maps dart coordinates through standard-board geometry. This is why the candidate is technically relevant:
its five classes likely represent **one dart point plus four pose anchors**, not five arbitrary dartboard
objects.

The Roboflow `data.yaml` still does not preserve the human-readable names, so an automated importer
must continue to report the map as `requires-visual-confirmation`. The following sample review supplies
that human confirmation for v2 research intake; it does not license a silent production relabeling.

### 4.1 Visual and geometric sample review — 2026-09-08

A matched 640×640 v2 image/YOLO-label pair was reviewed locally and remains outside Git:

| Item                                                   | SHA-256                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `DSC_0002_JPG.rf.1bd54328bf6c173a96d414d5664b908b.jpg` | `6604c3c26df724da3ff31ea696407ef39a86dadcaed02c1260bccf9f30a8ca60` |
| matching `.txt` label file                             | `6e8be3ba0c63b348391fbea3441270c99f80271a47347fc7b75bce5a56a1a36d` |

The label file has seven valid rows: one each for IDs `1`–`4` and three rows for ID `0`. Visual overlay
confirms that the three ID-`0` boxes are centered on the three visible dart entry points, while IDs `1`–`4`
mark four ordered, perimeter calibration locations around the same board.

As an additional sanity check, applying the upstream four-anchor perspective transform and standard-board
geometry places its projected ring/wedge boundaries on the visible board wires and preserves the printed
number order. It yields source-geometry proposals `9`, `10`, and `3` for the three visible points. Those
are a mapping/geometry check only—not independently verified ground truth, an inference result, or an
accuracy measurement.

This confirms the **roles** of the five v2 IDs for the reviewed sample. The exact v2-wide ordinal
provenance, split lineage, class consistency, and performance still require the aggregate audit and
held-out evaluation. Do not silently relabel the numeric classes in a production pipeline.

## 5. Technical fit and gaps

### What is promising

- The published DeepDarts method is semantically aligned with Darts 180's core principle: detect a dart
  **entry point**, solve board geometry, then use deterministic rules rather than classify an image directly
  as a score.
- Four non-collinear, ordered anchors can define a homography. The source method uses that fact to orient
  a standard board and derive rings and wedge identities.
- The original research describes manual labels for dart landing positions and four calibration points.
  Its reported historical result is not a Darts 180 performance claim: the paper's stronger dataset was
  face-on smartphone footage, while its varied-angle set was small and collected on a separate setup.
  See the [published dataset record](https://ieee-dataport.org/open-access/deepdarts-dataset).

### What prevents direct use

1. **Current contract mismatch.** Darts 180's `darts180-board-tip-v1` requires a tip, quality output, and
   nine named landmarks: bull, four named double anchors, and four outer cardinal validators. This
   candidate likely has only a tip plus four generic ordered anchors. It must not be padded with invented
   landmarks or wired to the current manifest.
2. **No production model.** The supplied material is a YOLO-format dataset. It is not weights, ONNX,
   output ABI, calibrated policy, model card, or a hash-bound release attestation.
3. **Image preprocessing risk.** The export's 640×640 **stretch** resize changes image aspect ratio. A
   camera scorer must use its contract's exact letterbox preprocessing and restore coordinates correctly;
   it must not adopt stretch because an external export used it.
4. **Split/leakage uncertainty.** Three generated variants per source image mean 1,397 files are not
   proof of 1,397 independent real captures. The export does not yet prove that related source frames or
   augmentations are separated by session/board/device across train, validation, and test.
5. **Coverage gap.** The original research is steel-tip focused. It does not establish soft-tip performance,
   broad current-phone/browser behavior, arbitrary rooms, severe occlusion, every board profile, or Darts
   180's required abstention precision.

## 6. Reproducible local intake audit

`ml/src/darts180_vision/deepdarts_yolo_audit.py` is an offline structural audit for a locally extracted
export. It deliberately does not download data, need a Roboflow key, train a model, or modify a web
manifest. It checks class declarations, paired image/label counts, YOLO row validity, per-class counts,
complete anchor-plus-dart frames, representative relative pairs containing every declared class,
cross-split relative-name collisions, and optionally exact duplicate image bytes.

```bash
cd ml
PYTHONPATH=src python -m darts180_vision.deepdarts_yolo_audit \
  /secure/path/to/extracted-deepdarts-export \
  --hash-images \
  --output /tmp/deepdarts-yolov8-v2-audit.json
```

The report is aggregate-only and may be reviewed or committed after removing local paths. Raw images,
labels, ZIP files, weights, and model artifacts remain excluded from Git by `.gitignore`.

## 7. Required experiment gates

| Gate                     | Required evidence                                                                                                                   | Outcome if not satisfied                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Class-order confirmation | One safe representative image and its paired YOLO label file, ideally containing IDs 0–4                                            | Do not assign semantic meanings to numeric IDs        |
| Structural intake        | Clean audit report; explain every orphan, malformed row, duplicate, and split collision                                             | Do not train from the export                          |
| Lineage/split review     | Source/derivative version, hashes, augmentation lineage, and group-aware split plan                                                 | Do not report held-out accuracy                       |
| Model design decision    | Written choice: use only as pretraining, relabel/retrain to nine landmarks, or define an experimentally reviewed successor contract | Do not adapt it silently to `darts180-board-tip-v1`   |
| Browser feasibility      | A new local-only ONNX candidate with strict output decoder, WebGPU/WASM tests, latency/memory/thermal evidence                      | Do not place an artifact in `apps/web/public/models/` |
| Field evaluation         | Locked, separately consented, human-adjudicated device/board/lighting/angle/point-type holdout                                      | Do not enable auto-record or advertise scoring        |
| Release approval         | Full schema-v2 manifest, artifact and attestation hashes, provenance/evaluation/approval IDs, rollback owner                        | Keep the public manifest `unavailable`                |

## 8. Next smallest safe handoff

The first representative v2 image/label review is complete. The next useful evidence is the aggregate
report from the local audit above—especially split counts, class counts, orphan/malformed-row findings,
relative-name collisions, exact byte-duplicate findings, and the listed representative pairs. If a later
sample conflicts with the confirmed roles, pause the candidate and investigate the derivative version.

Do not send an API key, password, token-bearing download link, full dataset archive, or third-party
hosted-inference credential. No deployed camera frame should leave the device for this research path.
