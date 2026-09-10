"""Compile human-reviewed local captures into the five-point YOLO training shape.

This is intentionally a local file-system tool. It takes approved JPEG/annotation pairs retrieved
by a restricted storage operator after the explicit five-point annotation profile and manual review,
preserves session boundaries while making train/validation/test splits, and writes a conventional
numeric YOLO dataset. It never reads Blob, downloads media or weights, contacts an API, or
installs/deploys a model artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from .data_contract import validate_capture_sidecar
from .deepdarts_yolo_audit import DatasetAuditError, audit_deepdarts_yolov8_export

DEVELOPMENT_ANNOTATION_METHOD = "deepdarts-four-cardinal-homography-v1"
DEVELOPMENT_ANNOTATION_PROFILE = "deepdarts-five-point-v1"
DEFAULT_POINT_BOX_WIDTH_FRACTION = 0.0304
DEFAULT_POINT_BOX_HEIGHT_FRACTION = 0.0307
_CAPTURE_ID_PATTERN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]

# The browser annotation profile uses exactly these source-compatible landmarks. The numeric labels
# match the isolated development browser manifest: 0=dart entry, 1=cal1, 2=cal2, 3=cal3, 4=cal4.
_EXPECTED_ANCHORS: dict[str, tuple[int, tuple[float, float]]] = {
    "cal1": (1, (-26.594, -167.907)),
    "cal2": (2, (26.594, 167.907)),
    "cal3": (3, (-167.907, 26.594)),
    "cal4": (4, (167.907, -26.594)),
}


class LocalFivePointDatasetError(ValueError):
    """Raised when locally captured examples cannot safely form a training data set."""


@dataclass(frozen=True)
class YoloPoint:
    class_id: int
    x_center: float
    y_center: float
    width: float
    height: float


@dataclass(frozen=True)
class LocalFivePointExample:
    capture_id: str
    session_id: str
    source_image: Path
    source_annotation: Path
    image_sha256: str
    annotation_sha256: str
    labels: tuple[YoloPoint, ...]


def compile_local_five_point_dataset(
    source_root: Path,
    output_directory: Path,
    *,
    split_seed: str,
    accepted_consent_version: str,
    point_box_width_fraction: float = DEFAULT_POINT_BOX_WIDTH_FRACTION,
    point_box_height_fraction: float = DEFAULT_POINT_BOX_HEIGHT_FRACTION,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Create a deterministic, session-disjoint numeric five-class YOLO data set.

    ``source_root`` is an approved local folder holding a JPEG beside each Data Lab
    ``*-annotations.json`` sidecar. It must not be the repository. ``output_directory`` must not
    overlap it; this protects source captures from the explicit ``--overwrite`` option.
    """

    source_root = _resolved_directory(source_root, "source_root")
    output_directory = _resolved_output_directory(output_directory)
    _reject_repository_path(source_root, "source_root")
    _reject_repository_path(output_directory, "output_directory")
    if output_directory == source_root or output_directory.is_relative_to(source_root):
        raise LocalFivePointDatasetError(
            "output_directory must sit outside source_root so --overwrite cannot touch source captures."
        )
    if source_root.is_relative_to(output_directory):
        raise LocalFivePointDatasetError("output_directory must not contain source_root.")
    if output_directory.exists() and not overwrite:
        raise LocalFivePointDatasetError(
            "output_directory already exists; choose a new directory or pass --overwrite deliberately."
        )
    if not split_seed.strip():
        raise LocalFivePointDatasetError("split_seed must be a non-empty reproducibility value.")
    if not accepted_consent_version.strip():
        raise LocalFivePointDatasetError("accepted_consent_version must be explicit.")
    _validate_point_box_fraction(point_box_width_fraction, "point_box_width_fraction")
    _validate_point_box_fraction(point_box_height_fraction, "point_box_height_fraction")

    examples = _load_examples(
        source_root,
        accepted_consent_version=accepted_consent_version,
        point_box_width_fraction=point_box_width_fraction,
        point_box_height_fraction=point_box_height_fraction,
    )
    if not any(label.class_id == 0 for example in examples for label in example.labels):
        raise LocalFivePointDatasetError(
            "At least one reviewed dart label is required across the compilation; blank-board examples supplement, not replace, dart tests."
        )
    split_by_capture = _assign_session_disjoint_splits(examples, split_seed)

    staging_directory = output_directory.parent / f".{output_directory.name}.staging-{uuid4().hex}"
    if staging_directory.exists():
        raise LocalFivePointDatasetError(
            f"Unexpected staging directory exists: {staging_directory.name}"
        )
    try:
        report = _write_compiled_dataset(
            staging_directory,
            output_directory,
            examples,
            split_by_capture,
            split_seed=split_seed,
            accepted_consent_version=accepted_consent_version,
            point_box_width_fraction=point_box_width_fraction,
            point_box_height_fraction=point_box_height_fraction,
        )
        if output_directory.exists():
            _remove_output_directory(output_directory)
        staging_directory.replace(output_directory)
        return report
    except Exception:
        shutil.rmtree(staging_directory, ignore_errors=True)
        raise


