"""Canonical dartboard geometry shared conceptually with mobile runtime implementations.

A model predicts image evidence. The image-to-board homography maps it to `BoardPointMm`; only
then do we deterministically decode scoring rings and wedges. Keep this file and the TypeScript /
Rust equivalents under differential test whenever a boundary changes.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import atan2, degrees, hypot
from typing import Literal

SEGMENT_ORDER = (20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5)
Ring = Literal["S", "D", "T", "IB", "OB", "MISS"]


@dataclass(frozen=True)
class BoardPointMm:
    x_mm: float
    y_mm: float


@dataclass(frozen=True)
class DartZone:
    ring: Ring
    segment: int | None
    score: int


def decode_board_point(point: BoardPointMm) -> DartZone:
    """Decode a canonical point (x right, y down, origin at bull centre)."""
    radius = hypot(point.x_mm, point.y_mm)
    if radius <= 6.35:
        return DartZone("IB", None, 50)
    if radius <= 15.9:
        return DartZone("OB", None, 25)
    if radius > 170:
        return DartZone("MISS", None, 0)

    segment = segment_at_point(point)
    if radius < 99:
        return DartZone("S", segment, segment)
    if radius <= 107:
        return DartZone("T", segment, segment * 3)
    if radius < 162:
        return DartZone("S", segment, segment)
    return DartZone("D", segment, segment * 2)


def segment_at_point(point: BoardPointMm) -> int:
    """Return segment number; zero degrees is 20 at twelve o'clock, clockwise is positive."""
    angle = degrees(atan2(point.x_mm, -point.y_mm)) % 360
    return SEGMENT_ORDER[int((angle + 9) // 18) % 20]
