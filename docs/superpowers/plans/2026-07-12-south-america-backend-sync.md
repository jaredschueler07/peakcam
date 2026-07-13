# South America Backend Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get real snow data, forecasts, and condition ratings flowing for ~19 South American ski resorts (Chile & Argentina), using the same tables and UI components North American resorts already use — no separate code path in the app.

**Architecture:** A new `scripts/model-sync.ts`, cloned from the proven `scripts/snotel-sync.ts` pattern, fetches Open-Meteo (free, keyless, global weather model) for every resort that has no SNOTEL station, runs the existing `computeConditions()` engine on the result, and writes to the same `snowpack_daily` / `snow_reports` / `resorts.cond_rating` tables SNOTEL resorts use. A new `lib/open-meteo.ts` module handles all Open-Meteo fetching, unit conversion, and shaping into the app's existing `WeatherPeriod`/`HourlyWeather` types so resort detail pages render forecasts identically regardless of data source.

**Tech Stack:** TypeScript, tsx (script runtime), Supabase Postgres (REST API via service-role key), Open-Meteo Forecast API (no key required), Next.js Server Components.

## Global Constraints

- Follow the existing hand-rolled `.env.local` loader pattern in every new script (copy the `loadEnv()` function verbatim from `scripts/snotel-sync.ts:39-54`) — this repo does not use `dotenv` in its scheduled scripts, by established convention.
- All Supabase writes from scripts use the service-role key via raw `fetch()` to the PostgREST REST API (`${SUPABASE_URL}/rest/v1/...`) — no `supabase-js` client in scripts, matching `snotel-sync.ts` and `pipeline-sync.ts`.
- Test files use Node's built-in `node:test` + `node:assert`, run via `npx tsx --test <file>` — this is the only test convention in the repo (see `lib/analytics-events.test.ts`). Do not introduce Jest/Vitest.
- New/changed `.ts` files inside `scripts/` import sibling `lib/` modules with an explicit `.js` extension (e.g. `from "../lib/conditions-engine.js"`) — matches `scripts/snotel-sync.ts`'s existing imports (NodeNext module resolution).
- Do not touch: `app/api/`, any file under `components/`, `POPULAR_SLUGS` or other copy/UI in `components/browse/BrowsePage.tsx`, or anything in `public/images/` — that scope was handed to a separate UI/copy workstream (Grok Code) working from `docs/superpowers/specs/2026-07-12-south-america-expansion-design.md` Section 6.
- Migrations in this repo are applied by hand (SQL Editor or the Supabase MCP `apply_migration` tool) — there is no Supabase CLI / `config.toml` in this project. Do not add one.

---

### Task 1: Migration 012 — `resorts.country`, extended `snow_reports.source`, cams dedup + unique constraint

**Files:**
- Create: `supabase/migrations/012_south_america.sql`

**Interfaces:**
- Produces: `resorts.country` (text, not null, default `'US'`), `snow_reports.source` check constraint now admits `'open_meteo'`, a new unique index `cams_resort_embed_url_idx` on `cams(resort_id, embed_url, name)` (name is part of the key — see Step 1 for why; NOT partial — see Step 1's note on why a `where embed_url is not null` predicate is both unnecessary and incompatible with PostgREST's `on_conflict=` upsert mechanism).

- [ ] **Step 1: Write the migration file**

```sql
-- ─────────────────────────────────────────────────────────────
-- Migration 012 — South America expansion
-- Adds resorts.country (for Chile/Argentina resorts fed by the
-- new model-sync pipeline instead of SNOTEL), extends
-- snow_reports.source to admit 'open_meteo', and fixes the cams
-- table's missing unique constraint (import-resorts-standalone.mjs
-- previously could duplicate cam rows on re-run).
-- ─────────────────────────────────────────────────────────────

-- ── resorts.country ──────────────────────────────────────────
alter table resorts add column if not exists country text not null default 'US';

update resorts set country = 'CA' where state = 'BC';

create index if not exists resorts_country_idx on resorts (country);

-- ── snow_reports.source — admit 'open_meteo' ─────────────────
alter table snow_reports drop constraint if exists snow_reports_source_check;

alter table snow_reports add constraint snow_reports_source_check
  check (source in ('snotel','manual','resort','pipeline','open_meteo'));

-- ── cams — dedupe then add a real unique constraint ──────────
-- import-resorts-standalone.mjs previously inserted with
-- `Prefer: resolution=ignore-duplicates` and no on_conflict target,
-- which is a no-op without a unique constraint — re-running the
-- importer duplicated every cam row. Dedupe first (keep the
-- earliest row per resort_id + embed_url + name), then add the
-- constraint.
--
-- The key includes `name`, not just (resort_id, embed_url), because
-- `embed_type='link'` cams intentionally share one embed_url across
-- multiple distinct named cams at the same resort (the "embed" is a
-- link-out to the resort's one general webcams page — e.g. Red River
-- Ski Area has "The Face" and "Town", different named cams, both
-- pointing at the same page). A key of (resort_id, embed_url) alone
-- would wrongly treat those as duplicates. Adding `name` still catches
-- the real bug (exact re-insert of the same cam row on importer re-run)
-- while allowing legitimately distinct link-out cams to coexist.

delete from cams a using cams b
  where a.resort_id = b.resort_id
    and a.embed_url = b.embed_url
    and a.name = b.name
    and a.embed_url is not null
    and (a.created_at > b.created_at
         or (a.created_at = b.created_at and a.id > b.id));

-- Not partial: PostgREST's on_conflict= query parameter only accepts a
-- plain column list, and Postgres's ON CONFLICT inference requires the
-- conflict target's predicate to syntactically match a partial index's
-- predicate exactly — a bare column list can never infer a partial
-- index, so any upsert through the REST API would fail with "no unique
-- or exclusion constraint matching the ON CONFLICT specification"
-- (verified against the live DB — see Task 8's note). No predicate is
-- needed anyway: Postgres never treats NULL as equal to another NULL
-- for uniqueness, so rows with embed_url IS NULL already coexist freely
-- under a plain unique index.
create unique index if not exists cams_resort_embed_url_idx
  on cams (resort_id, embed_url, name);
```

- [ ] **Step 2: Apply the migration**

