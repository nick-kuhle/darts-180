import unittest

import cv2
import numpy as np

from darts180_vision.pose_baseline import (
    BoardCircle,
    assess_quality,
    detect_board_circle,
    off_axis_degrees_from_ellipse,
)


class PoseBaselineTests(unittest.TestCase):
    def test_detects_large_centered_synthetic_board_circle(self) -> None:
        image = np.full((800, 800, 3), 45, dtype=np.uint8)
        cv2.circle(image, (400, 400), 260, (220, 220, 220), 7)
        circle = detect_board_circle(image)

        self.assertIsNotNone(circle)
        assert circle is not None
        self.assertAlmostEqual(circle.center_x_px, 400, delta=12)
        self.assertAlmostEqual(circle.center_y_px, 400, delta=12)
        self.assertAlmostEqual(circle.radius_px, 260, delta=16)
        self.assertGreater(circle.confidence, 0.45)

    def test_quality_explains_insufficient_board_size(self) -> None:
        image = np.full((600, 600, 3), 80, dtype=np.uint8)
        quality = assess_quality(
            image,
            BoardCircle(center_x_px=300, center_y_px=300, radius_px=150, confidence=0.9),
        )

        self.assertEqual(quality.board_diameter_pixels, 300)
        self.assertTrue(any("Move the camera closer" in reason for reason in quality.reasons))

    def test_ellipse_ratio_becomes_a_conservative_off_axis_estimate(self) -> None:
        self.assertAlmostEqual(off_axis_degrees_from_ellipse(400, 400), 0.0, delta=0.01)
        self.assertAlmostEqual(off_axis_degrees_from_ellipse(400, 200), 60.0, delta=0.01)


if __name__ == "__main__":
    unittest.main()
