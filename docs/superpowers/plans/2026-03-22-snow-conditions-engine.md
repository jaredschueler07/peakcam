# Snow Conditions Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated snow conditions engine that fetches SNOTEL data, validates it, stores daily history, compares against 30-year normals, and computes condition ratings, trends, and outlook.

**Architecture:** Three pure-function modules (`snow-quality.ts`, `conditions-engine.ts`, water-year helpers) feed into an enhanced sync script that writes to two new tables (`snowpack_daily`, `snotel_normals`) and enriches `snow_reports` with % of normal, trend, and outlook. The sync script migrates from `.mjs` to `.ts` (run via `tsx`).

**Tech Stack:** TypeScript, Supabase/Postgres, NRCS AWDB REST API, NWS API, tsx

**Spec:** `docs/superpowers/specs/2026-03-22-snow-conditions-engine-design.md`

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/005_snowpack_history.sql`

- [ ] **Step 1: Create migration file**

```sql
-- ─────────────────────────────────────────────────────────────
-- PeakCam — Snowpack History & Conditions Engine
-- Adds snowpack_daily, snotel_normals tables and new
-- columns on snow_reports for automated conditions.
-- ─────────────────────────────────────────────────────────────

-- ── snowpack_daily ──────────────────────────────────────────
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

alter table snowpack_daily enable row level security;
create policy "Public snowpack_daily read"
  on snowpack_daily for select using (true);

-- ── snotel_normals ──────────────────────────────────────────
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

alter table snotel_normals enable row level security;
create policy "Public snotel_normals read"
  on snotel_normals for select using (true);

-- ── snow_reports additions ──────────────────────────────────
alter table snow_reports
  add column if not exists swe_in           numeric(6,1),
  add column if not exists pct_of_normal    integer,
  add column if not exists trend_7d         text
    check (trend_7d in ('rising','falling','stable')),
  add column if not exists outlook          text
    check (outlook in ('more_snow','stable','warming','melt_risk')),
  add column if not exists auto_cond_rating text
    check (auto_cond_rating in ('great','good','fair','poor'));
```

- [ ] **Step 2: Apply migration to Supabase**

Run in Supabase SQL Editor (Dashboard → SQL Editor → paste and run), or via CLI:
```bash
# If using Supabase CLI:
supabase db push
```

Verify: Check that `snowpack_daily`, `snotel_normals` tables exist and `snow_reports` has the new columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/005_snowpack_history.sql
git commit -m "feat(db): add snowpack_daily, snotel_normals tables and snow_reports columns"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add new types to `lib/types.ts`**

Add these after the existing `SnowReport` interface (around line 55):

```typescript
// ── Snowpack & Conditions Engine Types ───────────────────────
export type QCFlag = "valid" | "suspect" | "missing" | "corrected";
export type SnowTrend = "rising" | "falling" | "stable";
export type SnowOutlook = "more_snow" | "stable" | "warming" | "melt_risk";

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

- [ ] **Step 2: Add new fields to existing `SnowReport` interface**

In the existing `SnowReport` interface (line 42), add after `updated_at`:

```typescript
  swe_in: number | null;
  pct_of_normal: number | null;
  trend_7d: SnowTrend | null;
  outlook: SnowOutlook | null;
  auto_cond_rating: ConditionRating | null;
```

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add SnowpackDaily, SnotelNormal, and conditions engine types"
```

---

## Task 3: Snow Quality Module (`lib/snow-quality.ts`)

**Files:**
- Create: `lib/snow-quality.ts`

This module contains the `dayOfWaterYear` helper and the `validateReading` function for data quality checks. All pure functions, no side effects.

- [ ] **Step 1: Create `lib/snow-quality.ts`**

```typescript
// ─────────────────────────────────────────────────────────────
// PeakCam — Snow Data Quality Validation
// Pure functions for SNOTEL data validation and water-year math.
// ─────────────────────────────────────────────────────────────

import type { QCFlag } from "./types";

// ── Water Year Helper ────────────────────────────────────────

/**
 * Convert a calendar date to day-of-water-year.
 * Water year runs Oct 1 (day 1) through Sep 30 (day 365/366).
 */
