"""Scoring of powder probabilities against observed outcomes.

Inputs are forecast probabilities and observed event booleans
(y = 1 when the observed window snowfall reached the threshold).
Scores treat probabilities as given: raw member frequencies and any
later calibrated probabilities are scored the same way, and the two
must never be conflated in storage.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def _paired(p: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    p = np.asarray(p, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    if p.shape != y.shape:
        raise ValueError("probabilities and outcomes must have the same shape")
    if p.size == 0:
        raise ValueError("no forecast/outcome pairs to score")
    if np.any((p < 0) | (p > 1)):
        raise ValueError("probabilities must lie in [0, 1]")
    if np.any((y != 0) & (y != 1)):
        raise ValueError("outcomes must be 0 or 1")
    return p, y


def brier_score(p: np.ndarray, y: np.ndarray) -> float:
    p, y = _paired(p, y)
    return float(np.mean((p - y) ** 2))


def climatology_brier(y: np.ndarray) -> float:
    """Brier score of always forecasting the sample base rate."""
    y = np.asarray(y, dtype=np.float64)
    if y.size == 0:
        raise ValueError("no outcomes")
    return float(np.mean((y.mean() - y) ** 2))


def brier_skill_score(p: np.ndarray, y: np.ndarray) -> float:
    """Skill vs climatology; >0 beats climatology. NaN if base rate is 0/1."""
    ref = climatology_brier(y)
    if ref == 0.0:
        return float("nan")
    return 1.0 - brier_score(p, y) / ref


@dataclass(frozen=True)
class ReliabilityBin:
    lo: float
    hi: float
    n: int
    mean_forecast: float | None
    observed_frequency: float | None


def reliability_bins(p: np.ndarray, y: np.ndarray, n_bins: int = 10) -> list[ReliabilityBin]:
    """Fixed equal-width bins [0,.1) ... [.9,1]; empty bins report n=0."""
    p, y = _paired(p, y)
    bins: list[ReliabilityBin] = []
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    idx = np.clip(np.digitize(p, edges[1:-1], right=False), 0, n_bins - 1)
    for b in range(n_bins):
        mask = idx == b
        n = int(mask.sum())
        bins.append(
            ReliabilityBin(
                lo=float(edges[b]),
                hi=float(edges[b + 1]),
                n=n,
                mean_forecast=float(p[mask].mean()) if n else None,
                observed_frequency=float(y[mask].mean()) if n else None,
            )
        )
    return bins


def expected_calibration_error(p: np.ndarray, y: np.ndarray, n_bins: int = 10) -> float:
    p, _ = _paired(p, y)
    total = 0.0
    for b in reliability_bins(p, y, n_bins):
        if b.n and b.mean_forecast is not None and b.observed_frequency is not None:
            total += (b.n / p.size) * abs(b.mean_forecast - b.observed_frequency)
    return float(total)
