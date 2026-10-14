# PeakCam WeatherNext powder-probability harness (Phase 0)

Offline, self-contained Python project that turns per-member hourly
ensemble output (total precipitation, 2 m temperature and dewpoint)
into derived powder probabilities: P(snow >= 6/8/12 in) and p10-p90 of
snow totals for the next 72 h and the best fixed 72 h storm window in
7 days, plus Brier / reliability scoring against observed powder-day
booleans.

Phase 0 runs **without WeatherNext access** (allowlist pending). A
real Zarr reader later implements the same `WeatherNextSource`
protocol in `sources.py`; nothing else changes. The public widget
remains gated on SNOTEL calibration and a terms review — this harness
emits derived values only and never republishes raw ensemble data.

## Run

```bash
cd scripts/weathernext
uv sync                                   # creates .venv inside this dir
uv run peakcam-weathernext probabilities  # synthetic ensemble smoke run
uv run peakcam-weathernext probabilities --fixture examples/tiny_ensemble.json \
  --slug test-resort --window-hours 3 --horizon-hours 12
uv run peakcam-weathernext score --pairs pairs.json   # {"probabilities":[..],"outcomes":[..]}
```

## Test

```bash
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
```

## Method (v1, see `derive.METHOD_VERSION`)

- t0 = first full hour >= init + 7h45m dissemination latency; windows
  are anchored at t0, never at init or "now".
- Lapse: temperature 6.5 C/km, dewpoint 1.8 C/km (separate rates),
  dewpoint capped at temperature. Missing target/grid elevation or
  missing dewpoint fails closed.
- Phase from wet bulb (Stull 2011): all snow at Tw <= -0.5 C, all rain
  at Tw >= +1.5 C, linear between. SLR from a wet-bulb table (v1
  prior, to be fitted per region in calibration).
- Probabilities are per-member frequencies of accumulated totals.
  Per-hour percentile marginals are never summed.
- best_7d is ONE fixed sliding 72 h window maximizing P(>= 8 in),
  earliest on ties; its probabilities describe that window. The
  per-member any-window max is a separate diagnostic.

Known v1 simplifications: surface wet bulb only (warm layer aloft is
misclassified as snow), SLR keyed to surface rather than
dendritic-growth-zone temperature, no in-window melt/settling, fixed
lapse rates (fails in inversions). Precipitation variable assumed
`total_precipitation_1hr`; the choice among the model's precip
variables must be confirmed and is recorded in the method version.

## Fixture formats

JSON: `init_time`, `valid_times` (ISO 8601, hourly), `slugs`,
`member_ids`, and `(members, hours, points)` arrays `precip_m`,
`temp_2m_k`, `dewpoint_2m_k`, optional `wind10m_ms`, plus
`grid_elev_m` per point and optional `temp_unit`/`precip_unit`
(only `K` / `m` accepted — anything else fails closed, because real
Zarr attrs can only be verified after allowlist access).

CSV: one row per member/hour/point with columns `init_time`,
`valid_time`, `slug`, `member_id`, `precip_m`, `temp_2m_k`,
`dewpoint_2m_k`, `grid_elev_m`.
