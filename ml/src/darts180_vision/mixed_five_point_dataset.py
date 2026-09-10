"""Build a reviewed-real plus procedural-synthetic five-point development dataset.

This is deliberately an offline operator tool. It never reads Vercel Blob, requests browser data,
downloads weights, trains a model, or deploys an artifact. The operator must first perform privacy,
provenance, and label review on private Data Lab records and explicitly compile them locally.

The output keeps real validation and test sessions completely free of synthetic examples. Synthetic
scenes supplement only the training split; this allows a mixed development model to receive broad
simulated practice without treating generated imagery as evidence that it works on a physical board.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from .deepdarts_yolo_audit import DatasetAuditError, audit_deepdarts_yolov8_export

_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_CLASS_NAMES = ["0", "1", "2", "3", "4"]
_REAL_COMPILATION_REPORT = "darts180-local-fivepoint-compilation.json"
_SYNTHETIC_BOOTSTRAP_REPORT = "darts180-synthetic-fivepoint-bootstrap.json"
_MIXED_DATASET_REPORT = "darts180-mixed-fivepoint-dataset.json"
_IMAGE_SUFFIXES = frozenset({".jpg", ".jpeg"})
_SAFE_REVIEW_ID_CHARACTERS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
)


class MixedFivePointDatasetError(ValueError):
    """Raised when reviewed real and synthetic examples cannot safely be mixed."""


@dataclass(frozen=True)
class SourceExample:
    source_kind: str
    source_split: str
    image_path: Path
    label_path: Path
    image_sha256: str
    label_sha256: str


def build_mixed_five_point_dataset(
    real_dataset_root: Path,
    synthetic_dataset_root: Path,
    output_directory: Path,
    *,
    mix_id: str,
    real_review_id: str,
    synthetic_review_id: str,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Mix reviewed real training examples with procedural synthetic training examples.

    ``real_dataset_root`` must be the external output of ``local_five_point_dataset`` after an
    operator's review. ``synthetic_dataset_root`` must be the external output of
    ``synthetic_five_point_dataset``. The returned directory is also external-only.

    The output split policy is intentionally fixed:

    * ``train``: real train + synthetic train
    * ``val``: real val only
    * ``test``: real test only

    This does not make an experiment production-ready. It establishes an honest mixed-data input
    for a development-only, editable camera-score model.
    """

    real_root = _resolve_existing_external_directory(real_dataset_root, "real_dataset_root")
    synthetic_root = _resolve_existing_external_directory(
        synthetic_dataset_root, "synthetic_dataset_root"
    )
    final_output = _resolve_external_output_directory(output_directory)
    _validate_distinct_directories(real_root, synthetic_root, final_output)
    _validate_identifier(mix_id, "mix_id")
    _validate_identifier(real_review_id, "real_review_id")
    _validate_identifier(synthetic_review_id, "synthetic_review_id")
    if final_output.exists() and not overwrite:
        raise MixedFivePointDatasetError(
            "output_directory already exists; choose a new directory or pass --overwrite deliberately."
        )

    real_provenance = _read_real_provenance(real_root)
    synthetic_provenance = _read_synthetic_provenance(synthetic_root)
    real_audit = _audit_source(real_root, "reviewed real")
    synthetic_audit = _audit_source(synthetic_root, "synthetic")
    _validate_real_source_audit(real_audit)
    _validate_synthetic_source_audit(synthetic_audit)

    examples = [
        *_collect_split_examples(real_root, "train", "real"),
        *_collect_split_examples(real_root, "val", "real"),
        *_collect_split_examples(real_root, "test", "real"),
        *_collect_split_examples(synthetic_root, "train", "synthetic"),
    ]
    _assert_unique_image_bytes(examples)
    _assert_expected_example_counts(examples, real_audit, synthetic_audit)

    staging = final_output.parent / f".{final_output.name}.staging-{uuid4().hex}"
    if staging.exists():
        raise MixedFivePointDatasetError(f"Unexpected staging directory exists: {staging.name}")
    try:
        report = _write_mixed_dataset(
            staging,
            final_output,
            examples,
            mix_id=mix_id,
            real_review_id=real_review_id,
            synthetic_review_id=synthetic_review_id,
            real_provenance=real_provenance,
            synthetic_provenance=synthetic_provenance,
        )
        if final_output.exists():
            _remove_output_directory(final_output)
        staging.replace(final_output)
        return report
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def _resolve_existing_external_directory(path: Path, name: str) -> Path:
    raw_path = path.expanduser()
    if raw_path.is_symlink():
        raise MixedFivePointDatasetError(f"{name} must not be a symlink.")
    resolved = raw_path.resolve()
    if resolved == Path(resolved.anchor) or not resolved.is_dir():
        raise MixedFivePointDatasetError(f"{name} must be an existing non-root directory.")
    _reject_repository_path(resolved, name)
    _reject_nested_symlinks(resolved, name)
    return resolved


