import importlib.util
import unittest
from pathlib import Path

_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "write_private_model_build_summary.py"
_SPEC = importlib.util.spec_from_file_location("private_model_build_summary", _SCRIPT_PATH)
assert _SPEC is not None and _SPEC.loader is not None
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)
build_private_model_build_summary = _MODULE.build_private_model_build_summary
PrivateModelBuildSummaryError = _MODULE.PrivateModelBuildSummaryError


class PrivateModelBuildSummaryTests(unittest.TestCase):
    def test_emits_only_aggregate_counts_and_development_model_identity(self) -> None:
        summary = build_private_model_build_summary(
            retrieval=_retrieval(),
            real_compilation=_real_compilation(),
            synthetic_bootstrap=_synthetic_bootstrap(),
            mixed_dataset=_mixed_dataset(),
            training_summary={"trainingDataKind": "mixed-synthetic-and-real"},
            development_manifest={
                "modelId": "darts180-deepdarts-yolo",
                "modelVersion": "darts180-mixed-dev-v1",
                "releaseStage": "development",
                "sha256": "a" * 64,
                "provenance": {"trainedAt": "2026-09-09T12:00:00Z"},
            },
        )

        self.assertEqual(summary["outcome"], "trained-development-artifact")
        self.assertEqual(summary["privateCaptureRetrieval"]["recordCount"], 16)
        self.assertEqual(summary["realCompilation"]["splitImageCounts"], {"train": 10, "val": 3, "test": 3})
        self.assertEqual(
            summary["mixedDataset"]["syntheticIncludedImageCounts"],
            {"train": 210, "val": 0, "test": 0},
        )
        self.assertTrue(summary["releaseSafety"]["mustRemainEditable"])
        self.assertFalse(summary["releaseSafety"]["productionReady"])
        self.assertEqual(summary["model"]["onnxSha256"], "a" * 64)

        rendered = repr(summary)
        self.assertNotIn("record_", rendered)
        self.assertNotIn("capture_", rendered)
        self.assertNotIn("/private/", rendered)
        self.assertNotIn("imagePath", rendered)

    def test_rejects_any_synthetic_evaluation_contamination(self) -> None:
        mixed = _mixed_dataset()
        mixed["mixedProvenance"]["evaluation"]["testContainsOnlyReviewedReal"] = False

        with self.assertRaisesRegex(PrivateModelBuildSummaryError, "test"):
            build_private_model_build_summary(
                retrieval=_retrieval(),
                real_compilation=_real_compilation(),
                synthetic_bootstrap=_synthetic_bootstrap(),
                mixed_dataset=mixed,
            )


def _retrieval() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "recordCount": 16,
        "assetCount": {"image": 16, "manifest": 16, "annotations": 16},
        "byteCount": {"image": 12_000_000, "manifest": 40_000, "annotations": 120_000},
    }


def _real_compilation() -> dict[str, object]:
    return {
        "compilationVersion": 1,
        "annotationMethod": "deepdarts-four-cardinal-homography-v1",
        "annotationProfile": "deepdarts-five-point-v1",
        "classMap": _class_map(),
        "splitImageCounts": {"train": 10, "val": 3, "test": 3},
        "splitSessionCounts": {"train": 1, "val": 1, "test": 1},
        "labelCounts": {
            "dartEntryPoint": 12,
            "cal1": 16,
            "cal2": 16,
            "cal3": 16,
            "cal4": 16,
        },
        "structuralAudit": {"labelIntegrity": {"count": 0}},
        "records": [{"captureId": "must-not-be-copied"}],
    }


def _synthetic_bootstrap() -> dict[str, object]:
    return {
        "syntheticProvenance": {
            "profile": "procedural-simulated-dartboard-v1",
            "containsHumanCapture": False,
            "containsAiGeneratedWholeBoardPhotos": False,
            "realWorldEvaluationEligible": False,
        },
        "splitImageCounts": {"train": 210, "val": 45, "test": 45},
        "labelCounts": {
            "dartEntryPoint": 589,
            "cal1": 300,
            "cal2": 300,
            "cal3": 300,
            "cal4": 300,
        },
        "structuralAudit": {"labelIntegrity": {"count": 0}},
    }


def _mixed_dataset() -> dict[str, object]:
    return {
        "mixingVersion": 1,
        "classMap": _class_map(),
        "splitImageCounts": {"train": 220, "val": 3, "test": 3},
        "labelCountsByClassId": {"0": 601, "1": 316, "2": 316, "3": 316, "4": 316},
        "mixedProvenance": {
            "trainingDataKind": "mixed-synthetic-and-real",
            "real": {"includedImageCounts": {"train": 10, "val": 3, "test": 3}},
            "synthetic": {
                "includedImageCounts": {"train": 210, "val": 0, "test": 0},
                "usedForTrainingOnly": True,
                "realWorldEvaluationEligible": False,
            },
            "evaluation": {
                "validationContainsOnlyReviewedReal": True,
                "testContainsOnlyReviewedReal": True,
                "productionReady": False,
            },
        },
        "structuralAudit": {
            "labelIntegrity": {"count": 0},
            "aggregate": {
                "annotationCount": 1_865,
                "framesWithAllFourCalibrationClasses": 226,
                "framesWithDartAndAllFourCalibrationAnchors": 220,
                "framesWithDartClass0": 220,
                "imageCount": 226,
                "imagesWithoutLabels": 0,
                "labelFileCount": 226,
                "labelsWithoutImages": 0,
                "pairedImageLabelCount": 226,
            },
        },
    }


def _class_map() -> dict[str, int]:
    return {
        "dartEntryPoint": 0,
        "calibration1": 1,
        "calibration2": 2,
        "calibration3": 3,
        "calibration4": 4,
    }


if __name__ == "__main__":
    unittest.main()
