# Enhanced Snow Conditions System — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Branch:** `feat/map-overhaul` (or new branch TBD)

## Goal

Replace PeakCam's manually-set condition ratings with an automated system that fetches SNOTEL data, compares it against 30-year normals, detects trends, combines with NWS forecasts, and outputs: accurate current conditions, "% of normal" context, trend direction, and a forward-looking outlook label.

## Problem Statement

Today, `cond_rating` on the `resorts` table is manually set and never changes. Snow reports capture point-in-time base depth and new snow but provide no historical context. Users cannot tell whether 48" of base at Vail in March is exceptional or below average. There is no trend data, no outlook, and no data quality validation.

## Architecture

Three subsystems layered on the existing SNOTEL sync:

1. **Snowpack History** — Daily time-series of SWE + snow depth per resort, archived indefinitely (multi-year)
2. **SNOTEL Normals** — 30-year median SWE/depth by day-of-water-year per station, seeded from NRCS
3. **Conditions Engine** — Pure-function module that combines current readings + normals + NWS forecast → outputs condition rating, % of normal, trend, and outlook

### Data Flow

```
SNOTEL API (hourly cron)
    ↓
Data Quality Engine (validate, flag, clean)
    ↓
snowpack_daily table (append daily time-series)
    ↓
Conditions Engine
    ├── reads: snowpack_daily (current + 7d history)
    ├── reads: snotel_normals (30-year median for today's water-year day)
    ├── reads: NWS forecast (existing lib/weather.ts)
    ↓
snow_reports table (insert new row with all fields)
    ↓
resorts.cond_rating (auto-updated)
```

## Database Schema

### Migration Numbering Note

The existing migrations have a duplicate `004` (both `004_powder_alerts.sql` and `004_user_conditions.sql` exist). This spec uses `005_snowpack_history.sql`. Before applying, verify both `004` migrations have been applied to the target database.

### New Table: `snowpack_daily`

Stores one row per resort per day. Multi-year archive (~27k rows/year for 75 resorts).

The `station_id` column is denormalized metadata — a resort is assumed to map 1:1 to a SNOTEL station permanently. If a resort's station is ever reassigned, the old history remains valid (it reflects what was measured at the time). The primary key is `(resort_id, date)` because queries always filter by resort, not by station.

```sql
create table if not exists snowpack_daily (
  resort_id       uuid not null references resorts(id) on delete cascade,
  station_id      text not null,
  date            date not null,
  snow_depth_in   integer,
  swe_in          numeric(6,1),
  precip_accum_in numeric(6,1),
  temp_obs_f      integer,
  temp_max_f      integer,
  temp_min_f      integer,
  qc_flag         text not null default 'valid'
                  check (qc_flag in ('valid','suspect','missing','corrected')),
  created_at      timestamptz not null default now(),
  primary key (resort_id, date)
);
```

**No additional indexes needed.** The composite primary key `(resort_id, date)` creates a B-tree that covers the main query pattern: `WHERE resort_id = ? AND date >= ? ORDER BY date`.

**Sizing:** 75 resorts × 365 days × 5 years = ~137k rows. Trivial for Postgres. No partitioning needed.

### New Table: `snotel_normals`

30-year (1991-2020) median values by day-of-water-year. Seeded once, refreshed annually.

```sql
create table if not exists snotel_normals (
  station_id        text not null,
  day_of_water_year integer not null check (day_of_water_year between 1 and 366),
  median_swe_in     numeric(6,1),
  median_depth_in   integer,
  pctile_10_swe_in  numeric(6,1),
  pctile_90_swe_in  numeric(6,1),
  refreshed_at      timestamptz not null default now(),
  primary key (station_id, day_of_water_year)
);
```

**Sizing:** ~30 unique stations × 366 days = ~11k rows. Static lookup.

**Water year convention:** Day 1 = October 1. Day 93 = December 31. Day 183 = March 31.

### Modified Table: `snow_reports`

Add columns to the existing table. The `snow_reports` table is append-only (no unique constraint on `resort_id`). The sync script **inserts a new row** each run. The existing `latest_snow_reports` view uses `DISTINCT ON (resort_id)` to return only the most recent row per resort. All new columns are nullable — non-SNOTEL resorts (source = 'manual' or 'resort') will have these as `NULL`.

