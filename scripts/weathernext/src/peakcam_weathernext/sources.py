"""Ensemble input sources behind one protocol.

The real WeatherNext Zarr reader (post-allowlist) implements this same
protocol in a separate module; the harness never imports xarray, zarr,
or GCS clients. Two offline implementations ship now so derivation,
accumulation, scoring, and the CLI all run without WeatherNext access:

- FixtureSource: JSON or CSV files (formats documented in README.md).
- SyntheticSource: seeded random ensembles for smoke tests.

Sources return per-member values only and do no unit conversion, snow
derivation, or window logic. NaNs propagate; the harness fails closed.
"""

from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol, Sequence

import numpy as np

from .types import EnsemblePointSeries, ResortPoint, WeatherNextNotAvailable

VALID_INIT_HOURS = (0, 6, 12, 18)


class WeatherNextSource(Protocol):
    def latest_available_init(self, *, now: datetime) -> datetime | None: ...

    def fetch_point_ensemble(
        self,
        *,
        init_time: datetime,
        points: Sequence[ResortPoint],
        horizon_hours: int = 168,
    ) -> EnsemblePointSeries: ...


def _check_init(init_time: datetime) -> None:
    init_utc = init_time.astimezone(timezone.utc)
    if init_utc.hour not in VALID_INIT_HOURS or init_utc.minute or init_utc.second:
        raise ValueError("init_time must be a 00/06/12/18 UTC run")


def _parse_time(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


class FixtureSource:
    """Loads one ensemble from a JSON or CSV fixture file."""

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        self._series = self._load()

    def _load(self) -> EnsemblePointSeries:
        if self._path.suffix == ".json":
            return self._load_json()
        if self._path.suffix == ".csv":
            return self._load_csv()
        raise ValueError(f"unsupported fixture suffix {self._path.suffix!r}")

    def _load_json(self) -> EnsemblePointSeries:
        doc = json.loads(self._path.read_text(encoding="utf-8"))
        series = EnsemblePointSeries(
            init_time=_parse_time(doc["init_time"]),
            valid_times=tuple(_parse_time(t) for t in doc["valid_times"]),
            slugs=tuple(doc["slugs"]),
            member_ids=tuple(int(m) for m in doc["member_ids"]),
            precip_m=np.asarray(doc["precip_m"], dtype=np.float32),
            temp_2m=np.asarray(doc["temp_2m_k"], dtype=np.float32),
            dewpoint_2m=(
                np.asarray(doc["dewpoint_2m_k"], dtype=np.float32)
                if doc.get("dewpoint_2m_k") is not None else None
            ),
            wind10m_ms=(
                np.asarray(doc["wind10m_ms"], dtype=np.float32)
                if doc.get("wind10m_ms") is not None else None
            ),
            grid_elev_m=tuple(doc["grid_elev_m"]) if doc.get("grid_elev_m") else None,
            precip_variable=doc.get("precip_variable", "total_precipitation_1hr"),
            temp_unit=doc.get("temp_unit", "K"),
            precip_unit=doc.get("precip_unit", "m"),
        )
        series.validate()
        return series

    def _load_csv(self) -> EnsemblePointSeries:
        rows = list(csv.DictReader(self._path.read_text(encoding="utf-8").splitlines()))
        if not rows:
            raise ValueError("empty CSV fixture")
        init_time = _parse_time(rows[0]["init_time"])
        times = sorted({_parse_time(r["valid_time"]) for r in rows})
        slugs = sorted({r["slug"] for r in rows})
        members = sorted({int(r["member_id"]) for r in rows})
        shape = (len(members), len(times), len(slugs))
        precip = np.full(shape, np.nan, dtype=np.float32)
        temp = np.full(shape, np.nan, dtype=np.float32)
        dew = np.full(shape, np.nan, dtype=np.float32)
        grid_elev: dict[str, float] = {}
        t_idx = {t: i for i, t in enumerate(times)}
        for r in rows:
            mi, ti, si = members.index(int(r["member_id"])), t_idx[_parse_time(r["valid_time"])], slugs.index(r["slug"])
            precip[mi, ti, si] = float(r["precip_m"])
            temp[mi, ti, si] = float(r["temp_2m_k"])
            dew[mi, ti, si] = float(r["dewpoint_2m_k"]) if r.get("dewpoint_2m_k") else np.nan
            if r.get("grid_elev_m"):
                grid_elev[r["slug"]] = float(r["grid_elev_m"])
        series = EnsemblePointSeries(
            init_time=init_time,
            valid_times=tuple(times),
            slugs=tuple(slugs),
            member_ids=tuple(members),
            precip_m=precip,
            temp_2m=temp,
            dewpoint_2m=dew,
            grid_elev_m=tuple(grid_elev[s] for s in slugs) if grid_elev else None,
        )
        series.validate()
        return series

    def latest_available_init(self, *, now: datetime) -> datetime | None:
        return self._series.init_time

    def fetch_point_ensemble(
        self, *, init_time: datetime, points: Sequence[ResortPoint], horizon_hours: int = 168
    ) -> EnsemblePointSeries:
        _check_init(init_time)
        if init_time.astimezone(timezone.utc) != self._series.init_time.astimezone(timezone.utc):
            raise WeatherNextNotAvailable(f"fixture holds {self._series.init_time}, not {init_time}")
        wanted = [p.slug for p in points]
        missing = [s for s in wanted if s not in self._series.slugs]
        if missing:
            raise WeatherNextNotAvailable(f"fixture has no points for {missing}")
        return self._series


class SyntheticSource:
    """Seeded synthetic ensembles; deterministic for a given seed."""

    def __init__(self, seed: int = 0, n_members: int = 8) -> None:
        self._rng = np.random.default_rng(seed)
        self._n_members = n_members

    def latest_available_init(self, *, now: datetime) -> datetime | None:
        base = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        for back in range(0, 24):
            cand = base - timedelta(hours=back)
            if cand.hour in VALID_INIT_HOURS:
                return cand
        return None

    def fetch_point_ensemble(
        self, *, init_time: datetime, points: Sequence[ResortPoint], horizon_hours: int = 168
    ) -> EnsemblePointSeries:
        _check_init(init_time)
        n_hours = horizon_hours + 24  # headroom before the first issuable hour
        valid_times = tuple(
            init_time.astimezone(timezone.utc) + timedelta(hours=h) for h in range(n_hours)
        )
        shape = (self._n_members, n_hours, len(points))
        precip = (self._rng.random(shape) * 0.004).astype(np.float32)
        temp = (268.0 + self._rng.random(shape) * 6.0).astype(np.float32)
        dew = (temp - self._rng.random(shape) * 3.0).astype(np.float32)
        series = EnsemblePointSeries(
            init_time=init_time.astimezone(timezone.utc),
            valid_times=valid_times,
            slugs=tuple(p.slug for p in points),
            member_ids=tuple(range(self._n_members)),
            precip_m=precip,
            temp_2m=temp,
            dewpoint_2m=dew,
            grid_elev_m=tuple((p.elev_m or 2500.0) - 300.0 for p in points),
        )
        series.validate()
        return series
