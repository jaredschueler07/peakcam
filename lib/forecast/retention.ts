// ─────────────────────────────────────────────────────────────
// Retention rule for stored forecast runs (scripts/forecast-sync.ts).
// Pure so it can be tested without a database:
//   - runs older than THIN_AFTER_DAYS are thinned to the newest per
//     (point, model, UTC day) — the scorer grades the day's newest run;
//   - runs older than DELETE_AFTER_DAYS are deleted;
//   - the newest run of a (point, model) that has nothing more recent than
//     DELETE_AFTER_DAYS is always kept, so a model that stopped updating
//     still has a row.
// ─────────────────────────────────────────────────────────────

import type { ForecastRunRow } from "./store";

export const THIN_AFTER_DAYS = 7;
export const DELETE_AFTER_DAYS = 120;

/**
 * Ids to delete. `rows` are every run of one resort older than
 * THIN_AFTER_DAYS; `recentKeys` are the `point:model` keys that have a run
 * newer than DELETE_AFTER_DAYS.
 */
export function selectRunsToDelete(rows: readonly ForecastRunRow[], recentKeys: ReadonlySet<string>, now: Date): string[] {
  const deleteCutoff = now.getTime() - DELETE_AFTER_DAYS * 86_400_000;
  const newestPerKey = new Map<string, ForecastRunRow>();
  const newestPerKeyDay = new Map<string, ForecastRunRow>();
  const dayOf = (r: ForecastRunRow): string => new Date(r.issued_at).toISOString().slice(0, 10);
  for (const r of rows) {
    const key = `${r.point}:${r.model}`;
    const ms = Date.parse(r.issued_at);
    const cur = newestPerKey.get(key);
    if (!cur || ms > Date.parse(cur.issued_at)) newestPerKey.set(key, r);
    const dayKey = `${key}:${dayOf(r)}`;
    const curDay = newestPerKeyDay.get(dayKey);
    if (!curDay || ms > Date.parse(curDay.issued_at)) newestPerKeyDay.set(dayKey, r);
  }
  const out: string[] = [];
  for (const r of rows) {
    const key = `${r.point}:${r.model}`;
    const dayKey = `${key}:${dayOf(r)}`;
    const ms = Date.parse(r.issued_at);
    if (newestPerKey.get(key)?.id === r.id && !recentKeys.has(key)) continue; // the model's last row ever
    if (ms < deleteCutoff) {
      out.push(r.id);
      continue;
    }
    if (newestPerKeyDay.get(dayKey)?.id !== r.id) out.push(r.id);
  }
  return out;
}