```sql
alter table snow_reports
  add column if not exists swe_in           numeric(6,1),
  add column if not exists pct_of_normal    integer,
  add column if not exists trend_7d         text check (trend_7d in ('rising','falling','stable')),
  add column if not exists outlook          text check (outlook in ('more_snow','stable','warming','melt_risk')),
  add column if not exists auto_cond_rating text check (auto_cond_rating in ('great','good','fair','poor'));
```

**Growth rate:** At hourly sync, the script inserts 1 row per SNOTEL-linked resort per run. With ~50 SNOTEL-linked resorts running hourly, that is ~1,200 rows/day or ~438k rows/year. This is still well within Postgres comfort zone, but consider reducing to every-6-hours for snow_reports inserts (SNOTEL data only updates daily; hourly inserts just for NWS forecast freshness may not warrant it). The `snowpack_daily` table handles daily archival separately.

**Recommendation:** Insert into `snow_reports` only when data has materially changed (new SNOTEL reading or significant forecast shift), not on every hourly tick. This reduces growth to ~75-150 rows/day.

### Updated View: `latest_snow_reports`

No change needed — the existing `DISTINCT ON` view automatically picks up the new columns.

### RLS Policies

Both new tables are read-only for the public (anon key), write via service role only — same pattern as existing tables.

```sql
alter table snowpack_daily enable row level security;
alter table snotel_normals enable row level security;

create policy "Public snowpack_daily read" on snowpack_daily for select using (true);
create policy "Public snotel_normals read" on snotel_normals for select using (true);
```

## Data Quality Engine

Applied during sync before writing to `snowpack_daily`. Implemented as pure functions in `lib/snow-quality.ts`.

| Check | Logic | Action |
|---|---|---|
| **Range check** | Snow depth > 300" or < 0, or SWE > 100" or < 0 | Set `qc_flag = 'suspect'`, carry forward previous day's value |
| **Spike detection** | Depth changes ±36" in 24 hours | Set `qc_flag = 'suspect'`, interpolate between previous and next valid reading |
| **Snow blockage** | Precip increment = 0 for 3+ consecutive days then sudden 10"+ spike | Set `qc_flag = 'corrected'`, redistribute spike across blocked days |
| **Missing data** | Null values returned from SNOTEL | Set `qc_flag = 'missing'`, carry forward previous day's value |
| **Negative new snow** | Snow depth decreased day-over-day (settlement or melt) | Clamp computed `new_snow` to 0, record actual depth as-is |
| **SWE/depth ratio** | SWE > snow depth (physically impossible) | Set `qc_flag = 'suspect'`, prefer SWE reading |

Functions:

```typescript
interface QualityResult {
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
  qcFlag: 'valid' | 'suspect' | 'missing' | 'corrected';
  notes: string | null; // human-readable reason for flag
}

function validateReading(
  current: RawSnotelReading,
  previous: SnowpackDaily | null,
): QualityResult;
```

## Conditions Engine

Pure-function module: `lib/conditions-engine.ts`. No side effects, no database calls. Takes data in, returns computed conditions out.

### Inputs

```typescript
interface ConditionsInput {
  current: {
    snowDepthIn: number | null;
    sweIn: number | null;
    newSnow24h: number;
    newSnow48h: number;
  };
  normals: {
    medianSweIn: number | null;
    pctile10SweIn: number | null;
    pctile90SweIn: number | null;
  };
  history7d: {
    sweValues: (number | null)[]; // last 7 days of SWE, oldest first
  };
  forecast: {
    snowInchesNext48h: number;   // sum of NWS estimated snow next 2 days
    maxHighTemp48h: number;      // highest high temp in next 2 days (single value)
  };
}
```

### Outputs

```typescript
interface ConditionsOutput {
  condRating: 'great' | 'good' | 'fair' | 'poor';
  pctOfNormal: number | null;        // e.g. 115 means 115% of median
  trend7d: 'rising' | 'falling' | 'stable';
  outlook: 'more_snow' | 'stable' | 'warming' | 'melt_risk';
  outlookLabel: string;              // human-readable, e.g. "More snow expected"
}
```

### Condition Rating Rules (Skier-Experience Focus)

Evaluated top-to-bottom, first match wins. Thresholds are initial values subject to calibration — they should be defined as a config object for easy adjustment.

```typescript
const RATING_THRESHOLDS = {
  great: { newSnow24h: 6, newSnow48h: 12 },
  good:  { newSnow24h: 2, pctOfNormal: 100, minDepth: 24 },
  fair:  { pctOfNormal: 70, minDepth: 20 },
} as const;
```

