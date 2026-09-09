"""Create a fully synthetic five-point YOLO bootstrap dataset outside the repository.

The renderer supplies known board geometry, simulated dart-tip locations, and the four fixed
calibration landmarks. This makes it useful for a *development bootstrap* only: the generated
train/validation/test partitions are all synthetic and must never be relabeled as real-device
validation or merged into a sacred real-world evaluation split.

No source image archive, model weight, browser artifact, network call, or hosted inference is used.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from collections.abc import Mapping
from pathlib import Path
from random import Random
from typing import Any
from uuid import uuid4

import cv2
import numpy as np

from .deepdarts_yolo_audit import DatasetAuditError, audit_deepdarts_yolov8_export
from .synthetic import generate_synthetic_scene

_REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
_IMAGE_WIDTH = 1280
_IMAGE_HEIGHT = 720
_POINT_BOX_WIDTH_FRACTION = 0.0304
_POINT_BOX_HEIGHT_FRACTION = 0.0307
_SYNTHETIC_PROFILE = 'procedural-simulated-dartboard-v1'
_CLASS_MAP = {
    'dartEntryPoint': 0,
    'calibration1': 1,
    'calibration2': 2,
    'calibration3': 3,
    'calibration4': 4,
}
# These are deliberately the exact source-compatible five-point landmarks used by the browser
# development scorer and the real-capture compiler—not visual screen-cardinal points.
_ANCHORS: tuple[tuple[int, str, tuple[float, float]], ...] = (
    (1, 'cal1', (-26.594, -167.907)),
    (2, 'cal2', (26.594, 167.907)),
    (3, 'cal3', (-167.907, 26.594)),
    (4, 'cal4', (167.907, -26.594)),
)


class SyntheticFivePointDatasetError(ValueError):
    """Raised when a local synthetic bootstrap dataset cannot be safely produced."""


def build_synthetic_five_point_dataset(
    output_directory: Path,
    *,
    count: int,
    seed: int = 20260908,
    overwrite: bool = False,
) -> dict[str, Any]:
    """Write a deterministic, fully synthetic numeric YOLO data set outside this repository.

    The output contains only generated JPEGs, standard YOLO point-sized boxes, aggregate provenance,
    and structural-audit metadata. It deliberately creates no Data Lab manifests because it must not
    be confused with consented real capture records.
    """
    if count < 3:
        raise SyntheticFivePointDatasetError(
            'count must be at least 3 so synthetic train, validation, and test partitions are non-empty.'
        )
    final_output = _resolve_output_directory(output_directory)
    if final_output.exists() and not overwrite:
        raise SyntheticFivePointDatasetError(
            'output_directory already exists; choose a new directory or pass --overwrite deliberately.'
        )

    split_by_index = _split_by_index(count)
    staging = final_output.parent / f'.{final_output.name}.staging-{uuid4().hex}'
    if staging.exists():
        raise SyntheticFivePointDatasetError(f'Unexpected staging directory exists: {staging.name}')

    try:
        report = _write_dataset(staging, final_output, split_by_index, seed)
        if final_output.exists():
            _remove_output_directory(final_output)
        staging.replace(final_output)
        return report
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def _resolve_output_directory(path: Path) -> Path:
    raw_path = path.expanduser()
    if raw_path.is_symlink():
        raise SyntheticFivePointDatasetError('output_directory must not be a symlink.')
    resolved = raw_path.resolve()
    if resolved == Path(resolved.anchor):
        raise SyntheticFivePointDatasetError('output_directory cannot be a filesystem root.')
    if resolved.is_relative_to(_REPOSITORY_ROOT):
        raise SyntheticFivePointDatasetError(
            'output_directory must be outside the Darts 180 repository so generated data cannot be committed.'
        )
    return resolved


def _remove_output_directory(path: Path) -> None:
    if path.is_symlink():
        raise SyntheticFivePointDatasetError('Refusing to overwrite a symlinked output_directory.')
    if path.is_dir():
        shutil.rmtree(path)
    elif path.is_file():
        path.unlink()
    else:
        raise SyntheticFivePointDatasetError(
            'output_directory exists but is neither a regular file nor directory.'
        )


def _split_by_index(count: int) -> dict[int, str]:
    """Allocate deterministic non-empty 70/15/15-style splits without session semantics."""
    train_count = max(1, round(count * 0.7))
    validation_count = max(1, round(count * 0.15))
    test_count = count - train_count - validation_count
    if test_count < 1:
        # `count >= 3`, but rounded small datasets need a transparent re-balance.
        excess = 1 - test_count
        train_count -= excess
        test_count = 1
    if train_count < 1 or validation_count < 1 or test_count < 1:
        raise SyntheticFivePointDatasetError('Could not allocate a non-empty synthetic split.')

    result: dict[int, str] = {}
    for index in range(count):
        if index < train_count:
            result[index] = 'train'
        elif index < train_count + validation_count:
            result[index] = 'val'
        else:
            result[index] = 'test'
    return result


def _write_dataset(
    staging: Path,
    final_output: Path,
    split_by_index: Mapping[int, str],
    seed: int,
) -> dict[str, Any]:
    for split in ('train', 'val', 'test'):
        (staging / split / 'images').mkdir(parents=True, exist_ok=True)
        (staging / split / 'labels').mkdir(parents=True, exist_ok=True)

    rng = Random(seed)
    split_counts = {'train': 0, 'val': 0, 'test': 0}
    label_counts = {class_name: 0 for class_name in _CLASS_MAP}
    records: list[dict[str, Any]] = []
    for index in sorted(split_by_index):
        split = split_by_index[index]
        image, sidecar = generate_synthetic_scene(rng, index)
        capture = _required_mapping(sidecar.get('capture'), 'synthetic capture')
        board = _required_mapping(sidecar.get('board'), 'synthetic board')
        darts = sidecar.get('darts')
        if not isinstance(darts, list) or not darts:
            raise SyntheticFivePointDatasetError('Each synthetic bootstrap scene must contain a simulated dart.')
        if capture.get('captureMode') != 'synthetic' or (
            capture.get('admissionStatus') != 'synthetic-not-real-world-evaluation'
        ):
            raise SyntheticFivePointDatasetError('Synthetic renderer provenance unexpectedly changed.')

        labels = [
            *_anchor_labels(board),
            *_dart_labels(darts),
        ]
        stem = f'synthetic_{index:05d}'
        image_path = staging / split / 'images' / f'{stem}.jpg'
        label_path = staging / split / 'labels' / f'{stem}.txt'
        if not cv2.imwrite(str(image_path), image, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            raise SyntheticFivePointDatasetError(f'Could not write {image_path}')
        label_path.write_text(
            '\n'.join(
                f'{class_id} {x_center:.8f} {y_center:.8f} {width:.8f} {height:.8f}'
                for class_id, x_center, y_center, width, height in labels
            )
            + '\n',
            encoding='utf-8',
        )
        split_counts[split] += 1
        for class_id, _x_center, _y_center, _width, _height in labels:
            label_counts[_class_name(class_id)] += 1
        records.append(
            {
                'syntheticId': capture.get('captureId'),
                'split': split,
                'image': image_path.relative_to(staging).as_posix(),
                'label': label_path.relative_to(staging).as_posix(),
            }
        )

    _write_data_yaml(staging, final_output)
    (staging / 'README.dataset.txt').write_text(
        'Darts 180 fully synthetic five-point development bootstrap.\n'
        'Renderer: procedural simulated dartboard/darts; no people, real captures, or external archive.\n'
        'Class IDs: 0=dart entry, 1=cal1, 2=cal2, 3=cal3, 4=cal4.\n'
        'All train/val/test scenes are synthetic. They are not real-world validation and cannot support '\
        'a production scoring claim.\n'
        'Keep generated data outside the repository; independently collect and hold out consented real throws.\n',
        encoding='utf-8',
    )

    try:
        audit = audit_deepdarts_yolov8_export(staging, hash_images=True)
    except DatasetAuditError as error:
        raise SyntheticFivePointDatasetError(
            f'The generated synthetic YOLO data failed its structural audit: {error}'
        ) from error
    _assert_structural_audit(audit, len(records))
    # The audit runs against an atomic staging directory. Do not preserve that random temporary name
    # in the final provenance report, where it would make otherwise reproducible metadata misleading.
    audit["datasetRootName"] = final_output.name

    report: dict[str, Any] = {
        'generationVersion': 1,
        'scope': (
            'fully synthetic five-point development bootstrap; no network, real-world evaluation, '
            'production approval, model install, or deployment'
        ),
        'syntheticProvenance': {
            'profile': _SYNTHETIC_PROFILE,
            'consentVersion': 'SYNTHETIC-NO-USER-DATA',
            'admissionStatus': 'synthetic-not-real-world-evaluation',
            'containsHumanCapture': False,
            'containsAiGeneratedWholeBoardPhotos': False,
            'realWorldEvaluationEligible': False,
        },
        'classMap': _CLASS_MAP,
        'seed': seed,
        'splitImageCounts': split_counts,
        'labelCounts': label_counts,
        'records': records,
        'structuralAudit': audit,
        'nextRequiredSteps': [
            'Use this only as a controlled synthetic pretraining/bootstrap experiment.',
            'Keep this synthetic validation/test partition separate from every real-world evaluation set.',
            'Collect consented real board/throw records and complete privacy, quality, provenance, and label review.',
            'Validate any candidate model against held-out real throws before making camera-scoring claims.',
        ],
    }
    (staging / 'darts180-synthetic-fivepoint-bootstrap.json').write_text(
        json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8'
    )
    return report


def _anchor_labels(board: Mapping[str, Any]) -> list[tuple[int, float, float, float, float]]:
    matrix_values = board.get('canonicalToImageHomography')
    if not isinstance(matrix_values, list) or len(matrix_values) != 9:
        raise SyntheticFivePointDatasetError('Synthetic board needs a 3×3 canonical-to-image homography.')
    try:
        matrix = np.asarray(matrix_values, dtype=np.float64).reshape(3, 3)
    except (TypeError, ValueError) as error:
        raise SyntheticFivePointDatasetError('Synthetic homography cannot be parsed.') from error
    if not np.all(np.isfinite(matrix)):
        raise SyntheticFivePointDatasetError('Synthetic homography must be finite.')

    labels: list[tuple[int, float, float, float, float]] = []
    for class_id, _identifier, (x_mm, y_mm) in _ANCHORS:
        # `synthetic.py` has a 640px canonical canvas, centered at 320px, at 1.55 px/mm.
        canonical = np.asarray([320 + x_mm * 1.55, 320 + y_mm * 1.55, 1.0])
        projected = matrix @ canonical
        if abs(projected[2]) < 1e-9:
            raise SyntheticFivePointDatasetError('Synthetic anchor projected to infinity.')
        labels.append(_point_box(class_id, projected[0] / projected[2], projected[1] / projected[2]))
    return labels


def _dart_labels(darts: list[Any]) -> list[tuple[int, float, float, float, float]]:
    labels: list[tuple[int, float, float, float, float]] = []
    for dart in darts:
        if not isinstance(dart, Mapping):
            raise SyntheticFivePointDatasetError('Synthetic dart label must be an object.')
        tip = dart.get('tipPixel')
        if (
            not isinstance(tip, list)
            or len(tip) != 2
            or not all(isinstance(value, (int, float)) for value in tip)
        ):
            raise SyntheticFivePointDatasetError('Synthetic dart needs a numeric [x, y] tip pixel.')
        labels.append(_point_box(0, float(tip[0]), float(tip[1])))
    return labels


def _point_box(class_id: int, x: float, y: float) -> tuple[int, float, float, float, float]:
    x_center = x / _IMAGE_WIDTH
    y_center = y / _IMAGE_HEIGHT
    if not np.isfinite(x_center) or not np.isfinite(y_center):
        raise SyntheticFivePointDatasetError('Synthetic point must project to finite image coordinates.')
    half_width = _POINT_BOX_WIDTH_FRACTION / 2
    half_height = _POINT_BOX_HEIGHT_FRACTION / 2
    if not (
        half_width <= x_center <= 1 - half_width and half_height <= y_center <= 1 - half_height
    ):
        raise SyntheticFivePointDatasetError(
            'Synthetic point box would extend outside the generated image; do not silently clamp its label.'
        )
    return (
        class_id,
        x_center,
        y_center,
        _POINT_BOX_WIDTH_FRACTION,
        _POINT_BOX_HEIGHT_FRACTION,
    )


def _class_name(class_id: int) -> str:
    for name, value in _CLASS_MAP.items():
        if value == class_id:
            return name
    raise SyntheticFivePointDatasetError(f'Unexpected synthetic class ID {class_id}.')


def _assert_structural_audit(audit: Mapping[str, Any], expected_images: int) -> None:
    integrity = audit.get('labelIntegrity')
    aggregate = audit.get('aggregate')
    cross_split = audit.get('crossSplit')
    if not isinstance(integrity, Mapping) or integrity.get('count') != 0:
        raise SyntheticFivePointDatasetError('Generated synthetic labels did not pass structural integrity.')
    if (
        not isinstance(aggregate, Mapping)
        or aggregate.get('pairedImageLabelCount') != expected_images
        or aggregate.get('framesWithDartAndAllFourCalibrationAnchors') != expected_images
    ):
        raise SyntheticFivePointDatasetError('Generated synthetic labels are missing required point classes.')
    if not isinstance(cross_split, Mapping):
        raise SyntheticFivePointDatasetError('Generated synthetic audit did not report cross-split checks.')
    duplicate_bytes = cross_split.get('exactImageBytes')
    if not isinstance(duplicate_bytes, Mapping) or duplicate_bytes.get('crossSplitDuplicateGroups'):
        raise SyntheticFivePointDatasetError('Generated synthetic data has duplicate image bytes across splits.')


def _write_data_yaml(staging: Path, final_output: Path) -> None:
    root_literal = json.dumps(str(final_output))
    (staging / 'data.yaml').write_text(
        f'path: {root_literal}\n'
        'train: train/images\n'
        'val: val/images\n'
        'test: test/images\n'
        'nc: 5\n'
        "names: ['0', '1', '2', '3', '4']\n",
        encoding='utf-8',
    )


def _required_mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise SyntheticFivePointDatasetError(f'{name} must be an object.')
    return value


def _cli() -> None:
    parser = argparse.ArgumentParser(
        description=(
            'Build a fully synthetic five-point YOLO bootstrap dataset outside the Darts 180 repository.'
        )
    )
    parser.add_argument(
        '--output-directory',
        type=Path,
        required=True,
        help='External output directory; generated JPEGs and labels must not be committed.',
    )
    parser.add_argument('--count', type=int, default=300)
    parser.add_argument('--seed', type=int, default=20260908)
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args()
    try:
        report = build_synthetic_five_point_dataset(
            args.output_directory,
            count=args.count,
            seed=args.seed,
            overwrite=args.overwrite,
        )
    except SyntheticFivePointDatasetError as error:
        raise SystemExit(f'Synthetic five-point dataset build failed: {error}') from error
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == '__main__':
    _cli()