Load the Supabase MCP tool: `ToolSearch({query: "select:mcp__claude_ai_Supabase__apply_migration,mcp__claude_ai_Supabase__list_tables"})`, then call `apply_migration` with `name: "012_south_america"` and the SQL from Step 1. If the MCP tool is unavailable in this environment, paste the same SQL into the Supabase Dashboard → SQL Editor and run it manually (this project's established practice — there is no CLI migration runner).

- [ ] **Step 3: Verify**

Run: `mcp__claude_ai_Supabase__list_tables` (or, via SQL Editor: `select column_name, data_type, column_default from information_schema.columns where table_name = 'resorts' and column_name = 'country';`)
Expected: one row showing `country | text | 'US'::text`.

Also run: `select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'snow_reports_source_check';`
Expected: definition includes `'open_meteo'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/012_south_america.sql
git commit -m "feat(db): migration 012 — country column, open_meteo source, cams unique constraint"
```

---

### Task 2: `lib/types.ts` — add `country` to `Resort`, extend `SnowReportSource`

**Files:**
- Modify: `lib/types.ts:8` and `lib/types.ts:11-28`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Resort.country: string`, `SnowReportSource` now includes `"pipeline" | "open_meteo"` (this also fixes an existing drift — the type was missing `"pipeline"`, which the DB has allowed since migration 010).

- [ ] **Step 1: Make the type changes**

In `lib/types.ts`, change line 8:

```typescript
export type SnowReportSource = "snotel" | "manual" | "resort" | "pipeline" | "open_meteo";
```

And in the `Resort` interface (after the `state` field, matching DB column order), add:

```typescript
export interface Resort {
  id: string;
  name: string;
  slug: string;
  state: string;
  country: string;         // "US" | "CA" | "CL" | "AR"
  region: string;
  lat: number;
  lng: number;
  website_url: string | null;
  cam_page_url: string | null;
  cond_rating: ConditionRating;
  snotel_station_id: string | null;
  x_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  is_active: boolean;
  created_at: string;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors. (If any component destructures `Resort` with an exhaustive object-literal type check that would break on an added field, it will show here — none are expected, since TS structural typing allows extra required fields to just need populating wherever a `Resort` is constructed, and the only place resorts are constructed in code is `lib/supabase.ts` query results, which use `select("*")` and will include `country` automatically once Task 1 lands.)

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add Resort.country, extend SnowReportSource with open_meteo"
```

---

### Task 3: `lib/conditions-engine.ts` — configurable trend threshold

**Files:**
- Modify: `lib/conditions-engine.ts:96-108` (`computeTrend`), `lib/conditions-engine.ts:32` (`ConditionsInput.history7d`), `lib/conditions-engine.ts:322` (`computeConditions`'s call site)
- Test: `lib/conditions-engine.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `computeTrend(sweValues: (number | null)[], thresholdIn?: number): SnowTrend` (default `0.5`, backward compatible). `ConditionsInput.history7d` gains optional `thresholdIn?: number`, threaded through `computeConditions()`.

Why: SA resorts have no SWE data from Open-Meteo, so `model-sync.ts` (Task 6) will feed *snow-depth* deltas into the same `sweValues` array param. Depth values swing by inches, not the fractional-inch SWE swings the default `0.5"` threshold was tuned for — without a larger threshold, every SA resort would show a `rising`/`falling` trend on essentially every run instead of `stable` for a flat week. This task makes the threshold configurable without touching any existing caller's behavior.

- [ ] **Step 1: Write the failing tests**

Create `lib/conditions-engine.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert";
import { computeTrend, computeConditions, type ConditionsInput } from "./conditions-engine";

test("computeTrend uses the default 0.5in threshold when none is passed", () => {
  assert.strictEqual(computeTrend([10, 10.3, 10.6]), "rising"); // delta 0.6 > 0.5
  assert.strictEqual(computeTrend([10, 10.2, 10.3]), "stable"); // delta 0.3 <= 0.5
});

test("computeTrend accepts a custom threshold", () => {
  // A 1.5in swing is "rising" under the default 0.5in threshold...
  assert.strictEqual(computeTrend([20, 21, 21.5]), "rising");
  // ...but "stable" under a 2.0in threshold meant for depth-series data.
  assert.strictEqual(computeTrend([20, 21, 21.5], 2.0), "stable");
});

test("computeTrend still requires 3+ valid values regardless of threshold", () => {
  assert.strictEqual(computeTrend([20, 30], 2.0), "stable");
  assert.strictEqual(computeTrend([null, null], 2.0), "stable");
});

test("computeConditions threads a custom history7d.thresholdIn through to trend7d", () => {
  const input: ConditionsInput = {
    current: { snowDepthIn: 40, sweIn: null, newSnow24h: 0, newSnow48h: 0 },
    normals: { medianSweIn: null, pctile10SweIn: null, pctile90SweIn: null },
    history7d: { sweValues: [38, 39, 40], thresholdIn: 5.0 }, // 2in swing, under a 5in threshold
    forecast: { snowInchesNext48h: 0, maxHighTemp48h: 30 },
  };
  const result = computeConditions(input);
  assert.strictEqual(result.trend7d, "stable");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test lib/conditions-engine.test.ts`
Expected: FAIL — `computeTrend` doesn't accept a second argument yet (TS compile error under tsx, or the extra arg is silently ignored and the "custom threshold" test fails on the assertion).

- [ ] **Step 3: Implement the change**

In `lib/conditions-engine.ts`, change `computeTrend` (around line 96):

```typescript
export function computeTrend(
  sweValues: (number | null)[],
  thresholdIn: number = TREND_THRESHOLD_IN,
): SnowTrend {
  // Need at least 3 days of data to determine a trend
  const valid = sweValues.filter((v): v is number => v != null);
  if (valid.length < 3) return "stable";

  const oldest = valid[0];
  const newest = valid[valid.length - 1];
  const delta = newest - oldest;

  if (delta > thresholdIn) return "rising";
  if (delta < -thresholdIn) return "falling";
  return "stable";
}
```

In the `ConditionsInput` interface (around line 32), extend `history7d`:

```typescript
history7d: {
  /** Last 7 days of SWE values, oldest first. May contain nulls. */
  sweValues: (number | null)[];
  /** Optional override for the rising/falling threshold (inches). Defaults to 0.5in, tuned for SWE. Pass a larger value (e.g. 2.0) when sweValues actually holds snow-depth data. */
  thresholdIn?: number;
};
```

In `computeConditions()` (around line 322), change the trend call:

```typescript
const trend7d = computeTrend(input.history7d.sweValues, input.history7d.thresholdIn);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/conditions-engine.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Regression-check existing callers are unaffected**

Run: `npx tsc --noEmit`
Expected: no errors. `scripts/snotel-sync.ts` and `lib/pipeline/blender.ts` both call `computeTrend(sweValues)` / build `ConditionsInput` without `thresholdIn` — the added parameter is optional, so both keep the existing `0.5in` SWE behavior unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/conditions-engine.ts lib/conditions-engine.test.ts
git commit -m "feat(engine): configurable trend threshold for non-SWE (depth-based) data sources"
```

---

### Task 4: `lib/open-meteo.ts` — typed fetcher, unit conversions, and forecast shaping

**Files:**
- Create: `lib/open-meteo.ts`
- Test: `lib/open-meteo.test.ts`

**Interfaces:**
- Consumes: `WeatherPeriod`, `HourlyWeather` from `./types`; `windChill` from `./weather` (reused, not duplicated).
- Produces:
  - `getOpenMeteoSnapshot(lat: number, lng: number, elevationFt?: number | null): Promise<OpenMeteoSnapshot | null>`
  - `getOpenMeteoForecast(lat: number, lng: number, elevationFt?: number | null): Promise<WeatherPeriod[] | null>`
  - `getOpenMeteoHourly(lat: number, lng: number, elevationFt?: number | null): Promise<HourlyWeather[] | null>`
  - `OpenMeteoSnapshot` type: `{ snowDepthIn: number | null; newSnow24hIn: number; newSnow48hIn: number; forecastSnow48hIn: number; maxHighTemp48hF: number; skyCoverAvg: number; windGustMaxMph: number; freezingLevelFt: number; tempF: number | null; snowingNow: boolean }`
  - Exported pure helpers (unit-tested directly): `cmToInches`, `metersToInches`, `metersToFeet`, `feetToMeters`, `celsiusToFahrenheit`, `kmhToMph`, `weatherCodeToCondition`, `weatherCodeToLabel`, `degreesToCompass`, `parseSnapshot`, `parseForecast`, `parseHourly`.
  - Task 6 (`model-sync.ts`) consumes all three `get*` functions and the `OpenMeteoSnapshot` shape above verbatim.

- [ ] **Step 1: Write the failing unit tests**

Create `lib/open-meteo.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert";
import {
  cmToInches,
  metersToInches,
  metersToFeet,
  feetToMeters,
  celsiusToFahrenheit,
  kmhToMph,
  weatherCodeToCondition,
  weatherCodeToLabel,
  degreesToCompass,
  parseSnapshot,
  parseForecast,
  parseHourly,
  type OpenMeteoResponse,
} from "./open-meteo";

// ── Unit conversions ──────────────────────────────────────────

test("cmToInches converts centimeters to inches", () => {
  assert.strictEqual(cmToInches(2.54), 1);
  assert.strictEqual(cmToInches(0), 0);
});

test("metersToInches and metersToFeet convert meters", () => {
  assert.ok(Math.abs(metersToInches(1) - 39.3701) < 0.001);
  assert.ok(Math.abs(metersToFeet(1) - 3.28084) < 0.001);
});

test("feetToMeters is the inverse of metersToFeet", () => {
  assert.ok(Math.abs(feetToMeters(metersToFeet(100)) - 100) < 0.01);
});

test("celsiusToFahrenheit converts known reference points", () => {
  assert.strictEqual(celsiusToFahrenheit(0), 32);
  assert.strictEqual(celsiusToFahrenheit(100), 212);
  assert.strictEqual(celsiusToFahrenheit(-40), -40);
});

test("kmhToMph converts km/h to mph", () => {
  assert.ok(Math.abs(kmhToMph(100) - 62.1371) < 0.001);
});

// ── Weather code mapping ──────────────────────────────────────

test("weatherCodeToCondition maps known WMO codes", () => {
  assert.strictEqual(weatherCodeToCondition(0), "clear");
  assert.strictEqual(weatherCodeToCondition(3), "cloudy");
  assert.strictEqual(weatherCodeToCondition(45), "fog");
  assert.strictEqual(weatherCodeToCondition(61), "rain");
  assert.strictEqual(weatherCodeToCondition(56), "freezing-rain");
  assert.strictEqual(weatherCodeToCondition(71), "light-snow");
  assert.strictEqual(weatherCodeToCondition(75), "heavy-snow");
});

test("weatherCodeToCondition falls back to partly-cloudy for unknown codes", () => {
  assert.strictEqual(weatherCodeToCondition(999), "partly-cloudy");
});

test("weatherCodeToLabel maps known codes to human labels", () => {
  assert.strictEqual(weatherCodeToLabel(0), "Clear");
  assert.strictEqual(weatherCodeToLabel(75), "Heavy Snow");
});

test("degreesToCompass maps compass points including wrap-around", () => {
  assert.strictEqual(degreesToCompass(0), "N");
  assert.strictEqual(degreesToCompass(90), "E");
  assert.strictEqual(degreesToCompass(180), "S");
  assert.strictEqual(degreesToCompass(270), "W");
  assert.strictEqual(degreesToCompass(45), "NE");
  assert.strictEqual(degreesToCompass(359), "N");
});

// ── Parsers, against a synthetic fixture ──────────────────────
// PAST_DAYS=2 → hourly index 48 is "now" (local midnight of today).
// Build 96 hourly entries (4 days) so every 48h window (past and
// future) is fully populated — a shorter fixture would silently
// under-count due to the parser's array-bounds guard.

function buildFixture(): OpenMeteoResponse {
  const hourlyTimes: string[] = [];
  const snowfall: number[] = [];
  const snowDepth: number[] = [];
  const temp: number[] = [];
  const windGust: number[] = [];
  const windSpeed: number[] = [];
  const windDir: number[] = [];
  const cloudCover: number[] = [];
  const freezingLevel: number[] = [];
  const weathercode: number[] = [];
  const precipProb: number[] = [];

  const start = new Date("2026-07-10T00:00:00");
  for (let i = 0; i < 96; i++) {
    const t = new Date(start.getTime() + i * 3600_000);
    hourlyTimes.push(t.toISOString().slice(0, 16));
    snowfall.push(1); // 1cm every hour → 24h window = 24cm, 48h window = 48cm
    snowDepth.push(0.5); // constant 0.5m depth (~19.7in) — snow_depth is in METERS, not cm
    temp.push(-5); // constant -5C (=23F)
    windGust.push(20); // constant 20km/h
    windSpeed.push(10);
    windDir.push(90); // due east
    cloudCover.push(40); // constant 40%
    freezingLevel.push(2000); // constant 2000m (~6562ft)
    weathercode.push(71); // light snow
    precipProb.push(60);
  }

  const dailyTimes = ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"];

  return {
    elevation: 2500,
    hourly: {
      time: hourlyTimes,
      snowfall,
      snow_depth: snowDepth,
      temperature_2m: temp,
      wind_gusts_10m: windGust,
      wind_speed_10m: windSpeed,
      wind_direction_10m: windDir,
      cloud_cover: cloudCover,
      freezing_level_height: freezingLevel,
      weathercode,
      precipitation_probability: precipProb,
    },
    daily: {
      time: dailyTimes,
      weathercode: [71, 71, 71, 73, 0],
      temperature_2m_max: [-3, -3, -3, -2, 5],
      temperature_2m_min: [-8, -8, -8, -7, -1],
      snowfall_sum: [24, 24, 24, 30, 0],
      precipitation_probability_max: [60, 60, 60, 70, 10],
      wind_gusts_10m_max: [25, 25, 25, 30, 10],
      wind_direction_10m_dominant: [90, 90, 90, 180, 270],
    },
  };
}

test("parseSnapshot computes depth, new-snow windows, and grid fields", () => {
  const snap = parseSnapshot(buildFixture());
  assert.ok(Math.abs(snap.snowDepthIn! - 19.7) < 0.2); // 50cm ≈ 19.69in
  // All snow-inch fields are rounded to 1 decimal by the implementation
  // (Math.round(x * 10) / 10) — match that rounding in the expected value,
  // not the raw conversion, or these assertions fail even on correct code.
  assert.strictEqual(snap.newSnow24hIn, Math.round(cmToInches(24) * 10) / 10);
  assert.strictEqual(snap.newSnow48hIn, Math.round(cmToInches(48) * 10) / 10);
  assert.strictEqual(snap.forecastSnow48hIn, Math.round(cmToInches(48) * 10) / 10); // next 48h, same constant rate
  assert.strictEqual(snap.maxHighTemp48hF, celsiusToFahrenheit(-5));
  assert.strictEqual(snap.skyCoverAvg, 40);
  assert.ok(Math.abs(snap.windGustMaxMph - kmhToMph(20)) < 0.5);
  assert.ok(Math.abs(snap.freezingLevelFt - metersToFeet(2000)) < 5);
  assert.strictEqual(snap.tempF, celsiusToFahrenheit(-5));
  assert.strictEqual(snap.snowingNow, true); // constant 1cm/hr snowfall throughout
});

test("parseForecast shapes 5 daily WeatherPeriod entries starting with Today", () => {
  const days = parseForecast(buildFixture());
  assert.strictEqual(days.length, 3); // forecast_days beyond past_days: indices 2,3,4
  assert.strictEqual(days[0].dow, "Today");
  assert.strictEqual(days[0].condition, "light-snow");
  // high/low are Math.round()-ed by the implementation — -3C/-8C aren't
  // exact-integer °F conversions, so match the rounded value, not the raw one.
  assert.strictEqual(days[0].high, Math.round(celsiusToFahrenheit(-3)));
  assert.strictEqual(days[0].low, Math.round(celsiusToFahrenheit(-8)));
  assert.strictEqual(days[1].shortForecast, "Snow");
  assert.strictEqual(days[2].condition, "clear");
});

test("parseHourly returns the next 48 hours shaped as HourlyWeather", () => {
  const hourly = parseHourly(buildFixture());
  assert.strictEqual(hourly.length, 48);
  assert.strictEqual(hourly[0].temperature, celsiusToFahrenheit(-5));
  assert.strictEqual(hourly[0].condition, "light-snow");
  assert.strictEqual(hourly[0].windDirection, "E");
  assert.strictEqual(hourly[0].snowInches, Math.round(cmToInches(1) * 10) / 10);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test lib/open-meteo.test.ts`
Expected: FAIL — `lib/open-meteo.ts` doesn't exist yet (module not found).

- [ ] **Step 3: Implement `lib/open-meteo.ts`**

```typescript
import type { WeatherPeriod, HourlyWeather } from "./types";
import { windChill } from "./weather";

// ─────────────────────────────────────────────────────────────
// Open-Meteo API helpers — free, keyless, global weather model.
// Used for resorts with no SNOTEL station (South America + any
// other non-US/CA resort). All fetches MUST be server-side.
// ─────────────────────────────────────────────────────────────

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";
const PAST_DAYS = 2;
const NOW_IDX = PAST_DAYS * 24; // hourly index representing "now" (local midnight of today)

// ── Unit conversions ──────────────────────────────────────────

export function cmToInches(cm: number): number {
  return cm / 2.54;
}

export function metersToInches(m: number): number {
  return m * 39.3701;
}

export function metersToFeet(m: number): number {
  return m * 3.28084;
}

export function feetToMeters(ft: number): number {
  return ft / 3.28084;
}

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export function kmhToMph(kmh: number): number {
  return kmh * 0.621371;
}

// ── Weather code mapping (WMO codes → PeakCam condition slugs) ─
// Slugs match forecastToCondition() in lib/weather.ts so the same
// WeatherIcon set renders regardless of data source.

const WEATHER_CODE_CONDITION: Record<number, string> = {
  0: "clear", 1: "partly-cloudy", 2: "partly-cloudy", 3: "cloudy",
  45: "fog", 48: "fog",
  51: "rain", 53: "rain", 55: "rain",
  56: "freezing-rain", 57: "freezing-rain",
  61: "rain", 63: "rain", 65: "rain",
  66: "freezing-rain", 67: "freezing-rain",
  71: "light-snow", 73: "light-snow", 75: "heavy-snow", 77: "light-snow",
  80: "rain", 81: "rain", 82: "rain",
  85: "light-snow", 86: "heavy-snow",
  95: "rain", 96: "rain", 99: "rain",
};

export function weatherCodeToCondition(code: number): string {
  return WEATHER_CODE_CONDITION[code] ?? "partly-cloudy";
}

const WEATHER_CODE_LABEL: Record<number, string> = {
  0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Overcast",
  45: "Fog", 48: "Freezing Fog",
  51: "Light Drizzle", 53: "Drizzle", 55: "Heavy Drizzle",
  56: "Freezing Drizzle", 57: "Freezing Drizzle",
  61: "Light Rain", 63: "Rain", 65: "Heavy Rain",
  66: "Freezing Rain", 67: "Freezing Rain",
  71: "Light Snow", 73: "Snow", 75: "Heavy Snow", 77: "Snow Grains",
  80: "Rain Showers", 81: "Rain Showers", 82: "Violent Rain Showers",
  85: "Snow Showers", 86: "Heavy Snow Showers",
  95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
};

export function weatherCodeToLabel(code: number): string {
  return WEATHER_CODE_LABEL[code] ?? "Variable";
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function degreesToCompass(deg: number): string {
  const idx = Math.round((deg % 360) / 22.5) % 16;
  return COMPASS_POINTS[idx];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Raw API response shape (subset we use) ────────────────────

interface OpenMeteoHourlyBlock {
  time: string[];
  snowfall: number[];
  snow_depth: number[];
  temperature_2m: number[];
  wind_gusts_10m: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  cloud_cover: number[];
  freezing_level_height: number[];
  weathercode: number[];
  precipitation_probability: number[];
}

interface OpenMeteoDailyBlock {
  time: string[];
  weathercode: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  snowfall_sum: number[];
  precipitation_probability_max: number[];
  wind_gusts_10m_max: number[];
  wind_direction_10m_dominant: number[];
}

export interface OpenMeteoResponse {
  elevation: number;
  hourly: OpenMeteoHourlyBlock;
  daily: OpenMeteoDailyBlock;
}

// ── Fetch ──────────────────────────────────────────────────────

async function fetchOpenMeteo(
  lat: number,
  lng: number,
  elevationFt?: number | null,
): Promise<OpenMeteoResponse | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    hourly:
      "snowfall,snow_depth,temperature_2m,wind_gusts_10m,wind_speed_10m,wind_direction_10m,cloud_cover,freezing_level_height,weathercode,precipitation_probability",
    daily:
      "weathercode,temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_probability_max,wind_gusts_10m_max,wind_direction_10m_dominant",
    past_days: String(PAST_DAYS),
    forecast_days: "5",
    timezone: "auto",
  });
  if (elevationFt != null) {
    params.set("elevation", String(Math.round(feetToMeters(elevationFt))));
  }

  try {
    const res = await fetch(`${OPEN_METEO_BASE}?${params}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Windowed aggregation helpers ───────────────────────────────

function sumWindow(arr: number[], start: number, count: number): number {
  let total = 0;
  for (let i = Math.max(start, 0); i < start + count && i < arr.length; i++) {
    total += arr[i] ?? 0;
  }
  return total;
}

function maxWindow(arr: number[], start: number, count: number): number {
  let max = -Infinity;
  for (let i = Math.max(start, 0); i < start + count && i < arr.length; i++) {
    if (arr[i] != null) max = Math.max(max, arr[i]);
  }
  return max === -Infinity ? 0 : max;
}

function avgWindow(arr: number[], start: number, count: number): number {
  let total = 0;
  let n = 0;
  for (let i = Math.max(start, 0); i < start + count && i < arr.length; i++) {
    if (arr[i] != null) {
      total += arr[i];
      n++;
    }
  }
  return n > 0 ? total / n : 0;
}

/** Index of the hourly entry closest to right now (for "is it snowing" precision, vs. NOW_IDX's day-boundary alignment). */
function findCurrentHourIndex(times: string[]): number {
  const now = Date.now();
  let closest = 0;
  let closestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const diff = Math.abs(new Date(times[i]).getTime() - now);
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = i;
    }
  }
  return closest;
}

