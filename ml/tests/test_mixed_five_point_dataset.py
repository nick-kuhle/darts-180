import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from darts180_vision.deepdarts_yolo_train import (
    DevelopmentTrainingError,
    validate_dataset_provenance,
)
from darts180_vision.local_five_point_dataset import compile_local_five_point_dataset
from darts180_vision.mixed_five_point_dataset import (
    MixedFivePointDatasetError,
    build_mixed_five_point_dataset,
)
from darts180_vision.synthetic_five_point_dataset import build_synthetic_five_point_dataset


class MixedFivePointDatasetTests(unittest.TestCase):
    def test_mixes_synthetic_training_with_real_only_validation_and_test(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real_source = root / "reviewed-real-pairs"
            real_source.mkdir()
            for index, session_id in enumerate(("session_a1", "session_b2", "session_c3"), start=1):
                _write_real_pair(real_source, index, session_id=session_id, color=index * 30)

            real_dataset = root / "reviewed-real-yolo"
            compile_local_five_point_dataset(
                real_source,
                real_dataset,
                split_seed="mixed-dataset-test",
                accepted_consent_version="DEVELOPMENT-DATA-LAB-CONSENT-V1",
            )
            synthetic_dataset = root / "procedural-synthetic-yolo"
            build_synthetic_five_point_dataset(synthetic_dataset, count=9, seed=42)

            mixed_dataset = root / "mixed-yolo"
            report = build_mixed_five_point_dataset(
                real_dataset,
                synthetic_dataset,
                mixed_dataset,
                mix_id="first-mixed-dev-v1",
                real_review_id="operator-real-review-v1",
                synthetic_review_id="procedural-renderer-review-v1",
            )

            self.assertEqual(report["splitImageCounts"], {"train": 7, "val": 1, "test": 1})
            provenance = report["mixedProvenance"]
            self.assertEqual(provenance["trainingDataKind"], "mixed-synthetic-and-real")
            self.assertEqual(
                provenance["real"]["includedImageCounts"], {"train": 1, "val": 1, "test": 1}
            )
            self.assertEqual(
                provenance["synthetic"]["includedImageCounts"],
                {"train": 6, "val": 0, "test": 0},
            )
            self.assertTrue(provenance["evaluation"]["validationContainsOnlyReviewedReal"])
            self.assertTrue(provenance["evaluation"]["testContainsOnlyReviewedReal"])
            self.assertFalse(provenance["evaluation"]["productionReady"])
            self.assertEqual(report["structuralAudit"]["labelIntegrity"]["count"], 0)
            self.assertTrue((mixed_dataset / "darts180-mixed-fivepoint-dataset.json").is_file())
            self.assertEqual(
                len(list((mixed_dataset / "train" / "images").glob("synthetic-*.jpg"))),
                6,
            )
            self.assertEqual(len(list((mixed_dataset / "val" / "images").glob("synthetic-*"))), 0)
            self.assertEqual(len(list((mixed_dataset / "test" / "images").glob("synthetic-*"))), 0)

            validate_dataset_provenance(mixed_dataset, "mixed-synthetic-and-real")
            with self.assertRaisesRegex(DevelopmentTrainingError, "mixed-synthetic-and-real"):
                validate_dataset_provenance(mixed_dataset, "real-reviewed")

    def test_refuses_exact_duplicate_real_and_synthetic_training_images(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real_source = root / "reviewed-real-pairs"
            real_source.mkdir()
            for index, session_id in enumerate(("session_a1", "session_b2", "session_c3"), start=1):
                _write_real_pair(real_source, index, session_id=session_id, color=index * 30)
            real_dataset = root / "reviewed-real-yolo"
            compile_local_five_point_dataset(
                real_source,
                real_dataset,
                split_seed="mixed-duplicate-test",
                accepted_consent_version="DEVELOPMENT-DATA-LAB-CONSENT-V1",
            )
            synthetic_dataset = root / "procedural-synthetic-yolo"
            build_synthetic_five_point_dataset(synthetic_dataset, count=6, seed=7)

            real_image = next((real_dataset / "train" / "images").glob("*.jpg"))
            synthetic_image = next((synthetic_dataset / "train" / "images").glob("*.jpg"))
            synthetic_image.write_bytes(real_image.read_bytes())

            with self.assertRaisesRegex(MixedFivePointDatasetError, "Exact duplicate JPEG bytes"):
                build_mixed_five_point_dataset(
                    real_dataset,
                    synthetic_dataset,
                    root / "mixed-yolo",
                    mix_id="mixed-duplicate-v1",
                    real_review_id="operator-real-review-v1",
                    synthetic_review_id="procedural-renderer-review-v1",
                )

    def test_mixed_provenance_requires_an_operator_review_and_real_holdouts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "darts180-mixed-fivepoint-dataset.json").write_text(
                json.dumps(
                    {
                        "mixingVersion": 1,
                        "mixedProvenance": {
                            "trainingDataKind": "mixed-synthetic-and-real",
                            "operatorReview": {
                                "realReviewId": "review-real-v1",
                                "syntheticReviewId": "review-synthetic-v1",
                                "automaticTrainingAdmission": False,
                            },
                            "real": {
                                "compilationReportSha256": "a" * 64,
                                "includedImageCounts": {"train": 1, "val": 1, "test": 1},
                            },
                            "synthetic": {
                                "bootstrapReportSha256": "b" * 64,
                                "includedImageCounts": {"train": 4, "val": 0, "test": 0},
                                "usedForTrainingOnly": True,
                                "realWorldEvaluationEligible": False,
                            },
                            "evaluation": {
                                "validationContainsOnlyReviewedReal": True,
                                "testContainsOnlyReviewedReal": True,
                                "productionReady": False,
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )
            validate_dataset_provenance(root, "mixed-synthetic-and-real")

            value = json.loads((root / "darts180-mixed-fivepoint-dataset.json").read_text())
            value["mixedProvenance"]["synthetic"]["includedImageCounts"]["val"] = 1
            (root / "darts180-mixed-fivepoint-dataset.json").write_text(
                json.dumps(value), encoding="utf-8"
            )
            with self.assertRaisesRegex(DevelopmentTrainingError, "train only"):
                validate_dataset_provenance(root, "mixed-synthetic-and-real")


def _write_real_pair(root: Path, index: int, *, session_id: str, color: int) -> None:
    capture_id = f"cap0000{index}"
    image_name = f"darts-180-{capture_id}-static-dart.jpg"
    image_path = root / image_name
    image = np.full((480, 640, 3), color, dtype=np.uint8)
    assert cv2.imwrite(str(image_path), image)
    sidecar = {
        "schemaVersion": 1,
        "capture": {
            "captureId": capture_id,
            "sessionId": session_id,
            "consentVersion": "DEVELOPMENT-DATA-LAB-CONSENT-V1",
            "consentAcceptedAt": "2026-09-09T12:00:00.000Z",
            "admissionStatus": "consented-development-unreviewed",
            "boardModel": "Standard board",
            "deviceModel": "Test camera",
            "captureMode": "still",
            "captureIntent": "static-dart",
            "imageFile": image_name,
            "imageMime": "image/jpeg",
            "offAxisDegrees": 20,
            "distanceMm": 900,
            "lightingBand": "normal",
            "containsFaces": False,
            "createdAt": "2026-09-09T12:00:00Z",
            "labelsVersion": "unlabeled-v0",
            "split": "unassigned",
        },
        "image": {"file": image_name, "width": 640, "height": 480},
        "board": {
            "annotationMethod": "deepdarts-four-cardinal-homography-v1",
            "annotationProfile": "deepdarts-five-point-v1",
            "imageToBoardHomography": [1, 0, 0, 0, 1, 0, 0, 0, 1],
            "anchors": [
                {"id": "cal1", "canonicalPointMm": [-26.594, -167.907], "imagePointPx": [320, 70]},
                {"id": "cal2", "canonicalPointMm": [26.594, 167.907], "imagePointPx": [320, 410]},
                {"id": "cal3", "canonicalPointMm": [-167.907, 26.594], "imagePointPx": [80, 240]},
                {"id": "cal4", "canonicalPointMm": [167.907, -26.594], "imagePointPx": [560, 240]},
            ],
        },
        "darts": [
            {
                "dartTrackId": f"manual-{capture_id}-dart-1",
                "tipPixel": [320, 240],
                "entryPointBoardMm": [0, 0],
                "zone": {"ring": "IB", "segment": None, "score": 50},
                "visibility": "clear",
                "wireMarginMm": 6.35,
            }
        ],
    }
    (root / f"darts-180-{capture_id}-annotations.json").write_text(
        json.dumps(sidecar), encoding="utf-8"
    )


if __name__ == "__main__":
    unittest.main()