def _resolved_directory(path: Path, name: str) -> Path:
    raw_path = path.expanduser()
    if raw_path.is_symlink():
        raise LocalFivePointDatasetError(f"{name} must not be a symlink.")
    resolved = raw_path.resolve()
    if resolved == Path(resolved.anchor):
        raise LocalFivePointDatasetError(f"{name} cannot be a filesystem root.")
    if not resolved.is_dir():
        raise LocalFivePointDatasetError(f"{name} must be an existing directory.")
    return resolved


def _resolved_output_directory(path: Path) -> Path:
    raw_path = path.expanduser()
    if raw_path.is_symlink():
        raise LocalFivePointDatasetError("output_directory must not be a symlink.")
    resolved = raw_path.resolve()
    if resolved == Path(resolved.anchor):
        raise LocalFivePointDatasetError("output_directory cannot be a filesystem root.")
    return resolved


def _reject_repository_path(path: Path, name: str) -> None:
    if path.is_relative_to(_REPOSITORY_ROOT):
        raise LocalFivePointDatasetError(
            f"{name} must be outside the Darts 180 repository so raw captures and generated data cannot be committed."
        )


def _remove_output_directory(path: Path) -> None:
    if path.is_symlink():
        raise LocalFivePointDatasetError("Refusing to overwrite a symlinked output_directory.")
    if path.is_dir():
        shutil.rmtree(path)
    elif path.is_file():
        path.unlink()
    else:
        raise LocalFivePointDatasetError(
            "output_directory exists but is neither a regular file nor directory."
        )


def _load_examples(
    source_root: Path,
    *,
    accepted_consent_version: str,
    point_box_width_fraction: float,
    point_box_height_fraction: float,
) -> list[LocalFivePointExample]:
    sidecars = [
        path
        for path in sorted(source_root.rglob("*-annotations.json"))
        if path.is_file() and not path.is_symlink()
    ]
    if not sidecars:
        raise LocalFivePointDatasetError(
            "No Data Lab *-annotations.json sidecars were found under source_root."
        )

    examples: list[LocalFivePointExample] = []
    capture_ids: set[str] = set()
    image_hashes: dict[str, Path] = {}
    for sidecar in sidecars:
        example = _load_example(
            source_root,
            sidecar,
            accepted_consent_version=accepted_consent_version,
            point_box_width_fraction=point_box_width_fraction,
            point_box_height_fraction=point_box_height_fraction,
        )
        if example.capture_id in capture_ids:
            raise LocalFivePointDatasetError(
                f"Duplicate captureId {example.capture_id!r}; resolve duplicate sidecars before compiling."
            )
        capture_ids.add(example.capture_id)
        previous_image = image_hashes.get(example.image_sha256)
        if previous_image is not None:
            raise LocalFivePointDatasetError(
                "Exact duplicate JPEG bytes were found in two annotations "
                f"({previous_image.name!r} and {example.source_image.name!r}); do not train/test on copies."
            )
        image_hashes[example.image_sha256] = example.source_image
        examples.append(example)
    return examples