// ── Snapshot (current conditions, for the conditions engine) ──

export interface OpenMeteoSnapshot {
  snowDepthIn: number | null;
  newSnow24hIn: number;
  newSnow48hIn: number;
  forecastSnow48hIn: number;
  maxHighTemp48hF: number;
  skyCoverAvg: number;
  windGustMaxMph: number;
  freezingLevelFt: number;
  tempF: number | null;
  snowingNow: boolean;
}

export function parseSnapshot(data: OpenMeteoResponse): OpenMeteoSnapshot {
  const h = data.hourly;
  const nowIdx = Math.min(NOW_IDX, h.time.length - 1);

  const snowDepthM = h.snow_depth[nowIdx]; // snow_depth is in METERS (verified against the live API — see design doc)
  const newSnow24hCm = sumWindow(h.snowfall, nowIdx - 24, 24);
  const newSnow48hCm = sumWindow(h.snowfall, nowIdx - 48, 48);
  const forecastSnowCm = sumWindow(h.snowfall, nowIdx, 48);
  const maxHighC = maxWindow(h.temperature_2m, nowIdx, 48);
  const skyCover = avgWindow(h.cloud_cover, nowIdx, 24);
  const windGustKmh = maxWindow(h.wind_gusts_10m, nowIdx, 24);
  const freezingLevelM = h.freezing_level_height[nowIdx];
  const tempC = h.temperature_2m[nowIdx];

  const currentIdx = findCurrentHourIndex(h.time);
  const snowingNow = (h.snowfall[currentIdx] ?? 0) > 0;

  return {
    snowDepthIn: snowDepthM != null ? Math.round(metersToInches(snowDepthM) * 10) / 10 : null,
    newSnow24hIn: Math.round(cmToInches(newSnow24hCm) * 10) / 10,
    newSnow48hIn: Math.round(cmToInches(newSnow48hCm) * 10) / 10,
    forecastSnow48hIn: Math.round(cmToInches(forecastSnowCm) * 10) / 10,
    maxHighTemp48hF: Math.round(celsiusToFahrenheit(maxHighC)),
    skyCoverAvg: Math.round(skyCover),
    windGustMaxMph: Math.round(kmhToMph(windGustKmh)),
    freezingLevelFt: Math.round(metersToFeet(freezingLevelM ?? 0)),
    tempF: tempC != null ? Math.round(celsiusToFahrenheit(tempC)) : null,
    snowingNow,
  };
}

