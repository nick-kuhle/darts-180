"""Conservative before/after-frame dart-arrival baseline.

This module is deliberately simple: it assumes a fixed camera and known board circle, finds a
new elongated change region, then proposes the endpoint nearest the board center as a likely dart
tip. It is useful for validating temporal contracts and producing baseline failure data. It is not
a replacement for the production temporal tracker + learned entrypoint model.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .geometry import BoardPointMm, DartZone, decode_board_point


@dataclass(frozen=True)
class ImagePoint:
    x_px: float
    y_px: float


@dataclass(frozen=True)
class TemporalDartCandidate:
    tip: ImagePoint
    shaft_end: ImagePoint
    length_px: float
    confidence: float
    changed_pixels: int


@dataclass(frozen=True)
class ScoredTemporalCandidate:
    candidate: TemporalDartCandidate
    board_point: BoardPointMm
    zone: DartZone


def detect_new_dart_tip(
    before_bgr: np.ndarray,
    after_bgr: np.ndarray,
    *,
    board_center_px: tuple[float, float],
    board_radius_px: float,
    difference_threshold: int = 28,
) -> TemporalDartCandidate | None:
    """Propose a new dart tip from two settled, same-pose frames.

    Rejects empty/low-information differences. The caller must provide a board circle from a
    calibration/pose tracker; this function intentionally refuses to guess board location.
    """
    if before_bgr.shape != after_bgr.shape:
        raise ValueError("Before and after frames must have equal dimensions.")
    if before_bgr.ndim not in (2, 3):
        raise ValueError("Expected grayscale or BGR frames.")
    if board_radius_px <= 0:
        raise ValueError("board_radius_px must be positive.")

    before = _to_gray(before_bgr)
    after = _to_gray(after_bgr)
    difference = cv2.absdiff(after, before)
    _, binary = cv2.threshold(difference, difference_threshold, 255, cv2.THRESH_BINARY)
    # Allow a shaft just outside double ring while rejecting unrelated room movement.
    expanded_mask = _board_mask(binary.shape, board_center_px, board_radius_px * 1.22)
    binary = cv2.bitwise_and(binary, expanded_mask)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    changed_pixels = int(np.count_nonzero(binary))
    if changed_pixels < 35:
        return None

    lines = cv2.HoughLinesP(
        binary,
        rho=1,
        theta=np.pi / 180,
        threshold=18,
        minLineLength=max(18, int(board_radius_px * 0.09)),
        maxLineGap=max(8, int(board_radius_px * 0.04)),
    )
    if lines is None:
        return None

    center = np.array(board_center_px, dtype=np.float64)
    candidates: list[TemporalDartCandidate] = []
    for x1, y1, x2, y2 in lines.reshape(-1, 4):
        first = np.array([float(x1), float(y1)])
        second = np.array([float(x2), float(y2)])
        length = float(np.linalg.norm(second - first))
        if length < board_radius_px * 0.08:
            continue
        first_distance = float(np.linalg.norm(first - center))
        second_distance = float(np.linalg.norm(second - center))
        tip_px, shaft_px = (first, second) if first_distance <= second_distance else (second, first)
        # A tip must appear inside the actual board face. This rejects a hand moving near the board.
        if float(np.linalg.norm(tip_px - center)) > board_radius_px:
            continue
        inside_support = _line_support(binary, tip_px, shaft_px)
        tip_distance = float(np.linalg.norm(tip_px - center))
        radial_plausibility = (
            1.0 if float(np.linalg.norm(shaft_px - center)) > tip_distance else 0.65
        )
        confidence = min(
            0.95,
            0.35
            + min(0.35, length / (board_radius_px * 1.2))
            + 0.2 * inside_support
            + 0.1 * radial_plausibility,
        )
        candidates.append(
            TemporalDartCandidate(
                tip=ImagePoint(float(tip_px[0]), float(tip_px[1])),
                shaft_end=ImagePoint(float(shaft_px[0]), float(shaft_px[1])),
                length_px=round(length, 3),
                confidence=round(confidence, 4),
                changed_pixels=changed_pixels,
            )
        )
    if not candidates:
        return None
    return max(candidates, key=lambda candidate: candidate.confidence)


def score_candidate(
    candidate: TemporalDartCandidate,
    image_to_board_homography: np.ndarray,
) -> ScoredTemporalCandidate:
    """Map an image proposal into canonical mm and score it using deterministic geometry."""
    matrix = np.asarray(image_to_board_homography, dtype=np.float64)
    if matrix.shape != (3, 3):
        raise ValueError("image_to_board_homography must be a 3x3 matrix.")
    source = np.array([[[candidate.tip.x_px, candidate.tip.y_px]]], dtype=np.float32)
    transformed = cv2.perspectiveTransform(source, matrix.astype(np.float32))[0, 0]
    board_point = BoardPointMm(x_mm=float(transformed[0]), y_mm=float(transformed[1]))
    return ScoredTemporalCandidate(
        candidate=candidate, board_point=board_point, zone=decode_board_point(board_point)
    )


def candidate_as_json(candidate: TemporalDartCandidate | None) -> dict[str, Any] | None:
    return asdict(candidate) if candidate is not None else None


def _to_gray(image: np.ndarray) -> np.ndarray:
    return image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)


def _board_mask(shape: tuple[int, ...], center: tuple[float, float], radius: float) -> np.ndarray:
    mask = np.zeros(shape[:2], dtype=np.uint8)
    cv2.circle(mask, (round(center[0]), round(center[1])), round(radius), 255, -1)
    return mask


def _line_support(binary: np.ndarray, first: np.ndarray, second: np.ndarray) -> float:
    samples = np.linspace(first, second, 50)
    xs = np.clip(np.round(samples[:, 0]).astype(int), 0, binary.shape[1] - 1)
    ys = np.clip(np.round(samples[:, 1]).astype(int), 0, binary.shape[0] - 1)
    return float(np.mean(binary[ys, xs] > 0))


def _debug_image(
    after_bgr: np.ndarray,
    center: tuple[float, float],
    radius: float,
    candidate: TemporalDartCandidate | None,
) -> np.ndarray:
    debug = after_bgr.copy()
    cv2.circle(debug, (round(center[0]), round(center[1])), round(radius), (0, 210, 255), 2)
    if candidate is not None:
        tip = (round(candidate.tip.x_px), round(candidate.tip.y_px))
        shaft_end = (round(candidate.shaft_end.x_px), round(candidate.shaft_end.y_px))
        cv2.line(debug, tip, shaft_end, (0, 220, 0), 2)
        cv2.circle(debug, tip, 7, (0, 0, 255), -1)
        cv2.putText(
            debug,
            f"candidate {candidate.confidence:.2f}",
            (tip[0] + 10, tip[1] - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 0, 255),
            2,
            cv2.LINE_AA,
        )
    return debug


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Propose one newly arrived dart from settled before/after frames."
    )
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--center", type=float, nargs=2, required=True, metavar=("X", "Y"))
    parser.add_argument("--radius", type=float, required=True, help="Board-face radius in pixels.")
    parser.add_argument(
        "--homography-json", type=Path, help="Optional image-to-board 3x3 JSON matrix."
    )
    parser.add_argument("--debug-output", type=Path, help="Optional annotated output image path.")
    args = parser.parse_args()

    before = cv2.imread(str(args.before), cv2.IMREAD_COLOR)
    after = cv2.imread(str(args.after), cv2.IMREAD_COLOR)
    if before is None or after is None:
        raise SystemExit("Could not read both input images.")
    center = (args.center[0], args.center[1])
    candidate = detect_new_dart_tip(
        before, after, board_center_px=center, board_radius_px=args.radius
    )
    payload: dict[str, Any] = {"candidate": candidate_as_json(candidate)}
    if candidate is not None and args.homography_json is not None:
        matrix = np.asarray(
            json.loads(args.homography_json.read_text(encoding="utf-8")), dtype=np.float64
        )
        payload["scoredCandidate"] = asdict(score_candidate(candidate, matrix))
    if args.debug_output is not None:
        args.debug_output.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(
            str(args.debug_output), _debug_image(after, center, args.radius, candidate)
        ):
            raise SystemExit(f"Could not write debug image: {args.debug_output}")
    print(json.dumps(payload, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
