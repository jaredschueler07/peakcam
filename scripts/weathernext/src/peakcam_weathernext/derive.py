"""Hourly snow derivation: lapse correction, wet bulb, phase, SLR.

Known v1 simplifications (named, not hidden): phase uses surface wet
bulb only, so a warm layer aloft (sleet / freezing rain) is
misclassified as snow; SLR is keyed to surface wet bulb rather than
dendritic-growth-zone temperature; there is no in-window melt or
settling, which biases totals high against snow-depth-delta truth.
The SLR table is an unsourced v1 prior to be fitted per region during
calibration. Pressure-level fields exist in the full Zarr store and
are the v2 fix for the warm-layer error.
"""

from __future__ import annotations

import numpy as np

from .types import EnsemblePointSeries, ResortPoint

METHOD_VERSION = "wn3-powder-v1:tp=total_precipitation_1hr;phase=tw-linear(-0.5,1.5);slr=tw-table-v1;lapseT=6.5;lapseTd=1.8;best=fixed72-maxP8"

LAPSE_TEMP_C_PER_KM = 6.5
LAPSE_DEWPOINT_C_PER_KM = 1.8  # dewpoint lapses much slower than temperature
METRES_TO_INCHES = 39.3701

# (wet-bulb upper bound in C, snow:liquid ratio); above the last bound SLR is 0.
SLR_BANDS: tuple[tuple[float, float], ...] = (
    (-15.0, 22.0), (-10.0, 19.0), (-7.0, 16.0), (-4.0, 14.0), (-2.0, 12.0),
    (-1.0, 10.0), (0.0, 9.0), (1.0, 7.0), (1.5, 5.0),
)


def wet_bulb_c(temp_c: np.ndarray, dewpoint_c: np.ndarray) -> np.ndarray:
    """Wet-bulb temperature (Stull 2011); RH from dewpoint via Magnus."""
    rh = 100.0 * np.exp(
        (17.625 * dewpoint_c / (243.04 + dewpoint_c))
        - (17.625 * temp_c / (243.04 + temp_c))
    )
    rh = np.clip(rh, 0.0, 100.0)
    return (
        temp_c * np.arctan(0.151977 * np.sqrt(rh + 8.313659))
        + np.arctan(temp_c + rh)
        - np.arctan(rh - 1.676331)
        + 0.00391838 * rh**1.5 * np.arctan(0.023101 * rh)
        - 4.686035
    )


def snow_fraction(tw_c: np.ndarray) -> np.ndarray:
    """Snow share of precipitation: all snow at Tw<=-0.5C, all rain at >=+1.5C."""
    return np.clip((1.5 - tw_c) / 2.0, 0.0, 1.0)


def slr(tw_c: np.ndarray) -> np.ndarray:
    """Snow:liquid ratio from the v1 wet-bulb table."""
    bounds = np.array([b for b, _ in SLR_BANDS])
    values = np.array([v for _, v in SLR_BANDS] + [0.0])
    return values[np.searchsorted(bounds, tw_c, side="left")]


def lapse_adjust(
    values_c: np.ndarray, dz_m: float, lapse_c_per_km: float
) -> np.ndarray:
    """Adjust a temperature-like field from grid elevation to target elevation."""
    return values_c - lapse_c_per_km * dz_m / 1000.0


def hourly_snow_inches(
    series: EnsemblePointSeries,
    point: ResortPoint,
    point_index: int,
) -> np.ndarray:
    """Hourly snowfall in inches, shape (n_members, n_hours), for one point.

    Fails closed: dewpoint is required (wet bulb cannot be derived from
    temperature alone), and lapse correction requires both the target
    elevation and the grid-cell elevation.
    """
    series.validate()
    if series.dewpoint_2m is None:
        raise ValueError("dewpoint_2m is required for wet-bulb phase; refusing T-only fallback")
    if point.elev_m is None or series.grid_elev_m is None:
        raise ValueError("target and grid elevations are required for lapse correction")
    dz_m = point.elev_m - series.grid_elev_m[point_index]
    temp_c = series.temp_2m[:, :, point_index].astype(np.float64) - 273.15
    dew_c = series.dewpoint_2m[:, :, point_index].astype(np.float64) - 273.15
    temp_c = lapse_adjust(temp_c, dz_m, LAPSE_TEMP_C_PER_KM)
    dew_c = lapse_adjust(dew_c, dz_m, LAPSE_DEWPOINT_C_PER_KM)
    dew_c = np.minimum(dew_c, temp_c)
    tw = wet_bulb_c(temp_c, dew_c)
    precip_m = np.maximum(series.precip_m[:, :, point_index].astype(np.float64), 0.0)
    return precip_m * METRES_TO_INCHES * snow_fraction(tw) * slr(tw)