// ── Forecast (5-day) ────────────────────────────────────────────

export function parseForecast(data: OpenMeteoResponse): WeatherPeriod[] {
  const d = data.daily;
  const days: WeatherPeriod[] = [];

  for (let i = PAST_DAYS; i < d.time.length && days.length < 5; i++) {
    const code = d.weathercode[i];
    const high = Math.round(celsiusToFahrenheit(d.temperature_2m_max[i]));
    const low = Math.round(celsiusToFahrenheit(d.temperature_2m_min[i]));
    const windSpeed = Math.round(kmhToMph(d.wind_gusts_10m_max[i]));

    days.push({
      dow: days.length === 0 ? "Today" : DAY_NAMES[new Date(d.time[i]).getUTCDay()],
      condition: weatherCodeToCondition(code),
      high,
      low,
      snowInches: Math.round(cmToInches(d.snowfall_sum[i]) * 10) / 10,
      shortForecast: weatherCodeToLabel(code),
      windSpeed,
      windDirection: degreesToCompass(d.wind_direction_10m_dominant[i]),
      windGust: windSpeed,
      precipProbability: d.precipitation_probability_max[i] ?? null,
      feelsLike: windChill(high, windSpeed),
    });
  }

  return days;
}

// ── Hourly (next 48h) ────────────────────────────────────────────

export function parseHourly(data: OpenMeteoResponse): HourlyWeather[] {
  const h = data.hourly;
  const nowIdx = Math.min(NOW_IDX, h.time.length - 1);
  const hourly: HourlyWeather[] = [];

  for (let i = nowIdx; i < nowIdx + 48 && i < h.time.length; i++) {
    const temp = Math.round(celsiusToFahrenheit(h.temperature_2m[i]));
    const windSpeed = Math.round(kmhToMph(h.wind_speed_10m[i]));

    hourly.push({
      time: `${h.time[i]}:00`, // Open-Meteo returns "YYYY-MM-DDTHH:MM" without seconds
      temperature: temp,
      windSpeed,
      windDirection: degreesToCompass(h.wind_direction_10m[i]),
      shortForecast: weatherCodeToLabel(h.weathercode[i]),
      condition: weatherCodeToCondition(h.weathercode[i]),
      snowInches: Math.round(cmToInches(h.snowfall[i]) * 10) / 10,
      precipProbability: h.precipitation_probability[i] ?? 0,
      feelsLike: windChill(temp, windSpeed),
    });
  }

  return hourly;
}

// ── Public API (fetch + parse) ──────────────────────────────────

export async function getOpenMeteoSnapshot(
  lat: number,
  lng: number,
  elevationFt?: number | null,
): Promise<OpenMeteoSnapshot | null> {
  const data = await fetchOpenMeteo(lat, lng, elevationFt);
  return data ? parseSnapshot(data) : null;
}

export async function getOpenMeteoForecast(
  lat: number,
  lng: number,
  elevationFt?: number | null,
): Promise<WeatherPeriod[] | null> {
  const data = await fetchOpenMeteo(lat, lng, elevationFt);
  if (!data) return null;
  const days = parseForecast(data);
  return days.length > 0 ? days : null;
}

