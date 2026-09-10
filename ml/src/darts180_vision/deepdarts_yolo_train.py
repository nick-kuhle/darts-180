"""Deliberate local training/export path for Darts 180's editable five-point development scorer.

This command never downloads data, calls hosted inference, copies an artifact into the web app, or
marks a model production-ready. It trains only from a caller-provided local five-point YOLOv8 dataset
after the repository's structural audit succeeds. The caller must state whether the data is fully
synthetic, reviewed real data, or a mixture; a synthetic bootstrap remains visibly synthetic in the
resulting development-only manifest.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from darts180_vision.deepdarts_yolo_audit import DatasetAuditError, audit_deepdarts_yolov8_export

_MANIFEST_SCHEMA_VERSION = 1
_REQUIRED_NUMERIC_NAMES = ["0", "1", "2", "3", "4"]
_DEFAULT_PUBLIC_ASSET_PATH = "/models/darts180-deepdarts-yolo-dev-v1.onnx"
_TRAINING_DATA_KINDS = frozenset({"synthetic-only", "real-reviewed", "mixed-synthetic-and-real"})
_SYNTHETIC_BOOTSTRAP_REPORT = "darts180-synthetic-fivepoint-bootstrap.json"
_MIXED_DATASET_REPORT = "darts180-mixed-fivepoint-dataset.json"


class DevelopmentTrainingError(ValueError):
    """Raised before training when a local candidate is not safe enough for a dev experiment."""


def validate_audit_for_development_training(report: dict[str, Any]) -> None:
    """Require intact five-class local data, while deliberately not confusing it with release proof."""

    metadata = report.get("metadata")
    candidate = report.get("deepDartsCandidate")
    aggregate = report.get("aggregate")
    integrity = report.get("labelIntegrity")
    if not isinstance(metadata, dict) or not isinstance(candidate, dict):
        raise DevelopmentTrainingError(
            "The local dataset audit did not return its required metadata."
        )
    data_yaml = metadata.get("dataYaml")
    if not isinstance(data_yaml, dict) or data_yaml.get("names") != _REQUIRED_NUMERIC_NAMES:
        raise DevelopmentTrainingError(
            "The local data.yaml must preserve the reviewed numeric five-point class order 0 through 4."
        )
    if candidate.get("numericExportShapeMatchesExpected") is not True:
        raise DevelopmentTrainingError(
            "The local export does not match the reviewed five-class candidate shape."
        )
    if not isinstance(integrity, dict) or integrity.get("count") != 0:
        raise DevelopmentTrainingError(
            "Resolve local label-integrity issues before training a development model."
        )
    if (
        not isinstance(aggregate, dict)
        or aggregate.get("framesWithDartAndAllFourCalibrationAnchors", 0) < 1
    ):
        raise DevelopmentTrainingError(
            "The local export needs at least one frame with class-0 dart and all four calibration anchors."
        )


def build_development_manifest(
    *,
    model_version: str,
    model_sha256: str,
    output_tensor_name: str,
    public_asset_path: str,
    training_data_id: str,
    training_data_kind: str,
    license_review_id: str,
    trained_at: str,
    image_size: int,
) -> dict[str, Any]:
    """Create the browser's isolated review-only manifest; this is never a production artifact."""

    if not model_version.strip():
        raise DevelopmentTrainingError("model_version cannot be empty.")
    if len(model_sha256) != 64 or any(
        character not in "0123456789abcdef" for character in model_sha256
    ):
        raise DevelopmentTrainingError("model_sha256 must be lowercase SHA-256 hex.")
    if not output_tensor_name.replace("_", "a").isalnum() or output_tensor_name[0].isdigit():
        raise DevelopmentTrainingError(
            "The ONNX output tensor name is not safe for the browser manifest."
        )
    allowed_path = public_asset_path.startswith("/") and all(
        part and part.replace("_", "a").replace("-", "a").replace(".", "a").isalnum()
        for part in public_asset_path.removeprefix("/").split("/")
    )
    if not allowed_path or ".." in public_asset_path or not public_asset_path.endswith(".onnx"):
        raise DevelopmentTrainingError(
            "public_asset_path must be a root-relative .onnx path with safe segments and no traversal."
        )
    if image_size < 256 or image_size > 2048:
        raise DevelopmentTrainingError("image_size must be between 256 and 2048.")
    if not training_data_id.strip() or not license_review_id.strip():
        raise DevelopmentTrainingError("training_data_id and license_review_id are required.")
    _validate_training_data_kind(training_data_kind)

    return {
        "schemaVersion": _MANIFEST_SCHEMA_VERSION,
        "modelId": "darts180-deepdarts-yolo",
        "modelVersion": model_version,
        "releaseStage": "development",
        "assetPath": public_asset_path,
        "sha256": model_sha256,
        "runtime": "onnxruntime-web",
        "input": {
            "width": image_size,
            "height": image_size,
            "colorOrder": "rgb",
            "normalization": "zero-to-one",
            "resizeMode": "stretch",
        },
        "output": {
            "detections": output_tensor_name,
            "layout": "yolov8-raw-cxcywh-class-scores",
            "classCount": 5,
        },
        "classMap": {
            "dartEntryPoint": 0,
            "calibration1": 1,
            "calibration2": 2,
            "calibration3": 3,
            "calibration4": 4,
        },
        "policy": {
            # Low detector floors deliberately permit early test evidence; they are detector filters,
            # not a score-accuracy claim. Every proposal remains an editable review card.
            "minDetectionConfidence": 0.10,
            "minDartConfidence": 0.10,
            "minCalibrationConfidence": 0.10,
            "nmsIouThreshold": 0.45,
            "maxDetections": 32,
            "tipTrackMatchDistanceMm": 12,
            "tipTrackSettleMs": 250,
            "tipTrackStaleAfterMs": 1200,
            "maxTipTrackSpreadMm": 6,
        },
        "provenance": {
            "trainingDataId": training_data_id,
            "trainingDataKind": training_data_kind,
            "licenseReviewId": license_review_id,
            "trainedAt": trained_at,
        },
    }