def _resolve_external_output_directory(path: Path) -> Path:
    raw_path = path.expanduser()
    if raw_path.is_symlink():
        raise MixedFivePointDatasetError("output_directory must not be a symlink.")
    resolved = raw_path.resolve()
    if resolved == Path(resolved.anchor):
        raise MixedFivePointDatasetError("output_directory cannot be a filesystem root.")
    _reject_repository_path(resolved, "output_directory")
    return resolved


def _reject_repository_path(path: Path, name: str) -> None:
    if path.is_relative_to(_REPOSITORY_ROOT):
        raise MixedFivePointDatasetError(
            f"{name} must be outside the Darts 180 repository so private/generated data cannot be committed."
        )


def _reject_nested_symlinks(root: Path, name: str) -> None:
    for path in root.rglob("*"):
        if path.is_symlink():
            raise MixedFivePointDatasetError(f"{name} contains a symlink: {path.relative_to(root)}")


def _validate_distinct_directories(real_root: Path, synthetic_root: Path, output: Path) -> None:
    pairs = (
        ("real_dataset_root", real_root, "synthetic_dataset_root", synthetic_root),
        ("real_dataset_root", real_root, "output_directory", output),
        ("synthetic_dataset_root", synthetic_root, "output_directory", output),
    )
    for left_name, left, right_name, right in pairs:
        if left == right or left.is_relative_to(right) or right.is_relative_to(left):
            raise MixedFivePointDatasetError(
                f"{left_name} and {right_name} must be separate non-overlapping directories."
            )


def _validate_identifier(value: str, name: str) -> None:
    if not 3 <= len(value) <= 128 or any(
        character not in _SAFE_REVIEW_ID_CHARACTERS for character in value
    ):
        raise MixedFivePointDatasetError(
            f"{name} must be a 3–128 character non-secret identifier using letters, digits, dot, dash, or underscore."
        )


def _read_real_provenance(root: Path) -> dict[str, Any]:
    report_path = root / _REAL_COMPILATION_REPORT
    report = _read_json_object(report_path, "reviewed real compilation report")
    if report.get("compilationVersion") != 1:
        raise MixedFivePointDatasetError(
            "The real dataset has an unsupported compilation report version."
        )
    if report.get("annotationProfile") != "deepdarts-five-point-v1":
        raise MixedFivePointDatasetError(
            "The real dataset does not use the required five-point annotation profile."
        )
    if (
        not isinstance(report.get("acceptedConsentVersion"), str)
        or not report["acceptedConsentVersion"].strip()
    ):
        raise MixedFivePointDatasetError(
            "The real compilation report lacks its reviewed consent version."
        )
    _validate_report_split_counts(report, "reviewed real compilation report")
    return {
        "reportSha256": _sha256(report_path),
        "acceptedConsentVersion": report["acceptedConsentVersion"],
        "splitImageCounts": report["splitImageCounts"],
        "labelCounts": report.get("labelCounts"),
    }


def _read_synthetic_provenance(root: Path) -> dict[str, Any]:
    report_path = root / _SYNTHETIC_BOOTSTRAP_REPORT
    report = _read_json_object(report_path, "synthetic bootstrap report")
    synthetic = report.get("syntheticProvenance")
    if not isinstance(synthetic, Mapping):
        raise MixedFivePointDatasetError(
            "The synthetic bootstrap report lacks synthetic provenance."
        )
    if (
        synthetic.get("consentVersion") != "SYNTHETIC-NO-USER-DATA"
        or synthetic.get("admissionStatus") != "synthetic-not-real-world-evaluation"
        or synthetic.get("containsHumanCapture") is not False
        or synthetic.get("realWorldEvaluationEligible") is not False
    ):
        raise MixedFivePointDatasetError(
            "The synthetic bootstrap provenance is incomplete; do not mix ambiguously labelled data."
        )
    _validate_report_split_counts(report, "synthetic bootstrap report")
    return {
        "reportSha256": _sha256(report_path),
        "profile": synthetic.get("profile"),
        "splitImageCounts": report["splitImageCounts"],
        "labelCounts": report.get("labelCounts"),
    }


