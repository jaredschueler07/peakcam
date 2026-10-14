"""Shared data types for the Phase 0 powder-probability harness.

The adapter boundary is deliberately narrow: a source returns per-member
hourly values only (never percentiles or means). All snow derivation,
window, and probability logic lives in the harness, not the source.
Units are carried explicitly and validated; unknown units fail closed
because the real WeatherNext Zarr attrs cannot be inspected until
allowlist access exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

SUPPORTED_TEMP_UNIT = "K"
SUPPORTED_PRECIP_UNIT = "m"  # 1-hour total precipitation, metres liquid equivalent
LATENCY = timedelta(hours=7, minutes=45)  # WeatherNext dissemination delay


class WeatherNextNotAvailable(RuntimeError):
    """Raised when a requested model run is missing or incomplete."""


class WeatherNextAuthError(RuntimeError):
    """Raised on 401/403 from the upstream store."""


@dataclass(frozen=True)
class ResortPoint:
    slug: str
    lat: float
    lng: float  # [-180, 180) as in data/resorts.csv; sources convert to 0..360
    elev_m: float | None = None  # target elevation; required for lapse correction


@dataclass(frozen=True)
class EnsemblePointSeries:
    """Per-member hourly series for one or more points.

    Arrays are float32 with shape (n_members, n_hours, n_points).
    precip_m is 1-hour total precipitation in metres (not accumulated).
    """

    init_time: datetime
    valid_times: tuple[datetime, ...]
    slugs: tuple[str, ...]
    member_ids: tuple[int, ...]
    precip_m: np.ndarray
    temp_2m: np.ndarray
    dewpoint_2m: np.ndarray | None = None
    wind10m_ms: np.ndarray | None = None
    grid_elev_m: tuple[float, ...] | None = None  # per point, for lapse correction
    precip_variable: str = "total_precipitation_1hr"
    temp_unit: str = SUPPORTED_TEMP_UNIT
    precip_unit: str = SUPPORTED_PRECIP_UNIT

    def validate(self) -> None:
        """Fail closed on any shape, ordering, or unit problem."""
        if self.temp_unit != SUPPORTED_TEMP_UNIT:
            raise ValueError(f"unsupported temperature unit {self.temp_unit!r}; expected 'K'")
        if self.precip_unit != SUPPORTED_PRECIP_UNIT:
            raise ValueError(f"unsupported precipitation unit {self.precip_unit!r}; expected 'm'")
        if self.init_time.tzinfo is None:
            raise ValueError("init_time must be timezone-aware (UTC)")
        if not self.member_ids:
            raise ValueError("ensemble has no members")
        if not self.valid_times:
            raise ValueError("ensemble has no valid times")
        if not self.slugs:
            raise ValueError("ensemble has no points")
        expected = (len(self.member_ids), len(self.valid_times), len(self.slugs))
        for name, arr in (
            ("precip_m", self.precip_m),
            ("temp_2m", self.temp_2m),
            ("dewpoint_2m", self.dewpoint_2m),
            ("wind10m_ms", self.wind10m_ms),
        ):
            if arr is not None and arr.shape != expected:
                raise ValueError(f"{name} shape {arr.shape} != expected {expected}")
        for prev, cur in zip(self.valid_times, self.valid_times[1:]):
            if cur - prev != timedelta(hours=1):
                raise ValueError("valid_times must be hourly and strictly increasing")
        if self.grid_elev_m is not None and len(self.grid_elev_m) != len(self.slugs):
            raise ValueError("grid_elev_m must have one entry per point")


def first_issuable_hour(init_time: datetime, latency: timedelta = LATENCY) -> datetime:
    """First full valid hour at or after init + dissemination latency."""
    ready = init_time.astimezone(timezone.utc) + latency
    floored = ready.replace(minute=0, second=0, microsecond=0)
    return floored if floored == ready else floored + timedelta(hours=1)