def _validate_training_data_kind(value: str) -> None:
    if value not in _TRAINING_DATA_KINDS:
        allowed = ", ".join(sorted(_TRAINING_DATA_KINDS))
        raise DevelopmentTrainingError(f"training_data_kind must be one of: {allowed}.")


def validate_dataset_provenance(root: Path, training_data_kind: str) -> None:
    """Bind recognized local source reports to an honest development artifact provenance field."""
    _validate_training_data_kind(training_data_kind)
    synthetic_report = root / _SYNTHETIC_BOOTSTRAP_REPORT
    mixed_report = root / _MIXED_DATASET_REPORT
    if synthetic_report.is_file() and mixed_report.is_file():
        raise DevelopmentTrainingError(
            "A dataset cannot carry both synthetic-only and mixed provenance reports."
        )
    if mixed_report.is_file():
        _validate_mixed_dataset_report(mixed_report)
        if training_data_kind != "mixed-synthetic-and-real":
            raise DevelopmentTrainingError(
                "A reviewed mixed dataset must produce a mixed-synthetic-and-real development manifest."
            )
        return
    if synthetic_report.is_file():
        _validate_synthetic_bootstrap_report(synthetic_report)
        if training_data_kind != "synthetic-only":
            raise DevelopmentTrainingError(
                "A synthetic bootstrap dataset must produce a synthetic-only development manifest; "
                "do not present it as reviewed real or mixed data."
            )
        return
    if training_data_kind == "synthetic-only":
        raise DevelopmentTrainingError(
            "synthetic-only training requires the generated synthetic bootstrap provenance report in dataset_root."
        )
    if training_data_kind == "mixed-synthetic-and-real":
        raise DevelopmentTrainingError(
            "mixed-synthetic-and-real training requires the reviewed mixed dataset provenance report in dataset_root."
        )


