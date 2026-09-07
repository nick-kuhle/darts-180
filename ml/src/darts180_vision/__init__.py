"""Darts 180 vision training and evaluation primitives.

Keep this package initializer dependency-light. OpenCV tools live in explicit modules so geometry
can be imported in a minimal environment and `python -m darts180_vision.pose_baseline` is clean.
"""

from .geometry import BoardPointMm, DartZone, decode_board_point

__all__ = ["BoardPointMm", "DartZone", "decode_board_point"]