def _read_json_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise MixedFivePointDatasetError(f"{label} is missing.")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MixedFivePointDatasetError(f"Could not read {label}.") from error
    if not isinstance(value, dict):
        raise MixedFivePointDatasetError(f"{label} must contain a JSON object.")
    return value


def _validate_report_split_counts(report: Mapping[str, Any], label: str) -> None:
    counts = report.get("splitImageCounts")
    if not isinstance(counts, Mapping) or any(
        not isinstance(counts.get(split), int)
        or isinstance(counts.get(split), bool)
        or counts[split] < 1
        for split in ("train", "val", "test")
    ):
        raise MixedFivePointDatasetError(
            f"{label} needs non-empty train, val, and test image counts."
        )


def _audit_source(root: Path, source_name: str) -> dict[str, Any]:
    try:
        return audit_deepdarts_yolov8_export(root, hash_images=True)
    except DatasetAuditError as error:
        raise MixedFivePointDatasetError(
            f"Could not audit the {source_name} YOLO dataset: {error}"
        ) from error


def _validate_real_source_audit(audit: Mapping[str, Any]) -> None:
    _validate_clean_five_point_audit(
        audit, "reviewed real", required_splits=("train", "val", "test")
    )
    splits = _required_mapping(audit.get("splits"), "reviewed real audit splits")
    for split in ("train", "val", "test"):
        split_report = _required_mapping(splits.get(split), f"reviewed real {split} audit")
        if split_report.get("framesWithDartAndAllFourCalibrationAnchors", 0) < 1:
            raise MixedFivePointDatasetError(
                f"The reviewed real {split} split needs at least one dart plus all four anchors."
            )


def _validate_synthetic_source_audit(audit: Mapping[str, Any]) -> None:
    _validate_clean_five_point_audit(audit, "synthetic", required_splits=("train",))
    splits = _required_mapping(audit.get("splits"), "synthetic audit splits")
    train = _required_mapping(splits.get("train"), "synthetic train audit")
    if train.get("framesWithDartAndAllFourCalibrationAnchors", 0) < 1:
        raise MixedFivePointDatasetError(
            "The synthetic training split needs at least one dart plus all four anchors."
        )


def _validate_clean_five_point_audit(
    audit: Mapping[str, Any],
    source_name: str,
    *,
    required_splits: Sequence[str],
) -> None:
    metadata = _required_mapping(audit.get("metadata"), f"{source_name} audit metadata")
    data_yaml = _required_mapping(metadata.get("dataYaml"), f"{source_name} data.yaml metadata")
    if data_yaml.get("names") != _CLASS_NAMES:
        raise MixedFivePointDatasetError(
            f"The {source_name} dataset must use the fixed numeric five-point class order 0 through 4."
        )
    candidate = _required_mapping(
        audit.get("deepDartsCandidate"), f"{source_name} candidate metadata"
    )
    if candidate.get("numericExportShapeMatchesExpected") is not True:
        raise MixedFivePointDatasetError(
            f"The {source_name} dataset does not match the required numeric five-point export shape."
        )
    integrity = _required_mapping(audit.get("labelIntegrity"), f"{source_name} label integrity")
    if integrity.get("count") != 0:
        raise MixedFivePointDatasetError(f"The {source_name} dataset has label-integrity issues.")
    duplicate_bytes = _required_mapping(
        _required_mapping(audit.get("crossSplit"), f"{source_name} cross-split report").get(
            "exactImageBytes"
        ),
        f"{source_name} image duplicate report",
    )
    if duplicate_bytes.get("performed") is not True or duplicate_bytes.get(
        "crossSplitDuplicateGroups"
    ):
        raise MixedFivePointDatasetError(
            f"The {source_name} dataset has unscanned or duplicate images across source splits."
        )
    splits = _required_mapping(audit.get("splits"), f"{source_name} audit splits")
    for split in required_splits:
        split_report = _required_mapping(splits.get(split), f"{source_name} {split} audit")
        if (
            split_report.get("pairedImageLabelCount", 0) < 1
            or split_report.get("imagesWithoutLabels", 0) != 0
            or split_report.get("labelsWithoutImages", 0) != 0
        ):
            raise MixedFivePointDatasetError(
                f"The {source_name} {split} split needs complete paired JPEG and label files."
            )


