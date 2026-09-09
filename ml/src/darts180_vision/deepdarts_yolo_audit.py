"""Offline, non-training audit for a locally acquired DeepDarts YOLOv8 export.

This tool intentionally reads only a caller-supplied local directory and emits aggregate metadata.
It does not download a dataset, contact Roboflow, train a model, produce an ONNX artifact, or make
any release decision. It exists to make external-data intake reproducible without placing images,
labels, credentials, or model artifacts in the Darts 180 repository.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_IMAGE_SUFFIXES = frozenset({".bmp", ".jpeg", ".jpg", ".png", ".webp"})
_MAX_ISSUE_EXAMPLES = 100
_MAX_REPRESENTATIVE_PAIRS = 20
_BOUND_EPSILON = 1e-6

# The upstream DeepDarts `classes` file names these classes. The Roboflow v2 export keeps only
# numeric strings in data.yaml, so this remains a provisional mapping until a visual label/image
# sample confirms that the conversion preserved the source ordering.
_DEEPDARTS_EXPECTED_CLASS_NAMES = ("dart", "cal1", "cal2", "cal3", "cal4")
_DEEPDARTS_NUMERIC_EXPORT_NAMES = tuple(str(index) for index in range(5))


class DatasetAuditError(ValueError):
    """Raised when a local export cannot be read as a minimally valid YOLO dataset."""


@dataclass(frozen=True)
class YoloDataSpec:
    """The small subset of data.yaml needed for a structure audit."""

    class_count: int | None
    names: tuple[str, ...]
    declared_split_paths: dict[str, str]


@dataclass(frozen=True)
class ParsedLabel:
    """A syntactically and geometrically valid YOLO detection row."""

    class_id: int
    x_center: float
    y_center: float
    width: float
    height: float


class IssueRecorder:
    """Bound issue examples so a malformed large export cannot create an unbounded report."""

    def __init__(self) -> None:
        self.counts: Counter[str] = Counter()
        self.examples: list[dict[str, Any]] = []

    def add(self, kind: str, path: Path, message: str, *, line: int | None = None) -> None:
        self.counts[kind] += 1
        if len(self.examples) < _MAX_ISSUE_EXAMPLES:
            example: dict[str, Any] = {"kind": kind, "path": path.as_posix(), "message": message}
            if line is not None:
                example["line"] = line
            self.examples.append(example)

    def report(self) -> dict[str, Any]:
        return {
            "count": sum(self.counts.values()),
            "byKind": dict(sorted(self.counts.items())),
            "examples": self.examples,
            "examplesTruncated": sum(self.counts.values()) > len(self.examples),
        }


def parse_yolo_data_yaml(path: Path) -> YoloDataSpec:
    """Parse `nc`, `names`, and split paths without adding PyYAML as a runtime dependency.

    Roboflow's generated YAML commonly represents names as an inline list such as
    ``names: ['0', '1']``. The parser also accepts an indented numeric mapping, which is common in
    other YOLO exports. It is deliberately narrow: unexpected YAML should cause a transparent
    intake failure rather than a guessed class map.
    """

    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise DatasetAuditError(f"Could not read data YAML at {path}: {error}") from error

    class_count: int | None = None
    declared_split_paths: dict[str, str] = {}
    names: tuple[str, ...] | None = None

    for index, line in enumerate(lines):
        if line[:1].isspace() or not line.strip() or line.lstrip().startswith("#"):
            continue
        key_match = re.match(r"^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$", line)
        if key_match is None:
            continue
        key, raw_value = key_match.groups()
        if key == "nc":
            try:
                class_count = int(_strip_inline_comment(raw_value))
            except ValueError as error:
                raise DatasetAuditError(
                    f"{path}: nc must be an integer, found {raw_value!r}."
                ) from error
            if class_count < 1:
                raise DatasetAuditError(f"{path}: nc must be positive, found {class_count}.")
        elif key in {"train", "val", "test"}:
            value = _strip_inline_comment(raw_value).strip()
            if value:
                declared_split_paths[key] = _unquote(value)
        elif key == "names":
            names = _parse_names_value(path, lines, index, raw_value)

    if names is None:
        raise DatasetAuditError(f"{path}: no supported names declaration was found.")
    if not names:
        raise DatasetAuditError(f"{path}: names must contain at least one class.")
    if class_count is not None and class_count != len(names):
        raise DatasetAuditError(
            f"{path}: nc declares {class_count} classes but names contains {len(names)} entries."
        )
    return YoloDataSpec(
        class_count=class_count,
        names=names,
        declared_split_paths=declared_split_paths,
    )


def audit_deepdarts_yolov8_export(root: Path, *, hash_images: bool = False) -> dict[str, Any]:
    """Inspect a local DeepDarts YOLOv8 export and return an aggregate, JSON-safe report.

    ``root`` must be the extracted export directory containing ``data.yaml``. The audit looks only
    below that directory for conventional ``train``, ``valid``/``val``, and ``test`` image/label
    folders. It does not follow data.yaml paths outside the selected root.
    """

    root = root.expanduser().resolve()
    data_yaml = root / "data.yaml"
    spec = parse_yolo_data_yaml(data_yaml)
    issues = IssueRecorder()

    split_reports: dict[str, dict[str, Any]] = {}
    image_keys_by_split: dict[str, set[str]] = {}
    image_paths_by_split: dict[str, dict[str, Path]] = {}
    for split_name, split_directory in _discover_split_directories(root):
        report, image_paths = _audit_split(
            root=root,
            split_name=split_name,
            split_directory=split_directory,
            class_count=spec.class_count or len(spec.names),
            issues=issues,
        )
        split_reports[split_name] = report
        image_paths_by_split[split_name] = image_paths
        image_keys_by_split[split_name] = set(image_paths)

    cross_split_collisions = _cross_split_stem_collisions(image_keys_by_split)
    image_hash_report = (
        _cross_split_image_hashes(root, image_paths_by_split)
        if hash_images
        else {
            "performed": False,
            "reason": "Pass --hash-images to scan exact image-byte duplicates across splits.",
            "crossSplitDuplicateGroups": [],
        }
    )

    expected_numeric_names = _DEEPDARTS_NUMERIC_EXPORT_NAMES
    class_count = spec.class_count or len(spec.names)
    numeric_export_shape_matches = (
        class_count == len(expected_numeric_names) and spec.names == expected_numeric_names
    )
    required_calibration_ids = {1, 2, 3, 4}
    aggregate = _aggregate_split_counts(split_reports)

    hard_blocks = [
        "Dataset inspection alone is not training, evaluation, browser-ONNX compatibility, or a release approval.",
        "The numeric class names must be visually confirmed against an image/label pair before treating the upstream class order as preserved.",
        "A four-calibration-anchor export cannot be substituted for the current nine-landmark production contract without a separately reviewed contract/model/evaluation decision.",
        "No production deployment is permitted from this audit report.",
    ]
    if issues.counts:
        hard_blocks.insert(
            0,
            "Label-integrity issues must be resolved before this export can enter a training experiment.",
        )
    if aggregate["framesWithDartAndAllFourCalibrationAnchors"] == 0:
        hard_blocks.insert(
            0,
            "No paired frame containing class 0 plus all four calibration classes was found; verify export completeness and class semantics.",
        )

    report: dict[str, Any] = {
        "auditVersion": 1,
        "scope": "local, aggregate-only external YOLO export intake; no network, training, or release action",
        "datasetRootName": root.name,
        "metadata": {
            "dataYaml": {
                "sha256": _sha256(data_yaml),
                "classCount": class_count,
                "names": list(spec.names),
                "declaredSplitPaths": spec.declared_split_paths,
            },
            "supportingFileSha256": _supporting_file_hashes(root),
        },
        "deepDartsCandidate": {
            "profile": "deepdarts-yolov8-v2",
            "numericExportShapeMatchesExpected": numeric_export_shape_matches,
            "numericNamesOnly": all(name.isdecimal() for name in spec.names),
            "provisionalUpstreamClassOrder": [
                {"classId": index, "upstreamName": name}
                for index, name in enumerate(_DEEPDARTS_EXPECTED_CLASS_NAMES)
            ],
            "mappingStatus": (
                "requires-visual-confirmation"
                if numeric_export_shape_matches
                else "does-not-match-expected-numeric-export-shape"
            ),
            "requiredCalibrationClassIds": sorted(required_calibration_ids),
            "candidateTipClassId": 0,
        },
        "splits": split_reports,
        "aggregate": aggregate,
        "crossSplit": {
            "sameRelativeImageStemGroups": cross_split_collisions,
            "sameRelativeImageStemGroupCount": len(cross_split_collisions),
            "exactImageBytes": image_hash_report,
        },
        "labelIntegrity": issues.report(),
        "releaseSafety": {
            "productionReady": False,
            "hardBlocks": hard_blocks,
        },
    }
    return report


def _parse_names_value(path: Path, lines: list[str], index: int, raw_value: str) -> tuple[str, ...]:
    value = _strip_inline_comment(raw_value).strip()
    if value:
        if value.startswith("[") and value.endswith("]"):
            return _parse_inline_names(path, value)
        if value.startswith("{") and value.endswith("}"):
            return _parse_inline_mapping(path, value)
        raise DatasetAuditError(
            f"{path}: names must be an inline list or an indented numeric mapping, found {value!r}."
        )

    numeric_names: dict[int, str] = {}
    for next_line in lines[index + 1 :]:
        if not next_line.strip() or next_line.lstrip().startswith("#"):
            continue
        if not next_line[:1].isspace():
            break
        mapping_match = re.match(r"^\s*(\d+)\s*:\s*(.*?)\s*$", next_line)
        if mapping_match is None:
            continue
        class_id = int(mapping_match.group(1))
        if class_id in numeric_names:
            raise DatasetAuditError(
                f"{path}: names mapping defines class {class_id} more than once."
            )
        mapped_name = _unquote(_strip_inline_comment(mapping_match.group(2)).strip())
        if not mapped_name:
            raise DatasetAuditError(
                f"{path}: names mapping has an empty label for class {class_id}."
            )
        numeric_names[class_id] = mapped_name

    if not numeric_names:
        raise DatasetAuditError(f"{path}: names has no supported values.")
    expected_ids = list(range(len(numeric_names)))
    if sorted(numeric_names) != expected_ids:
        raise DatasetAuditError(
            f"{path}: names mapping must contain consecutive IDs {expected_ids}, found {sorted(numeric_names)}."
        )
    return tuple(numeric_names[class_id] for class_id in expected_ids)


def _parse_inline_names(path: Path, value: str) -> tuple[str, ...]:
    try:
        parsed = ast.literal_eval(value)
    except (SyntaxError, ValueError):
        # YAML permits unquoted names in a flow sequence; a carefully constrained fallback is enough
        # for class names and avoids accepting arbitrary YAML expressions.
        raw_items = value[1:-1].split(",")
        parsed = [_unquote(item.strip()) for item in raw_items if item.strip()]
    if not isinstance(parsed, (list, tuple)):
        raise DatasetAuditError(f"{path}: names must be a list, found {type(parsed).__name__}.")
    names = tuple(str(item).strip() for item in parsed)
    if any(not name for name in names):
        raise DatasetAuditError(f"{path}: names may not contain an empty class name.")
    return names


def _parse_inline_mapping(path: Path, value: str) -> tuple[str, ...]:
    body = value[1:-1].strip()
    mapping: dict[int, str] = {}
    for item in body.split(","):
        if not item.strip() or ":" not in item:
            raise DatasetAuditError(f"{path}: could not parse names mapping item {item!r}.")
        raw_key, raw_name = item.split(":", 1)
        try:
            class_id = int(_unquote(raw_key.strip()))
        except ValueError as error:
            raise DatasetAuditError(
                f"{path}: names mapping key must be numeric, found {raw_key!r}."
            ) from error
        if class_id in mapping:
            raise DatasetAuditError(
                f"{path}: names mapping defines class {class_id} more than once."
            )
        name = _unquote(raw_name.strip())
        if not name:
            raise DatasetAuditError(
                f"{path}: names mapping has an empty label for class {class_id}."
            )
        mapping[class_id] = name
    expected_ids = list(range(len(mapping)))
    if sorted(mapping) != expected_ids:
        raise DatasetAuditError(
            f"{path}: names mapping must contain consecutive IDs {expected_ids}, found {sorted(mapping)}."
        )
    return tuple(mapping[class_id] for class_id in expected_ids)


def _strip_inline_comment(value: str) -> str:
    """Strip a simple YAML comment while preserving URL fragments and quoted values.

    The Roboflow files used by this audit do not need full YAML comment semantics. Treat a hash
    preceded by whitespace as a comment marker, which avoids damaging ordinary URLs.
    """

    return re.split(r"\s+#", value, maxsplit=1)[0]


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _discover_split_directories(root: Path) -> Iterable[tuple[str, Path]]:
    for split_name in ("train", "valid", "val", "test"):
        candidate = root / split_name
        if (candidate / "images").is_dir() or (candidate / "labels").is_dir():
            yield split_name, candidate


def _audit_split(
    *,
    root: Path,
    split_name: str,
    split_directory: Path,
    class_count: int,
    issues: IssueRecorder,
) -> tuple[dict[str, Any], dict[str, Path]]:
    image_directory = split_directory / "images"
    label_directory = split_directory / "labels"
    images = _files_by_relative_stem(image_directory, _IMAGE_SUFFIXES)
    labels = _files_by_relative_stem(label_directory, frozenset({".txt"}))

    image_keys = set(images)
    label_keys = set(labels)
    labels_without_images = sorted(label_keys - image_keys)
    images_without_labels = sorted(image_keys - label_keys)

    for key in labels_without_images:
        issues.add(
            "orphan-label-file",
            labels[key].relative_to(root),
            "No same-relative-stem image was found in this split.",
        )
    for key in images_without_labels:
        issues.add(
            "image-without-label-file",
            images[key].relative_to(root),
            "No same-relative-stem YOLO .txt label was found in this split.",
        )

    annotation_counts: Counter[int] = Counter()
    image_presence_counts: Counter[int] = Counter()
    paired_label_count = 0
    complete_calibration_frames = 0
    dart_frames = 0
    complete_calibration_with_dart = 0
    representative_pairs: list[dict[str, str]] = []

    for key in sorted(image_keys & label_keys):
        paired_label_count += 1
        rows = _parse_label_file(
            label_path=labels[key],
            display_path=labels[key].relative_to(root),
            class_count=class_count,
            issues=issues,
        )
        present_classes = {row.class_id for row in rows}
        annotation_counts.update(row.class_id for row in rows)
        image_presence_counts.update(present_classes)
        has_dart = 0 in present_classes
        has_complete_calibration = {1, 2, 3, 4}.issubset(present_classes)
        dart_frames += int(has_dart)
        complete_calibration_frames += int(has_complete_calibration)
        complete_calibration_with_dart += int(has_dart and has_complete_calibration)
        if (
            present_classes == set(range(class_count))
            and len(representative_pairs) < _MAX_REPRESENTATIVE_PAIRS
        ):
            representative_pairs.append(
                {
                    "imagePath": images[key].relative_to(root).as_posix(),
                    "labelPath": labels[key].relative_to(root).as_posix(),
                }
            )

    report = {
        "imageCount": len(images),
        "labelFileCount": len(labels),
        "pairedImageLabelCount": paired_label_count,
        "imagesWithoutLabels": len(images_without_labels),
        "labelsWithoutImages": len(labels_without_images),
        "annotationCount": sum(annotation_counts.values()),
        "annotationCountByClassId": _class_count_map(annotation_counts, class_count),
        "imagePresenceCountByClassId": _class_count_map(image_presence_counts, class_count),
        "framesWithDartClass0": dart_frames,
        "framesWithAllFourCalibrationClasses": complete_calibration_frames,
        "framesWithDartAndAllFourCalibrationAnchors": complete_calibration_with_dart,
        "representativePairsWithAllDeclaredClasses": representative_pairs,
    }
    return report, images


def _files_by_relative_stem(directory: Path, suffixes: frozenset[str]) -> dict[str, Path]:
    if not directory.is_dir():
        return {}
    files: dict[str, Path] = {}
    for path in sorted(directory.rglob("*")):
        if not path.is_file() or path.is_symlink() or path.suffix.lower() not in suffixes:
            continue
        key = path.relative_to(directory).with_suffix("").as_posix()
        previous = files.get(key)
        if previous is not None:
            raise DatasetAuditError(
                f"{directory}: multiple files share the relative YOLO stem {key!r}: {previous.name!r}, {path.name!r}."
            )
        files[key] = path
    return files


def _parse_label_file(
    *,
    label_path: Path,
    display_path: Path,
    class_count: int,
    issues: IssueRecorder,
) -> list[ParsedLabel]:
    try:
        lines = label_path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError) as error:
        issues.add("unreadable-label-file", display_path, str(error))
        return []

    rows: list[ParsedLabel] = []
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        tokens = line.split()
        if len(tokens) != 5:
            issues.add(
                "malformed-label-row",
                display_path,
                f"Expected 5 whitespace-separated YOLO fields, found {len(tokens)}.",
                line=line_number,
            )
            continue
        try:
            class_id = int(tokens[0])
        except ValueError:
            issues.add(
                "invalid-class-id",
                display_path,
                f"Class ID must be an integer, found {tokens[0]!r}.",
                line=line_number,
            )
            continue
        if class_id < 0 or class_id >= class_count:
            issues.add(
                "class-id-out-of-range",
                display_path,
                f"Class ID {class_id} is outside 0..{class_count - 1}.",
                line=line_number,
            )
            continue
        try:
            x_center, y_center, width, height = (float(token) for token in tokens[1:])
        except ValueError:
            issues.add(
                "non-numeric-box-value",
                display_path,
                "YOLO coordinates must be numeric.",
                line=line_number,
            )
            continue
        values = (x_center, y_center, width, height)
        if not all(math.isfinite(value) for value in values):
            issues.add(
                "non-finite-box-value",
                display_path,
                "YOLO coordinates must be finite.",
                line=line_number,
            )
            continue
        if (
            not 0 <= x_center <= 1
            or not 0 <= y_center <= 1
            or not 0 < width <= 1
            or not 0 < height <= 1
        ):
            issues.add(
                "box-value-out-of-range",
                display_path,
                "Center values must be in [0,1] and width/height in (0,1].",
                line=line_number,
            )
            continue
        if (
            x_center - width / 2 < -_BOUND_EPSILON
            or x_center + width / 2 > 1 + _BOUND_EPSILON
            or y_center - height / 2 < -_BOUND_EPSILON
            or y_center + height / 2 > 1 + _BOUND_EPSILON
        ):
            issues.add(
                "box-extends-outside-image",
                display_path,
                "Normalized box extends outside the image bounds.",
                line=line_number,
            )
            continue
        rows.append(ParsedLabel(class_id, x_center, y_center, width, height))
    return rows


def _class_count_map(counts: Counter[int], class_count: int) -> dict[str, int]:
    return {str(class_id): counts[class_id] for class_id in range(class_count)}


def _aggregate_split_counts(split_reports: dict[str, dict[str, Any]]) -> dict[str, int]:
    count_fields = (
        "imageCount",
        "labelFileCount",
        "pairedImageLabelCount",
        "imagesWithoutLabels",
        "labelsWithoutImages",
        "annotationCount",
        "framesWithDartClass0",
        "framesWithAllFourCalibrationClasses",
        "framesWithDartAndAllFourCalibrationAnchors",
    )
    return {
        field: sum(int(split_report[field]) for split_report in split_reports.values())
        for field in count_fields
    }


def _cross_split_stem_collisions(image_keys_by_split: dict[str, set[str]]) -> list[dict[str, Any]]:
    occurrences: dict[str, list[str]] = defaultdict(list)
    for split_name, image_keys in image_keys_by_split.items():
        for key in image_keys:
            occurrences[key].append(split_name)
    return [
        {"relativeImageStem": key, "splits": sorted(split_names)}
        for key, split_names in sorted(occurrences.items())
        if len(set(split_names)) > 1
    ]


def _cross_split_image_hashes(
    root: Path, image_paths_by_split: dict[str, dict[str, Path]]
) -> dict[str, Any]:
    occurrences: dict[str, list[dict[str, str]]] = defaultdict(list)
    scanned = 0
    for split_name, image_paths in image_paths_by_split.items():
        for relative_stem, image_path in image_paths.items():
            scanned += 1
            occurrences[_sha256(image_path)].append(
                {
                    "split": split_name,
                    "relativeImagePath": image_path.relative_to(root).as_posix(),
                    "relativeImageStem": relative_stem,
                }
            )
    duplicates = [
        {
            "sha256": digest,
            "files": sorted(files, key=lambda item: (item["split"], item["relativeImagePath"])),
        }
        for digest, files in sorted(occurrences.items())
        if len({file["split"] for file in files}) > 1
    ]
    return {
        "performed": True,
        "imageFilesScanned": scanned,
        "crossSplitDuplicateGroups": duplicates,
    }


def _supporting_file_hashes(root: Path) -> dict[str, str]:
    files = ("README.dataset.txt", "README.roboflow.txt")
    return {filename: _sha256(root / filename) for filename in files if (root / filename).is_file()}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Audit a locally extracted DeepDarts YOLOv8 export without downloading, training, or publishing it."
        )
    )
    parser.add_argument("root", type=Path, help="Extracted export directory containing data.yaml.")
    parser.add_argument(
        "--hash-images",
        action="store_true",
        help="Hash every image and report exact duplicate image bytes that cross split boundaries; can be slow.",
    )
    parser.add_argument(
        "--output", type=Path, help="Optional path for the JSON report; stdout always receives it."
    )
    args = parser.parse_args()

    try:
        report = audit_deepdarts_yolov8_export(args.root, hash_images=args.hash_images)
    except DatasetAuditError as error:
        raise SystemExit(f"Dataset audit failed: {error}") from error
    rendered = json.dumps(report, indent=2, sort_keys=True)
    print(rendered)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
