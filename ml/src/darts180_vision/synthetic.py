"""Generate synthetic, labeled dartboard scenes for pipeline smoke tests and augmentation.

Synthetic data supplements—not replaces—consented real capture. Its value is controlled variation:
board pose, image scale, lighting, dart count, ring/segment coverage, and deterministic ground
truth. It must never be used as the sacred evaluation set.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from math import cos, pi, sin
from pathlib import Path
from random import Random
from typing import Any

import cv2
import numpy as np

from .geometry import BoardPointMm, DartZone, SEGMENT_ORDER, decode_board_point

_CANVAS_SIZE = 640
_CENTER = _CANVAS_SIZE / 2
_BOARD_SCALE = 1.55  # pixels / canonical mm
_BOARD_RADIUS_MM = 170


def generate_synthetic_dataset(output_directory: Path, *, count: int, seed: int = 20260906) -> list[Path]:
    """Create JPEG + JSON sidecars. Returns label paths, suitable for tests and local experiments."""
    if count < 1:
        raise ValueError("count must be at least one.")
    output_directory.mkdir(parents=True, exist_ok=True)
    rng = Random(seed)
    label_paths: list[Path] = []
    for index in range(count):
        image, label = generate_synthetic_scene(rng, index)
        image_name = f"synthetic_{index:05d}.jpg"
        label_name = f"synthetic_{index:05d}.json"
        image_path = output_directory / image_name
        label_path = output_directory / label_name
        if not cv2.imwrite(str(image_path), image, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            raise RuntimeError(f"Could not write {image_path}")
        label["image"]["file"] = image_name
        label_path.write_text(json.dumps(label, indent=2), encoding="utf-8")
        label_paths.append(label_path)
    return label_paths


def generate_synthetic_scene(rng: Random, index: int) -> tuple[np.ndarray, dict[str, Any]]:
    """Render one intentionally simple but geometrically consistent scene."""
    board = _render_canonical_board()
    dart_count = rng.randint(1, 3)
    darts = _sample_non_overlapping_darts(rng, dart_count)
    for dart in darts:
        _draw_dart(board, dart["point"], rng)

    output_width, output_height = 1280, 720
    background = _render_background(rng, output_width, output_height)
    source_corners = np.float32(
        [[0, 0], [_CANVAS_SIZE - 1, 0], [_CANVAS_SIZE - 1, _CANVAS_SIZE - 1], [0, _CANVAS_SIZE - 1]]
    )
    destination_corners = _sample_destination_quad(rng, output_width, output_height)
    canonical_to_image = cv2.getPerspectiveTransform(source_corners, destination_corners)
    warped = cv2.warpPerspective(board, canonical_to_image, (output_width, output_height))
    board_mask = np.zeros((_CANVAS_SIZE, _CANVAS_SIZE), dtype=np.uint8)
    cv2.circle(board_mask, (int(_CENTER), int(_CENTER)), int(_BOARD_RADIUS_MM * _BOARD_SCALE + 5), 255, -1)
    mask = cv2.warpPerspective(board_mask, canonical_to_image, (output_width, output_height))
    scene = np.where(mask[..., None] > 0, warped, background)

    image_darts: list[dict[str, Any]] = []
    for dart in darts:
        image_tip = _transform_point(canonical_to_image, dart["board_px"])
        image_darts.append(
            {
                "dartTrackId": dart["track_id"],
                "tipPixel": [round(image_tip[0], 2), round(image_tip[1], 2)],
                "entryPointBoardMm": [round(dart["point"].x_mm, 3), round(dart["point"].y_mm, 3)],
                "zone": asdict(dart["zone"]),
                "visibility": "clear",
                "wireMarginMm": round(_wire_margin(dart["point"]), 3),
            }
        )

    capture_id = f"synthetic_{index:05d}"
    label: dict[str, Any] = {
        "schemaVersion": 1,
        "capture": {
            "captureId": capture_id,
            "consentVersion": "SYNTHETIC-NO-USER-DATA",
            "boardModel": "synthetic-standard-steel-tip",
            "deviceModel": "synthetic-camera",
            "captureMode": "synthetic",
            "offAxisDegrees": round(_off_axis_from_quad(destination_corners), 2),
            "distanceMm": 900,
            "lightingBand": "normal",
            "containsFaces": False,
            "createdAt": "2026-09-06T00:00:00.000Z",
            "labelsVersion": "synthetic-v1",
            "split": "unassigned",
        },
        "image": {"file": None, "width": output_width, "height": output_height},
        "board": {
            "canonicalCanvas": {"sizePx": _CANVAS_SIZE, "centerPx": [_CENTER, _CENTER], "scalePxPerMm": _BOARD_SCALE},
            "canonicalToImageHomography": [round(float(item), 8) for item in canonical_to_image.flatten()],
            "outerBoardQuadPx": [[round(float(x), 2), round(float(y), 2)] for x, y in destination_corners],
        },
        "darts": image_darts,
    }
    return scene, label


def _render_canonical_board() -> np.ndarray:
    image = np.full((_CANVAS_SIZE, _CANVAS_SIZE, 3), (23, 30, 27), dtype=np.uint8)
    # Board face; colors are BGR because OpenCV is BGR.
    cv2.circle(image, (int(_CENTER), int(_CENTER)), int(_BOARD_RADIUS_MM * _BOARD_SCALE), (40, 47, 44), -1)
    for index, _segment in enumerate(SEGMENT_ORDER):
        primary = index % 2 == 0
        single = (194, 208, 213) if primary else (38, 44, 42)
        accent = (62, 65, 197) if primary else (87, 147, 31)
        start, end = index * 18 - 9, index * 18 + 9
        _fill_sector(image, start, end, 15.9, 99, single)
        _fill_sector(image, start, end, 99, 107, accent)
        _fill_sector(image, start, end, 107, 162, single)
        _fill_sector(image, start, end, 162, 170, accent)
    for radius in (99, 107, 162, 170):
        cv2.circle(image, (int(_CENTER), int(_CENTER)), int(radius * _BOARD_SCALE), (25, 25, 25), 2)
    cv2.circle(image, (int(_CENTER), int(_CENTER)), int(15.9 * _BOARD_SCALE), (74, 145, 29), -1)
    cv2.circle(image, (int(_CENTER), int(_CENTER)), int(6.35 * _BOARD_SCALE), (50, 50, 205), -1)
    return image


def _fill_sector(image: np.ndarray, start_degrees: float, end_degrees: float, inner_mm: float, outer_mm: float, color: tuple[int, int, int]) -> None:
    angles = np.linspace(start_degrees, end_degrees, 18)
    outer = [_canonical_pixel(outer_mm, float(angle)) for angle in angles]
    inner = [_canonical_pixel(inner_mm, float(angle)) for angle in angles[::-1]]
    polygon = np.array(outer + inner, dtype=np.int32)
    cv2.fillConvexPoly(image, polygon, color)


def _canonical_pixel(radius_mm: float, degrees_clockwise_from_top: float) -> tuple[int, int]:
    radians = degrees_clockwise_from_top * pi / 180
    return (
        round(_CENTER + sin(radians) * radius_mm * _BOARD_SCALE),
        round(_CENTER - cos(radians) * radius_mm * _BOARD_SCALE),
    )


def _sample_non_overlapping_darts(rng: Random, dart_count: int) -> list[dict[str, Any]]:
    darts: list[dict[str, Any]] = []
    for dart_index in range(dart_count):
        for _attempt in range(40):
            candidate = _sample_dart(rng, dart_index)
            point = candidate["point"]
            if all(
                ((point.x_mm - existing["point"].x_mm) ** 2 + (point.y_mm - existing["point"].y_mm) ** 2) ** 0.5
                > 14
                for existing in darts
            ):
                darts.append(candidate)
                break
        else:
            # Keep a bounded generator deterministic even in rare crowded sample cases.
            darts.append(_sample_dart(rng, dart_index))
    return darts


def _sample_dart(rng: Random, dart_index: int) -> dict[str, Any]:
    ring = rng.choices(["S-inner", "T", "S-outer", "D", "IB", "OB", "MISS"], [26, 17, 22, 16, 5, 7, 7])[0]
    if ring == "IB":
        radius = rng.uniform(0, 6.1)
        angle = rng.uniform(0, 360)
    elif ring == "OB":
        radius = rng.uniform(6.6, 15.5)
        angle = rng.uniform(0, 360)
    elif ring == "MISS":
        radius = rng.uniform(171, 190)
        angle = rng.uniform(0, 360)
    else:
        segment_index = rng.randrange(20)
        # Some intentional near-wire examples, but not every synthetic dart is a boundary dart.
        wedge_offset = rng.choice([rng.uniform(-7.0, 7.0), rng.choice([-8.6, 8.6])])
        angle = segment_index * 18 + wedge_offset
        radius = {
            "S-inner": rng.uniform(17, 97),
            "T": rng.uniform(99.4, 106.6),
            "S-outer": rng.uniform(109, 160),
            "D": rng.uniform(162.4, 169.6),
        }[ring]
    radians = angle * pi / 180
    point = BoardPointMm(x_mm=sin(radians) * radius, y_mm=-cos(radians) * radius)
    return {
        "track_id": f"synthetic-track-{dart_index + 1}",
        "point": point,
        "board_px": _canonical_pixel(radius, angle),
        "zone": decode_board_point(point),
    }


def _draw_dart(image: np.ndarray, point: BoardPointMm, rng: Random) -> None:
    tip_x = int(round(_CENTER + point.x_mm * _BOARD_SCALE))
    tip_y = int(round(_CENTER + point.y_mm * _BOARD_SCALE))
    # Draw an intentionally varied shaft/flight vector; it is not a photorealistic dart renderer.
    angle = np.arctan2(point.y_mm, point.x_mm) + rng.uniform(-0.85, 0.85)
    length = int(rng.uniform(55, 115))
    end = (int(tip_x + np.cos(angle) * length), int(tip_y + np.sin(angle) * length))
    cv2.line(image, (tip_x, tip_y), end, (15, 15, 15), 8, cv2.LINE_AA)
    cv2.line(image, (tip_x, tip_y), end, (180, 180, 180), 3, cv2.LINE_AA)
    cv2.circle(image, (tip_x, tip_y), 4, (230, 230, 230), -1, cv2.LINE_AA)


def _render_background(rng: Random, width: int, height: int) -> np.ndarray:
    base = np.zeros((height, width, 3), dtype=np.uint8)
    base[:, :] = (rng.randint(18, 42), rng.randint(20, 48), rng.randint(18, 42))
    noise = np.random.default_rng(rng.randrange(2**32)).normal(0, 6, base.shape).astype(np.int16)
    return np.clip(base.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def _sample_destination_quad(rng: Random, width: int, height: int) -> np.ndarray:
    center_x = rng.uniform(width * 0.38, width * 0.62)
    center_y = rng.uniform(height * 0.43, height * 0.58)
    size = rng.uniform(390, 550)
    skew_x = rng.uniform(-0.22, 0.22) * size
    skew_y = rng.uniform(-0.16, 0.16) * size
    perspective = rng.uniform(-0.13, 0.13) * size
    return np.float32(
        [
            [center_x - size / 2 + skew_x, center_y - size / 2 + perspective],
            [center_x + size / 2 + skew_x, center_y - size / 2 - perspective],
            [center_x + size / 2 - skew_x, center_y + size / 2 + skew_y],
            [center_x - size / 2 - skew_x, center_y + size / 2 - skew_y],
        ]
    )


def _transform_point(matrix: np.ndarray, point: tuple[int, int]) -> tuple[float, float]:
    source = np.array([[[float(point[0]), float(point[1])]]], dtype=np.float32)
    projected = cv2.perspectiveTransform(source, matrix)[0, 0]
    return float(projected[0]), float(projected[1])


def _off_axis_from_quad(quad: np.ndarray) -> float:
    top = float(np.linalg.norm(quad[1] - quad[0]))
    bottom = float(np.linalg.norm(quad[2] - quad[3]))
    left = float(np.linalg.norm(quad[3] - quad[0]))
    right = float(np.linalg.norm(quad[2] - quad[1]))
    asymmetry = abs(top - bottom) / max(top, bottom) + abs(left - right) / max(left, right)
    return float(min(55.0, asymmetry * 55.0))


def _wire_margin(point: BoardPointMm) -> float:
    radius = (point.x_mm**2 + point.y_mm**2) ** 0.5
    radial = min(abs(radius - wire) for wire in (6.35, 15.9, 99, 107, 162, 170))
    if radius <= 15.9:
        return radial
    angle = (np.degrees(np.arctan2(point.x_mm, -point.y_mm)) + 360) % 360
    local_angle = ((angle + 9) % 18) - 9
    angular = radius * sin((9 - abs(local_angle)) * pi / 180)
    return max(0.0, min(radial, angular))


def _cli() -> None:
    parser = argparse.ArgumentParser(description="Generate local, synthetic Darts 180 dartboard scenes.")
    parser.add_argument("--output", type=Path, required=True, help="Output directory (never commit generated media).")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260906)
    args = parser.parse_args()
    paths = generate_synthetic_dataset(args.output, count=args.count, seed=args.seed)
    print(f"Generated {len(paths)} labeled synthetic scenes in {args.output}")


if __name__ == "__main__":
    _cli()