export async function getOpenMeteoHourly(
  lat: number,
  lng: number,
  elevationFt?: number | null,
): Promise<HourlyWeather[] | null> {
  const data = await fetchOpenMeteo(lat, lng, elevationFt);
  if (!data) return null;
  const hourly = parseHourly(data);
  return hourly.length > 0 ? hourly : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/open-meteo.test.ts`
Expected: PASS, all tests (12 tests: 6 conversion/mapping + 1 fallback + 3 parser tests, adjust count as written above).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/open-meteo.ts lib/open-meteo.test.ts
git commit -m "feat(weather): add Open-Meteo fetcher and formatters for non-SNOTEL resorts"
```

---

### Task 5: `scripts/snotel-sync.ts` — fix the elevation bug

**Files:**
- Modify: `scripts/snotel-sync.ts:96-103` (`SnotelResort` interface), `scripts/snotel-sync.ts:127-132` (`fetchResorts`), `scripts/snotel-sync.ts:581` (the bug)

**Interfaces:**
- Consumes: `resort_metadata` table (already exists, migration 007) via a PostgREST embed on the `resorts` query.
- Produces: no change to any function signature other callers depend on — this is a self-contained internal fix.

Why: `scripts/snotel-sync.ts:581` currently sets `resortElevBase: resort.lat` — passing a *latitude* (~40) as an *elevation in feet*. This makes the "Rain at Base" tag's check (`snowLevelAvg > resortElevBase + 500`) fire whenever the snow level is above ~540ft, which is true on almost every wet day. This task fixes it to use the real elevation from `resort_metadata`, with a safe fallback that suppresses just this one tag (not the whole `nwsGrid` block, which still has good data for wind/sky/ice tags) when elevation is unknown.

- [ ] **Step 1: Update the `SnotelResort` interface and query**

In `scripts/snotel-sync.ts`, change the interface (around line 96):

```typescript
interface SnotelResort {
  id: string;
  name: string;
  state: string;
  snotel_station_id: string;
  lat: number;
  lng: number;
  resort_metadata: { elevation_base_ft: number | null } | null;
}
```

And `fetchResorts()` (around line 127-132):

```typescript
async function fetchResorts(): Promise<SnotelResort[]> {
  const url = `${SUPABASE_URL}/rest/v1/resorts?select=id,name,state,snotel_station_id,lat,lng,resort_metadata(elevation_base_ft)&is_active=eq.true&snotel_station_id=not.is.null`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 2: Fix the bug at the usage site**

Around line 581, change:

```typescript
        nwsGrid: forecast.gridData ? {
          skyCoverAvg: getGridVal(forecast.gridData.skyCover) ?? 50,
          windGustMax: (getGridVal(forecast.gridData.windGust) ?? 0) * 0.621371, // km/h to mph
          windChillAvg: (getGridVal(forecast.gridData.windChill) ?? 0) * 9/5 + 32, // C to F
          snowLevelAvg: (getGridVal(forecast.gridData.snowLevel) ?? 0) * 3.28084, // m to ft
          resortElevBase: resort.resort_metadata?.elevation_base_ft ?? 99999, // unknown elevation → effectively disable the "Rain at Base" check (was: resort.lat, a latitude misused as feet — see docs/superpowers/plans/2026-07-12-south-america-backend-sync.md)
          iceAccumulationMax: (getGridVal(forecast.gridData.iceAccumulation) ?? 0) / 25.4, // mm to inches
          probOfPrecipMax: getGridVal(forecast.gridData.probabilityOfPrecipitation) ?? 0,
        } : null,
```

(Only the `resortElevBase` line changes — every other field in this block is untouched.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify with a real run**

This script has no `--dry-run` flag and no unit-testable seam around this logic (it's inline in `main()`) — matching this repo's existing convention that scripts/ has no test coverage. Verify by running it for real; it's the same idempotent (append-only insert + upsert) job that already runs every 6 hours in production, so running it once more ahead of schedule is safe.

Run: `npx tsx scripts/snotel-sync.ts`
Expected: log output ending in `[snotel-sync] Done. N synced, ...` with no new failures compared to a baseline run. Then spot-check one high-elevation resort (e.g. a Colorado resort with `resort_metadata.elevation_base_ft` around 8000-10000ft): its latest `snow_reports.conditions` should no longer contain "Rain at Base" unless the snow level genuinely dropped within 500ft of that resort's real base elevation.

- [ ] **Step 5: Commit**

```bash
git add scripts/snotel-sync.ts
git commit -m "fix(snotel-sync): use real resort elevation instead of latitude for Rain at Base check"
```

---

### Task 6: `scripts/model-sync.ts` — the new sync script

**Files:**
- Create: `scripts/model-sync.ts`
- Modify: `package.json` (add `"model-sync"` script entry)

**Interfaces:**
- Consumes: `getOpenMeteoSnapshot` from `../lib/open-meteo.js` (Task 4), `computeConditions`, `ConditionsInput`, `UserConditionReport` from `../lib/conditions-engine.js` (Task 3's `thresholdIn` addition), `validateReading`/`dayOfWaterYear` are NOT used here (no QC needed for model data — see rationale below).
- Produces: writes to `snowpack_daily` (station_id = `'open-meteo'`), `snow_reports` (source = `'open_meteo'`), `resorts.cond_rating` — same tables `snotel-sync.ts` writes, disjoint resort set.

Why no QC validation: `lib/snow-quality.ts`'s `validateReading` exists to catch *sensor* failure modes (SNOTEL station outages, physically-impossible spikes). Open-Meteo is a weather model, not a physical sensor with those failure modes — its own internal consistency is Open-Meteo's problem, not ours to second-guess with SNOTEL-tuned thresholds. This keeps the script simpler and avoids silently "correcting" legitimate model output.

- [ ] **Step 1: Write the script**

```typescript
#!/usr/bin/env tsx

/**
 * model-sync.ts
 * ─────────────
 * Snow sync for every resort WITHOUT a SNOTEL station (South
 * America + any other non-NRCS-network resort), using the
 * Open-Meteo global weather model. Mirrors scripts/snotel-sync.ts's
 * structure and writes to the same tables snotel-sync uses.
 *
 * Usage:
 *   npx tsx scripts/model-sync.ts
 *   npx tsx scripts/model-sync.ts --dry-run
 *
 * Reads:  .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * Writes: snowpack_daily, snow_reports, resorts.cond_rating
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getOpenMeteoSnapshot } from "../lib/open-meteo.js";
import {
  computeConditions,
  type ConditionsInput,
  type UserConditionReport,
} from "../lib/conditions-engine.js";

// ─── Load .env.local manually ────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

loadEnv(path.join(ROOT, ".env.local"));
loadEnv(path.join(ROOT, ".env"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const supaHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const STATION_ID = "open-meteo"; // synthetic station_id for snowpack_daily.station_id (not null)

// ─── Parse args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Types ────────────────────────────────────────────────────────────────

interface ModelResort {
  id: string;
  name: string;
  lat: number;
  lng: number;
  resort_metadata: { elevation_base_ft: number | null; elevation_summit_ft: number | null } | null;
}

// ─── Step 1: Fetch resorts with no SNOTEL station ─────────────────────────

async function fetchResorts(): Promise<ModelResort[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/resorts?select=id,name,lat,lng,resort_metadata(elevation_base_ft,elevation_summit_ft)` +
    `&is_active=eq.true&snotel_station_id=is.null`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) throw new Error(`Supabase resorts fetch failed: ${resp.status}`);
  return resp.json();
}

function resortElevationFt(resort: ModelResort): number | null {
  const meta = resort.resort_metadata;
  if (!meta) return null;
  if (meta.elevation_base_ft != null && meta.elevation_summit_ft != null) {
    return Math.round((meta.elevation_base_ft + meta.elevation_summit_ft) / 2);
  }
  return meta.elevation_base_ft ?? null;
}

// ─── Step 2: Depth history (last 7 days) ──────────────────────────────────

async function fetchDepthHistory(resortId: string): Promise<(number | null)[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/snowpack_daily?resort_id=eq.${resortId}&station_id=eq.${STATION_ID}` +
    `&order=date.desc&limit=7&select=snow_depth_in`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) return [];
  const rows: { snow_depth_in: number | null }[] = await resp.json();
  return rows.map((r) => r.snow_depth_in).reverse(); // oldest-first
}

// ─── Step 3: Recent user reports ──────────────────────────────────────────

async function fetchUserReports(resortId: string): Promise<UserConditionReport[]> {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/user_conditions?resort_id=eq.${resortId}&is_flagged=eq.false&submitted_at=gte.${cutoff}` +
    `&select=snow_quality,visibility,wind,trail_conditions`;
  const resp = await fetch(url, { headers: supaHeaders });
  if (!resp.ok) return [];
  return await resp.json();
}

// ─── Step 4: Write helpers ─────────────────────────────────────────────────

async function upsertSnowpackDaily(
  resortId: string,
  date: string,
  snowDepthIn: number | null,
): Promise<void> {
  const body = {
    resort_id: resortId,
    station_id: STATION_ID,
    date,
    snow_depth_in: snowDepthIn != null ? Math.round(snowDepthIn) : null,
    swe_in: null,
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/snowpack_daily`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`snowpack_daily upsert failed (${resp.status}): ${text}`);
  }
}

async function insertSnowReport(
  resortId: string,
  snowDepthIn: number | null,
  newSnow24hIn: number,
  newSnow48hIn: number,
  conditions: ReturnType<typeof computeConditions>,
  snowingNow: boolean,
): Promise<void> {
  const conditionsString = `${conditions.tags.join(",")}||${conditions.narrative}`;

  const body = {
    resort_id: resortId,
    base_depth: snowDepthIn != null ? Math.round(snowDepthIn) : null,
    new_snow_24h: Math.round(newSnow24hIn),
    new_snow_48h: Math.round(newSnow48hIn),
    swe_in: null,
    pct_of_normal: null, // no climatology for model-sync resorts
    trend_7d: conditions.trend7d,
    outlook: conditions.outlook,
    auto_cond_rating: conditions.condRating,
    conditions: conditionsString,
    snowing_now: snowingNow,
    source: "open_meteo",
    updated_at: new Date().toISOString(),
  };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/snow_reports`, {
    method: "POST",
    headers: supaHeaders,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`snow_reports insert failed (${resp.status}): ${text}`);
  }
}

async function updateResortRating(resortId: string, condRating: string): Promise<void> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/resorts?id=eq.${resortId}`, {
    method: "PATCH",
    headers: supaHeaders,
    body: JSON.stringify({ cond_rating: condRating }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`resorts.cond_rating update failed (${resp.status}): ${text}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

const DEPTH_TREND_THRESHOLD_IN = 2.0; // vs. the 0.5in default tuned for SWE

async function main(): Promise<void> {
  console.log(`[model-sync] Starting model-based sync${dryRun ? " (DRY RUN)" : ""}...\n`);

  const resorts = await fetchResorts();
  console.log(`[model-sync] Found ${resorts.length} resorts without a SNOTEL station\n`);

  let success = 0;
  let failed = 0;
  let noData = 0;

  for (const resort of resorts) {
    try {
      const elevationFt = resortElevationFt(resort);
      const snapshot = await getOpenMeteoSnapshot(resort.lat, resort.lng, elevationFt);

      if (!snapshot) {
        console.log(`  SKIP ${resort.name} — Open-Meteo unreachable`);
        noData++;
        await sleep(300);
        continue;
      }

      const today = fmtDate(new Date());

      if (!dryRun) {
        await upsertSnowpackDaily(resort.id, today, snapshot.snowDepthIn);
      }

      const [depthHistory, userReports] = await Promise.all([
        fetchDepthHistory(resort.id),
        fetchUserReports(resort.id),
      ]);

      const conditionsInput: ConditionsInput = {
        current: {
          snowDepthIn: snapshot.snowDepthIn,
          sweIn: null,
          newSnow24h: snapshot.newSnow24hIn,
          newSnow48h: snapshot.newSnow48hIn,
        },
        normals: {
          medianSweIn: null,
          pctile10SweIn: null,
          pctile90SweIn: null,
        },
        history7d: {
          // Depth values, not SWE — computeTrend doesn't care about units,
          // only deltas, so this reuses the same field with a larger threshold.
          // depthHistory is fetched AFTER today's snowpack_daily upsert above,
          // so on a live run it already includes today's just-written depth
          // as its newest entry (same as scripts/snotel-sync.ts's sweHistory
          // usage) — do not append snapshot.snowDepthIn again here, or today
          // gets double-counted and the 7-day window shrinks to 6 prior days.
          sweValues: depthHistory,
          thresholdIn: DEPTH_TREND_THRESHOLD_IN,
        },
        forecast: {
          snowInchesNext48h: snapshot.forecastSnow48hIn,
          maxHighTemp48h: snapshot.maxHighTemp48hF,
        },
        nwsGrid: {
          skyCoverAvg: snapshot.skyCoverAvg,
          windGustMax: snapshot.windGustMaxMph,
          windChillAvg: snapshot.tempF ?? 32,
          snowLevelAvg: snapshot.freezingLevelFt,
          resortElevBase: elevationFt ?? 99999, // unknown elevation → suppress Rain at Base
          iceAccumulationMax: 0, // Open-Meteo doesn't expose ice accumulation
          probOfPrecipMax: 0, // approximated via skyCoverAvg/snow tags instead
        },
        userReports: userReports.length > 0 ? userReports : undefined,
      };

      const conditions = computeConditions(conditionsInput);

      if (!dryRun) {
        await insertSnowReport(
          resort.id,
          snapshot.snowDepthIn,
          snapshot.newSnow24hIn,
          snapshot.newSnow48hIn,
          conditions,
          snapshot.snowingNow,
        );
        await updateResortRating(resort.id, conditions.condRating);
      }

      console.log(
        `  OK   ${resort.name} — ` +
          `depth: ${snapshot.snowDepthIn ?? "?"}in, ` +
          `24h: ${snapshot.newSnow24hIn}in, ` +
          `rating: ${conditions.condRating}, ` +
          `trend: ${conditions.trend7d}, ` +
          `outlook: ${conditions.outlook}`,
      );
      success++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${resort.name} — ${msg}`);
      failed++;
    }

    await sleep(300); // rate limit between resorts, matching snotel-sync.ts
  }

  console.log(
    `\n[model-sync] Done. ${success} synced, ${noData} no data, ${failed} failed (of ${resorts.length} total)`,
  );
}

main().catch((err) => {
  console.error("[model-sync] Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add a new line inside `"scripts"` (alongside `"snotel-sync"`):

```json
    "model-sync": "tsx scripts/model-sync.ts",
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Dry-run against real resorts**

Run: `npx tsx scripts/model-sync.ts --dry-run`
Expected: at this point in the plan, `resorts` has zero rows with `snotel_station_id is null` among *active* resorts (SA seed data lands in Task 9), so the log should show `Found 0 resorts without a SNOTEL station` and exit cleanly with `0 synced, 0 no data, 0 failed`. This confirms the script runs end-to-end without errors before real data exists — full behavioral verification happens in Task 10 once Task 9's seed data is live.

- [ ] **Step 5: Commit**

```bash
git add scripts/model-sync.ts package.json
git commit -m "feat(pipeline): add model-sync.ts — Open-Meteo sync for non-SNOTEL resorts"
```

---

### Task 7: Resort detail page — select forecast source by country

**Files:**
- Modify: `lib/supabase.ts` (add `getResortElevationFt`)
- Modify: `app/resorts/[slug]/page.tsx:1-4`, `:82-91`

**Interfaces:**
- Consumes: `getOpenMeteoForecast`, `getOpenMeteoHourly` from `lib/open-meteo.ts` (Task 4); `resort.country` (Task 1/2).
- Produces: `getResortElevationFt(resortId: string): Promise<number | null>` in `lib/supabase.ts`.

- [ ] **Step 1: Add the elevation query helper**

In `lib/supabase.ts`, add (near the other query helpers, e.g. after `getResortWithMetadata`):

```typescript
/** Midpoint elevation (base+summit)/2 in feet, for resorts with resort_metadata. Returns base-only or null if incomplete/missing. */
export async function getResortElevationFt(resortId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("resort_metadata")
    .select("elevation_base_ft, elevation_summit_ft")
    .eq("resort_id", resortId)
    .maybeSingle();

  if (error || !data) return null;
  const { elevation_base_ft, elevation_summit_ft } = data;
  if (elevation_base_ft != null && elevation_summit_ft != null) {
    return Math.round((elevation_base_ft + elevation_summit_ft) / 2);
  }
  return elevation_base_ft ?? null;
}
```

- [ ] **Step 2: Branch the forecast fetch by country**

In `app/resorts/[slug]/page.tsx`, change the import line (currently line 3):

```typescript
import { getResortBySlug, getAllResortSlugs, getLiveConditions, getUserConditions, getResortElevationFt } from "@/lib/supabase";
import { getWeatherForecast, getHourlyForecast, bucketIntoPeriods } from "@/lib/weather";
import { getOpenMeteoForecast, getOpenMeteoHourly } from "@/lib/open-meteo";
```

Then change the fetch block (currently lines 82-91):

```typescript
  // Fetch weather, live conditions, and user reports server-side
  const isUS = resort.country === "US";
  const elevationFt = isUS ? null : await getResortElevationFt(resort.id);

  const [weather, hourlyRaw, liveConditions, userConditions] = await Promise.all([
    isUS
      ? getWeatherForecast(resort.lat, resort.lng)
      : getOpenMeteoForecast(resort.lat, resort.lng, elevationFt),
    isUS
      ? getHourlyForecast(resort.lat, resort.lng)
      : getOpenMeteoHourly(resort.lat, resort.lng, elevationFt),
    getLiveConditions(resort.id),
    getUserConditions(resort.id),
  ]);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors — `weather` and `hourlyRaw` keep the same `WeatherPeriod[] | null` / `HourlyWeather[] | null` types regardless of branch, so nothing downstream (`bucketIntoPeriods(hourlyRaw)`, `ResortDetailPage` props) needs to change.

- [ ] **Step 4: Verify**

This depends on real SA data (Task 9) and DB state (Task 1) to observe end-to-end — full behavioral check happens in Task 10. For now:

Run: `npm run build`
Expected: build succeeds (this also exercises `generateStaticParams`/`generateMetadata` for every existing resort, none of which are affected by this change since they're all `country: "US"`).

- [ ] **Step 5: Commit**

```bash
git add lib/supabase.ts "app/resorts/[slug]/page.tsx"
git commit -m "feat(resort-page): use Open-Meteo forecast for non-US resorts"
```

---

### Task 8: `scripts/import-resorts-standalone.mjs` — country, resort_metadata, and a real cams upsert

**Files:**
- Modify: `scripts/import-resorts-standalone.mjs`
- Test: `scripts/import-resorts-standalone.test.mjs` (new)

**Interfaces:**
- Consumes: the new `country`, `elevation_base_ft`, `elevation_summit_ft` columns in `data/resorts.csv` (Task 9); migration 012's `cams_resort_embed_url_idx` (Task 1).
- Produces: `toResortMetadataRecord(resortId, row)` and `hasElevationData(row)` — extracted, unit-tested pure helpers.

- [ ] **Step 1: Write the failing unit tests**

Create `scripts/import-resorts-standalone.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert";
import { hasElevationData, toResortMetadataRecord } from "./import-resorts-standalone.mjs";

test("hasElevationData is true when both elevation fields are present", () => {
  assert.strictEqual(hasElevationData({ elevation_base_ft: "8360", elevation_summit_ft: "10860" }), true);
});

test("hasElevationData is false when fields are blank or missing", () => {
  assert.strictEqual(hasElevationData({ elevation_base_ft: "", elevation_summit_ft: "" }), false);
  assert.strictEqual(hasElevationData({}), false);
  assert.strictEqual(hasElevationData({ elevation_base_ft: "8360", elevation_summit_ft: "" }), false);
});

test("toResortMetadataRecord parses elevation strings into integers", () => {
  const record = toResortMetadataRecord("resort-uuid-123", {
    elevation_base_ft: "8360",
    elevation_summit_ft: "10860",
  });
  assert.deepStrictEqual(record, {
    resort_id: "resort-uuid-123",
    elevation_base_ft: 8360,
    elevation_summit_ft: 10860,
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/import-resorts-standalone.test.mjs`
Expected: FAIL — `hasElevationData` and `toResortMetadataRecord` aren't exported yet.

- [ ] **Step 3: Implement the changes**

In `scripts/import-resorts-standalone.mjs`, add these two exported pure helpers (near the other `Helpers` section, after `toNullFloat`):

```javascript
export function hasElevationData(row) {
  return Boolean(row.elevation_base_ft) && Boolean(row.elevation_summit_ft);
}

export function toResortMetadataRecord(resortId, row) {
  return {
    resort_id: resortId,
    elevation_base_ft: parseInt(row.elevation_base_ft, 10),
    elevation_summit_ft: parseInt(row.elevation_summit_ft, 10),
  };
}
```

Change the resorts batch mapping inside `importResorts()` to include `country`:

```javascript
    const batch = rows.slice(i, i + BATCH).map((r) => ({
      name:               r.name,
      slug:               r.slug,
      state:              r.state,
      region:             r.region,
      lat:                toNullFloat(r.lat),
      lng:                toNullFloat(r.lng),
      website_url:        blankToNull(r.website_url),
      cam_page_url:       blankToNull(r.cam_page_url),
      snotel_station_id:  blankToNull(r.snotel_station_id),
      x_url:              blankToNull(r.x_url),
      facebook_url:       blankToNull(r.facebook_url),
      instagram_url:      blankToNull(r.instagram_url),
      is_active:          toBool(r.is_active),
      country:            r.country || "US",
    }));
```

Add a new function to upsert `resort_metadata` for rows that have elevation data, called after `importResorts()` builds `slugToId`:

```javascript
async function importResortMetadata(rows, slugToId) {
  const records = rows
    .filter(hasElevationData)
    .map((r) => toResortMetadataRecord(slugToId.get(r.slug), r))
    .filter((r) => r.resort_id); // drop rows whose slug didn't map (shouldn't happen, defensive)

  if (records.length === 0) {
    console.log("\nℹ️  No resort_metadata rows to import (no elevation data in CSV).");
    return;
  }

  console.log(`\n⛰  Resort metadata: ${records.length} rows with elevation data`);
  const data = await supabaseUpsert("resort_metadata", records, "resort_id");
  console.log(`✅  Resort metadata done. ${data.length} upserted.`);
}
```

Update `importResorts()` to return the raw `rows` too (not just `slugToId`), so `main()` can pass them to `importResortMetadata`:

```javascript
async function importResorts() {
  // ... unchanged body ...
  console.log(`✅  Resorts done. ${slugToId.size} IDs mapped.`);
  return { slugToId, rows };
}
```

Change `importCams()` to use a real upsert instead of ignore-duplicates insert:

```javascript
async function importCams(slugToId) {
  const csvPath = path.join(ROOT, "data/cams.csv");
  if (!fs.existsSync(csvPath)) {
    console.warn("⚠  data/cams.csv not found — skipping cam import.");
    return;
  }

  const rows = parseCsv(csvPath);
  console.log(`\n📷 Cams: ${rows.length} rows`);

  const skipped = [];
  const records = rows
    .filter((r) => {
      const id = slugToId.get(r.resort_slug);
      if (!id) { skipped.push(r.resort_slug); return false; }
      return true;
    })
    .map((r) => ({
      resort_id:       slugToId.get(r.resort_slug),
      name:            r.name,
      elevation:       blankToNull(r.elevation),
      embed_type:      r.embed_type,
      embed_url:       blankToNull(r.embed_url),
      youtube_id:      blankToNull(r.youtube_id),
      is_active:       toBool(r.is_active),
      last_checked_at: new Date().toISOString(),
    }));

  if (skipped.length > 0) {
    const unique = [...new Set(skipped)];
    console.warn(`  ⚠  Skipped cams for unknown slugs: ${unique.join(", ")}`);
  }

  if (records.length === 0) {
    console.warn("  ⚠  No cam records to insert.");
    return;
  }

  // Migration 012 added a unique index on (resort_id, embed_url, name) — real
  // upsert now, instead of the old ignore-duplicates insert (which was a
  // no-op without a unique constraint and duplicated cams on re-run).
  const BATCH = 100;
  let total = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const data = await supabaseUpsert("cams", batch, "resort_id,embed_url,name");
    total += data.length;
    process.stdout.write(`  ✓ Batch ${Math.floor(i / BATCH) + 1}: ${data.length} cams upserted\n`);
  }

  console.log(`✅  Cams done. ${total} upserted.`);
}
```

Update `main()` to wire the new metadata import through:

```javascript
async function main() {
  console.log("\n🏔  PeakCam — Standalone Resort & Cam Import");
  console.log("─────────────────────────────────────────────");
  console.log(`    Supabase: ${SUPABASE_URL}`);

  const { slugToId, rows } = await importResorts();
  await importResortMetadata(rows, slugToId);
  await importCams(slugToId);

  console.log("\n🎉  Import complete.\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/import-resorts-standalone.test.mjs`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/import-resorts-standalone.mjs scripts/import-resorts-standalone.test.mjs
git commit -m "feat(import): country + resort_metadata elevation upsert, real cams upsert (fixes duplicate-cam bug)"
```

---

### Task 9: Seed data — 19 South America resorts + 48 cams

**Files:**
- Modify: `data/resorts.csv` (header + 19 new rows)
- Modify: `data/cams.csv` (48 new rows)

**Interfaces:**
- Consumes: nothing (raw data).
- Produces: the row data Task 8's importer reads. All values sourced from `docs/superpowers/specs/research/2026-07-12-sa-resort-research.json` (verified 2026-07-12 research pass) — no fabricated data.

Note: Pillán/Volcán Villarrica (the 20th resort noted in the design spec) is **not** included here — its coordinates/elevation/cams were never independently researched (only flagged as a lead by the completeness critic). Seed it in a follow-up once researched; do not block this task on it.

- [ ] **Step 1: Extend the `resorts.csv` header**

Change the header line (line 1) of `data/resorts.csv` from:

```
name,slug,state,region,lat,lng,website_url,cam_page_url,snotel_station_id,is_active,x_url,facebook_url,instagram_url
```

to:

```
name,slug,state,region,lat,lng,website_url,cam_page_url,snotel_station_id,is_active,x_url,facebook_url,instagram_url,country,elevation_base_ft,elevation_summit_ft
```

The 127 existing rows do **not** need to be touched — `parseCsv` maps missing trailing fields to `""`, which `blankToNull`/`hasElevationData` already handle as "not present," and the importer already defaults `country` to `"US"` when absent (Task 8, Step 3). Verify this by checking that no existing row's trailing fields need editing — just the header row changes, plus the 19 new rows appended below.

- [ ] **Step 2: Append the 19 South America rows**

Append these rows to the end of `data/resorts.csv` (after the last existing row):

```
Portillo,ski-portillo,Chile,Central Andes,-32.8367,-70.1289,https://skiportillo.com/en/home/,https://skiportillo.com/en/our-mountain/portillo-snow-forecast-conditions/,,true,https://x.com/skiportillo,https://www.facebook.com/skiportillo/,https://www.instagram.com/skiportillo/,CL,8360,10860
Valle Nevado,valle-nevado,Chile,Central Andes,-33.3567,-70.2495,https://www.vallenevado.com/en/,https://www.vallenevado.com/en/cameras/,,true,https://x.com/valle_nevado,https://www.facebook.com/vallenevadoskiresort,https://www.instagram.com/valle_nevado/,CL,9843,12041
La Parva,la-parva,Chile,Central Andes,-33.3356,-70.2905,https://laparva.cl/en/,https://laparva.cl/en/mountain-report/web-cameras/,,true,https://twitter.com/skilaparva,https://www.facebook.com/skilaparva,https://www.instagram.com/skilaparva/,CL,8760,11910
El Colorado,el-colorado,Chile,Central Andes,-33.3493,-70.2923,https://www.elcolorado.cl,https://www.elcolorado.cl/live-cam/,,true,,https://www.facebook.com/ElColorado/,https://www.instagram.com/elcoloradofare/,CL,7972,10935
Lagunillas,lagunillas,Chile,Central Andes,-33.6071,-70.2888,https://www.skilagunillas.cl/,,,true,https://x.com/skilagunillas,https://www.facebook.com/LagunillasCentrodeSki/,https://www.instagram.com/skilagunillas/,CL,7218,8366
Nevados de Chillán,nevados-de-chillan,Chile,Ñuble Andes,-36.9065,-71.4142,https://www.nevadosdechillan.com/,https://www.nevadosdechillan.com/camaras,,true,https://x.com/nevadosski,https://www.facebook.com/nevadosdechillan/,https://www.instagram.com/nevadosdechillan/,CL,5020,7874
Corralco,corralco,Chile,Araucanía Andes,-38.410833,-71.545313,https://corralco.com/,https://webcam.corralco.com/,,true,https://x.com/corralco,https://www.facebook.com/Corralco/,https://www.instagram.com/skicorralco/,CL,5085,7874
Antillanca,antillanca,Chile,Lake District,-40.775589,-72.204641,https://www.antillanca.cl/,https://www.antillanca.cl/webcams/,,true,https://x.com/antillancachile,https://www.facebook.com/antillancachile/,https://www.instagram.com/skiantillanca/,CL,3410,5050
Volcán Osorno (Centro de Ski y Montaña Volcán Osorno),volcan-osorno,Chile,Lake District,-41.1278,-72.53,https://centrovolcanosorno.cl/,https://centrovolcanosorno.cl/live-cam/,,true,,https://www.facebook.com/vnosorno/,https://www.instagram.com/volcanosornocentrodemontana/,CL,4035,5774
Cerro Mirador (Punta Arenas),cerro-mirador,Chile,Patagonia,-53.1612232,-71.0259379,https://www.clubandino.cl/,,,true,,https://www.facebook.com/CerroMiradorClubAndino/,https://www.instagram.com/clubandinopuq/,CL,1247,1870
Cerro Catedral (Bariloche),cerro-catedral,Argentina,Argentine Lake District,-41.1652,-71.4395,https://catedralaltapatagonia.com/,https://catedralaltapatagonia.com/webcams/,,true,https://x.com/cerrocatedralok,https://www.facebook.com/CatedralAltaPatagonia,https://www.instagram.com/cerrocatedralok/,AR,3379,7152
Chapelco (Cerro Chapelco Ski Resort),chapelco,Argentina,Argentine Lake District,-40.1978659,-71.3192884,https://www.cerrochapelco.com.ar/,https://www.cerrochapelco.com.ar/webcams-cerro-chapelco/,,true,https://x.com/cerro_chapelco,https://www.facebook.com/ChapelcoSkiResort/,https://www.instagram.com/cerro_chapelco/,AR,4101,6496
Las Leñas,las-lenas,Argentina,Andes de Mendoza,-35.1476,-70.0828,https://laslenas.com/,https://laslenas.com/camara-en-vivo/,,true,https://x.com/laslenasresort,https://www.facebook.com/LasLenasResort/,https://www.instagram.com/laslenasresort/,AR,7349,11253
Cerro Castor (Ushuaia),cerro-castor,Argentina,Tierra del Fuego,-54.7239,-68.0170417,https://www.cerrocastor.com/,https://www.cerrocastor.com/es_ar/live.html,,true,,https://www.facebook.com/CerroCastorUshuaia/,https://www.instagram.com/cerrocastor/,AR,640,3143
Caviahue,caviahue,Argentina,Neuquén Andes,-37.867,-71.083,https://www.caviahue.com/,https://www.caviahue.com/camara-web,,true,,https://www.facebook.com/caviahueskiresort/,https://www.instagram.com/caviahueskiresort/,AR,5413,6785
Cerro Bayo,cerro-bayo,Argentina,Argentine Lake District,-40.7508,-71.6025,https://www.cerrobayo.com.ar,https://www.cerrobayo.com.ar/montana/camara/,,true,,https://www.facebook.com/cerrobayo/,https://www.instagram.com/cerro_bayo,AR,3445,5906
La Hoya (Esquel),la-hoya,Argentina,Patagonia,-42.8331,-71.2574,https://skilahoya.com/,https://skilahoya.com/webcams/,,true,,https://www.facebook.com/CamLaHoya/,https://www.instagram.com/camlahoya/,AR,4692,6808
Batea Mahuida,batea-mahuida,Argentina,Neuquén Andes,-38.832546,-71.222804,https://www.cerrobateamahuida.com/,,,true,https://x.com/bateamahuida,https://www.facebook.com/cerrobateamahuida/,https://www.instagram.com/bateamahuida/,AR,5413,5709
Cerro Perito Moreno (El Bolsón),cerro-perito-moreno,Argentina,Argentine Lake District,-41.790152,-71.563997,https://www.laderas.com.ar,,,true,,https://www.facebook.com/cerroperitomoreno/,https://www.instagram.com/laderascerroperitomoreno/,AR,2953,5577
```

Note: `Lagunillas`, `Cerro Mirador`, `Batea Mahuida`, and `Cerro Perito Moreno` have no `cam_page_url` and no cam rows in Step 3 below — they ship cam-light per the approved design (Section 5's "cam-light OK" decision). `Cerro Castor` and 4 Chile resorts (`Valle Nevado`, `La Parva`, `El Colorado`, `Corralco`, `Volcán Osorno`) have cams whose live-status the research pass marked "unverifiable" (JS/CORS blocking a headless check, not confirmed dead) — imported as-is per the design's explicit call; flag for a manual spot-check before the next `cam-health-check.mjs` run.

- [ ] **Step 3: Append the 48 cam rows to `data/cams.csv`**

Append these rows to the end of `data/cams.csv`:

```
ski-portillo,Laguna (Inca Lake),,iframe,https://g3.ipcamlive.com/player/player.php?alias=laguna,,true
ski-portillo,Tío Bob's,,iframe,https://g3.ipcamlive.com/player/player.php?alias=tiobobs,,true
ski-portillo,Plateau,,iframe,https://g3.ipcamlive.com/player/player.php?alias=plateau,,true
ski-portillo,Escuela (Ski School),,iframe,https://g3.ipcamlive.com/player/player.php?alias=escuela,,true
valle-nevado,La Fourchette Terrace,,youtube,https://www.youtube.com/embed/tWNxInShxZI,tWNxInShxZI,true
valle-nevado,Pool (Piscina),,youtube,https://www.youtube.com/embed/uyt8JsITTac,uyt8JsITTac,true
valle-nevado,Hotel Puerta del Sol,,youtube,https://www.youtube.com/embed/tmS73xQ4zVc,tmS73xQ4zVc,true
valle-nevado,La Góndola,,youtube,https://www.youtube.com/embed/_oWY76RiLZQ,_oWY76RiLZQ,true
la-parva,Parva Chica,,youtube,https://www.youtube.com/embed/dEF-ujYXgkU,dEF-ujYXgkU,true
la-parva,Parva Comercial,,youtube,https://www.youtube.com/embed/Q3P64_RPNlY,Q3P64_RPNlY,true
el-colorado,Parador Pista,,youtube,https://www.youtube.com/embed/r3vGVM_gW64,r3vGVM_gW64,true
el-colorado,Mirador Cima,,youtube,https://www.youtube.com/embed/xr0iN3zNe8U,xr0iN3zNe8U,true
el-colorado,Liebre Base,,youtube,https://www.youtube.com/embed/qxh2rEl_PFU,qxh2rEl_PFU,true
nevados-de-chillan,Novicios (Pista Novicios),,iframe,https://g3.ipcamlive.com/player/player.php?alias=pistanovicios&autoplay=1,,true
nevados-de-chillan,Plaza Tata,,iframe,https://g3.ipcamlive.com/player/player.php?alias=plazatata&autoplay=1,,true
corralco,Hotel,,iframe,https://www.ipcamlive.com/player/player.php?alias=hotel,,true
corralco,ZCB Ski Area,,iframe,https://www.ipcamlive.com/player/player.php?alias=zcbski,,true
corralco,Vista 1600,,iframe,https://www.ipcamlive.com/player/player.php?alias=vista1600,,true
corralco,Retorno Cornisa,,iframe,https://www.ipcamlive.com/player/player.php?alias=recornisa,,true
antillanca,Vista Don Pedro (Haique lift view),,image,https://www.antillanca.cl/wp-json/antillanca/v1/webcam/1,,true
antillanca,Vista Flecha,,image,https://www.antillanca.cl/wp-json/antillanca/v1/webcam/2,,true
volcan-osorno,Camara VO - Cono VO,,youtube,https://www.youtube.com/embed/2uBn7TRSYjI,2uBn7TRSYjI,true
volcan-osorno,Camara VO - Zona Boleterias,,youtube,https://www.youtube.com/embed/BhJ-RasFPTM,BhJ-RasFPTM,true
cerro-catedral,Punta Princesa (live),,iframe,https://g3.ipcamlive.com/player/player.php?alias=6a2c31a02eaf9&skin=white&autoplay=1&mute=1&disableautofullscreen=1&disablezoombutton=1&disableframecapture=1&disablestorageplayer=1&disabledownloadbutton=1&disableplaybackspeedbutton=1,,true
cerro-catedral,Centro Superior (Desembarque),,image,https://varitech.ar/cameras/cam006/latest.jpg,,true
cerro-catedral,Pista Eventos (vista desde la base),,image,https://varitech.ar/cameras/cam005/latest.jpg,,true
cerro-catedral,Playpark (Base),,image,https://varitech.ar/cameras/cam002/latest.jpg,,true
cerro-catedral,Plaza Catalina Reynal (Base),,image,https://varitech.ar/cameras/cam003/latest.jpg,,true
cerro-catedral,Diente de Caballo Sur,,image,https://varitech.ar/cameras/cam008/latest.jpg,,true
cerro-catedral,Punta Princesa (static snapshot),,image,https://varitech.ar/cameras/cam001/latest.jpg,,true
chapelco,Pradera del Puma,,image,https://varitech.ar/cameras/cam016/latest.jpg,,true
chapelco,Lift del Puente,,image,https://varitech.ar/cameras/cam017/latest.jpg,,true
chapelco,"Rancho Grande (Desenganche Silla Rancho Grande, hacia la cordillera)",,image,https://varitech.ar/cameras/cam018/latest.jpg,,true
las-lenas,Base / Live Cam (official),,iframe,https://tv.streamcasthd.com/live-stream-video-widget/laslenas,,true
las-lenas,Pirámide,,image,https://snow2day.com/imgs/webcams/Valle_de_Las_Lenas_Piramide_ar61783890389805xl.jpg,,true
las-lenas,Principal,,image,https://snow2day.com/imgs/webcams/Valle_de_Las_Lenas_Principal_ar61783890441754xl.jpg,,true
cerro-castor,Cerro Castor Live Stream,,youtube,https://www.youtube.com/embed/RVuTqjTyrr0,RVuTqjTyrr0,true
caviahue,Copahue Volcano - Agrio Superior Station (AGS),,image,https://oavv.segemar.gob.ar/CP/AGS.png,,true
caviahue,Copahue Volcano - Aerodrome Node (AER),,image,https://oavv.segemar.gob.ar/CP/AER.png,,true
caviahue,Copahue Volcano - Laguna Escondida Station (ESC),,image,https://oavv.segemar.gob.ar/CP/ESC.png,,true
caviahue,Copahue Volcano - Mellizas Station (MLZ),,image,https://oavv.segemar.gob.ar/CP/MLZ.png,,true
cerro-bayo,Cumbre (Summit 1800m),,image,https://ipcamlive.com/player/snapshot.php?alias=cumbre,,true
cerro-bayo,Copitos Pista 3 (1500m),,image,https://ipcamlive.com/player/snapshot.php?alias=copitos,,true
cerro-bayo,Principiantes 1500,,image,https://ipcamlive.com/player/snapshot.php?alias=principiantes1500,,true
cerro-bayo,Telecabina 1500,,image,https://ipcamlive.com/player/snapshot.php?alias=telecabina1500,,true
cerro-bayo,Telesilla Lagos,,image,https://ipcamlive.com/player/snapshot.php?alias=lagos2,,true
cerro-bayo,Principiantes Pista 2,,image,https://ipcamlive.com/player/snapshot.php?alias=principiantes2,,true
la-hoya,Principiantes / Plano Base 1600,,image,https://varitech.ar/cameras/cam031/latest.jpg,,true
```

- [ ] **Step 4: Run the importer for real**

Run: `node scripts/import-resorts-standalone.mjs`
Expected: log ending in `✅ Resorts done. 146 IDs mapped.` (127 existing + 19 new), `✅ Resort metadata done. 19 upserted.`, `✅ Cams done. N upserted.` (48 new + however many existing NA cams pass through the upsert unchanged — this is now safe to re-run any number of times thanks to Task 8's real upsert).

- [ ] **Step 5: Verify in the database**

Run (via Supabase MCP or SQL Editor): `select count(*) from resorts where country in ('CL','AR');`
Expected: `19`.

Run: `select count(*) from cams c join resorts r on c.resort_id = r.id where r.country in ('CL','AR');`
Expected: `48`.

Run: `select count(*) from resort_metadata rm join resorts r on rm.resort_id = r.id where r.country in ('CL','AR');`
Expected: `19`.

- [ ] **Step 6: Commit**

```bash
git add data/resorts.csv data/cams.csv
git commit -m "feat(data): seed 19 South America resorts and 48 cams from 2026-07-12 research"
```

---

### Task 10: End-to-end verification and scheduling

**Files:**
- Create: a `com.peakcam.model-sync.plist` launchd job description (documented here for the operator to install on the Mac Mini — this plan does not have shell access to `~/Library/LaunchAgents/` on that machine, so this task's deliverable is the plist content + install instructions, not an automated install).

**Interfaces:**
- Consumes: everything from Tasks 1-9.
- Produces: confirmed live data flow for at least one SA resort, end to end.

- [ ] **Step 1: Run model-sync for real**

Run: `npx tsx scripts/model-sync.ts`
Expected: `Found 19 resorts without a SNOTEL station` (assuming no other non-SNOTEL NA/BC resorts existed before this — if some did, the count will be 19 + that number; either way, log ends `[model-sync] Done. N synced, ...` with `failed: 0`).

- [ ] **Step 2: Verify the data landed correctly**

Run (SQL Editor or MCP): `select r.name, sr.base_depth, sr.new_snow_24h, sr.auto_cond_rating, sr.source from resorts r join latest_snow_reports sr on sr.resort_id = r.id where r.country in ('CL','AR') order by r.name;`
Expected: 19 rows, all with `source = 'open_meteo'` and non-null `auto_cond_rating`.

- [ ] **Step 3: Verify a resort page renders correctly**

Run: `npm run dev`, then visit `http://localhost:3000/resorts/valle-nevado` (or any seeded SA slug) in a browser.
Expected: page loads with a base-depth number, a 5-day forecast strip, a condition badge, and at least the cams marked `working`/found in Task 9 rendering as clickable tiles. No console errors about undefined weather fields.

- [ ] **Step 4: Verify the browse page and map pick up the new resorts**

Visit `http://localhost:3000/` and filter by state = "Chile" or "Argentina" (this works with zero UI code changes per the design — `STATE_NAMES` fallback or Grok Code's UI task will add proper labels; functionally the filter chip should appear and filter correctly using the raw `state` value even before that lands).
Expected: the 19 SA resorts appear and are filterable.

- [ ] **Step 5: Verify powder-alert eligibility**

Run: `curl -X POST "$NEXT_PUBLIC_SITE_URL/api/alerts/subscribe" -H "Content-Type: application/json" -d '{"email":"test@example.com","resort_ids":["<a seeded SA resort id>"],"thresholds":{"<that resort id>":1}}'` (adjust body to match the route's actual accepted shape — see `app/api/alerts/subscribe/route.ts`).
Then trigger manually: `curl -X POST "$NEXT_PUBLIC_SITE_URL/api/alerts/trigger" -H "Authorization: Bearer $CRON_SECRET"`.
Expected: `{"ok":true,"sent":<=1,"failed":0}` — confirms `latest_snow_reports.new_snow_24h` for the SA resort is readable by the existing alerts route with zero code changes (it already queries `latest_snow_reports` generically). Clean up the test subscription afterward via `/api/alerts/unsubscribe`.

- [ ] **Step 6: Write and install the launchd schedule**

Create `com.peakcam.model-sync.plist` content (share with the operator to save at `~/Library/LaunchAgents/com.peakcam.model-sync.plist` and load with `launchctl load ~/Library/LaunchAgents/com.peakcam.model-sync.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.peakcam.model-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/npx</string>
    <string>tsx</string>
    <string>scripts/model-sync.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/maestro_admin/peakcam/peakcam</string>
  <key>StartInterval</key>
  <integer>21600</integer>
  <key>StandardOutPath</key>
  <string>/Users/maestro_admin/peakcam/peakcam/scripts/model-sync.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/maestro_admin/peakcam/peakcam/scripts/model-sync.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
```

**Critical:** this plist includes the `EnvironmentVariables`/`PATH` block. This is the exact block missing from `com.peakcam.pipeline.plist`, which is why that job has failed with `exit 127` ("env: node: No such file or directory") on every run since April (per the codebase audit). Before installing, confirm the real path to `npx` on the Mac Mini with `which npx` and use that exact path in `ProgramArguments[0]` and in `PATH` — do not assume `/usr/local/bin` without checking, since Node install location varies by install method (nvm, Homebrew, etc.).

- [ ] **Step 7: Final commit**

```bash
git add com.peakcam.model-sync.plist
git commit -m "docs(ops): add model-sync launchd schedule (every 6h, matches snotel-sync cadence)"
```

---

## Plan Self-Review

**Spec coverage:** every component in `docs/superpowers/specs/2026-07-12-south-america-expansion-design.md`'s backend scope (migration 012, `lib/open-meteo.ts`, `scripts/model-sync.ts`, the conditions-engine trend-threshold change, the snotel-sync elevation fix, resort-detail forecast source selection, and seed data) maps to Tasks 1-9. Task 10 covers the design's "Testing" and "Success criteria" sections end to end, plus the launchd scheduling the design called for. Pillán/Volcán Villarrica is explicitly deferred (Task 9 note) rather than silently dropped.

**Placeholder scan:** no "TBD"/"TODO" remain in code blocks; the one open item (Pillán) is explicitly flagged as deferred, not a placeholder standing in for missing work.

**Type consistency:** `OpenMeteoSnapshot` (Task 4) is referenced identically in Task 6 (`model-sync.ts`) with the same field names (`snowDepthIn`, `newSnow24hIn`, `newSnow48hIn`, `forecastSnow48hIn`, `maxHighTemp48hF`, `skyCoverAvg`, `windGustMaxMph`, `freezingLevelFt`, `snowingNow`). `getOpenMeteoForecast`/`getOpenMeteoHourly` signatures in Task 4 match their call sites in Task 7 exactly (`lat, lng, elevationFt?`). `ConditionsInput.history7d.thresholdIn` (Task 3) is consumed with the same field name in Task 6.

**Fixed during review:** four issues caught by re-deriving the arithmetic by hand before finalizing:
1. Task 4's `parseSnapshot` had a stray `/100` unit-conversion bug (treating `snow_depth` as centimeters when Open-Meteo returns it in meters) — fixed directly in the implementation (variable renamed `snowDepthM`, no `/100`).
2. Task 4's test fixture pushed `50` for `snow_depth` intending "50cm" — but `snow_depth` is meters, so `50` meant 164 feet of snowpack. Fixed to `0.5` (0.5m ≈ 19.7in, matching the test's own comment).
3. Several test assertions compared a rounded implementation output (`Math.round(x * 10) / 10` or `Math.round(x)`) against an *unrounded* expected value (e.g. `cmToInches(24)` instead of `Math.round(cmToInches(24) * 10) / 10`) — these would fail even against correct code. Fixed all affected assertions (`newSnow24hIn`, `newSnow48hIn`, `forecastSnow48hIn`, `days[0].high`, `days[0].low`, `hourly[0].snowInches`) to match the implementation's actual rounding.
4. Task 9's verification SQL in Step 5 had the join condition backwards (`r.resort_id = c.resort_id`, but `resorts` has no `resort_id` column — `cams.resort_id` references `resorts.id`) — fixed to `c.resort_id = r.id`.
