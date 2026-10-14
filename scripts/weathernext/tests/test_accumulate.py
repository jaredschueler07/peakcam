"""Tests for per-member accumulation and window selection."""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

import numpy as np

from peakcam_weathernext.accumulate import _window_totals, compute_probabilities
from peakcam_weathernext.types import (
    EnsemblePointSeries,
    ResortPoint,
    first_issuable_hour,
)

INIT = datetime(2026, 1, 1, 0, tzinfo=timezone.utc)
POINT = ResortPoint(slug="test-resort", lat=39.5, lng=-106.0, elev_m=2500.0)
HEAVY = 0.005  # metres/hour; cold SLR makes ~3.7 in of snow per hour


def storm_series(precip: np.ndarray) -> EnsemblePointSeries:
    n_members, n_hours = precip.shape
    shape = (n_members, n_hours, 1)
    return EnsemblePointSeries(
        init_time=INIT,
        valid_times=tuple(INIT + timedelta(hours=h) for h in range(n_hours)),
        slugs=("test-resort",),
        member_ids=tuple(range(n_members)),
        precip_m=precip.reshape(shape).astype(np.float32),
        temp_2m=np.full(shape, 263.15, dtype=np.float32),
        dewpoint_2m=np.full(shape, 262.15, dtype=np.float32),
        grid_elev_m=(2500.0,),
    )


class AccumulationTest(unittest.TestCase):
    def test_first_issuable_hour_rounds_up_after_latency(self) -> None:
        self.assertEqual(
            first_issuable_hour(INIT), INIT + timedelta(hours=8)  # 7h45 latency
        )

    def test_member_totals_are_not_summed_hourly_percentiles(self) -> None:
        # Anti-correlated members: each totals 10 in, but summing the
        # per-hour p90s would claim 18 in. Per-member accumulation is law.
        hourly = np.array([[10.0, 0.0], [0.0, 10.0]])
        totals, valid = _window_totals(hourly, 0, 2)
        np.testing.assert_allclose(totals, [10.0, 10.0])
        self.assertTrue(np.all(valid))
        summed_hourly_p90 = float(np.percentile(hourly, 90, axis=0).sum())
        self.assertNotAlmostEqual(float(np.percentile(totals, 90)), summed_hourly_p90)

    def test_best_window_is_fixed_and_maximizes_p8(self) -> None:
        precip = np.zeros((2, 20))
        t0_idx = 8
        precip[:, t0_idx + 4 : t0_idx + 7] = HEAVY  # both members storm late
        result = compute_probabilities(
            storm_series(precip), POINT, window_hours=3, horizon_hours=7
        )
        self.assertEqual(result.next_window.valid_start, result.t0)
        self.assertEqual(result.next_window.p_ge[8.0], 0.0)
        self.assertEqual(result.best_window.valid_start, result.t0 + timedelta(hours=4))
        self.assertEqual(result.best_window.p_ge[8.0], 1.0)
        self.assertEqual(result.best_window.members_ge[8.0], 2)
        self.assertGreaterEqual(result.best_window.p_ge[6.0], result.best_window.p_ge[12.0])

    def test_probabilities_are_member_frequencies(self) -> None:
        precip = np.zeros((4, 20))
        precip[:1, 8:11] = HEAVY  # only member 0 reaches 8 in in next window
        result = compute_probabilities(
            storm_series(precip), POINT, window_hours=3, horizon_hours=7
        )
        self.assertEqual(result.next_window.p_ge[8.0], 0.25)
        self.assertEqual(result.next_window.percentiles_in[50], 0.0)

    def test_all_nan_member_is_excluded(self) -> None:
        precip = np.zeros((2, 20))
        precip[0, 8:11] = HEAVY
        precip[1, :] = np.nan
        result = compute_probabilities(
            storm_series(precip), POINT, window_hours=3, horizon_hours=7
        )
        self.assertEqual(result.next_window.n_valid, 1)
        self.assertEqual(result.next_window.p_ge[8.0], 1.0)
        self.assertFalse(result.next_window.degraded)  # 1 of 2 is exactly half

    def test_empty_ensemble_raises(self) -> None:
        shape = (0, 4, 1)
        series = EnsemblePointSeries(
            init_time=INIT,
            valid_times=tuple(INIT + timedelta(hours=h) for h in range(4)),
            slugs=("test-resort",),
            member_ids=(),
            precip_m=np.zeros(shape, dtype=np.float32),
            temp_2m=np.zeros(shape, dtype=np.float32),
            dewpoint_2m=np.zeros(shape, dtype=np.float32),
            grid_elev_m=(2500.0,),
        )
        with self.assertRaises(ValueError):
            compute_probabilities(series, POINT, window_hours=3, horizon_hours=7)

    def test_short_horizon_raises_instead_of_truncating_window(self) -> None:
        precip = np.zeros((1, 10))  # only 2 issuable hours after t0=init+8h
        with self.assertRaises(ValueError):
            compute_probabilities(
                storm_series(precip), POINT, window_hours=3, horizon_hours=7
            )


if __name__ == "__main__":
    unittest.main()
