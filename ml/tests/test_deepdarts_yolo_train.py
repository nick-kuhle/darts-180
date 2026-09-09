import json
import tempfile
import unittest
from pathlib import Path

from darts180_vision.deepdarts_yolo_train import (
    DevelopmentTrainingError,
    build_development_manifest,
    validate_audit_for_development_training,
    validate_dataset_provenance,
)


class DeepDartsYoloDevelopmentTrainingTests(unittest.TestCase):
    def test_builds_a_strict_review_only_browser_manifest_with_required_data_kind(self) -> None:
        manifest = build_development_manifest(
            model_version="deepdarts-local-dev-2026-09-08",
            model_sha256="a" * 64,
            output_tensor_name="output0",
            public_asset_path="/models/darts180-deepdarts-yolo-dev-v1.onnx",
            training_data_id="deepdarts-local-audit-001",
            training_data_kind="real-reviewed",
            license_review_id="deepdarts-ccby-review-001",
            trained_at="2026-09-08T12:00:00Z",
            image_size=640,
        )

        self.assertEqual(manifest["releaseStage"], "development")
        self.assertFalse(manifest["policy"].get("autoRecordEnabled", False))
        self.assertEqual(manifest["classMap"]["dartEntryPoint"], 0)
        self.assertEqual(manifest["classMap"]["calibration4"], 4)
        self.assertEqual(manifest["output"]["layout"], "yolov8-raw-cxcywh-class-scores")
        self.assertEqual(manifest["input"]["resizeMode"], "stretch")
        self.assertEqual(manifest["provenance"]["trainingDataKind"], "real-reviewed")

    def test_manifest_builder_rejects_remote_unsafe_paths_or_ambiguous_data_kind(self) -> None:
        kwargs = {
            "model_version": "dev",
            "model_sha256": "a" * 64,
            "output_tensor_name": "output0",
            "public_asset_path": "https://example.invalid/model.onnx",
            "training_data_id": "data",
            "training_data_kind": "real-reviewed",
            "license_review_id": "review",
            "trained_at": "2026-09-08T12:00:00Z",
            "image_size": 640,
        }
        with self.assertRaises(DevelopmentTrainingError):
            build_development_manifest(**kwargs)
        kwargs["public_asset_path"] = "/models/../model.onnx"
        with self.assertRaises(DevelopmentTrainingError):
            build_development_manifest(**kwargs)
        kwargs["public_asset_path"] = "/models/model.onnx"
        kwargs["training_data_kind"] = "real-world-validated"
        with self.assertRaisesRegex(DevelopmentTrainingError, "training_data_kind"):
            build_development_manifest(**kwargs)

    def test_synthetic_bootstrap_report_can_only_generate_a_synthetic_only_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "darts180-synthetic-fivepoint-bootstrap.json").write_text(
                json.dumps(
                    {
                        "syntheticProvenance": {
                            "consentVersion": "SYNTHETIC-NO-USER-DATA",
                            "admissionStatus": "synthetic-not-real-world-evaluation",
                            "realWorldEvaluationEligible": False,
                        }
                    }
                ),
                encoding="utf-8",
            )
            validate_dataset_provenance(root, "synthetic-only")
            with self.assertRaisesRegex(DevelopmentTrainingError, "synthetic-only development manifest"):
                validate_dataset_provenance(root, "real-reviewed")

    def test_synthetic_only_kind_requires_a_recognized_bootstrap_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(DevelopmentTrainingError, "requires the generated synthetic"):
                validate_dataset_provenance(Path(temporary), "synthetic-only")

    def test_training_gate_accepts_only_an_intact_reviewed_five_class_audit(self) -> None:
        report = {
            "metadata": {"dataYaml": {"names": ["0", "1", "2", "3", "4"]}},
            "deepDartsCandidate": {"numericExportShapeMatchesExpected": True},
            "aggregate": {"framesWithDartAndAllFourCalibrationAnchors": 1},
            "labelIntegrity": {"count": 0},
        }
        validate_audit_for_development_training(report)

        report["labelIntegrity"] = {"count": 1}
        with self.assertRaisesRegex(DevelopmentTrainingError, "label-integrity"):
            validate_audit_for_development_training(report)

        report["labelIntegrity"] = {"count": 0}
        report["metadata"] = {"dataYaml": {"names": ["dart", "cal1", "cal2", "cal3", "cal4"]}}
        with self.assertRaisesRegex(DevelopmentTrainingError, "numeric five-point class order"):
            validate_audit_for_development_training(report)


if __name__ == "__main__":
    unittest.main()
