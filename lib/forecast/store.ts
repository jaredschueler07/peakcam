// ─────────────────────────────────────────────────────────────
// Stored forecasts (migration 027) — row shapes and the pure helpers that
// turn `forecast_runs` + `forecast_daily` rows back into runs the blend
// and the scorer consume. No Supabase here: lib/supabase.ts fetches the
// rows for the app, scripts/forecast-*.ts fetch them over PostgREST, and
// the tests build them by hand.
// ─────────────────────────────────────────────────────────────

import type { ForecastPoint, ModelDay } from "./open-meteo-models";

export interface ForecastRunRow {
  id: string;
  resort_id: string;
  point: ForecastPoint;
  model: string;
  /** ISO instant (timestamptz). */
  issued_at: string;
  horizon_days: number;
}

export interface ForecastDailyRow {
  run_id: string;
  /** YYYY-MM-DD. */
  date: string;
  snowfall_cm: number | null;
  snowfall_lo: number | null;
  snowfall_hi: number | null;
  temp_max: number | null;
  temp_min: number | null;
  precip_prob: number | null;
  wind_gust: number | null;
  weather_code: number | null;
}

export interface ForecastScoreRow {
  resort_id: string;
  model: string;
  period_days: number;
  day1_mae: number | null;
  day3_mae: number | null;
  day7_mae: number | null;
  samples: number | null;
  bias_ratio: number | null;
  computed_at: string;
}

/** A run with its days attached, as the blend, the API and the scorer see it. */
export interface StoredRun {
  id: string;
  point: ForecastPoint;
  model: string;
  /** ISO instant. */
  issuedAt: string;
  horizonDays: number;
  daily: ModelDay[];
}

/** The runs the API serves: the newest per (point, model). */
export interface StoredForecast {
  runs: StoredRun[];
}

const toNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** The newest run per (point, model). Rows may arrive in any order. */
export function latestRunsPerModel(rows: readonly ForecastRunRow[]): ForecastRunRow[] {
  const best = new Map<string, ForecastRunRow>();
  for (const row of rows) {
    const key = `${row.point}:${row.model}`;
    const cur = best.get(key);
    if (!cur || Date.parse(row.issued_at) > Date.parse(cur.issued_at)) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => a.point.localeCompare(b.point) || a.model.localeCompare(b.model));
}

/** Attach daily rows (numeric columns may come back as strings from PostgREST) to their runs, days in date order. */
export function assembleStoredRuns(runs: readonly ForecastRunRow[], daily: readonly ForecastDailyRow[]): StoredRun[] {
  const byRun = new Map<string, ModelDay[]>();
  for (const row of daily) {
    if (!byRun.has(row.run_id)) byRun.set(row.run_id, []);
    byRun.get(row.run_id)!.push({
      date: row.date,
      snowfallCm: toNum(row.snowfall_cm),
      tempMaxC: toNum(row.temp_max),
      tempMinC: toNum(row.temp_min),
      precipProb: toNum(row.precip_prob),
      windGustKmh: toNum(row.wind_gust),
      weatherCode: toNum(row.weather_code),
    });
  }
  return runs.map((run) => {
    const days = (byRun.get(run.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    return {
      id: run.id,
      point: run.point,
      model: run.model,
      issuedAt: new Date(run.issued_at).toISOString(),
      horizonDays: run.horizon_days,
      daily: days,
    };
  });
}

/** Runs for one point; falls back to the other point when the asked one has none. */
export function runsForPoint(stored: StoredForecast | null | undefined, point: ForecastPoint): { point: ForecastPoint; runs: StoredRun[] } {
  const all = stored?.runs ?? [];
  const asked = all.filter((r) => r.point === point);
  if (asked.length) return { point, runs: asked };
  const other: ForecastPoint = point === "summit" ? "base" : "summit";
  return { point: other, runs: all.filter((r) => r.point === other) };
}

/** Newest issue instant across the runs, or null. */
export function newestIssuedAt(runs: readonly StoredRun[]): string | null {
  let best: number | null = null;
  for (const r of runs) {
    const ms = Date.parse(r.issuedAt);
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

/** Start of the UTC hour an instant falls in, as an ISO string — the sync job's idempotency key. */
export function issueHour(at: Date): string {
  const d = new Date(at);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}