| Rating | Rule |
|---|---|
| **Great** | `newSnow24h >= 6` OR `newSnow48h >= 12` |
| **Good** | `newSnow24h >= 2` OR (`pctOfNormal >= 100` AND `snowDepthIn >= 24`) |
| **Fair** | `snowDepthIn >= 20` AND (`pctOfNormal >= 70` OR `pctOfNormal` is null) |
| **Poor** | Everything else (thin base, well below normal, no new snow) |

The "Fair" rule now uses 70% (not 80%) and allows null `pctOfNormal` (for resorts without normals data). A resort with 60" of base and 95% of normal correctly falls into "Good" via the depth+pctOfNormal rule.

### Percent of Normal

```
pctOfNormal = (currentSweIn / medianSweIn) * 100
```

Returns `null` if either value is missing. Rounded to nearest integer.

### Trend Calculation

Compare current SWE to SWE from 7 days ago:

| Delta (inches) | Trend |
|---|---|
| > +0.5 | `rising` |
| < -0.5 | `falling` |
| else | `stable` |

If insufficient history (<3 days of data), default to `stable`.

### Outlook Rules

The `forecast.maxHighTemp48h` is a single number (max high across the next 48 hours). The "2+ days at 40°F" rule is simplified to just "max high ≥ 40°F" since the forecast interface provides a single value.

| Outlook | Rule |
|---|---|
| `more_snow` | `forecast.snowInchesNext48h >= 3` |
| `melt_risk` | Trend is `falling` AND `forecast.maxHighTemp48h >= 40` |
| `warming` | `forecast.maxHighTemp48h >= 40` (but trend not falling) |
| `stable` | Everything else |

Evaluated top-to-bottom, first match wins.

### Outlook Label Generation

Simple templates that don't reference specific day names (the forecast interface doesn't provide granularity for that):

- `more_snow`: `"More snow expected — {snowInchesNext48h}\" in the forecast"`
- `melt_risk`: `"Warming trend — highs near {maxHighTemp48h}°F, base may soften"`
- `warming`: `"Mild temps ahead — highs near {maxHighTemp48h}°F"`
- `stable`: `"Steady conditions expected"`

### NWS Forecast Limitation

The existing `lib/weather.ts` uses `estimateSnow()` — a heuristic that returns rough values (8 for "heavy snow", 3 for "snow", 1 for "flurries"). This is imprecise for the `more_snow` threshold of 3". This is a known limitation accepted for V1. Future enhancement: use the NWS hourly/quantitative precipitation forecast endpoint for more accurate snow totals.

## Enhanced Sync Script

The sync script migrates from `snotel-sync.mjs` to `snotel-sync.ts`, run via `tsx` (TypeScript execute). This enables direct import of `lib/snow-quality.ts` and `lib/conditions-engine.ts` without duplicating logic.

**Package change:** Add `tsx` as a dev dependency. Update `package.json` script:
```json
"snotel-sync": "tsx scripts/snotel-sync.ts"
```

The old `.mjs` file is kept temporarily for reference, then deleted.

### Pipeline steps:

1. **Fetch resorts** with `snotel_station_id` from Supabase (existing)
2. **Fetch SNOTEL data** — now includes SNWD, WTEQ, PREC, TOBS, TMAX, TMIN (expanded)
3. **Run data quality checks** via `validateReading()` from `lib/snow-quality.ts` (new)
4. **Upsert to `snowpack_daily`** — on conflict `(resort_id, date)` do update (new)
5. **Look up normals** from `snotel_normals` for today's water-year day (new)
6. **Compute 7-day trend** from `snowpack_daily` history (new)
7. **Fetch NWS forecast snippet** — extract next-48h snow total and max high temp (new)
8. **Run Conditions Engine** → get rating, pctOfNormal, trend, outlook (new)
9. **Insert into `snow_reports`** with all existing + new fields, only if data changed (modified)
10. **Update `resorts.cond_rating`** with computed `auto_cond_rating` (new)

### Sync frequency

Run hourly via cron. SNOTEL updates daily but NWS forecasts change every 6 hours.

**Rate-limiting strategy:**
- SNOTEL API: 200ms pause between stations (existing)
- NWS API: 300ms pause between stations. NWS rate-limits at ~5 req/s. At 75 resorts × 2 NWS calls = 150 requests per run, this is well within limits.
- NWS forecasts are cached for 1 hour via `next: { revalidate: 3600 }` in `lib/weather.ts`. The sync script should reuse this cached data rather than making fresh calls when a recent fetch exists.