def _load_example(
    source_root: Path,
    sidecar_path: Path,
    *,
    accepted_consent_version: str,
    point_box_width_fraction: float,
    point_box_height_fraction: float,
) -> LocalFivePointExample:
    try:
        value = json.loads(sidecar_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalFivePointDatasetError(
            f"Could not read local annotation JSON {sidecar_path.name!r}: {error}"
        ) from error
    if not isinstance(value, Mapping):
        raise LocalFivePointDatasetError(f"{sidecar_path.name!r} must contain a JSON object.")

    issues = validate_capture_sidecar(value)
    if issues:
        rendered = "; ".join(f"{issue.path}: {issue.message}" for issue in issues[:3])
        raise LocalFivePointDatasetError(
            f"{sidecar_path.name!r} has invalid capture/label fields: {rendered}"
        )

    capture = _required_mapping(value.get("capture"), sidecar_path, "capture")
    board = _required_mapping(value.get("board"), sidecar_path, "board")
    image = _required_mapping(value.get("image"), sidecar_path, "image")
    if board.get("annotationMethod") != DEVELOPMENT_ANNOTATION_METHOD:
        raise LocalFivePointDatasetError(
            f"{sidecar_path.name!r} was not made with the required Five-point development model labels. "
            "Relabel it with the Data Lab five-point workflow before exporting."
        )
    if board.get("annotationProfile") != DEVELOPMENT_ANNOTATION_PROFILE:
        raise LocalFivePointDatasetError(
            f"{sidecar_path.name!r} has the wrong five-point annotation profile marker."
        )
    if capture.get("captureMode") != "still":
        raise LocalFivePointDatasetError(
            f"{sidecar_path.name!r} must describe one board still image."
        )
    if capture.get("consentVersion") != accepted_consent_version:
        raise LocalFivePointDatasetError(
            f"{sidecar_path.name!r} consentVersion does not equal the explicitly accepted local value."
        )

    capture_id = _required_pseudonymous_id(capture.get("captureId"), sidecar_path, "captureId")
    session_id = _required_pseudonymous_id(capture.get("sessionId"), sidecar_path, "sessionId")
    image_name = _required_string(image.get("file"), sidecar_path, "image.file")
    capture_image_name = _required_string(
        capture.get("imageFile"), sidecar_path, "capture.imageFile"
    )
    if image_name != capture_image_name:
        raise LocalFivePointDatasetError(
            f"{sidecar_path.name!r} image.file does not match capture.imageFile."
        )
    if (
        "/" in image_name
        or "\\" in image_name
        or not image_name.lower().endswith((".jpg", ".jpeg"))
    ):
        raise LocalFivePointDatasetError(
            f"{sidecar_path.name!r} has an unsafe/non-JPEG image filename."
        )
    image_path = sidecar_path.parent / image_name
    if image_path.is_symlink() or not image_path.is_file():
        raise LocalFivePointDatasetError(
            f"{sidecar_path.name!r} needs its matching regular JPEG in the same directory."
        )
    if not image_path.resolve().is_relative_to(source_root):
        raise LocalFivePointDatasetError(f"{sidecar_path.name!r} image escapes source_root.")

    width = _required_positive_integer(image.get("width"), sidecar_path, "image.width")
    height = _required_positive_integer(image.get("height"), sidecar_path, "image.height")
    actual_width, actual_height = _jpeg_dimensions(image_path)
    if (actual_width, actual_height) != (width, height):
        raise LocalFivePointDatasetError(
            f"{sidecar_path.name!r} image dimensions do not match the original annotation frame."
        )

    dart_labels = _dart_labels(
        value.get("darts"),
        sidecar_path,
        width=width,
        height=height,
        box_width=point_box_width_fraction,
        box_height=point_box_height_fraction,
        allow_empty=capture.get("captureIntent") == "empty-board",
    )
    labels = [
        *_anchor_labels(
            board.get("anchors"),
            sidecar_path,
            width=width,
            height=height,
            box_width=point_box_width_fraction,
            box_height=point_box_height_fraction,
        ),
        *dart_labels,
    ]
    return LocalFivePointExample(
        capture_id=capture_id,
        session_id=session_id,
        source_image=image_path,
        source_annotation=sidecar_path,
        image_sha256=_sha256(image_path),
        annotation_sha256=_sha256(sidecar_path),
        labels=tuple(labels),
    )


def _required_mapping(value: Any, path: Path, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise LocalFivePointDatasetError(f"{path.name!r} requires object field {field!r}.")
    return value


def _required_string(value: Any, path: Path, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise LocalFivePointDatasetError(f"{path.name!r} requires non-empty string {field!r}.")
    return value.strip()


def _required_pseudonymous_id(value: Any, path: Path, field: str) -> str:
    item = _required_string(value, path, field)
    if not 8 <= len(item) <= 128 or any(character not in _CAPTURE_ID_PATTERN for character in item):
        raise LocalFivePointDatasetError(
            f"{path.name!r} requires a pseudonymous 8–128 character {field!r}."
        )
    return item


def _required_positive_integer(value: Any, path: Path, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise LocalFivePointDatasetError(f"{path.name!r} requires positive integer {field!r}.")
    return value


def _anchor_labels(
    value: Any,
    path: Path,
    *,
    width: int,
    height: int,
    box_width: float,
    box_height: float,
) -> list[YoloPoint]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise LocalFivePointDatasetError(f"{path.name!r} requires board.anchors as an array.")
    anchors: dict[str, Mapping[str, Any]] = {}
    for item in value:
        if not isinstance(item, Mapping):
            raise LocalFivePointDatasetError(f"{path.name!r} has a non-object board anchor.")
        identifier = item.get("id")
        if not isinstance(identifier, str) or identifier not in _EXPECTED_ANCHORS:
            raise LocalFivePointDatasetError(
                f"{path.name!r} has an unexpected five-point anchor ID."
            )
        if identifier in anchors:
            raise LocalFivePointDatasetError(f"{path.name!r} repeats anchor {identifier!r}.")
        anchors[identifier] = item
    if set(anchors) != set(_EXPECTED_ANCHORS):
        raise LocalFivePointDatasetError(
            f"{path.name!r} must contain each of cal1, cal2, cal3, and cal4 once."
        )

    labels: list[YoloPoint] = []
    for identifier, (class_id, expected_canonical) in _EXPECTED_ANCHORS.items():
        anchor = anchors[identifier]
        canonical = _numeric_pair(
            anchor.get("canonicalPointMm"), path, f"anchor {identifier} canonical"
        )
        if not _close_pair(canonical, expected_canonical, tolerance=0.02):
            raise LocalFivePointDatasetError(
                f"{path.name!r} has a changed canonical position for {identifier!r}; do not mix geometry profiles."
            )
        point = _numeric_pair(anchor.get("imagePointPx"), path, f"anchor {identifier} image point")
        labels.append(
            _yolo_point(
                class_id,
                point,
                width=width,
                height=height,
                box_width=box_width,
                box_height=box_height,
                display_name=f"anchor {identifier}",
                path=path,
            )
        )
    return labels


def _dart_labels(
    value: Any,
    path: Path,
    *,
    width: int,
    height: int,
    box_width: float,
    box_height: float,
    allow_empty: bool,
) -> list[YoloPoint]:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        raise LocalFivePointDatasetError(f"{path.name!r} requires dart labels as an array.")
    if not value:
        if allow_empty:
            # A reviewed blank-board still teaches the four semantic board anchors. It is valid only
            # when its explicit capture intent says that no dart should be present.
            return []
        raise LocalFivePointDatasetError(
            f"{path.name!r} requires at least one reviewed dart label unless it is an empty-board capture."
        )
    if len(value) > 3:
        raise LocalFivePointDatasetError(
            f"{path.name!r} has more than three dart labels for one visit."
        )

    labels: list[YoloPoint] = []
    seen_points: set[tuple[float, float]] = set()
    for index, dart in enumerate(value, start=1):
        if not isinstance(dart, Mapping):
            raise LocalFivePointDatasetError(f"{path.name!r} has a non-object dart label.")
        if dart.get("visibility") != "clear":
            raise LocalFivePointDatasetError(
                f"{path.name!r} dart {index} is not visibly clear; reserve it for adjudication, not bootstrap training."
            )
        point = _numeric_pair(dart.get("tipPixel"), path, f"dart {index} tipPixel")
        rounded = (round(point[0], 4), round(point[1], 4))
        if rounded in seen_points:
            raise LocalFivePointDatasetError(f"{path.name!r} repeats a dart tip coordinate.")
        seen_points.add(rounded)
        labels.append(
            _yolo_point(
                0,
                point,
                width=width,
                height=height,
                box_width=box_width,
                box_height=box_height,
                display_name=f"dart {index}",
                path=path,
            )
        )
    return labels


def _numeric_pair(value: Any, path: Path, field: str) -> tuple[float, float]:
    if (
        not isinstance(value, Sequence)
        or isinstance(value, (str, bytes))
        or len(value) != 2
        or any(not isinstance(item, (int, float)) or isinstance(item, bool) for item in value)
    ):
        raise LocalFivePointDatasetError(f"{path.name!r} requires finite numeric pair {field!r}.")
    first = float(value[0])
    second = float(value[1])
    if not math.isfinite(first) or not math.isfinite(second):
        raise LocalFivePointDatasetError(f"{path.name!r} requires finite numeric pair {field!r}.")
    return first, second


def _close_pair(left: tuple[float, float], right: tuple[float, float], *, tolerance: float) -> bool:
    return abs(left[0] - right[0]) <= tolerance and abs(left[1] - right[1]) <= tolerance


def _yolo_point(
    class_id: int,
    point: tuple[float, float],
    *,
    width: int,
    height: int,
    box_width: float,
    box_height: float,
    display_name: str,
    path: Path,
) -> YoloPoint:
    x_center = point[0] / width
    y_center = point[1] / height
    if (
        x_center < box_width / 2
        or x_center > 1 - box_width / 2
        or y_center < box_height / 2
        or y_center > 1 - box_height / 2
    ):
        raise LocalFivePointDatasetError(
            f"{path.name!r} {display_name} cannot fit its point box within the image frame."
        )
    return YoloPoint(class_id, x_center, y_center, box_width, box_height)


def _assign_session_disjoint_splits(
    examples: Sequence[LocalFivePointExample], split_seed: str
) -> dict[str, str]:
    by_session: dict[str, list[LocalFivePointExample]] = defaultdict(list)
    for example in examples:
        by_session[example.session_id].append(example)
    if len(by_session) < 3:
        raise LocalFivePointDatasetError(
            "At least three separate setup/session IDs are required so train, validation, and test do not share a view."
        )

    ordered_sessions = sorted(
        by_session,
        key=lambda session_id: hashlib.sha256(f"{split_seed}:{session_id}".encode()).hexdigest(),
    )
    target_share = {"train": 0.8, "val": 0.1, "test": 0.1}
    current_count = {split: 0 for split in target_share}
    session_split: dict[str, str] = {}
    # Establish a non-empty split for each session group before balancing remaining examples by count.
    for index, session_id in enumerate(ordered_sessions):
        if index < 3:
            split = ("train", "val", "test")[index]
        else:
            split = min(
                target_share,
                key=lambda candidate: (
                    current_count[candidate] / target_share[candidate],
                    candidate,
                ),
            )
        session_split[session_id] = split
        current_count[split] += len(by_session[session_id])
    return {example.capture_id: session_split[example.session_id] for example in examples}


def _write_compiled_dataset(
    output_directory: Path,
    final_output_directory: Path,
    examples: Sequence[LocalFivePointExample],
    split_by_capture: Mapping[str, str],
    *,
    split_seed: str,
    accepted_consent_version: str,
    point_box_width_fraction: float,
    point_box_height_fraction: float,
) -> dict[str, Any]:
    for split in ("train", "val", "test"):
        (output_directory / split / "images").mkdir(parents=True, exist_ok=True)
        (output_directory / split / "labels").mkdir(parents=True, exist_ok=True)

    record_rows: list[dict[str, Any]] = []
    counts = {"train": 0, "val": 0, "test": 0}
    label_counts = {"dartEntryPoint": 0, "cal1": 0, "cal2": 0, "cal3": 0, "cal4": 0}
    class_names = {0: "dartEntryPoint", 1: "cal1", 2: "cal2", 3: "cal3", 4: "cal4"}
    sessions_by_split: dict[str, set[str]] = {"train": set(), "val": set(), "test": set()}
    for example in sorted(examples, key=lambda item: item.capture_id):
        split = split_by_capture.get(example.capture_id)
        if split not in counts:
            raise LocalFivePointDatasetError("Internal split assignment was incomplete.")
        stem = f"{example.capture_id}-{example.image_sha256[:12]}"
        image_destination = output_directory / split / "images" / f"{stem}.jpg"
        label_destination = output_directory / split / "labels" / f"{stem}.txt"
        shutil.copy2(example.source_image, image_destination)
        label_destination.write_text(
            "\n".join(
                f"{label.class_id} {label.x_center:.8f} {label.y_center:.8f} {label.width:.8f} {label.height:.8f}"
                for label in example.labels
            )
            + "\n",
            encoding="utf-8",
        )
        counts[split] += 1
        for label in example.labels:
            label_counts[class_names[label.class_id]] += 1
        sessions_by_split[split].add(example.session_id)
        record_rows.append(
            {
                "captureId": example.capture_id,
                "sessionId": example.session_id,
                "split": split,
                "compiledImage": image_destination.relative_to(output_directory).as_posix(),
                "compiledLabel": label_destination.relative_to(output_directory).as_posix(),
                "sourceImageSha256": example.image_sha256,
                "sourceAnnotationSha256": example.annotation_sha256,
            }
        )

    _write_data_yaml(output_directory, final_output_directory)
    (output_directory / "README.dataset.txt").write_text(
        "Darts 180 locally compiled five-point development data.\n"
        "Class IDs are fixed: 0=dart entry, 1=cal1, 2=cal2, 3=cal3, 4=cal4.\n"
        "Source sessions are assigned whole to train/val/test; do not merge data back across splits.\n"
        "This compilation is not a release approval or production artifact.\n",
        encoding="utf-8",
    )

    try:
        audit = audit_deepdarts_yolov8_export(output_directory, hash_images=True)
    except DatasetAuditError as error:
        raise LocalFivePointDatasetError(
            f"The compiled YOLO data failed its structural audit: {error}"
        ) from error
    integrity = audit.get("labelIntegrity")
    if not isinstance(integrity, Mapping) or integrity.get("count") != 0:
        raise LocalFivePointDatasetError(
            "The compiled YOLO data has label-integrity issues; no output was kept."
        )
    duplicate_report = _required_mapping(
        audit.get("crossSplit"), output_directory, "audit.crossSplit"
    )
    exact_duplicates = _required_mapping(
        duplicate_report.get("exactImageBytes"),
        output_directory,
        "audit.crossSplit.exactImageBytes",
    )
    if exact_duplicates.get("crossSplitDuplicateGroups"):
        raise LocalFivePointDatasetError(
            "The compiled YOLO data has exact duplicate images across splits."
        )

    report: dict[str, Any] = {
        "compilationVersion": 1,
        "scope": "local human-reviewed five-point development data; no network, training, model install, or deployment",
        "annotationMethod": DEVELOPMENT_ANNOTATION_METHOD,
        "annotationProfile": DEVELOPMENT_ANNOTATION_PROFILE,
        "classMap": {
            "dartEntryPoint": 0,
            "calibration1": 1,
            "calibration2": 2,
            "calibration3": 3,
            "calibration4": 4,
        },
        "acceptedConsentVersion": accepted_consent_version,
        "splitSeedSha256": hashlib.sha256(split_seed.encode()).hexdigest(),
        "pointBoxFractions": {
            "width": point_box_width_fraction,
            "height": point_box_height_fraction,
        },
        "splitImageCounts": counts,
        "labelCounts": label_counts,
        "splitSessionCounts": {
            split: len(sessions) for split, sessions in sessions_by_split.items()
        },
        "records": record_rows,
        "structuralAudit": audit,
    }
    (output_directory / "darts180-local-fivepoint-compilation.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return report


def _write_data_yaml(output_directory: Path, final_output_directory: Path) -> None:
    # Ultralytics resolves this path before loading the relative split directories. Declare the
    # final (not temporary staging) directory explicitly so the file remains valid after atomic move.
    root_literal = json.dumps(str(final_output_directory))
    (output_directory / "data.yaml").write_text(
        f"path: {root_literal}\n"
        "train: train/images\n"
        "val: val/images\n"
        "test: test/images\n"
        "nc: 5\n"
        "names: ['0', '1', '2', '3', '4']\n",
        encoding="utf-8",
    )


def _jpeg_dimensions(path: Path) -> tuple[int, int]:
    """Read JPEG dimensions without importing a heavyweight image library."""

    sof_markers = {
        0xC0,
        0xC1,
        0xC2,
        0xC3,
        0xC5,
        0xC6,
        0xC7,
        0xC9,
        0xCA,
        0xCB,
        0xCD,
        0xCE,
        0xCF,
    }
    try:
        with path.open("rb") as stream:
            if stream.read(2) != b"\xff\xd8":
                raise LocalFivePointDatasetError(f"{path.name!r} is not a JPEG file.")
            while True:
                prefix = stream.read(1)
                if not prefix:
                    break
                if prefix != b"\xff":
                    continue
                marker = stream.read(1)
                while marker == b"\xff":
                    marker = stream.read(1)
                if not marker or marker == b"\x00":
                    continue
                marker_code = marker[0]
                if marker_code in {0xD8, 0xD9} or 0xD0 <= marker_code <= 0xD7:
                    continue
                length_bytes = stream.read(2)
                if len(length_bytes) != 2:
                    break
                length = int.from_bytes(length_bytes, "big")
                if length < 2:
                    break
                payload = stream.read(length - 2)
                if len(payload) != length - 2:
                    break
                if marker_code in sof_markers:
                    if len(payload) < 5:
                        break
                    height = int.from_bytes(payload[1:3], "big")
                    width = int.from_bytes(payload[3:5], "big")
                    if width > 0 and height > 0:
                        return width, height
    except OSError as error:
        raise LocalFivePointDatasetError(f"Could not read JPEG {path.name!r}: {error}") from error
    raise LocalFivePointDatasetError(f"Could not determine JPEG dimensions for {path.name!r}.")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_point_box_fraction(value: float, name: str) -> None:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0.002 <= value <= 0.2:
        raise LocalFivePointDatasetError(f"{name} must be a number between 0.002 and 0.2.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compile reviewed local Data Lab pairs into a session-disjoint five-point YOLO data set."
    )
    parser.add_argument(
        "source_root",
        type=Path,
        help="Approved local folder containing JPEGs + five-point sidecars.",
    )
    parser.add_argument(
        "--output-directory", required=True, type=Path, help="New local YOLO output directory."
    )
    parser.add_argument(
        "--split-seed",
        required=True,
        help="Non-secret deterministic split seed recorded only as SHA-256.",
    )
    parser.add_argument(
        "--accepted-consent-version",
        required=True,
        help="Exact reviewed consentVersion allowed into this local compilation.",
    )
    parser.add_argument(
        "--point-box-width-fraction",
        type=float,
        default=DEFAULT_POINT_BOX_WIDTH_FRACTION,
        help="Normalized width used for point labels (default matches the reviewed 640-style format).",
    )
    parser.add_argument(
        "--point-box-height-fraction",
        type=float,
        default=DEFAULT_POINT_BOX_HEIGHT_FRACTION,
        help="Normalized height used for point labels (default matches the reviewed 640-style format).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace only an existing non-overlapping local output directory after all checks pass.",
    )
    args = parser.parse_args()
    try:
        report = compile_local_five_point_dataset(
            args.source_root,
            args.output_directory,
            split_seed=args.split_seed,
            accepted_consent_version=args.accepted_consent_version,
            point_box_width_fraction=args.point_box_width_fraction,
            point_box_height_fraction=args.point_box_height_fraction,
            overwrite=args.overwrite,
        )
    except LocalFivePointDatasetError as error:
        raise SystemExit(f"Local five-point dataset compilation failed: {error}") from error
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
