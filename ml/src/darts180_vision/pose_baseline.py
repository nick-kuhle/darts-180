"""Inspectable OpenCV baseline for board finding and camera-quality feedback.

This is intentionally *not* the production pose network. It gives the team a runnable baseline,
synthetic-test harness, and a way to collect quality diagnostics before ML models exist. Production
will replace circle/ellipse heuristics with landmark/pose inference plus robust fitting.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from math import acos, degrees
from pathlib import Path
from typing import Any

import cv2
import numpy as np


@dataclass(frozen=True)
class BoardCircle:
    """Candidate face-on board circle in image pixel coordinates."""

    center_x_px: float
    center_y_px: float
    radius_px: float
    confidence: float


@dataclass(frozen=True)
class PoseQuality:
    overall: float
    board_coverage: float
    sharpness: float
    glare_risk: float
    occlusion_risk: float
    off_axis_degrees: float
    board_diameter_pixels: int
    reasons: tuple[str, ...]


def detect_board_circle(image_bgr: np.ndarray) -> BoardCircle | None:
    """Find a likely large board circle using a deliberately conservative Hough baseline.

    The result must be treated as a *proposal*: modern boards, protectors, shadows, and oblique
    images will defeat this heuristic. It is valuable as a capture-lab diagnostic and synthetic
    baseline, not enough to ship auto-scoring.
    """
    if image_bgr.ndim not in (2, 3):
        raise ValueError("Expected a grayscale or BGR image array.")
    height, width = image_bgr.shape[:2]
    shortest_side = min(height, width)
    if shortest_side < 160:
        return None

    gray = _to_gray(image_bgr)
    filtered = cv2.medianBlur(gray, 7)
    circles = cv2.HoughCircles(
        filtered,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=max(80, shortest_side // 3),
        param1=120,
        param2=32,
        minRadius=max(30, int(shortest_side * 0.18)),
        maxRadius=int(shortest_side * 0.49),
    )
    if circles is None:
        return None

    image_center = np.array([width / 2, height / 2])
    candidates: list[BoardCircle] = []
    for center_x, center_y, radius in circles[0]:
        center = np.array([center_x, center_y])
        centrality = max(
            0.0, 1.0 - float(np.linalg.norm(center - image_center)) / (shortest_side * 0.6)
        )
        scale = min(1.0, float(radius) / (shortest_side * 0.35))
        edge_support = _edge_support(gray, float(center_x), float(center_y), float(radius))
        confidence = 0.35 * centrality + 0.25 * scale + 0.40 * edge_support
        candidates.append(
            BoardCircle(
                center_x_px=float(center_x),
                center_y_px=float(center_y),
                radius_px=float(radius),
                confidence=round(min(1.0, confidence), 4),
            )
        )
    return max(candidates, key=lambda circle: circle.confidence)


def off_axis_degrees_from_ellipse(major_axis_px: float, minor_axis_px: float) -> float:
    """Weak-perspective estimate of pose angle from a circular board's projected ellipse.

    It is a quality hint only. The production model must use full landmarks/camera calibration,
    especially for close phone cameras where perspective and lens distortion are meaningful.
    """
    if major_axis_px <= 0 or minor_axis_px <= 0:
        raise ValueError("Ellipse axes must be positive.")
    ratio = min(1.0, min(major_axis_px, minor_axis_px) / max(major_axis_px, minor_axis_px))
    return degrees(acos(ratio))


def assess_quality(
    image_bgr: np.ndarray,
    circle: BoardCircle | None,
    *,
    off_axis_degrees: float = 0.0,
    occlusion_risk: float = 0.0,
) -> PoseQuality:
    """Generate user-facing-safe quality dimensions for the initial setup prototype."""
    if circle is None:
        return PoseQuality(
            overall=0.0,
            board_coverage=0.0,
            sharpness=0.0,
            glare_risk=0.0,
            occlusion_risk=1.0,
            off_axis_degrees=off_axis_degrees,
            board_diameter_pixels=0,
            reasons=("Show the full dartboard inside the guide.",),
        )

    height, width = image_bgr.shape[:2]
    gray = _to_gray(image_bgr)
    diameter = round(circle.radius_px * 2)
    board_coverage = min(1.0, diameter / min(height, width))
    sharpness_raw = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # This is a monotonic display normalization—not a device-independent physical metric.
    sharpness = min(1.0, sharpness_raw / 180.0)
    glare_risk = _glare_fraction(gray, circle)
    reasons: list[str] = []
    if diameter < 480:
        reasons.append("Move the camera closer so the board fills more of the frame.")
    if sharpness < 0.18:
        reasons.append("Hold the device still and let the camera focus on the board.")
    if glare_risk > 0.10:
        reasons.append("Reduce glare on the board or shift the light/camera angle.")
    if off_axis_degrees > 55:
        reasons.append("Move nearer the board centerline; this view is too oblique.")
    if occlusion_risk > 0.70:
        reasons.append("Clear anything blocking the board.")

    components = [
        min(1.0, diameter / 700.0),
        sharpness,
        1.0 - min(1.0, glare_risk * 2.0),
        1.0 - min(1.0, max(0.0, off_axis_degrees - 15.0) / 55.0),
        1.0 - min(1.0, occlusion_risk),
        circle.confidence,
    ]
    overall = max(0.0, min(1.0, sum(components) / len(components)))
    return PoseQuality(
        overall=round(overall, 4),
        board_coverage=round(board_coverage, 4),
        sharpness=round(sharpness, 4),
        glare_risk=round(glare_risk, 4),
        occlusion_risk=round(occlusion_risk, 4),
        off_axis_degrees=round(off_axis_degrees, 2),
        board_diameter_pixels=diameter,
        reasons=tuple(reasons),
    )


def draw_debug(
    image_bgr: np.ndarray, circle: BoardCircle | None, quality: PoseQuality
) -> np.ndarray:
    """Return a copy with baseline diagnostics; do not use this output as a training label."""
    annotated = image_bgr.copy()
    if circle is not None:
        center = (round(circle.center_x_px), round(circle.center_y_px))
        cv2.circle(annotated, center, round(circle.radius_px), (71, 224, 146), 3)
        cv2.circle(annotated, center, 5, (86, 197, 255), -1)
        cv2.putText(
            annotated,
            f"board {quality.board_diameter_pixels}px / q={quality.overall:.2f}",
            (20, 34),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
    for index, reason in enumerate(quality.reasons[:3]):
        cv2.putText(
            annotated,
            reason,
            (20, annotated.shape[0] - 20 - index * 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (40, 180, 255),
            2,
            cv2.LINE_AA,
        )
    return annotated


def _to_gray(image_bgr: np.ndarray) -> np.ndarray:
    return image_bgr if image_bgr.ndim == 2 else cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)


def _edge_support(gray: np.ndarray, center_x: float, center_y: float, radius: float) -> float:
    edges = cv2.Canny(gray, 60, 160)
    angles = np.linspace(0, 2 * np.pi, 180, endpoint=False)
    xs = np.clip(np.round(center_x + np.cos(angles) * radius).astype(int), 0, gray.shape[1] - 1)
    ys = np.clip(np.round(center_y + np.sin(angles) * radius).astype(int), 0, gray.shape[0] - 1)
    return float(np.mean(edges[ys, xs] > 0))


def _glare_fraction(gray: np.ndarray, circle: BoardCircle) -> float:
    yy, xx = np.ogrid[: gray.shape[0], : gray.shape[1]]
    mask = (xx - circle.center_x_px) ** 2 + (yy - circle.center_y_px) ** 2 <= circle.radius_px**2
    board_pixels = gray[mask]
    if board_pixels.size == 0:
        return 1.0
    return float(np.mean(board_pixels > 248))


def _cli() -> None:
    parser = argparse.ArgumentParser(description="Run Darts 180's inspectable board-pose baseline.")
    parser.add_argument("image", type=Path, help="Path to a board image (not uploaded anywhere).")
    parser.add_argument("--debug-output", type=Path, help="Optional annotated local image path.")
    parser.add_argument(
        "--off-axis-degrees", type=float, default=0.0, help="Optional known pose for quality test."
    )
    args = parser.parse_args()

    image = cv2.imread(str(args.image), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"Could not read image: {args.image}")
    circle = detect_board_circle(image)
    quality = assess_quality(image, circle, off_axis_degrees=args.off_axis_degrees)
    payload: dict[str, Any] = {
        "circle": asdict(circle) if circle else None,
        "quality": asdict(quality),
    }
    print(json.dumps(payload, indent=2))
    if args.debug_output is not None:
        args.debug_output.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(args.debug_output), draw_debug(image, circle, quality)):
            raise SystemExit(f"Could not write debug image: {args.debug_output}")


if __name__ == "__main__":
    _cli()
