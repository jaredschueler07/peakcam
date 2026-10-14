"""Tests for the offline ensemble sources (fixture + synthetic)."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from peakcam_weathernext.sources import FixtureSource, SyntheticSource
from peakcam_weathernext.types import ResortPoint, WeatherNextNotAvailable

INIT = datetime(2026, 1, 1, 0, tzinfo=timezone.utc)
POINT = ResortPoint(slug="test-resort", lat=39.5, lng=-106.0, elev_m=2500.0)


def tiny_doc() -> dict:
    n_hours = 12
    block = [[[0.001] for _ in range(n_hours)]]
    temps = [[[263.15] for _ in range(n_hours)]]
    dews = [[[262.15] for _ in range(n_hours)]]
    # JSON arrays are (members, hours, points); transpose the per-hour build.
    return {
        "init_time": "2026-01-01T00:00:00+00:00",
        "valid_times": [
            (INIT + timedelta(hours=h)).isoformat() for h in range(n_hours)
        ],
        "slugs": ["test-resort"],
        "member_ids": [0],
        "precip_m": [[[0.001] for _ in range(n_hours)]],
        "temp_2m_k": temps,
        "dewpoint_2m_k": dews if block else None,
        "grid_elev_m": [2500.0],
    }


class SourcesTest(unittest.TestCase):
    def test_json_fixture_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tiny.json"
            path.write_text(json.dumps(tiny_doc()), encoding="utf-8")
            source = FixtureSource(path)
            series = source.fetch_point_ensemble(init_time=INIT, points=[POINT])
            self.assertEqual(series.precip_m.shape, (1, 12, 1))
            self.assertEqual(series.member_ids, (0,))

    def test_fixture_wrong_init_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tiny.json"
            path.write_text(json.dumps(tiny_doc()), encoding="utf-8")
            source = FixtureSource(path)
            with self.assertRaises(WeatherNextNotAvailable):
                source.fetch_point_ensemble(
                    init_time=INIT + timedelta(hours=6), points=[POINT]
                )

    def test_csv_fixture_round_trip(self) -> None:
        lines = ["init_time,valid_time,slug,member_id,precip_m,temp_2m_k,dewpoint_2m_k,grid_elev_m"]
        for h in range(3):
            vt = (INIT + timedelta(hours=h)).isoformat()
            lines.append(f"{INIT.isoformat()},{vt},test-resort,0,0.001,263.15,262.15,2500")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tiny.csv"
            path.write_text("\n".join(lines), encoding="utf-8")
            source = FixtureSource(path)
            series = source.fetch_point_ensemble(init_time=INIT, points=[POINT])
            self.assertEqual(series.precip_m.shape, (1, 3, 1))
            self.assertEqual(series.grid_elev_m, (2500.0,))

    def test_synthetic_is_seeded_and_shaped(self) -> None:
        a = SyntheticSource(seed=7, n_members=4).fetch_point_ensemble(
            init_time=INIT, points=[POINT], horizon_hours=24
        )
        b = SyntheticSource(seed=7, n_members=4).fetch_point_ensemble(
            init_time=INIT, points=[POINT], horizon_hours=24
        )
        self.assertEqual(a.precip_m.shape, (4, 48, 1))
        self.assertTrue((a.precip_m == b.precip_m).all())

    def test_non_run_init_hour_rejected(self) -> None:
        with self.assertRaises(ValueError):
            SyntheticSource().fetch_point_ensemble(
                init_time=INIT + timedelta(hours=1), points=[POINT]
            )


if __name__ == "__main__":
    unittest.main()
