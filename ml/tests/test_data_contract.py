import json
import tempfile
import unittest
from pathlib import Path

import cv2

from darts180_vision.data_contract import validate_capture_manifest, validate_capture_sidecar, validate_dart_label
from darts180_vision.synthetic import generate_synthetic_dataset


class DataContractTests(unittest.TestCase):
    def test_accepts_a_minimal_private_capture_manifest(self) -> None:
        manifest = {
            "captureId": "cap_example_0001",
            "consentVersion": "LOCAL-CAPTURE-NOT-YET-SHARED",
            "boardModel": "Standard board",
            "deviceModel": "Phone camera",
            "captureMode": "still",
            "captureIntent": "static-dart",
            "imageFile": "darts-180-cap_example_0001-static-dart.jpg",
            "imageMime": "image/jpeg",
            "offAxisDegrees": 20,
            "distanceMm": 900,
            "lightingBand": "normal",
            "containsFaces": False,
            "createdAt": "2026-09-06T00:00:00.000Z",
            "split": "unassigned",
        }
        self.assertEqual(validate_capture_manifest(manifest), ())

    def test_rejects_manifest_that_does_not_explicitly_exclude_faces(self) -> None:
        manifest = {
            "captureId": "cap_example_0001",
            "consentVersion": "v1",
            "boardModel": "board",
            "deviceModel": "phone",
            "captureMode": "still",
            "offAxisDegrees": 20,
            "distanceMm": 900,
            "lightingBand": "normal",
            "containsFaces": True,
            "createdAt": "now",
        }
        self.assertTrue(any(issue.path == "containsFaces" for issue in validate_capture_manifest(manifest)))

    def test_rejects_dart_label_that_disagrees_with_canonical_geometry(self) -> None:
        label = {
            "entryPointBoardMm": [0, -103],
            "zone": {"ring": "S", "segment": 20, "score": 20},
            "wireMarginMm": 4,
        }
        self.assertTrue(any(issue.path == "zone" for issue in validate_dart_label(label)))

    def test_synthetic_generator_creates_geometry_consistent_sidecars(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            paths = generate_synthetic_dataset(output, count=3, seed=7)
            self.assertEqual(len(paths), 3)
            for label_path in paths:
                data = json.loads(label_path.read_text(encoding="utf-8"))
                self.assertEqual(validate_capture_manifest(data["capture"]), ())
                self.assertEqual(validate_capture_sidecar(data), ())
                image = cv2.imread(str(output / data["image"]["file"]))
                self.assertIsNotNone(image)
                self.assertEqual(image.shape[:2], (720, 1280))
                for dart in data["darts"]:
                    self.assertEqual(validate_dart_label(dart), ())


if __name__ == "__main__":
    unittest.main()
