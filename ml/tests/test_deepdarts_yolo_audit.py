import tempfile
import unittest
from pathlib import Path

from darts180_vision.deepdarts_yolo_audit import (
    DatasetAuditError,
    audit_deepdarts_yolov8_export,
    parse_yolo_data_yaml,
)


class DeepDartsYoloAuditTests(unittest.TestCase):
    def test_parses_the_numeric_roboflow_class_map(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_yaml = Path(directory) / "data.yaml"
            data_yaml.write_text(
                "train: ../train/images\n"
                "val: ../valid/images\n"
                "test: ../test/images\n\n"
                "nc: 5\n"
                "names: ['0', '1', '2', '3', '4']\n",
                encoding="utf-8",
            )

            spec = parse_yolo_data_yaml(data_yaml)

            self.assertEqual(spec.class_count, 5)
            self.assertEqual(spec.names, ("0", "1", "2", "3", "4"))
            self.assertEqual(spec.declared_split_paths["train"], "../train/images")

    def test_parses_an_indented_names_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_yaml = Path(directory) / "data.yaml"
            data_yaml.write_text(
                "nc: 2\nnames:\n  0: dart\n  1: calibration\nroboflow:\n  project: sample\n",
                encoding="utf-8",
            )

            spec = parse_yolo_data_yaml(data_yaml)

            self.assertEqual(spec.names, ("dart", "calibration"))

    def test_rejects_a_class_count_that_disagrees_with_names(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_yaml = Path(directory) / "data.yaml"
            data_yaml.write_text("nc: 5\nnames: ['0', '1']\n", encoding="utf-8")

            with self.assertRaises(DatasetAuditError):
                parse_yolo_data_yaml(data_yaml)

    def test_audits_pairs_class_counts_and_provisional_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "deepdarts-v2"
            self._write_data_yaml(root)
            self._write_pair(
                root,
                "train",
                "frame-01",
                "0 0.50 0.50 0.02 0.02\n"
                "1 0.50 0.10 0.02 0.02\n"
                "2 0.50 0.90 0.02 0.02\n"
                "3 0.10 0.50 0.02 0.02\n"
                "4 0.90 0.50 0.02 0.02\n",
            )
            self._write_pair(root, "valid", "frame-02", "0 0.25 0.25 0.02 0.02\n")
            image_without_label = root / "test" / "images" / "unlabeled.jpg"
            image_without_label.parent.mkdir(parents=True, exist_ok=True)
            image_without_label.write_bytes(b"unlabeled")
            orphan_label = root / "test" / "labels" / "orphan.txt"
            orphan_label.parent.mkdir(parents=True, exist_ok=True)
            orphan_label.write_text("0 0.25 0.25 0.02 0.02\n", encoding="utf-8")

            report = audit_deepdarts_yolov8_export(root)

            self.assertTrue(report["deepDartsCandidate"]["numericExportShapeMatchesExpected"])
            self.assertEqual(
                report["deepDartsCandidate"]["mappingStatus"], "requires-visual-confirmation"
            )
            self.assertEqual(
                report["splits"]["train"]["annotationCountByClassId"],
                {
                    "0": 1,
                    "1": 1,
                    "2": 1,
                    "3": 1,
                    "4": 1,
                },
            )
            self.assertEqual(
                report["splits"]["train"]["framesWithDartAndAllFourCalibrationAnchors"], 1
            )
            self.assertEqual(
                report["splits"]["train"]["representativePairsWithAllDeclaredClasses"],
                [
                    {
                        "imagePath": "train/images/frame-01.jpg",
                        "labelPath": "train/labels/frame-01.txt",
                    }
                ],
            )
            self.assertEqual(report["aggregate"]["framesWithDartAndAllFourCalibrationAnchors"], 1)
            self.assertEqual(report["labelIntegrity"]["byKind"]["image-without-label-file"], 1)
            self.assertEqual(report["labelIntegrity"]["byKind"]["orphan-label-file"], 1)
            self.assertFalse(report["releaseSafety"]["productionReady"])

    def test_rejects_ambiguous_image_stems_in_one_split(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "deepdarts-v2"
            self._write_data_yaml(root)
            self._write_pair(root, "train", "same-name", "0 0.50 0.50 0.02 0.02\n")
            (root / "train" / "images" / "same-name.png").write_bytes(b"another-format")

            with self.assertRaises(DatasetAuditError):
                audit_deepdarts_yolov8_export(root)

    def test_reports_bad_label_rows_and_exact_cross_split_duplicates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "deepdarts-v2"
            self._write_data_yaml(root)
            self._write_pair(
                root,
                "train",
                "same-content",
                "0 0.50 0.50 0.02 0.02\n"
                "1 0.50 0.50 0.02\n"
                "9 0.50 0.50 0.02 0.02\n"
                "2 1.10 0.50 0.02 0.02\n",
                image_bytes=b"exactly-the-same-image-bytes",
            )
            self._write_pair(
                root,
                "valid",
                "also-same-content",
                "0 0.50 0.50 0.02 0.02\n",
                image_bytes=b"exactly-the-same-image-bytes",
            )

            report = audit_deepdarts_yolov8_export(root, hash_images=True)

            self.assertEqual(report["labelIntegrity"]["byKind"]["malformed-label-row"], 1)
            self.assertEqual(report["labelIntegrity"]["byKind"]["class-id-out-of-range"], 1)
            self.assertEqual(report["labelIntegrity"]["byKind"]["box-value-out-of-range"], 1)
            duplicate_groups = report["crossSplit"]["exactImageBytes"]["crossSplitDuplicateGroups"]
            self.assertEqual(len(duplicate_groups), 1)
            self.assertEqual(
                {item["split"] for item in duplicate_groups[0]["files"]}, {"train", "valid"}
            )

    @staticmethod
    def _write_data_yaml(root: Path) -> None:
        root.mkdir(parents=True, exist_ok=True)
        (root / "data.yaml").write_text(
            "train: ../train/images\n"
            "val: ../valid/images\n"
            "test: ../test/images\n\n"
            "nc: 5\n"
            "names: ['0', '1', '2', '3', '4']\n",
            encoding="utf-8",
        )

    @staticmethod
    def _write_pair(
        root: Path,
        split: str,
        stem: str,
        labels: str,
        *,
        image_bytes: bytes = b"not-a-real-image-but-sufficient-for-a-structure-audit",
    ) -> None:
        image_path = root / split / "images" / f"{stem}.jpg"
        label_path = root / split / "labels" / f"{stem}.txt"
        image_path.parent.mkdir(parents=True, exist_ok=True)
        label_path.parent.mkdir(parents=True, exist_ok=True)
        image_path.write_bytes(image_bytes)
        label_path.write_text(labels, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