def _required_mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise MixedFivePointDatasetError(f"{name} must be an object.")
    return value


def _collect_split_examples(root: Path, split: str, source_kind: str) -> list[SourceExample]:
    image_directory = root / split / "images"
    label_directory = root / split / "labels"
    if not image_directory.is_dir() or not label_directory.is_dir():
        raise MixedFivePointDatasetError(
            f"{source_kind} {split} has no conventional images/labels folders."
        )
    images = _files_by_relative_stem(
        image_directory, _IMAGE_SUFFIXES, f"{source_kind} {split} images"
    )
    labels = _files_by_relative_stem(
        label_directory, frozenset({".txt"}), f"{source_kind} {split} labels"
    )
    if set(images) != set(labels):
        raise MixedFivePointDatasetError(
            f"{source_kind} {split} does not have exact image/label pairs; rerun the source audit."
        )
    return [
        SourceExample(
            source_kind=source_kind,
            source_split=split,
            image_path=images[stem],
            label_path=labels[stem],
            image_sha256=_sha256(images[stem]),
            label_sha256=_sha256(labels[stem]),
        )
        for stem in sorted(images)
    ]


def _files_by_relative_stem(
    directory: Path, suffixes: frozenset[str], display_name: str
) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise MixedFivePointDatasetError(f"{display_name} contains a symlink.")
        if not path.is_file() or path.suffix.lower() not in suffixes:
            continue
        stem = path.relative_to(directory).with_suffix("").as_posix()
        if stem in result:
            raise MixedFivePointDatasetError(
                f"{display_name} repeats the relative file stem {stem!r}."
            )
        result[stem] = path
    return result


def _assert_unique_image_bytes(examples: Sequence[SourceExample]) -> None:
    seen: dict[str, SourceExample] = {}
    for example in examples:
        duplicate = seen.get(example.image_sha256)
        if duplicate is not None:
            raise MixedFivePointDatasetError(
                "Exact duplicate JPEG bytes would cross a mixed-data boundary "
                f"({duplicate.source_kind}/{duplicate.source_split} and {example.source_kind}/{example.source_split})."
            )
        seen[example.image_sha256] = example


def _assert_expected_example_counts(
    examples: Sequence[SourceExample],
    real_audit: Mapping[str, Any],
    synthetic_audit: Mapping[str, Any],
) -> None:
    actual = {
        (kind, split): sum(
            1
            for example in examples
            if example.source_kind == kind and example.source_split == split
        )
        for kind, split in (
            ("real", "train"),
            ("real", "val"),
            ("real", "test"),
            ("synthetic", "train"),
        )
    }
    real_splits = _required_mapping(real_audit.get("splits"), "reviewed real audit splits")
    synthetic_splits = _required_mapping(synthetic_audit.get("splits"), "synthetic audit splits")
    for split in ("train", "val", "test"):
        expected = _required_mapping(real_splits.get(split), f"reviewed real {split} audit").get(
            "pairedImageLabelCount"
        )
        if actual[("real", split)] != expected:
            raise MixedFivePointDatasetError(
                f"Reviewed real {split} files changed after the audit; rerun the source compilation/review."
            )
    expected_synthetic = _required_mapping(
        synthetic_splits.get("train"), "synthetic train audit"
    ).get("pairedImageLabelCount")
    if actual[("synthetic", "train")] != expected_synthetic:
        raise MixedFivePointDatasetError(
            "Synthetic training files changed after the audit; regenerate/review the bootstrap dataset."
        )


