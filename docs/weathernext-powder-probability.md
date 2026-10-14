# WeatherNext 3 powder probability

Status: **Phase 1 code only.** Migration 021, types, and a server read
function exist; nothing is applied to any database, no writer runs in
production, and no UI calls the reader. WeatherNext access is
allowlist-gated (application is separate), so no live WeatherNext
read is possible yet. The Phase 0 offline harness lives in
`scripts/weathernext/` and is the derivation reference for everything
below (`derive.METHOD_VERSION` is the version string the writer will
store).

## Product definition

For each resort and each WeatherNext 3 model run, PeakCam derives:

- `next_72h` — P(new snow ≥ 6 / 8 / 12 in) over `[t0, t0+72h)`, plus
  p10/p50/p90 (and p25/p75/mean) of the snow-total distribution.
  `t0` is the first full hour at or after init + ~7h45m dissemination
  latency — windows are anchored at `t0`, never at init or "now".
- `best_7d` — the same quantities for **one fixed** sliding 72-hour
  window inside `[t0, t0+168h)` chosen to maximize P(≥ 8 in),
  earliest start on ties. Its probabilities honestly describe that
  window's dates. (The harness also emits a per-member "any window"
  diagnostic; it is deliberately not stored, because it cannot be
  paired with one window's dates.)

Thresholds are 6 / 8 / 12 inches; 8 in is the site powder threshold
and the best-window selection metric. The eventual public widget is
**gated** (see Calibration gate): until the gate passes, rows are
service-role-only by RLS and `getPowderProbabilities()` in
`lib/supabase.ts` returns `null` for every resort.

Data shapes: `supabase/migrations/021_powder_probabilities.sql`
(table `powder_probabilities`, append-only, PK includes
`method_version` so reprocessing never destroys scored history;
view `latest_powder_probabilities`), mirrored by the
`PowderProbability*` types at the end of `lib/types.ts`.
Probabilities are stored as raw member frequencies with their counts
(`probability_kind = 'raw_frequency'`); a future calibrated variant
gets its own `probability_kind` / `calibration_version` rather than
silently replacing the frequencies.

## Derivation

WeatherNext 3 has **no snowfall variable**. The full 64-member GCS
Zarr store provides 1-hour total precipitation (metres, liquid
equivalent), 2 m temperature and dewpoint, and 10 m wind. Snow is
derived per member, per hour, in the harness (`derive.py`):

1. Nearest 0.1° grid cell to the target point. Lapse-correct
   temperature (6.5 °C/km) and dewpoint (1.8 °C/km, separate rate,
   capped at temperature) from grid-cell elevation to target
   elevation. Missing dewpoint or either elevation fails closed —
   there is no temperature-only phase fallback.
2. Wet bulb via Stull 2011 (RH from dewpoint, Magnus). Snow fraction
   is 1 at Tw ≤ −0.5 °C, 0 at Tw ≥ +1.5 °C, linear between.
3. Snow:liquid ratio from a wet-bulb table (v1 prior, to be fitted
   per region in calibration). Hourly snow inches =
   precip_m × 39.3701 × fraction × SLR.
4. Accumulate **per member** over each window (`accumulate.py`),
   then P(≥ threshold) = members over threshold / valid members.
   A member with > 10% missing hours in a window is excluded;
   `degraded` is set when fewer than half the members are valid.
   Member counts are read from the data, never assumed to be 64.

Hard rule: BigQuery / statistics-bucket percentiles are per-hour
marginals and must **never** be summed into storm totals. Only
per-member accumulations from the full Zarr store produce valid
probabilities.

Target point: calibration mode uses the SNOTEL station's
lat/lng/elevation (truth is co-located); publishing mode (later,
gated) uses the resort's mid-mountain elevation,
mean(base, summit), mirroring `scripts/model-sync.ts`. Publishing
is blocked per resort where elevations are missing (the CSV only
populates ~20/148); the harness fails closed per point instead of
guessing.

Known v1 simplifications, named rather than hidden: phase uses
surface wet bulb only, so a warm layer aloft (sleet / freezing rain)
is misclassified as snow; SLR is keyed to surface wet bulb rather
than dendritic-growth-zone temperature; no in-window melt or
settling (biases totals high against depth-delta truth); fixed lapse
rates fail during inversions; the SLR table is unsourced. The
precipitation variable is assumed `total_precipitation_1hr` (one of
three candidate 1 h precipitation variables) and is recorded in
`method_version`; it must be confirmed on first live access, along
with Zarr attribute units, chunk shapes, and grid orography. The
harness asserts units (`K` / `m`) at runtime and fails closed on
anything else.

