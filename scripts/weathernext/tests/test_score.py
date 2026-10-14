"""Tests for Brier score, skill, and reliability bins."""

from __future__ import annotations

import unittest

import numpy as np

from peakcam_weathernext.score import (
    brier_score,
    brier_skill_score,
    expected_calibration_error,
    reliability_bins,
)


class ScoreTest(unittest.TestCase):
    def test_brier_known_example(self) -> None:
        p = np.array([1.0, 0.0, 0.5])
        y = np.array([1.0, 0.0, 1.0])
        self.assertAlmostEqual(brier_score(p, y), 0.25 / 3.0)

    def test_perfect_forecast_scores_zero(self) -> None:
        y = np.array([1.0, 0.0, 1.0, 0.0])
        self.assertEqual(brier_score(y, y), 0.0)
        self.assertEqual(brier_skill_score(y, y), 1.0)

    def test_climatology_forecast_has_zero_skill(self) -> None:
        y = np.array([1.0, 0.0, 1.0, 0.0])
        p = np.full_like(y, 0.5)
        self.assertAlmostEqual(brier_skill_score(p, y), 0.0)

    def test_reliability_bins_and_ece(self) -> None:
        p = np.array([0.05, 0.05, 0.95, 0.95])
        y = np.array([0.0, 0.0, 1.0, 1.0])
        bins = reliability_bins(p, y)
        self.assertEqual(len(bins), 10)
        self.assertEqual(bins[0].n, 2)
        self.assertEqual(bins[0].observed_frequency, 0.0)
        self.assertEqual(bins[9].n, 2)
        self.assertEqual(bins[9].observed_frequency, 1.0)
        self.assertEqual(bins[5].n, 0)
        self.assertIsNone(bins[5].mean_forecast)
        self.assertAlmostEqual(expected_calibration_error(p, y), 0.05)

    def test_invalid_inputs_raise(self) -> None:
        with self.assertRaises(ValueError):
            brier_score(np.array([]), np.array([]))
        with self.assertRaises(ValueError):
            brier_score(np.array([1.2]), np.array([1.0]))
        with self.assertRaises(ValueError):
            brier_score(np.array([0.5]), np.array([2.0]))


if __name__ == "__main__":
    unittest.main()
