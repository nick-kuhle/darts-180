import unittest

from darts180_vision.geometry import BoardPointMm, DartZone, decode_board_point


class GeometryTests(unittest.TestCase):
    def test_top_triple_is_t20(self) -> None:
        self.assertEqual(decode_board_point(BoardPointMm(0, -103)), DartZone("T", 20, 60))

    def test_bulls_and_miss(self) -> None:
        self.assertEqual(decode_board_point(BoardPointMm(0, 0)), DartZone("IB", None, 50))
        self.assertEqual(decode_board_point(BoardPointMm(0, -10)), DartZone("OB", None, 25))
        self.assertEqual(decode_board_point(BoardPointMm(171, 0)), DartZone("MISS", None, 0))


if __name__ == "__main__":
    unittest.main()
