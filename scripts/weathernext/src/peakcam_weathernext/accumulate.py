"""Per-member accumulation into window totals and probabilities.

Probabilities are raw member frequencies (count / n_valid), never sums
of per-hour percentiles. Two windows are produced:

- next_72h: [t0, t0+72h) where t0 is the first issuable hour.
- best_7d: ONE fixed sliding 72h window inside [t0, t0+168h) chosen to
  maximize P(total >= 8in), earliest start on ties. Probabilities are
  computed for that fixed window, so they honestly describe it.

A per-member any-window diagnostic (each member's own max 72h total)
is reported separately as ``any_window``; it answers "did any 72h
stretch reach the threshold" and must not be paired with one window's
dates. A member with >10% missing hours in a window is excluded from
that window; ``degraded`` is set when fewer than half the members are
valid (member counts are read from the data, never assumed to be 64).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np

from .types import EnsemblePointSeries, ResortPoint, first_issuable_hour
from .derive import hourly_snow_inches

THRESHOLDS_IN = (6.0, 8.0, 12.0)
PERCENTILES = (10, 25, 50, 75, 90)
MAX_MISSING_FRACTION = 0.10


@dataclass(frozen=True)
class WindowResult:
    kind: str
    valid_start: datetime
    valid_end: datetime
    n_valid: int
    n_members: int
    degraded: bool
    p_ge: dict[float, float]  # threshold inches -> raw frequency
    members_ge: dict[float, int]
    percentiles_in: dict[int, float]
    mean_in: float


@dataclass(frozen=True)
class PowderProbabilities:
    slug: str
    init_time: datetime
    t0: datetime
    next_window: WindowResult
    best_window: WindowResult
    any_window: WindowResult  # diagnostic only; dates span the full horizon
    horizon_truncated: bool


def _window_totals(hourly: np.ndarray, start: int, length: int) -> tuple[np.ndarray, np.ndarray]:
    """Per-member totals over [start, start+length) plus a validity mask."""
    block = hourly[:, start : start + length]
    missing = np.isnan(block).sum(axis=1)
    valid = missing <= MAX_MISSING_FRACTION * block.shape[1]
    totals = np.nansum(block, axis=1)
    return totals, valid


def _summarize(
    kind: str,
    valid_start: datetime,
    length_h: int,
    totals: np.ndarray,
    valid: np.ndarray,
    n_members: int,
) -> WindowResult:
    kept = totals[valid]
    if kept.size == 0:
        raise ValueError(f"no valid members for window {kind}")
    members_ge = {thr: int((kept >= thr).sum()) for thr in THRESHOLDS_IN}
    return WindowResult(
        kind=kind,
        valid_start=valid_start,
        valid_end=valid_start + timedelta(hours=length_h),
        n_valid=int(kept.size),
        n_members=n_members,
        degraded=bool(kept.size < 0.5 * n_members),
        p_ge={thr: members_ge[thr] / kept.size for thr in THRESHOLDS_IN},
        members_ge=members_ge,
        percentiles_in={p: float(np.percentile(kept, p)) for p in PERCENTILES},
        mean_in=float(kept.mean()),
    )


def compute_probabilities(
    series: EnsemblePointSeries,
    point: ResortPoint,
    point_index: int = 0,
    window_hours: int = 72,
    horizon_hours: int = 168,
) -> PowderProbabilities:
    hourly = hourly_snow_inches(series, point, point_index)
    t0 = first_issuable_hour(series.init_time)
    if t0 < series.valid_times[0] or t0 > series.valid_times[-1]:
        raise ValueError("first issuable hour lies outside the series")
    start_idx = series.valid_times.index(t0)
    available = len(series.valid_times) - start_idx
    truncated = available < horizon_hours
    horizon = min(horizon_hours, available)
    if horizon < window_hours:
        raise ValueError(
            f"only {horizon} issuable hours available; need at least {window_hours}"
        )
    n_members = hourly.shape[0]

    totals, valid = _window_totals(hourly, start_idx, window_hours)
    next_window = _summarize("next_72h", t0, window_hours, totals, valid, n_members)

    # Fixed best window: maximize P(>=8in) over sliding windows, earliest on ties.
    best_offset, best_p8, best_pair = 0, -1.0, None
    member_max = np.full(n_members, np.nan)
    for offset in range(0, horizon - window_hours + 1):
        w_totals, w_valid = _window_totals(hourly, start_idx + offset, window_hours)
        member_max = np.fmax(member_max, np.where(w_valid, w_totals, np.nan))
        kept = w_totals[w_valid]
        p8 = float((kept >= 8.0).mean()) if kept.size else -1.0
        if p8 > best_p8:
            best_offset, best_p8, best_pair = offset, p8, (w_totals, w_valid)
    assert best_pair is not None
    best_window = _summarize(
        "best_7d", t0 + timedelta(hours=best_offset), window_hours,
        best_pair[0], best_pair[1], n_members,
    )
    any_valid = ~np.isnan(member_max)
    any_window = _summarize(
        "any_window_7d", t0, horizon, np.nan_to_num(member_max), any_valid, n_members
    )
    return PowderProbabilities(
        slug=point.slug,
        init_time=series.init_time,
        t0=t0,
        next_window=next_window,
        best_window=best_window,
        any_window=any_window,
        horizon_truncated=truncated,
    )
