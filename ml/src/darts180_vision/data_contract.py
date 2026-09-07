"""Validation for capture manifests and dart labels before data enters any training split."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from .geometry import BoardPointMm, DartZone, decode_board_point

_CAPTURE_MODES = {"still", "arrival-clip", "failure-clip", "synthetic"}
_CAPTURE_INTENTS = {"empty-board", "static-dart", "failure-case"}
_LIGHTING_BANDS = {"low", "normal", "bright", "mixed", "glare"}
_SPLITS = {"unassigned", "train", "validation", "eval"}
_CAPTURE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{8,128}$")
_IMAGE_FILE_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]+\.(jpg|jpeg)$")


@dataclass(frozen=True)
class ValidationIssue:
    path: str
    message: str


def validate_capture_manifest(value: Mapping[str, Any]) -> tuple[ValidationIssue, ...]:
    """Validate the core, privacy-relevant manifest fields without a heavy runtime dependency."""
    issues: list[ValidationIssue] = []
    required = (
        "captureId",
        "consentVersion",
        "boardModel",
        "deviceModel",
        "captureMode",
        "offAxisDegrees",
        "distanceMm",
        "lightingBand",
        "containsFaces",
        "createdAt",
    )
    for field in required:
        if field not in value:
            issues.append(ValidationIssue(field, "Required field is missing."))

    capture_id = value.get("captureId")
    if not isinstance(capture_id, str) or not _CAPTURE_ID_PATTERN.fullmatch(capture_id):
        issues.append(ValidationIssue("captureId", "Must be an 8–128 character pseudonymous ID using letters, numbers, _ or -."))
    for field in ("consentVersion", "boardModel", "deviceModel", "createdAt"):
        if field in value and not _is_non_empty_string(value.get(field)):
            issues.append(ValidationIssue(field, "Must be a non-empty string."))
    if not _is_iso_datetime(value.get("createdAt")):
        issues.append(ValidationIssue("createdAt", "Must be an ISO-8601 timestamp with timezone."))
    if value.get("captureMode") not in _CAPTURE_MODES:
        issues.append(ValidationIssue("captureMode", f"Must be one of {sorted(_CAPTURE_MODES)}."))
    if "captureIntent" in value and value["captureIntent"] not in _CAPTURE_INTENTS:
        issues.append(ValidationIssue("captureIntent", f"Must be one of {sorted(_CAPTURE_INTENTS)}."))
    if "imageFile" in value and (
        not isinstance(value["imageFile"], str) or not _IMAGE_FILE_PATTERN.fullmatch(value["imageFile"])
    ):
        issues.append(ValidationIssue("imageFile", "Must be a plain .jpg/.jpeg filename without path separators."))
    if "imageMime" in value and value["imageMime"] != "image/jpeg":
        issues.append(ValidationIssue("imageMime", "Must be image/jpeg when supplied."))
    if value.get("lightingBand") not in _LIGHTING_BANDS:
        issues.append(ValidationIssue("lightingBand", f"Must be one of {sorted(_LIGHTING_BANDS)}."))
    if "split" in value and value["split"] not in _SPLITS:
        issues.append(ValidationIssue("split", f"Must be one of {sorted(_SPLITS)}."))
    if value.get("containsFaces") is not False:
        issues.append(ValidationIssue("containsFaces", "Must be explicitly false for accepted capture."))
    _validate_number(value, "offAxisDegrees", 0, 90, issues)
    _validate_number(value, "distanceMm", 200, 5000, issues)
    return tuple(issues)


def validate_dart_label(value: Mapping[str, Any], *, tolerance_mm: float = 0.05) -> tuple[ValidationIssue, ...]:
    """Ensure label point and label zone agree with the canonical board decoder.

    This catches a common training-data failure: a human writes T20 while coordinates actually land
    in a neighbouring segment/ring. Boundary labels need adjudication instead of increasing this
    tolerance silently.
    """
    issues: list[ValidationIssue] = []
    point = value.get("entryPointBoardMm")
    zone = value.get("zone")
    if not _is_numeric_pair(point):
        return (ValidationIssue("entryPointBoardMm", "Expected [x_mm, y_mm] numeric coordinates."),)
    if not isinstance(zone, Mapping):
        return (ValidationIssue("zone", "Expected a zone object."),)
    try:
        declared = DartZone(
            ring=str(zone["ring"]),
            segment=zone.get("segment"),
            score=int(zone["score"]),
        )
    except (KeyError, TypeError, ValueError):
        return (ValidationIssue("zone", "Zone requires ring, segment, and integer score."),)
    decoded = decode_board_point(BoardPointMm(float(point[0]), float(point[1])))
    if decoded != declared:
        issues.append(
            ValidationIssue(
                "zone",
                f"Declared {declared} disagrees with canonical decode {decoded}; inspect wire-boundary label.",
            )
        )
    if "wireMarginMm" in value:
        margin = value["wireMarginMm"]
        if not isinstance(margin, (int, float)) or isinstance(margin, bool) or margin < -tolerance_mm:
            issues.append(ValidationIssue("wireMarginMm", "Must be a non-negative numeric wire margin."))
    return tuple(issues)


def validate_capture_sidecar(value: Mapping[str, Any]) -> tuple[ValidationIssue, ...]:
    """Validate either a Capture Lab manifest or a labeled/synthetic sidecar.

    Labeled sidecars place their manifest under `capture` and optional labels under `darts`.
    A local Capture Lab export is itself a manifest and therefore needs no wrapper.
    """
    capture = value.get("capture", value)
    if not isinstance(capture, Mapping):
        return (ValidationIssue("capture", "Expected a capture manifest object."),)
    issues = list(validate_capture_manifest(capture))
    darts = value.get("darts")
    if darts is None:
        return tuple(issues)
    if not isinstance(darts, Sequence) or isinstance(darts, (str, bytes)):
        issues.append(ValidationIssue("darts", "Expected an array of dart labels."))
        return tuple(issues)
    for index, dart in enumerate(darts):
        if not isinstance(dart, Mapping):
            issues.append(ValidationIssue(f"darts[{index}]", "Expected a dart label object."))
            continue
        issues.extend(
            ValidationIssue(f"darts[{index}].{issue.path}", issue.message)
            for issue in validate_dart_label(dart)
        )
    return tuple(issues)


def _validate_number(
    value: Mapping[str, Any], field: str, lower: float, upper: float, issues: list[ValidationIssue]
) -> None:
    item = value.get(field)
    if not isinstance(item, (int, float)) or isinstance(item, bool) or not lower <= item <= upper:
        issues.append(ValidationIssue(field, f"Must be a number between {lower} and {upper}."))


def _is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _is_iso_datetime(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None


def _is_numeric_pair(value: Any) -> bool:
    return (
        isinstance(value, Sequence)
        and not isinstance(value, (str, bytes))
        and len(value) == 2
        and all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value)
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a Darts 180 capture manifest or labeled sidecar.")
    parser.add_argument("path", type=Path, help="JSON manifest or labeled sidecar path.")
    args = parser.parse_args()
    try:
        value = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read valid JSON from {args.path}: {error}") from error
    if not isinstance(value, Mapping):
        raise SystemExit("Expected a top-level JSON object.")
    issues = validate_capture_sidecar(value)
    print(json.dumps({"path": str(args.path), "valid": not issues, "issues": [asdict(issue) for issue in issues]}, indent=2))
    if issues:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