def _write_mixed_dataset(
    staging: Path,
    final_output: Path,
    examples: Sequence[SourceExample],
    *,
    mix_id: str,
    real_review_id: str,
    synthetic_review_id: str,
    real_provenance: Mapping[str, Any],
    synthetic_provenance: Mapping[str, Any],
) -> dict[str, Any]:
    for split in ("train", "val", "test"):
        (staging / split / "images").mkdir(parents=True, exist_ok=True)
        (staging / split / "labels").mkdir(parents=True, exist_ok=True)

    split_counts = {"train": 0, "val": 0, "test": 0}
    source_counts = {
        "real": {"train": 0, "val": 0, "test": 0},
        "synthetic": {"train": 0, "val": 0, "test": 0},
    }
    record_rows: list[dict[str, str]] = []
    label_counts = {str(class_id): 0 for class_id in range(5)}
    for index, example in enumerate(
        sorted(examples, key=lambda item: (item.source_kind, item.source_split, item.image_sha256)),
        start=1,
    ):
        split = example.source_split
        if example.source_kind == "synthetic":
            split = "train"
        suffix = example.image_path.suffix.lower()
        stem = f"{example.source_kind}-{index:06d}-{example.image_sha256[:12]}"
        image_destination = staging / split / "images" / f"{stem}{suffix}"
        label_destination = staging / split / "labels" / f"{stem}.txt"
        shutil.copy2(example.image_path, image_destination)
        shutil.copy2(example.label_path, label_destination)
        split_counts[split] += 1
        source_counts[example.source_kind][split] += 1
        for class_id in _label_class_ids(label_destination):
            label_counts[str(class_id)] += 1
        record_rows.append(
            {
                "source": example.source_kind,
                "sourceSplit": example.source_split,
                "outputSplit": split,
                "imageSha256": example.image_sha256,
                "labelSha256": example.label_sha256,
                "compiledImage": image_destination.relative_to(staging).as_posix(),
                "compiledLabel": label_destination.relative_to(staging).as_posix(),
            }
        )

    _write_data_yaml(staging, final_output)
    (staging / "README.dataset.txt").write_text(
        "Darts 180 mixed five-point development dataset.\n"
        "Train contains reviewed real + procedural synthetic scenes.\n"
        "Validation and test contain reviewed real scenes only; no synthetic score claim is allowed.\n"
        "Class IDs are fixed: 0=dart entry, 1=cal1, 2=cal2, 3=cal3, 4=cal4.\n"
        "This is an external-only development dataset, never a production approval.\n",
        encoding="utf-8",
    )
    try:
        audit = audit_deepdarts_yolov8_export(staging, hash_images=True)
    except DatasetAuditError as error:
        raise MixedFivePointDatasetError(
            f"The mixed dataset failed its structural audit: {error}"
        ) from error
    _assert_output_audit(audit, split_counts)
    audit["datasetRootName"] = final_output.name

    report: dict[str, Any] = {
        "mixingVersion": 1,
        "scope": (
            "reviewed real plus procedural synthetic five-point development data; no Vercel Blob read, "
            "network, model training, model install, deployment, or production approval"
        ),
        "classMap": {
            "dartEntryPoint": 0,
            "calibration1": 1,
            "calibration2": 2,
            "calibration3": 3,
            "calibration4": 4,
        },
        "splitImageCounts": split_counts,
        "labelCountsByClassId": label_counts,
        "mixedProvenance": {
            "trainingDataKind": "mixed-synthetic-and-real",
            "mixId": mix_id,
            "operatorReview": {
                "realReviewId": real_review_id,
                "syntheticReviewId": synthetic_review_id,
                "automaticTrainingAdmission": False,
            },
            "real": {
                "compilationReportSha256": real_provenance["reportSha256"],
                "acceptedConsentVersion": real_provenance["acceptedConsentVersion"],
                "sourceSplitImageCounts": real_provenance["splitImageCounts"],
                "includedImageCounts": source_counts["real"],
            },
            "synthetic": {
                "bootstrapReportSha256": synthetic_provenance["reportSha256"],
                "profile": synthetic_provenance["profile"],
                "sourceSplitImageCounts": synthetic_provenance["splitImageCounts"],
                "includedImageCounts": source_counts["synthetic"],
                "usedForTrainingOnly": True,
                "realWorldEvaluationEligible": False,
            },
            "evaluation": {
                "validationContainsOnlyReviewedReal": source_counts["synthetic"]["val"] == 0,
                "testContainsOnlyReviewedReal": source_counts["synthetic"]["test"] == 0,
                "productionReady": False,
            },
        },
        "records": record_rows,
        "structuralAudit": audit,
        "nextRequiredSteps": [
            "Train only a local development model from this reviewed external dataset.",
            "Evaluate on the preserved real validation/test sessions; do not use synthetic metrics as physical-board proof.",
            "Install only a reviewed development ONNX package and keep every score suggestion editable.",
            "Collect more diverse real sessions before considering any production model claim.",
        ],
    }
    (staging / _MIXED_DATASET_REPORT).write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return report


