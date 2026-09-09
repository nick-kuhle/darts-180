import json
import tempfile
import unittest
from pathlib import Path

from darts180_vision.synthetic_five_point_dataset import (
    SyntheticFivePointDatasetError,
    build_synthetic_five_point_dataset,
)


class SyntheticFivePointDatasetTests(unittest.TestCase):
    def test_builds_an_external_fully_synthetic_numeric_yolo_bootstrap(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "synthetic-five-point"
            report = build_synthetic_five_point_dataset(output, count=9, seed=42)

            self.assertEqual(report["splitImageCounts"], {"train": 6, "val": 1, "test": 2})
            self.assertEqual(report["syntheticProvenance"], {
                "profile": "procedural-simulated-dartboard-v1",
                "consentVersion": "SYNTHETIC-NO-USER-DATA",
                "admissionStatus": "synthetic-not-real-world-evaluation",
                "containsHumanCapture": False,
                "containsAiGeneratedWholeBoardPhotos": False,
                "realWorldEvaluationEligible": False,
            })
            self.assertIn("real-world evaluation", report["nextRequiredSteps"][1])
            self.assertEqual(report["structuralAudit"]["labelIntegrity"]["count"], 0)
            self.assertEqual(
                report["structuralAudit"]["aggregate"]["framesWithDartAndAllFourCalibrationAnchors"],
                9,
            )
            self.assertTrue((output / "data.yaml").is_file())
            self.assertEqual(
                (output / "data.yaml").read_text(encoding="utf-8").splitlines()[-1],
                "names: ['0', '1', '2', '3', '4']",
            )

            labels = sorted(output.glob("*/labels/*.txt"))
            self.assertEqual(len(labels), 9)
            for label_path in labels:
                class_ids = [line.split()[0] for line in label_path.read_text(encoding="utf-8").splitlines()]
                self.assertEqual(class_ids[:4], ["1", "2", "3", "4"])
                self.assertTrue(all(class_id == "0" for class_id in class_ids[4:]))

            on_disk_report = json.loads(
                (output / "darts180-synthetic-fivepoint-bootstrap.json").read_text(encoding="utf-8")
            )
            self.assertEqual(on_disk_report["syntheticProvenance"], report["syntheticProvenance"])

    def test_requires_non_empty_train_validation_and_test_partitions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(SyntheticFivePointDatasetError, "at least 3"):
                build_synthetic_five_point_dataset(Path(temporary) / "synthetic-five-point", count=2)

    def test_refuses_to_write_generated_archive_inside_repository(self) -> None:
        repository_root = Path(__file__).resolve().parents[2]
        with self.assertRaisesRegex(SyntheticFivePointDatasetError, "outside the Darts 180 repository"):
            build_synthetic_five_point_dataset(
                repository_root / "ml" / "data" / "curated" / "not-allowed", count=3
            )


if __name__ == "__main__":
    unittest.main()
