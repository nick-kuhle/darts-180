"""Evaluation helpers. Aggregate accuracy alone is never an acceptable release metric."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class ScoredExample:
    truth: str
    prediction: str
    confidence: float
    device: str
    pose_band: str
    light_band: str
    wire_margin_band: str


@dataclass(frozen=True)
class AccuracySummary:
    total: int
    correct: int
    accuracy: float


def accuracy(examples: Iterable[ScoredExample]) -> AccuracySummary:
    rows = list(examples)
    correct = sum(row.truth == row.prediction for row in rows)
    return AccuracySummary(
        total=len(rows), correct=correct, accuracy=correct / len(rows) if rows else 0.0
    )


def stratified_accuracy(
    examples: Iterable[ScoredExample], field: str
) -> Mapping[str, AccuracySummary]:
    groups: dict[str, list[ScoredExample]] = defaultdict(list)
    for row in examples:
        groups[str(getattr(row, field))].append(row)
    return {key: accuracy(rows) for key, rows in sorted(groups.items())}


def auto_accept_precision(
    examples: Iterable[ScoredExample], threshold: float = 0.97
) -> AccuracySummary:
    """Precision among candidates the product would auto-accept, not general accuracy."""
    return accuracy(row for row in examples if row.confidence >= threshold)