def _label_class_ids(path: Path) -> list[int]:
    try:
        rows = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as error:
        raise MixedFivePointDatasetError("Could not read a copied YOLO label file.") from error
    values: list[int] = []
    for row in rows:
        if not row.strip():
            continue
        try:
            values.append(int(row.split()[0]))
        except (IndexError, ValueError) as error:
            raise MixedFivePointDatasetError(
                "A copied YOLO label file has an invalid class ID."
            ) from error
    return values


def _assert_output_audit(audit: Mapping[str, Any], expected_counts: Mapping[str, int]) -> None:
    _validate_clean_five_point_audit(audit, "mixed", required_splits=("train", "val", "test"))
    splits = _required_mapping(audit.get("splits"), "mixed audit splits")
    for split, expected in expected_counts.items():
        actual = _required_mapping(splits.get(split), f"mixed {split} audit").get(
            "pairedImageLabelCount"
        )
        if actual != expected:
            raise MixedFivePointDatasetError(
                f"Mixed {split} output count disagrees with the structural audit."
            )
    for split in ("val", "test"):
        report = _required_mapping(splits.get(split), f"mixed {split} audit")
        if report.get("framesWithDartAndAllFourCalibrationAnchors", 0) < 1:
            raise MixedFivePointDatasetError(
                f"Mixed {split} must retain at least one real dart-plus-four-anchor frame."
            )


def _write_data_yaml(staging: Path, final_output: Path) -> None:
    root_literal = json.dumps(str(final_output))
    (staging / "data.yaml").write_text(
        f"path: {root_literal}\n"
        "train: train/images\n"
        "val: val/images\n"
        "test: test/images\n"
        "nc: 5\n"
        "names: ['0', '1', '2', '3', '4']\n",
        encoding="utf-8",
    )


def _remove_output_directory(path: Path) -> None:
    if path.is_symlink():
        raise MixedFivePointDatasetError("Refusing to overwrite a symlinked output_directory.")
    if path.is_dir():
        shutil.rmtree(path)
    elif path.is_file():
        path.unlink()
    else:
        raise MixedFivePointDatasetError(
            "output_directory exists but is neither a regular file nor directory."
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise MixedFivePointDatasetError(f"Could not hash {path.name!r}.") from error
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Create an external reviewed-real + procedural-synthetic five-point development dataset."
        )
    )
    parser.add_argument(
        "--real-dataset-root",
        required=True,
        type=Path,
        help="External reviewed Darts 180 local-five-point compilation.",
    )
    parser.add_argument(
        "--synthetic-dataset-root",
        required=True,
        type=Path,
        help="External procedural synthetic-five-point bootstrap.",
    )
    parser.add_argument(
        "--output-directory",
        required=True,
        type=Path,
        help="New external mixed YOLO dataset directory.",
    )
    parser.add_argument(
        "--mix-id",
        required=True,
        help="Non-secret identifier for this reviewed mixing run.",
    )
    parser.add_argument(
        "--real-review-id",
        required=True,
        help="Non-secret record of the operator's privacy/provenance/label review.",
    )
    parser.add_argument(
        "--synthetic-review-id",
        required=True,
        help="Non-secret record of the synthetic generator/label review.",
    )
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    try:
        report = build_mixed_five_point_dataset(
            args.real_dataset_root,
            args.synthetic_dataset_root,
            args.output_directory,
            mix_id=args.mix_id,
            real_review_id=args.real_review_id,
            synthetic_review_id=args.synthetic_review_id,
            overwrite=args.overwrite,
        )
    except MixedFivePointDatasetError as error:
        raise SystemExit(f"Mixed five-point dataset build failed: {error}") from error
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