export function dayOfWaterYear(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  const wyStart = month >= 9
    ? new Date(year, 9, 1)       // Oct 1 this year
    : new Date(year - 1, 9, 1);  // Oct 1 last year

  const diffMs = date.getTime() - wyStart.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Get the water year for a given date.
 * Oct-Dec → current calendar year + 1. Jan-Sep → current calendar year.
 * e.g. Oct 15, 2025 → WY 2026. Mar 1, 2026 → WY 2026.
 */
export function waterYear(date: Date): number {
  return date.getMonth() >= 9 ? date.getFullYear() + 1 : date.getFullYear();
}

// ── Raw Reading (input from SNOTEL API) ──────────────────────

export interface RawSnotelReading {
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
  tempObsF: number | null;
  tempMaxF: number | null;
  tempMinF: number | null;
}

// ── Previous Day (for delta checks) ──────────────────────────

export interface PreviousDay {
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
}

// ── Quality Result ───────────────────────────────────────────

export interface QualityResult {
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
  tempObsF: number | null;
  tempMaxF: number | null;
  tempMinF: number | null;
  qcFlag: QCFlag;
  notes: string | null;
}

// ── Validation ───────────────────────────────────────────────

/**
 * Validate a single SNOTEL reading against physical limits and
 * the previous day's values. Returns cleaned values + QC flag.
 */
export function validateReading(
  current: RawSnotelReading,
  previous: PreviousDay | null,
): QualityResult {
  let qcFlag: QCFlag = "valid";
  let notes: string | null = null;
  let { snowDepthIn, sweIn, precipAccumIn } = current;

  // ── Missing data ───────────────────────────────────────────
  if (snowDepthIn == null && sweIn == null) {
    return {
      snowDepthIn: previous?.snowDepthIn ?? null,
      sweIn: previous?.sweIn ?? null,
      precipAccumIn: previous?.precipAccumIn ?? null,
      tempObsF: current.tempObsF,
      tempMaxF: current.tempMaxF,
      tempMinF: current.tempMinF,
      qcFlag: "missing",
      notes: "No snow depth or SWE reported; carried forward previous day",
    };
  }

  // ── Range checks ───────────────────────────────────────────
  if (snowDepthIn != null && (snowDepthIn < 0 || snowDepthIn > 300)) {
    notes = `Snow depth out of range (${snowDepthIn}in); using previous day`;
    snowDepthIn = previous?.snowDepthIn ?? null;
    qcFlag = "suspect";
  }

  if (sweIn != null && (sweIn < 0 || sweIn > 100)) {
    notes = `SWE out of range (${sweIn}in); using previous day`;
    sweIn = previous?.sweIn ?? null;
    qcFlag = "suspect";
  }

  // ── Spike detection (±36" in 24h) ──────────────────────────
  if (
    snowDepthIn != null &&
    previous?.snowDepthIn != null &&
    Math.abs(snowDepthIn - previous.snowDepthIn) > 36
  ) {
    const prevNotes = notes ? notes + "; " : "";
    notes = `${prevNotes}Spike detected (${previous.snowDepthIn}→${snowDepthIn}in); using previous day`;
    snowDepthIn = previous.snowDepthIn;
    qcFlag = "suspect";
  }

  // ── SWE > depth (physically impossible) ────────────────────
  if (sweIn != null && snowDepthIn != null && sweIn > snowDepthIn) {
    const prevNotes = notes ? notes + "; " : "";
    notes = `${prevNotes}SWE (${sweIn}) > depth (${snowDepthIn}); flagged suspect`;
    qcFlag = "suspect";
  }

  return {
    snowDepthIn,
    sweIn,
    precipAccumIn,
    tempObsF: current.tempObsF,
    tempMaxF: current.tempMaxF,
    tempMinF: current.tempMinF,
    qcFlag,
    notes,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/snow-quality.ts
git commit -m "feat: add snow data quality validation and water-year helpers"
```

---

## Task 4: Conditions Engine (`lib/conditions-engine.ts`)

**Files:**
- Create: `lib/conditions-engine.ts`

Pure-function module. No imports from Supabase or fetch — takes data in, returns conditions out.

- [ ] **Step 1: Create `lib/conditions-engine.ts`**

```typescript
// ─────────────────────────────────────────────────────────────
// PeakCam — Conditions Engine
// Pure functions that compute condition rating, trend, outlook
// from SNOTEL data, 30-year normals, and NWS forecast.
// ─────────────────────────────────────────────────────────────

import type { ConditionRating } from "./types";

// ── Inputs ───────────────────────────────────────────────────

export interface ConditionsInput {
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
    /** Last 7 days of SWE values, oldest first. May contain nulls. */
    sweValues: (number | null)[];
  };
  forecast: {
    /** Sum of estimated snow (inches) over the next 48 hours. */
    snowInchesNext48h: number;
    /** Highest forecast high temperature (°F) in the next 48 hours. */
    maxHighTemp48h: number;
  };
}

// ── Outputs ──────────────────────────────────────────────────

export type SnowTrend = "rising" | "falling" | "stable";
export type SnowOutlook = "more_snow" | "stable" | "warming" | "melt_risk";

export interface ConditionsOutput {
  condRating: ConditionRating;
  pctOfNormal: number | null;
  trend7d: SnowTrend;
  outlook: SnowOutlook;
  outlookLabel: string;
}

// ── Thresholds (tunable) ─────────────────────────────────────

export const RATING_THRESHOLDS = {
  great: { newSnow24h: 6, newSnow48h: 12 },
  good:  { newSnow24h: 2, pctOfNormal: 100, minDepth: 24 },
  fair:  { pctOfNormal: 70, minDepth: 20 },
} as const;

const TREND_THRESHOLD_IN = 0.5;  // SWE change in inches
const SNOW_FORECAST_THRESHOLD = 3; // inches for "more_snow"
const WARM_TEMP_THRESHOLD = 40;    // °F for warming/melt

// ── Percent of Normal ────────────────────────────────────────

export function computePctOfNormal(
  currentSweIn: number | null,
  medianSweIn: number | null,
): number | null {
  if (currentSweIn == null || medianSweIn == null || medianSweIn <= 0) {
    return null;
  }
  return Math.round((currentSweIn / medianSweIn) * 100);
}

// ── Trend ────────────────────────────────────────────────────

export function computeTrend(sweValues: (number | null)[]): SnowTrend {
  // Need at least 3 days of data to determine a trend
  const valid = sweValues.filter((v): v is number => v != null);
  if (valid.length < 3) return "stable";

  const oldest = valid[0];
  const newest = valid[valid.length - 1];
  const delta = newest - oldest;

  if (delta > TREND_THRESHOLD_IN) return "rising";
  if (delta < -TREND_THRESHOLD_IN) return "falling";
  return "stable";
}

// ── Outlook ──────────────────────────────────────────────────

export function computeOutlook(
  trend: SnowTrend,
  snowInchesNext48h: number,
  maxHighTemp48h: number,
): { outlook: SnowOutlook; outlookLabel: string } {
  // Evaluated top-to-bottom, first match wins
  if (snowInchesNext48h >= SNOW_FORECAST_THRESHOLD) {
    return {
      outlook: "more_snow",
      outlookLabel: `More snow expected — ${snowInchesNext48h}" in the forecast`,
    };
  }

  if (trend === "falling" && maxHighTemp48h >= WARM_TEMP_THRESHOLD) {
    return {
      outlook: "melt_risk",
      outlookLabel: `Warming trend — highs near ${maxHighTemp48h}°F, base may soften`,
    };
  }

  if (maxHighTemp48h >= WARM_TEMP_THRESHOLD) {
    return {
      outlook: "warming",
      outlookLabel: `Mild temps ahead — highs near ${maxHighTemp48h}°F`,
    };
  }

  return {
    outlook: "stable",
    outlookLabel: "Steady conditions expected",
  };
}

// ── Condition Rating ─────────────────────────────────────────

export function computeConditionRating(
  newSnow24h: number,
  newSnow48h: number,
  snowDepthIn: number | null,
  pctOfNormal: number | null,
): ConditionRating {
  const t = RATING_THRESHOLDS;

  // Great: big dump
  if (newSnow24h >= t.great.newSnow24h || newSnow48h >= t.great.newSnow48h) {
    return "great";
  }

  // Good: moderate new snow OR healthy snowpack
  if (newSnow24h >= t.good.newSnow24h) return "good";
  if (
    pctOfNormal != null &&
    pctOfNormal >= t.good.pctOfNormal &&
    snowDepthIn != null &&
    snowDepthIn >= t.good.minDepth
  ) {
    return "good";
  }

  // Fair: adequate base, reasonable snowpack
  if (
    snowDepthIn != null &&
    snowDepthIn >= t.fair.minDepth &&
    (pctOfNormal == null || pctOfNormal >= t.fair.pctOfNormal)
  ) {
    return "fair";
  }

  // Poor: everything else
  return "poor";
}

// ── Main Entry Point ─────────────────────────────────────────

/**
 * Compute all conditions from inputs. Pure function — no side effects.
 */
export function computeConditions(input: ConditionsInput): ConditionsOutput {
  const pctOfNormal = computePctOfNormal(
    input.current.sweIn,
    input.normals.medianSweIn,
  );

  const trend7d = computeTrend(input.history7d.sweValues);

  const { outlook, outlookLabel } = computeOutlook(
    trend7d,
    input.forecast.snowInchesNext48h,
    input.forecast.maxHighTemp48h,
  );

  const condRating = computeConditionRating(
    input.current.newSnow24h,
    input.current.newSnow48h,
    input.current.snowDepthIn,
    pctOfNormal,
  );

  return { condRating, pctOfNormal, trend7d, outlook, outlookLabel };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/conditions-engine.ts
git commit -m "feat: add conditions engine — rating, trend, outlook computation"
```

---

## Task 5: Install `tsx` and Update Package Scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install tsx**

```bash
npm install --save-dev tsx
```

- [ ] **Step 2: Update snotel-sync script in package.json**

Change the existing `snotel-sync` script and add the new seed script:

In `package.json` `"scripts"` section, change:
```json
"snotel-sync": "tsx scripts/snotel-sync.ts",
"seed-normals": "tsx scripts/seed-snotel-normals.ts"
```

Keep the old `"snotel-sync": "node scripts/snotel-sync.mjs"` entry removed — the new `.ts` version replaces it.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add tsx for TypeScript script execution, update snotel-sync script"
```

---

## Task 6: Enhanced Sync Script (`scripts/snotel-sync.ts`)

**Files:**
- Create: `scripts/snotel-sync.ts`
- Keep: `scripts/snotel-sync.mjs` (for reference, delete later)

This is the largest task. The new script replaces the old `.mjs` with a TypeScript version that:
1. Fetches expanded SNOTEL data (adds SWE, temps)
2. Validates via `snow-quality.ts`
3. Writes to `snowpack_daily`
4. Looks up normals
5. Computes conditions via `conditions-engine.ts`
6. Inserts into `snow_reports` (only when data changed)
7. Updates `resorts.cond_rating`

- [ ] **Step 1: Create `scripts/snotel-sync.ts`**

```typescript
#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// snotel-sync.ts — Enhanced SNOTEL data sync with conditions engine
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateReading, dayOfWaterYear, type RawSnotelReading, type PreviousDay } from "../lib/snow-quality";
import { computeConditions, type ConditionsInput } from "../lib/conditions-engine";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Load .env.local ──────────────────────────────────────────

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
const NWS_USER_AGENT = "PeakCam/1.0 (contact@peakcam.app)";

// ── Helpers ──────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface Resort {
  id: string;
  name: string;
  state: string;
  snotel_station_id: string;
}

// ── Supabase helpers ─────────────────────────────────────────

const supaHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function supaFetch(path: string, init?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: { ...supaHeaders, ...init?.headers },
  });
}

// ── Step 1: Fetch resorts ────────────────────────────────────

async function fetchResorts(): Promise<Resort[]> {
  const resp = await supaFetch(
    "/resorts?select=id,name,state,snotel_station_id&is_active=eq.true&snotel_station_id=not.is.null"
  );
  if (!resp.ok) throw new Error(`Resorts fetch failed: ${resp.status}`);
  return resp.json();
}

// ── Step 2: Fetch SNOTEL data ────────────────────────────────

interface SnotelApiReading {
  snowDepthIn: number | null;
  sweIn: number | null;
  precipAccumIn: number | null;
  tempObsF: number | null;
  tempMaxF: number | null;
  tempMinF: number | null;
}

async function fetchSnotelData(
  stationId: string,
  stateCode: string,
  days: number = 8,
): Promise<SnotelApiReading[] | null> {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);

  const triplet = `${stationId}:${stateCode}:SNTL`;
  const params = new URLSearchParams({
    stationTriplets: triplet,
    elements: "SNWD,WTEQ,PREC,TOBS,TMAX,TMIN",
    duration: "DAILY",
    getFlags: "false",
    beginDate: fmtDate(start),
    endDate: fmtDate(now),
  });

  const resp = await fetch(`${SNOTEL_BASE}/data?${params}`);
  if (!resp.ok) return null;

  const json = await resp.json();
  if (!json.length || !json[0].data?.length) return null;

  // Parse element arrays into daily readings
  const elemData: Record<string, { date: string; value: number | null }[]> = {};
  for (const elem of json[0].data) {
    const code = elem.stationElement?.elementCode;
    if (code) {
      elemData[code] = (elem.values || []).map((v: { date: string; value: number }) => ({
        date: v.date?.slice(0, 10),
        value: v.value === -99 ? null : v.value,
      }));
    }
  }

  // Get all unique dates
  const allDates = new Set<string>();
  for (const vals of Object.values(elemData)) {
    for (const v of vals) if (v.date) allDates.add(v.date);
  }

  const sorted = [...allDates].sort();
  const getVal = (code: string, date: string): number | null => {
    const entry = elemData[code]?.find((v) => v.date === date);
    return entry?.value ?? null;
  };

  return sorted.map((date) => ({
    snowDepthIn: getVal("SNWD", date) != null ? Math.round(getVal("SNWD", date)!) : null,
    sweIn: getVal("WTEQ", date),
    precipAccumIn: getVal("PREC", date),
    tempObsF: getVal("TOBS", date) != null ? Math.round(getVal("TOBS", date)!) : null,
    tempMaxF: getVal("TMAX", date) != null ? Math.round(getVal("TMAX", date)!) : null,
    tempMinF: getVal("TMIN", date) != null ? Math.round(getVal("TMIN", date)!) : null,
  }));
}

// ── Step 3: Get previous day from snowpack_daily ─────────────

async function getPreviousDay(resortId: string): Promise<PreviousDay | null> {
  const resp = await supaFetch(
    `/snowpack_daily?resort_id=eq.${resortId}&order=date.desc&limit=1`
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  if (!rows.length) return null;
  return {
    snowDepthIn: rows[0].snow_depth_in,
    sweIn: rows[0].swe_in,
    precipAccumIn: rows[0].precip_accum_in,
  };
}

// ── Step 4: Upsert snowpack_daily ────────────────────────────

async function upsertSnowpackDaily(
  resortId: string,
  stationId: string,
  date: string,
  data: ReturnType<typeof validateReading>,
): Promise<void> {
  const body = {
    resort_id: resortId,
    station_id: stationId,
    date,
    snow_depth_in: data.snowDepthIn,
    swe_in: data.sweIn,
    precip_accum_in: data.precipAccumIn,
    temp_obs_f: data.tempObsF,
    temp_max_f: data.tempMaxF,
    temp_min_f: data.tempMinF,
    qc_flag: data.qcFlag,
  };

  await supaFetch("/snowpack_daily", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
}

// ── Step 5: Lookup normals ───────────────────────────────────

async function getNormals(stationId: string, dowy: number) {
  const resp = await supaFetch(
    `/snotel_normals?station_id=eq.${stationId}&day_of_water_year=eq.${dowy}`
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows.length ? rows[0] : null;
}

// ── Step 6: Get 7-day SWE history ────────────────────────────

async function get7dSwe(resortId: string): Promise<(number | null)[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const resp = await supaFetch(
    `/snowpack_daily?resort_id=eq.${resortId}&date=gte.${fmtDate(sevenDaysAgo)}&order=date.asc&select=swe_in`
  );
  if (!resp.ok) return [];
  const rows = await resp.json();
  return rows.map((r: { swe_in: number | null }) => r.swe_in);
}

// ── Step 7: Get NWS forecast summary ─────────────────────────

async function getNwsForecastSummary(
  lat: number,
  lng: number,
): Promise<{ snowInchesNext48h: number; maxHighTemp48h: number }> {
  try {
    const pointsRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
      { headers: { "User-Agent": NWS_USER_AGENT } },
    );
    if (!pointsRes.ok) return { snowInchesNext48h: 0, maxHighTemp48h: 32 };

    const pointsData = await pointsRes.json();
    const forecastUrl: string = pointsData?.properties?.forecast;
    if (!forecastUrl) return { snowInchesNext48h: 0, maxHighTemp48h: 32 };

    const forecastRes = await fetch(forecastUrl, {
      headers: { "User-Agent": NWS_USER_AGENT },
    });
    if (!forecastRes.ok) return { snowInchesNext48h: 0, maxHighTemp48h: 32 };

    const forecastData = await forecastRes.json();
    const periods = forecastData?.properties?.periods ?? [];

    // Aggregate first 4 periods (~48h)
    let snowTotal = 0;
    let maxHigh = -999;
    for (let i = 0; i < Math.min(4, periods.length); i++) {
      const p = periods[i];
      const lower = (p.shortForecast || "").toLowerCase();
      if (lower.includes("heavy snow") || lower.includes("blizzard")) snowTotal += 8;
      else if (lower.includes("snow")) snowTotal += 3;
      else if (lower.includes("flurr")) snowTotal += 1;
      if (p.isDaytime && p.temperature > maxHigh) maxHigh = p.temperature;
    }

    return {
      snowInchesNext48h: snowTotal,
      maxHighTemp48h: maxHigh > -999 ? maxHigh : 32,
    };
  } catch {
    return { snowInchesNext48h: 0, maxHighTemp48h: 32 };
  }
}

// ── Step 8: Insert snow_reports ───────────────────────────────

async function insertSnowReport(
  resortId: string,
  baseDepth: number | null,
  newSnow24h: number | null,
  newSnow48h: number | null,
  sweIn: number | null,
  pctOfNormal: number | null,
  trend7d: string,
  outlook: string,
  autoCondRating: string,
): Promise<void> {
  const body = {
    resort_id: resortId,
    base_depth: baseDepth,
    new_snow_24h: newSnow24h,
    new_snow_48h: newSnow48h,
    swe_in: sweIn,
    pct_of_normal: pctOfNormal,
    trend_7d: trend7d,
    outlook,
    auto_cond_rating: autoCondRating,
    source: "snotel",
    updated_at: new Date().toISOString(),
  };

  await supaFetch("/snow_reports", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Step 9: Update resort cond_rating ────────────────────────

async function updateResortRating(resortId: string, rating: string): Promise<void> {
  await supaFetch(`/resorts?id=eq.${resortId}`, {
    method: "PATCH",
    body: JSON.stringify({ cond_rating: rating }),
  });
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("[snotel-sync] Starting enhanced SNOTEL sync...");

  const resorts = await fetchResorts();
  console.log(`[snotel-sync] ${resorts.length} resorts with SNOTEL stations`);

  // Also fetch lat/lng for NWS forecasts
  const resortsFullResp = await supaFetch(
    `/resorts?select=id,lat,lng&is_active=eq.true&snotel_station_id=not.is.null`
  );
  const resortsFull: { id: string; lat: number; lng: number }[] = await resortsFullResp.json();
  const coordsMap = new Map(resortsFull.map((r) => [r.id, { lat: r.lat, lng: r.lng }]));

  let success = 0, failed = 0, skipped = 0;
  const today = fmtDate(new Date());
  const dowy = dayOfWaterYear(new Date());

  for (const resort of resorts) {
    try {
      // 1. Fetch SNOTEL data (last 8 days for delta calcs)
      const readings = await fetchSnotelData(resort.snotel_station_id, resort.state);
      if (!readings || readings.length === 0) {
        console.log(`  SKIP ${resort.name} — no SNOTEL data`);
        skipped++;
        continue;
      }

      // 2. Get previous day for quality checks
      const prevDay = await getPreviousDay(resort.id);

      // 3. Validate latest reading
      const latest = readings[readings.length - 1];
      const raw: RawSnotelReading = {
        snowDepthIn: latest.snowDepthIn,
        sweIn: latest.sweIn,
        precipAccumIn: latest.precipAccumIn,
        tempObsF: latest.tempObsF,
        tempMaxF: latest.tempMaxF,
        tempMinF: latest.tempMinF,
      };
      const validated = validateReading(raw, prevDay);

      // 4. Upsert to snowpack_daily
      await upsertSnowpackDaily(resort.id, resort.snotel_station_id, today, validated);

      // 5. Compute new snow deltas
      let newSnow24h = 0;
      let newSnow48h = 0;
      if (readings.length >= 2 && validated.snowDepthIn != null) {
        const prev1 = readings[readings.length - 2];
        if (prev1.snowDepthIn != null) {
          const delta = validated.snowDepthIn - prev1.snowDepthIn;
          newSnow24h = delta > 0 ? delta : 0;
        }
      }
      if (readings.length >= 3 && validated.snowDepthIn != null) {
        const prev2 = readings[readings.length - 3];
        if (prev2.snowDepthIn != null) {
          const delta = validated.snowDepthIn - prev2.snowDepthIn;
          newSnow48h = delta > 0 ? delta : 0;
        }
      }

      // 6. Lookup normals
      const normals = await getNormals(resort.snotel_station_id, dowy);

      // 7. Get 7-day SWE history
      const sweHistory = await get7dSwe(resort.id);

      // 8. Get NWS forecast
      const coords = coordsMap.get(resort.id);
      const forecast = coords
        ? await getNwsForecastSummary(coords.lat, coords.lng)
        : { snowInchesNext48h: 0, maxHighTemp48h: 32 };

      // 9. Run conditions engine
      const condInput: ConditionsInput = {
        current: {
          snowDepthIn: validated.snowDepthIn,
          sweIn: validated.sweIn,
          newSnow24h,
          newSnow48h,
        },
        normals: {
          medianSweIn: normals?.median_swe_in ?? null,
          pctile10SweIn: normals?.pctile_10_swe_in ?? null,
          pctile90SweIn: normals?.pctile_90_swe_in ?? null,
        },
        history7d: { sweValues: sweHistory },
        forecast,
      };

      const result = computeConditions(condInput);

      // 10. Insert snow report
      await insertSnowReport(
        resort.id,
        validated.snowDepthIn,
        newSnow24h,
        newSnow48h,
        validated.sweIn,
        result.pctOfNormal,
        result.trend7d,
        result.outlook,
        result.condRating,
      );

      // 11. Update resort condition rating
      await updateResortRating(resort.id, result.condRating);

      console.log(
        `  OK   ${resort.name} — base:${validated.snowDepthIn ?? "?"}″ ` +
        `swe:${validated.sweIn ?? "?"}″ ` +
        `pct:${result.pctOfNormal ?? "?"}% ` +
        `${result.condRating} ${result.trend7d} ${result.outlook} ` +
        `[${validated.qcFlag}]`
      );
      success++;
    } catch (err) {
      console.error(`  FAIL ${resort.name} — ${(err as Error).message}`);
      failed++;
    }

    await sleep(300); // Rate limit (SNOTEL + NWS)
  }

  console.log(
    `\n[snotel-sync] Done. ${success} synced, ${skipped} skipped, ${failed} failed`
  );
}

main().catch((err) => {
  console.error("[snotel-sync] Fatal:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it runs**

```bash
npm run snotel-sync
```

Expected: Script fetches data for all SNOTEL-linked resorts, validates readings, writes to `snowpack_daily`, computes conditions, inserts into `snow_reports`, updates `resorts.cond_rating`. Output shows per-resort status lines.

- [ ] **Step 3: Commit**

```bash
git add scripts/snotel-sync.ts
git commit -m "feat: enhanced snotel-sync with quality checks, history, and conditions engine"
```

---

## Task 7: Normals Seed Script (`scripts/seed-snotel-normals.ts`)

**Files:**
- Create: `scripts/seed-snotel-normals.ts`

This script fetches period-of-record SNOTEL data for each station, computes median/percentile SWE by day-of-water-year, and writes to `snotel_normals`.

- [ ] **Step 1: Create `scripts/seed-snotel-normals.ts`**

```typescript
#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// seed-snotel-normals.ts — Seed 30-year SNOTEL normals
// Fetches period-of-record daily SWE for each station,
// computes median + percentiles by day-of-water-year.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dayOfWaterYear } from "../lib/snow-quality";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Load env ─────────────────────────────────────────────────

function loadEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

loadEnv(path.join(ROOT, ".env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SNOTEL_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing env vars");
  process.exit(1);
}

const supaHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Stats helpers ────────────────────────────────────────────

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("[seed-normals] Fetching resorts with SNOTEL IDs...");

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/resorts?select=snotel_station_id,state&is_active=eq.true&snotel_station_id=not.is.null`,
    { headers: supaHeaders },
  );
  const resorts: { snotel_station_id: string; state: string }[] = await resp.json();

  // Dedupe stations (multiple resorts may share a station)
  const stations = new Map<string, string>();
  for (const r of resorts) {
    if (!stations.has(r.snotel_station_id)) {
      stations.set(r.snotel_station_id, r.state);
    }
  }

  console.log(`[seed-normals] ${stations.size} unique SNOTEL stations to process`);

  for (const [stationId, stateCode] of stations) {
    console.log(`  Processing ${stationId}:${stateCode}:SNTL...`);

    try {
      // Fetch period-of-record WTEQ (SWE) data
      const triplet = `${stationId}:${stateCode}:SNTL`;
      const params = new URLSearchParams({
        stationTriplets: triplet,
        elements: "WTEQ,SNWD",
        duration: "DAILY",
        getFlags: "false",
        beginDate: "1991-10-01",
        endDate: "2020-09-30",
      });

      const apiResp = await fetch(`${SNOTEL_BASE}/data?${params}`);
      if (!apiResp.ok) {
        console.log(`    SKIP — API returned ${apiResp.status}`);
        await sleep(500);
        continue;
      }

      const json = await apiResp.json();
      if (!json.length || !json[0].data?.length) {
        console.log(`    SKIP — no period-of-record data`);
        await sleep(500);
        continue;
      }

      // Build day-of-water-year buckets
      const sweBuckets = new Map<number, number[]>();
      const depthBuckets = new Map<number, number[]>();

      for (const elem of json[0].data) {
        const code = elem.stationElement?.elementCode;
        for (const val of elem.values || []) {
          if (val.value == null || val.value === -99 || !val.date) continue;
          const date = new Date(val.date);
          const dowy = dayOfWaterYear(date);

          if (code === "WTEQ") {
            if (!sweBuckets.has(dowy)) sweBuckets.set(dowy, []);
            sweBuckets.get(dowy)!.push(val.value);
          }
          if (code === "SNWD") {
            if (!depthBuckets.has(dowy)) depthBuckets.set(dowy, []);
            depthBuckets.get(dowy)!.push(val.value);
          }
        }
      }

      // Delete existing normals for this station
      await fetch(
        `${SUPABASE_URL}/rest/v1/snotel_normals?station_id=eq.${stationId}`,
        { method: "DELETE", headers: supaHeaders },
      );

      // Compute stats and insert
      const rows: object[] = [];
      for (let dowy = 1; dowy <= 366; dowy++) {
        const sweVals = sweBuckets.get(dowy);
        const depthVals = depthBuckets.get(dowy);

        if (!sweVals?.length && !depthVals?.length) continue;

        rows.push({
          station_id: stationId,
          day_of_water_year: dowy,
          median_swe_in: sweVals?.length ? Math.round(median(sweVals) * 10) / 10 : null,
          median_depth_in: depthVals?.length ? Math.round(median(depthVals)) : null,
          pctile_10_swe_in: sweVals?.length ? Math.round(percentile(sweVals, 10) * 10) / 10 : null,
          pctile_90_swe_in: sweVals?.length ? Math.round(percentile(sweVals, 90) * 10) / 10 : null,
          refreshed_at: new Date().toISOString(),
        });
      }

      // Batch insert (Supabase REST supports array body)
      if (rows.length > 0) {
        const insertResp = await fetch(
          `${SUPABASE_URL}/rest/v1/snotel_normals`,
          {
            method: "POST",
            headers: supaHeaders,
            body: JSON.stringify(rows),
          },
        );
        if (!insertResp.ok) {
          console.log(`    ERROR inserting — ${insertResp.status}: ${await insertResp.text()}`);
        } else {
          console.log(`    OK — ${rows.length} days of normals`);
        }
      }
    } catch (err) {
      console.error(`    FAIL — ${(err as Error).message}`);
    }

    await sleep(1000); // Be polite to NRCS
  }

  console.log("\n[seed-normals] Done.");
}

main().catch((err) => {
  console.error("[seed-normals] Fatal:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run the seed script**

```bash
npm run seed-normals
```

Expected: Script fetches 30-year SWE/SNWD data for each unique station, computes median + percentiles, inserts into `snotel_normals`. May take several minutes due to large API responses.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-snotel-normals.ts
git commit -m "feat: add SNOTEL normals seed script for 30-year medians"
```

---

## Task 8: Verify End-to-End & Clean Up

**Files:**
- Delete: `scripts/snotel-sync.mjs` (replaced by `.ts`)

- [ ] **Step 1: Run the full sync pipeline**

```bash
npm run snotel-sync
```

Verify in Supabase dashboard:
1. `snowpack_daily` table has rows for today's date
2. `snow_reports` has new rows with `swe_in`, `pct_of_normal`, `trend_7d`, `outlook`, `auto_cond_rating` populated
3. `resorts` table has updated `cond_rating` values (no longer all "good")

- [ ] **Step 2: Verify normals lookup**

In Supabase SQL Editor:
```sql
select * from snotel_normals where station_id = '622' order by day_of_water_year limit 10;
```

Expected: Rows with median_swe_in, pctile_10/90 values for Vail's SNOTEL station.

- [ ] **Step 3: Verify conditions output**

```sql
select r.name, sr.base_depth, sr.swe_in, sr.pct_of_normal, sr.trend_7d, sr.outlook, sr.auto_cond_rating
from latest_snow_reports sr
join resorts r on r.id = sr.resort_id
order by r.name
limit 20;
```

Expected: Resorts showing computed conditions data.

- [ ] **Step 4: Delete old sync script**

```bash
rm scripts/snotel-sync.mjs
```

- [ ] **Step 5: Run build to verify nothing broke**

```bash
npm run build
```

Expected: Build succeeds. The new types in `lib/types.ts` are additive (nullable columns) so existing UI code should not break.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: remove old snotel-sync.mjs, verify end-to-end pipeline"
```
