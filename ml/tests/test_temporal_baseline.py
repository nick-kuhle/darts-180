from __future__ import annotations

import unittest

import cv2
import numpy as np

from darts180_vision.temporal_baseline import detect_new_dart_tip, score_candidate


class TemporalBaselineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.center = (300.0, 300.0)
        self.radius = 245.0
        self.before = np.full((600, 600, 3), 220, dtype=np.uint8)
        cv2.circle(self.before, (300, 300), 245, (170, 170, 170), -1)

    def test_proposes_tip_for_a_new_radial_synthetic_dart(self) -> None:
        after = self.before.copy()
        # Tip lies at the T20 radius; shaft travels out toward the top of the board.
        cv2.line(after, (300, 145), (300, 55), (25, 25, 25), 7)
        candidate = detect_new_dart_tip(
            self.before,
            after,
            board_center_px=self.center,
            board_radius_px=self.radius,
        )
        self.assertIsNotNone(candidate)
        assert candidate is not None
        self.assertAlmostEqual(candidate.tip.x_px, 300, delta=12)
        self.assertAlmostEqual(candidate.tip.y_px, 145, delta=15)
        self.assertGreaterEqual(candidate.confidence, 0.5)

        pixels_per_mm = 1.5
        image_to_board = np.array(
            [
                [1 / pixels_per_mm, 0, -300 / pixels_per_mm],
                [0, 1 / pixels_per_mm, -300 / pixels_per_mm],
                [0, 0, 1],
            ],
            dtype=np.float32,
        )
        scored = score_candidate(candidate, image_to_board)
        self.assertEqual((scored.zone.ring, scored.zone.segment), ("T", 20))

    def test_returns_none_for_settled_identical_frames(self) -> None:
        self.assertIsNone(
            detect_new_dart_tip(
                self.before,
                self.before.copy(),
                board_center_px=self.center,
                board_radius_px=self.radius,
            )
        )

    def test_refuses_mismatched_frames(self) -> None:
        with self.assertRaises(ValueError):
            detect_new_dart_tip(
                self.before,
                self.before[:500],
                board_center_px=self.center,
                board_radius_px=self.radius,
            )


if __name__ == "__main__":
    unittest.main()
