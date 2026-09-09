import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from darts180_vision.local_five_point_dataset import (
    DEVELOPMENT_ANNOTATION_METHOD,
    DEVELOPMENT_ANNOTATION_PROFILE,
    LocalFivePointDatasetError,
    compile_local_five_point_dataset,
)


class LocalFivePointDatasetTests(unittest.TestCase):
    def test_compiles_three_session_disjoint_annotation_pairs_to_numeric_yolo(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "reviewed-captures"
            source.mkdir()
            for index, session_id in enumerate(("session_a1", "session_b2", "session_c3"), start=1):
                _write_pair(source, index, session_id=session_id, color=index * 30)

            output = root / "compiled-yolo"
            report = compile_local_five_point_dataset(
                source,
                output,
                split_seed="darts180-campaign-one",
                accepted_consent_version="DEVELOPMENT-DATA-LAB-CONSENT-V1",
            )

            self.assertTrue((output / "data.yaml").is_file())
            self.assertEqual(sum(report["splitImageCounts"].values()), 3)
            self.assertEqual(report["splitImageCounts"], {"train": 1, "val": 1, "test": 1})
            self.assertEqual(report["splitSessionCounts"], {"train": 1, "val": 1, "test": 1})
            self.assertEqual(report["structuralAudit"]["labelIntegrity"]["count"], 0)
            self.assertIn(str(output), (output / "data.yaml").read_text(encoding="utf-8"))

            labels = list(output.glob("*/labels/*.txt"))
            self.assertEqual(len(labels), 3)
            first_label = labels[0].read_text(encoding="utf-8").splitlines()
            self.assertEqual([line.split()[0] for line in first_label], ["1", "2", "3", "4", "0"])

    def test_accepts_blank_board_anchor_examples_only_when_the_capture_intent_is_explicit(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "reviewed-captures"
            source.mkdir()
            _write_pair(
                source,
                1,
                session_id="session_a1",
                capture_intent="empty-board",
                include_dart=False,
            )
            _write_pair(source, 2, session_id="session_b2", color=60)
            _write_pair(source, 3, session_id="session_c3", color=90)

            report = compile_local_five_point_dataset(
                source,
                root / "compiled-yolo",
                split_seed="darts180-blank-board-test",
                accepted_consent_version="DEVELOPMENT-DATA-LAB-CONSENT-V1",
            )

            self.assertEqual(report["labelCounts"]["dartEntryPoint"], 2)
            labels = list((root / "compiled-yolo").glob("*/labels/*.txt"))
            blank_label = next(
                label for label in labels if len(label.read_text().splitlines()) == 4
            )
            self.assertEqual(
                [line.split()[0] for line in blank_label.read_text(encoding="utf-8").splitlines()],
                ["1", "2", "3", "4"],
            )

    def test_rejects_a_corpus_that_contains_only_blank_board_examples(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "reviewed-captures"
            source.mkdir()
            for index, session_id in enumerate(("session_a1", "session_b2", "session_c3"), start=1):
                _write_pair(
                    source,
                    index,
                    session_id=session_id,
                    capture_intent="empty-board",
                    include_dart=False,
                    color=index * 30,
                )

            with self.assertRaisesRegex(
                LocalFivePointDatasetError, "At least one reviewed dart label"
            ):
                compile_local_five_point_dataset(
                    source,
                    root / "compiled-yolo",
                    split_seed="darts180-only-blank-boards",
                    accepted_consent_version="DEVELOPMENT-DATA-LAB-CONSENT-V1",
                )

    def test_rejects_empty_darts_when_a_photo_claims_to_be_a_dart_test(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "reviewed-captures"
            source.mkdir()
            _write_pair(source, 1, session_id="session_a1", include_dart=False)

            with self.assertRaisesRegex(
                LocalFivePointDatasetError, "at least one reviewed dart label"
            ):
                compile_local_five_point_dataset(
                    source,
                    root / "compiled-yolo",
                    split_seed="darts180-empty-dart-test",
                    accepted_consent_version="DEVELOPMENT-DATA-LAB-CONSENT-V1",
                )

    def test_refuses_standard_annotation_profile_for_five_point_training(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "reviewed-captures"
            source.mkdir()
            _write_pair(
                source,
                1,
                session_id="session_a1",
                annotation_method="manual-four-double-bed-homography-v0",
            )

            with self.assertRaisesRegex(
                LocalFivePointDatasetError, "Five-point development model labels"
            ):
                compile_local_five_point_dataset(
                    source,
                    root / "compiled-yolo",
                    split_seed="darts180-campaign-one",
                    accepted_consent_version="DEVELOPMENT-DATA-LAB-CONSENT-V1",
                )

    def test_refuses_exact_duplicate_jpegs_before_any_split(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "reviewed-captures"
            source.mkdir()
            first_image = _write_pair(source, 1, session_id="session_a1", color=90)
            _write_pair(source, 2, session_id="session_b2", image_bytes=first_image.read_bytes())

            with self.assertRaisesRegex(LocalFivePointDatasetError, "Exact duplicate JPEG bytes"):
                compile_local_five_point_dataset(
                    source,
                    root / "compiled-yolo",
                    split_seed="darts180-campaign-one",
                    accepted_consent_version="DEVELOPMENT-DATA-LAB-CONSENT-V1",
                )


def _write_pair(
    root: Path,
    index: int,
    *,
    session_id: str,
    color: int = 30,
    annotation_method: str = DEVELOPMENT_ANNOTATION_METHOD,
    image_bytes: bytes | None = None,
    capture_intent: str = "static-dart",
    include_dart: bool = True,
) -> Path:
    capture_id = f"cap0000{index}"
    image_name = f"darts-180-{capture_id}-{capture_intent}.jpg"
    image_path = root / image_name
    if image_bytes is None:
        image = np.full((480, 640, 3), color, dtype=np.uint8)
        assert cv2.imwrite(str(image_path), image)
    else:
        image_path.write_bytes(image_bytes)

    anchors = [
        ("cal1", [-26.594, -167.907], [320, 70]),
        ("cal2", [26.594, 167.907], [320, 410]),
        ("cal3", [-167.907, 26.594], [80, 240]),
        ("cal4", [167.907, -26.594], [560, 240]),
    ]
    sidecar = {
        "schemaVersion": 1,
        "capture": {
            "captureId": capture_id,
            "sessionId": session_id,
            "consentVersion": "DEVELOPMENT-DATA-LAB-CONSENT-V1",
            "consentAcceptedAt": "2026-09-08T11:55:00.000Z",
            "admissionStatus": "consented-development-unreviewed",
            "boardModel": "Standard board",
            "deviceModel": "Test camera",
            "captureMode": "still",
            "captureIntent": capture_intent,
            "imageFile": image_name,
            "imageMime": "image/jpeg",
            "offAxisDegrees": 20,
            "distanceMm": 900,
            "lightingBand": "normal",
            "containsFaces": False,
            "createdAt": "2026-09-08T12:00:00Z",
            "labelsVersion": "unlabeled-v0",
            "split": "unassigned",
        },
        "image": {"file": image_name, "width": 640, "height": 480},
        "board": {
            "annotationMethod": annotation_method,
            "annotationProfile": DEVELOPMENT_ANNOTATION_PROFILE,
            "imageToBoardHomography": [1, 0, 0, 0, 1, 0, 0, 0, 1],
            "anchors": [
                {"id": anchor_id, "canonicalPointMm": canonical, "imagePointPx": image_point}
                for anchor_id, canonical, image_point in anchors
            ],
        },
        "darts": (
            [
                {
                    "dartTrackId": f"manual-{capture_id}-dart-1",
                    "tipPixel": [320, 240],
                    "entryPointBoardMm": [0, 0],
                    "zone": {"ring": "IB", "segment": None, "score": 50},
                    "visibility": "clear",
                    "wireMarginMm": 6.35,
                }
            ]
            if include_dart
            else []
        ),
    }
    (root / f"darts-180-{capture_id}-annotations.json").write_text(
        json.dumps(sidecar), encoding="utf-8"
    )
    return image_path


if __name__ == "__main__":
    unittest.main()
