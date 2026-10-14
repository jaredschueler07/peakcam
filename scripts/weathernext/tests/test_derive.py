"""Tests for hourly snow derivation (phase, SLR, lapse, fail-closed)."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

import numpy as np

from peakcam_weathernext.derive import (
    hourly_snow_inches,
    lapse_adjust,
    slr,
    snow_fraction,
    wet_bulb_c,
)
from peakcam_weathernext.types import EnsemblePointSeries, ResortPoint

INIT = datetime(2026, 1, 1, 0, tzinfo=timezone.utc)


def make_series(temp_k: float, dew_k: float | None, precip_m: float, n_hours: int = 4,
                grid_elev_m: float = 2500.0) -> EnsemblePointSeries:
    shape = (1, n_hours, 1)
    return EnsemblePointSeries(
        init_time=INIT,
        valid_times=tuple(INIT + timedelta(hours=h) for h in range(n_hours)),
        slugs=("test-resort",),
        member_ids=(0,),
        precip_m=np.full(shape, precip_m, dtype=np.float32),
        temp_2m=np.full(shape, temp_k, dtype=np.float32),
        dewpoint_2m=None if dew_k is None else np.full(shape, dew_k, dtype=np.float32),
        grid_elev_m=(grid_elev_m,),
    )


POINT = ResortPoint(slug="test-resort", lat=39.5, lng=-106.0, elev_m=2500.0)


class PhaseAndSlrTest(unittest.TestCase):
    def test_snow_fraction_bounds(self) -> None:
        tw = np.array([-5.0, -0.5, 0.5, 1.5, 5.0])
        np.testing.assert_allclose(snow_fraction(tw), [1.0, 1.0, 0.5, 0.0, 0.0])

    def test_slr_table(self) -> None:
        tw = np.array([-20.0, -12.0, -5.0, 0.0, 1.2, 3.0])
        np.testing.assert_allclose(slr(tw), [22.0, 19.0, 14.0, 9.0, 5.0, 0.0])

    def test_wet_bulb_below_temp_when_unsaturated(self) -> None:
        tw = wet_bulb_c(np.array([0.0]), np.array([-5.0]))
        self.assertLess(float(tw[0]), 0.0)
        saturated = wet_bulb_c(np.array([-5.0]), np.array([-5.0]))
        self.assertAlmostEqual(float(saturated[0]), -5.0, delta=0.6)

    def test_cold_hour_produces_snow(self) -> None:
        series = make_series(263.15, 262.15, 0.01)  # -10 C, 10 mm liquid
        snow = hourly_snow_inches(series, POINT, 0)
        self.assertTrue(np.all(snow > 5.0))  # ~0.39 in liquid at high SLR

    def test_warm_hour_produces_no_snow(self) -> None:
        series = make_series(283.15, 281.15, 0.01)  # +10 C rain
        snow = hourly_snow_inches(series, POINT, 0)
        np.testing.assert_allclose(snow, 0.0)

    def test_lapse_adjust_and_summit_snow(self) -> None:
        adjusted = lapse_adjust(np.array([2.0]), 1000.0, 6.5)
        self.assertAlmostEqual(float(adjusted[0]), -4.5)
        # +2 C at the grid cell is mostly rain there, but snow 1 km higher.
        series = make_series(275.15, 274.15, 0.01, grid_elev_m=2000.0)
        summit = ResortPoint(slug="test-resort", lat=39.5, lng=-106.0, elev_m=3000.0)
        snow = hourly_snow_inches(series, summit, 0)
        self.assertTrue(np.all(snow > 3.0))

    def test_missing_dewpoint_fails_closed(self) -> None:
        series = make_series(263.15, None, 0.01)
        with self.assertRaises(ValueError):
            hourly_snow_inches(series, POINT, 0)

    def test_missing_elevation_fails_closed(self) -> None:
        series = make_series(263.15, 262.15, 0.01)
        no_elev = ResortPoint(slug="test-resort", lat=39.5, lng=-106.0, elev_m=None)
        with self.assertRaises(ValueError):
            hourly_snow_inches(series, no_elev, 0)

    def test_unexpected_units_fail_closed(self) -> None:
        series = make_series(263.15, 262.15, 0.01)
        bad = EnsemblePointSeries(
            init_time=series.init_time, valid_times=series.valid_times,
            slugs=series.slugs, member_ids=series.member_ids,
            precip_m=series.precip_m, temp_2m=series.temp_2m,
            dewpoint_2m=series.dewpoint_2m, grid_elev_m=series.grid_elev_m,
            temp_unit="C",
        )
        with self.assertRaises(ValueError):
            hourly_snow_inches(bad, POINT, 0)


if __name__ == "__main__":
    unittest.main()