### Conditional snow_reports insert

To avoid unbounded growth, the script only inserts a new `snow_reports` row when:
- The SNOTEL base depth has changed from the last reported value, OR
- The computed `auto_cond_rating` has changed, OR
- It has been ≥6 hours since the last insert for this resort

This reduces writes from ~1,200/day to ~75-300/day.

## Normals Seed Script

New script: `scripts/seed-snotel-normals.ts` (TypeScript, run via `tsx`)

- Queries the NRCS AWDB REST API for each unique `snotel_station_id` across all resorts
- Fetches period-of-record daily WTEQ and SNWD data
- Computes median, 10th percentile, 90th percentile by day-of-water-year from the full historical record
- Writes to `snotel_normals` table
- Idempotent — safe to re-run (deletes existing rows for each station before inserting)

**API Note:** The exact NRCS AWDB endpoint and parameter names should be verified against current documentation at implementation time. The API has evolved over the years and parameter formats may differ from what is documented in older references.

### Run schedule
- Once at setup
- Once annually (October 1, start of water year) to incorporate the latest year's data

## Water Year Helper

Utility function in `lib/snow-quality.ts`. Correct implementation using actual month lengths:

```typescript
/** Convert a calendar date to day-of-water-year (Oct 1 = day 1, Sep 30 = day 366). */
export function dayOfWaterYear(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  // Water year starts Oct 1
  // If Oct-Dec, water year start is Oct 1 of current year
  // If Jan-Sep, water year start is Oct 1 of previous year
  const wyStart = month >= 9
    ? new Date(year, 9, 1)      // Oct 1 this year
    : new Date(year - 1, 9, 1); // Oct 1 last year

  const diffMs = date.getTime() - wyStart.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}
```

## TypeScript Types

Add to `lib/types.ts`:

```typescript
export type QCFlag = 'valid' | 'suspect' | 'missing' | 'corrected';
export type SnowTrend = 'rising' | 'falling' | 'stable';
export type SnowOutlook = 'more_snow' | 'stable' | 'warming' | 'melt_risk';

export interface SnowpackDaily {
  resort_id: string;
  station_id: string;
  date: string;
  snow_depth_in: number | null;
  swe_in: number | null;
  precip_accum_in: number | null;
  temp_obs_f: number | null;
  temp_max_f: number | null;
  temp_min_f: number | null;
  qc_flag: QCFlag;
}

export interface SnotelNormal {
  station_id: string;
  day_of_water_year: number;
  median_swe_in: number | null;
  median_depth_in: number | null;
  pctile_10_swe_in: number | null;
  pctile_90_swe_in: number | null;
}
```

Extend existing `SnowReport` interface with new fields:

```typescript
export interface SnowReport {
  // ... existing fields ...
  swe_in: number | null;
  pct_of_normal: number | null;
  trend_7d: SnowTrend | null;
  outlook: SnowOutlook | null;
  auto_cond_rating: ConditionRating | null;
}
```

**UI compatibility note:** All new fields are nullable. Frontend components that read `SnowReport` must handle `null` gracefully for all new fields. Non-SNOTEL resorts (source = 'manual' or 'resort') will always have these as `NULL`. UI changes are out of scope for this spec but should be noted as a dependency.

## File Structure

```
lib/
  snow-quality.ts       — CREATE — Data quality validation, water-year helper
  conditions-engine.ts  — CREATE — Pure conditions computation (rating, trend, outlook)
  types.ts              — MODIFY — Add new types (QCFlag, SnowTrend, SnowOutlook, etc.)
  snotel.ts             — MODIFY — Add SWE to fetched elements, export shared helpers

scripts/
  snotel-sync.ts        — CREATE — New TypeScript sync script (replaces .mjs)
  snotel-sync.mjs       — DELETE — Old JS sync script (after migration)
  seed-snotel-normals.ts — CREATE — One-time normals seeder

supabase/migrations/
  005_snowpack_history.sql — CREATE — New tables + snow_reports alterations

package.json            — MODIFY — Add tsx dev dependency, update snotel-sync script
```

## What This Does NOT Include

- UI changes (snow report page, resort detail, browse cards) — separate spec
- SNODAS gridded data integration — future enhancement
- USGS streamflow data — not needed for snow conditions
- Avalanche risk assessment — out of scope, liability concern
- Resort-reported data scraping — separate data source, not SNOTEL