## Calibration gate

Nothing becomes public until both halves pass:

1. **Skill vs SNOTEL.** Truth is `snowpack_daily` with the repo's QC
   (`lib/snow-quality.ts`) and positive snow-depth deltas
   (`scripts/snotel-sync.ts`); `score.py` computes Brier score,
   Brier skill vs climatology, ECE, and reliability bins. Suggested
   bar: BSS > 0 against **both** a new-snow climatology baseline
   (note: `snotel_normals` cannot serve — it holds SWE/depth levels,
   not new-snow increments) and a dressed Open-Meteo deterministic
   baseline, at 8 in / 72 h, per region, on a held-out season
   (leave-one-season-out; all fit parameters train-fold only).
   Caveats that must be settled first: SNOTEL daily timestamps
   cannot align exactly to an hourly `t0` (up to a day of slip), and
   hindcast coverage is only the 2024/2025 backfill, so high-
   threshold reliability may be underpowered.
2. **Terms review** (next section), including the open retention
   question for local raw intermediates.

Passing the gate is a separate small migration that swaps migration
021's deny-all policy for migration 020's public-read posture, plus
the widget itself. The widget, when built, carries its attribution
inside the card and links to `/methodology`; probability-based
alerts are a further separate step (their own dedupe kind and email
copy — they do not reuse the deterministic forecast branch).

## Terms and attribution duties

Real-time WeatherNext data is usable publicly only as a derived
**Value Added Service**: publish derived probabilities and totals
only, never republish raw per-member data. Duties for any public
surface: Google / WeatherNext attribution, an experimental /
not-an-official-forecast disclaimer, and the model run time shown
with the numbers. The harness CLI already emits that attribution
string with every result, and migration 021 stores only derived
values (member counts, frequencies, percentiles of derived totals).
The real-time Experimental ToS PDF itself still needs a direct read
during terms review, including whether indefinite local retention
of raw per-init intermediates on the compute host is permitted.

Cost note: the full Zarr bucket is Requester Pays in `us-east1`.
Read amplification for ~148 scattered points and egress cost per run
from a non-GCP host are unmeasured; measure on the first live run
before committing to a 4×/day cadence.

## Running it

Local (harness; the `.venv` lives inside the project dir):

```bash
cd scripts/weathernext
uv sync                                    # creates .venv here (gitignored)
uv run peakcam-weathernext probabilities   # synthetic smoke run
uv run peakcam-weathernext probabilities --fixture examples/tiny_ensemble.json \
  --slug test-resort --window-hours 3 --horizon-hours 12
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
```

Mac Studio (compute home; `ssh studio`, user `totcho_admin`).
Corrected tooling fact: the Studio **does** have uv and modern
Python via Homebrew — `/opt/homebrew/bin/uv` — but non-login ssh and
launchd get a minimal PATH (`/usr/bin/python3` is 3.9), so every
path in scripts/plists must be absolute. Never use the system
interpreter. Provision an isolated project dir (not inside either
`village` tree; the Studio has no peakcam checkout yet — whether
`scripts/weathernext/` is synced from the repo or the dir is
standalone is still an open owner decision):

```bash
ssh studio
mkdir -p ~/Code/peakcam-weathernext   # then sync scripts/weathernext/ into it
cd ~/Code/peakcam-weathernext
/opt/homebrew/bin/uv python install 3.12
/opt/homebrew/bin/uv venv --python 3.12 .venv
/opt/homebrew/bin/uv sync --locked
.venv/bin/python -m peakcam_weathernext probabilities   # synthetic smoke
```

The live reader (post-allowlist) drops in behind the existing
`WeatherNextSource` protocol in `sources.py` — xarray / zarr /
obstore get added to `pyproject.toml` then, not before. The future
launchd job (`com.peakcam.weathernext-sync`, absolute
`ProgramArguments` pointing at the project `.venv/bin/python`,
logs under `~/Library/Logs/peakcam-weathernext/`) should wake
hourly (`StartInterval=3600`) and gate in code on UTC: process the
newest init with `init + 8h <= now` not yet in its state file,
idempotently per init. Credential form (ADC vs service-account key,
billing project for the Requester Pays header) is blocked on the
allowlist grant; credential material is referenced by path from a
`chmod 700` config dir, never stored in the repo or printed to logs.