def _validate_synthetic_bootstrap_report(path: Path) -> None:
    report = _read_provenance_report(path, "synthetic bootstrap")
    provenance = report.get("syntheticProvenance")
    if not isinstance(provenance, dict):
        raise DevelopmentTrainingError(
            "Synthetic bootstrap report has no usable provenance object."
        )
    if (
        provenance.get("consentVersion") != "SYNTHETIC-NO-USER-DATA"
        or provenance.get("admissionStatus") != "synthetic-not-real-world-evaluation"
        or provenance.get("realWorldEvaluationEligible") is not False
    ):
        raise DevelopmentTrainingError(
            "Synthetic bootstrap provenance is incomplete; do not train from an ambiguously labeled corpus."
        )


def _validate_mixed_dataset_report(path: Path) -> None:
    report = _read_provenance_report(path, "mixed dataset")
    if report.get("mixingVersion") != 1:
        raise DevelopmentTrainingError("Mixed dataset report has an unsupported mixingVersion.")
    provenance = report.get("mixedProvenance")
    if not isinstance(provenance, dict):
        raise DevelopmentTrainingError("Mixed dataset report has no usable mixedProvenance object.")
    if provenance.get("trainingDataKind") != "mixed-synthetic-and-real":
        raise DevelopmentTrainingError(
            "Mixed dataset report does not declare mixed-synthetic-and-real data."
        )
    operator_review = provenance.get("operatorReview")
    if (
        not isinstance(operator_review, dict)
        or not _non_empty_string(operator_review.get("realReviewId"))
        or not _non_empty_string(operator_review.get("syntheticReviewId"))
        or operator_review.get("automaticTrainingAdmission") is not False
    ):
        raise DevelopmentTrainingError(
            "Mixed dataset report requires explicit real/synthetic operator review and no automatic admission."
        )
    real = provenance.get("real")
    if not isinstance(real, dict) or not _sha256_string(real.get("compilationReportSha256")):
        raise DevelopmentTrainingError(
            "Mixed dataset report lacks a reviewed real compilation fingerprint."
        )
    _require_non_empty_counts(real.get("includedImageCounts"), "Mixed dataset reviewed real")
    synthetic = provenance.get("synthetic")
    if (
        not isinstance(synthetic, dict)
        or not _sha256_string(synthetic.get("bootstrapReportSha256"))
        or synthetic.get("usedForTrainingOnly") is not True
        or synthetic.get("realWorldEvaluationEligible") is not False
    ):
        raise DevelopmentTrainingError(
            "Mixed dataset report lacks synthetic bootstrap provenance restricted to training only."
        )
    synthetic_counts = synthetic.get("includedImageCounts")
    if not isinstance(synthetic_counts, dict) or not isinstance(synthetic_counts.get("train"), int):
        raise DevelopmentTrainingError(
            "Mixed dataset report lacks a synthetic training image count."
        )
    if (
        synthetic_counts["train"] < 1
        or synthetic_counts.get("val") != 0
        or synthetic_counts.get("test") != 0
    ):
        raise DevelopmentTrainingError(
            "Mixed dataset synthetic examples must appear in train only, never real validation/test."
        )
    evaluation = provenance.get("evaluation")
    if (
        not isinstance(evaluation, dict)
        or evaluation.get("validationContainsOnlyReviewedReal") is not True
        or evaluation.get("testContainsOnlyReviewedReal") is not True
        or evaluation.get("productionReady") is not False
    ):
        raise DevelopmentTrainingError(
            "Mixed dataset report must preserve real-only validation/test and remain non-production."
        )


def _read_provenance_report(path: Path, label: str) -> dict[str, Any]:
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DevelopmentTrainingError(f"Could not read the {label} provenance report.") from error
    if not isinstance(report, dict):
        raise DevelopmentTrainingError(f"The {label} provenance report must contain an object.")
    return report


def _non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _sha256_string(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _require_non_empty_counts(value: Any, label: str) -> None:
    if not isinstance(value, dict) or any(
        not isinstance(value.get(split), int)
        or isinstance(value.get(split), bool)
        or value[split] < 1
        for split in ("train", "val", "test")
    ):
        raise DevelopmentTrainingError(
            f"{label} data must include at least one real example in train, val, and test."
        )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def onnx_output_name(path: Path) -> str:
    try:
        import onnx
    except ImportError as error:  # pragma: no cover - depends on optional runtime installation.
        raise DevelopmentTrainingError(
            "Install the ML export extra (including onnx) before exporting a browser artifact."
        ) from error

    graph = onnx.load(str(path)).graph
    if len(graph.output) != 1:
        raise DevelopmentTrainingError(
            "The browser development contract accepts exactly one raw YOLO detection output."
        )
    output_name = graph.output[0].name
    if not output_name:
        raise DevelopmentTrainingError("The exported ONNX graph has no named detection output.")
    return output_name


def train_and_export(args: argparse.Namespace) -> dict[str, Any]:
    root = args.dataset_root.expanduser().resolve()
    output_directory = args.output_directory.expanduser().resolve()
    base_model = args.base_model.expanduser().resolve()
    if not root.is_dir() or not (root / "data.yaml").is_file():
        raise DevelopmentTrainingError(
            "dataset_root must be an extracted local export containing data.yaml."
        )
    if (
        output_directory == root
        or output_directory.is_relative_to(root)
        or root.is_relative_to(output_directory)
    ):
        raise DevelopmentTrainingError(
            "output_directory must not overlap dataset_root; this protects local source media from --overwrite."
        )
    if not base_model.is_file():
        raise DevelopmentTrainingError(
            "base_model must name a local Ultralytics-compatible checkpoint; this command does not download weights."
        )
    if base_model.is_relative_to(output_directory):
        raise DevelopmentTrainingError(
            "output_directory must not contain base_model; this protects the local checkpoint from --overwrite."
        )
    if output_directory.exists() and any(output_directory.iterdir()) and not args.overwrite:
        raise DevelopmentTrainingError(
            "output_directory is non-empty; choose a new location or pass --overwrite deliberately."
        )
    if output_directory.exists() and args.overwrite:
        shutil.rmtree(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)

    validate_dataset_provenance(root, args.training_data_kind)
    audit = audit_deepdarts_yolov8_export(root, hash_images=args.hash_images)
    validate_audit_for_development_training(audit)
    audit_path = output_directory / "dataset-audit.json"
    audit_path.write_text(json.dumps(audit, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    try:
        from ultralytics import YOLO
    except ImportError as error:  # pragma: no cover - depends on optional runtime installation.
        raise DevelopmentTrainingError(
            "Install the ML train extra (Ultralytics, Torch, and image dependencies) before training."
        ) from error

    run_directory = output_directory / "ultralytics-run"
    model = YOLO(str(base_model))
    results = model.train(
        data=str(root / "data.yaml"),
        imgsz=args.image_size,
        epochs=args.epochs,
        batch=args.batch,
        workers=args.workers,
        device=args.device,
        seed=args.seed,
        patience=args.patience,
        project=str(run_directory.parent),
        name=run_directory.name,
        exist_ok=True,
        pretrained=True,
        verbose=True,
    )
    save_directory = Path(results.save_dir)
    best_checkpoint = save_directory / "weights" / "best.pt"
    if not best_checkpoint.is_file():
        raise DevelopmentTrainingError(
            "Ultralytics did not produce weights/best.pt for this local run."
        )

    best_model = YOLO(str(best_checkpoint))
    exported_path = Path(
        best_model.export(
            format="onnx",
            imgsz=args.image_size,
            dynamic=False,
            simplify=False,
            opset=17,
            nms=False,
        )
    )
    if not exported_path.is_file():
        raise DevelopmentTrainingError("Ultralytics did not produce a local ONNX file.")
    artifact_directory = output_directory / "artifact"
    artifact_directory.mkdir(exist_ok=True)
    artifact_path = artifact_directory / Path(args.public_asset_path).name
    shutil.copy2(exported_path, artifact_path)
    model_sha256 = sha256_file(artifact_path)
    trained_at = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    manifest = build_development_manifest(
        model_version=args.model_version,
        model_sha256=model_sha256,
        output_tensor_name=onnx_output_name(artifact_path),
        public_asset_path=args.public_asset_path,
        training_data_id=args.training_data_id,
        training_data_kind=args.training_data_kind,
        license_review_id=args.license_review_id,
        trained_at=trained_at,
        image_size=args.image_size,
    )
    manifest_path = artifact_directory / "darts180-deepdarts-yolo-dev-v1.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    summary = {
        "scope": "development-only editable score suggestions; not production approval",
        "datasetAuditPath": audit_path.name,
        "datasetAuditSha256": sha256_file(audit_path),
        "baseModelSha256": sha256_file(base_model),
        "bestCheckpointPath": str(best_checkpoint),
        "onnxPath": str(artifact_path),
        "onnxSha256": model_sha256,
        "manifestPath": str(manifest_path),
        "modelVersion": args.model_version,
        "trainingDataKind": args.training_data_kind,
        "trainedAt": trained_at,
        "nextRequiredSteps": [
            *(
                [
                    "This synthetic-only artifact is not real-world validated; do not present it as a scoring-performance result.",
                    "Collect and evaluate on held-out consented real throws before relying on any result.",
                ]
                if args.training_data_kind == "synthetic-only"
                else [
                    "This mixed artifact must report metrics on its preserved real-only validation and test sessions; synthetic metrics are not physical-board proof.",
                    "Keep every first-pass score editable while additional real sessions test and improve the model.",
                ]
                if args.training_data_kind == "mixed-synthetic-and-real"
                else []
            ),
            "Run the browser contract tests and inspect ONNX Runtime initialization on target phones.",
            "Install only the reviewed ONNX plus manifest into the web public models directory.",
            "Validate the four-anchor orientation transform on held-out real throws before relying on results.",
            "Keep every development suggestion editable; do not turn this output into production auto-recording.",
        ],
    }
    summary_path = output_directory / "training-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Train and export an editable, local-only five-point development model; never deploys it."
        )
    )
    parser.add_argument(
        "dataset_root",
        type=Path,
        help="Local numeric five-point YOLO dataset containing data.yaml.",
    )
    parser.add_argument(
        "--base-model",
        required=True,
        type=Path,
        help="Local YOLOv8 checkpoint; no automatic download.",
    )
    parser.add_argument(
        "--output-directory",
        required=True,
        type=Path,
        help="New local experiment output directory.",
    )
    parser.add_argument(
        "--model-version", required=True, help="Immutable human-readable development model version."
    )
    parser.add_argument(
        "--training-data-id", required=True, help="Reviewed local data/provenance identifier."
    )
    parser.add_argument(
        "--training-data-kind",
        required=True,
        choices=sorted(_TRAINING_DATA_KINDS),
        help="Required source class; synthetic-only artifacts remain visibly unvalidated on real throws.",
    )
    parser.add_argument(
        "--license-review-id", required=True, help="Licence/IP review record identifier."
    )
    parser.add_argument(
        "--public-asset-path",
        default=_DEFAULT_PUBLIC_ASSET_PATH,
        help="Future same-origin ONNX path written into the review-only manifest.",
    )
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--device", default="", help="Ultralytics device selector, e.g. 0 or cpu.")
    parser.add_argument("--seed", type=int, default=180)
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument(
        "--hash-images",
        action="store_true",
        help="Also hash local images during audit to reveal exact cross-split duplicates before training.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Delete a non-empty output directory deliberately before beginning the local training run.",
    )
    args = parser.parse_args()

    if args.image_size < 256 or args.image_size > 2048:
        raise SystemExit("image-size must be between 256 and 2048.")
    if args.epochs < 1 or args.batch < 1 or args.workers < 0 or args.patience < 0:
        raise SystemExit(
            "epochs and batch must be positive; workers and patience cannot be negative."
        )
    try:
        summary = train_and_export(args)
    except (DatasetAuditError, DevelopmentTrainingError) as error:
        raise SystemExit(f"Development training did not start or complete: {error}") from error
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
