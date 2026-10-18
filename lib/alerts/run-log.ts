// ─────────────────────────────────────────────────────────────
// Run log for /api/alerts/trigger (powder_alert_runs, migration 023) and
// the server-side PostHog event per run.
//
// Both are best-effort: a missing table, a slow database or an unreachable
// PostHog host must never fail the run that sends the alerts. Every
// function here catches and logs. `shapeRunRow` is pure and unit-tested.
// ─────────────────────────────────────────────────────────────

import { serviceFetch } from "./service-fetch";

export const RUN_EVENT_NAME = "powder_alert_run";
const RUN_DISTINCT_ID = "peakcam-alerts-cron";
const POSTHOG_TIMEOUT_MS = 3_000;

/** The trigger's response body, as far as the run log cares. */
export interface TriggerSummaryLike {
  ok?: boolean;
  attempted?: number;
  sent?: number;
  failed?: number;
  logFailures?: number;
  errors?: string[];
  error?: string;
  subscribers?: number;
  openings?: { failed?: number; errors?: string[] } | null;
  webhooks?: { delivered?: number; failed?: number; errors?: string[] } | null;
  freshness?: { stale?: boolean } | null;
}

export interface RunRow {
  finished_at: string;
  subscribers: number | null;
  alerts_sent: number;
  webhooks_sent: number;
  errors: string[];
  summary: Record<string, unknown>;
}

/**
 * Flattens the trigger's response into the run row. Error strings from the
 * side branches are prefixed so "log_insert_failed" from the opening-day
 * branch is distinguishable from the powder branch's.
 */
export function shapeRunRow(summary: TriggerSummaryLike, finishedAt: Date, status: number): RunRow {
  const errors: string[] = [];
  const add = (prefix: string, list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (typeof item !== "string") continue;
      const value = prefix ? `${prefix}:${item}` : item;
      if (!errors.includes(value)) errors.push(value);
    }
  };
  add("", summary.errors);
  if (typeof summary.error === "string" && summary.error) add("", [summary.error]);
  add("openings", summary.openings?.errors);
  add("webhook", summary.webhooks?.errors);
  if (summary.freshness?.stale === true && !errors.includes("feed_stale")) errors.push("feed_stale");

  return {
    finished_at: finishedAt.toISOString(),
    subscribers: typeof summary.subscribers === "number" ? summary.subscribers : null,
    alerts_sent: typeof summary.sent === "number" ? summary.sent : 0,
    webhooks_sent: typeof summary.webhooks?.delivered === "number" ? summary.webhooks.delivered : 0,
    errors,
    summary: { ...(summary as Record<string, unknown>), http_status: status },
  };
}

/** Opens a run row; returns its id, or null when the write failed (logged). */
export async function openRun(startedAt: Date): Promise<string | null> {
  try {
    const resp = await serviceFetch("/powder_alert_runs", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ started_at: startedAt.toISOString() }),
    });
    if (!resp.ok) {
      console.error(`[alerts/trigger] run log open failed: HTTP ${resp.status} (migration 023 applied?)`);
      return null;
    }
    const rows = (await resp.json()) as Array<{ id?: string }>;
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error("[alerts/trigger] run log open threw:", err);
    return null;
  }
}

/** Closes the run row. Returns true when the update was accepted. */
export async function closeRun(runId: string | null, row: RunRow): Promise<boolean> {
  if (!runId) return false;
  try {
    const resp = await serviceFetch(`/powder_alert_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
    if (!resp.ok) console.error(`[alerts/trigger] run log close failed: HTTP ${resp.status}`);
    return resp.ok;
  } catch (err) {
    console.error("[alerts/trigger] run log close threw:", err);
    return false;
  }
}

/**
 * One server-side PostHog event per run, sent with plain fetch to the
 * project's ingestion host — no SDK, no new dependency. Skipped when the
 * key is unset (local, tests). Never throws.
 */
export async function capturePostHogEvent(
  event: string,
  properties: Record<string, unknown>,
  options: { fetchImpl?: typeof fetch; distinctId?: string } = {},
): Promise<boolean> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return false;
  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const resp = await fetchImpl(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: options.distinctId ?? RUN_DISTINCT_ID,
        properties: { ...properties, $lib: "peakcam-server", $process_person_profile: false },
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
    });
    if (!resp.ok) console.error(`[alerts/trigger] PostHog capture failed: HTTP ${resp.status}`);
    return resp.ok;
  } catch (err) {
    console.error("[alerts/trigger] PostHog capture threw:", err);
    return false;
  }
}

/** The properties the run event carries: counts only, no addresses or tokens. */
export function runEventProperties(row: RunRow, startedAt: Date, finishedAt: Date, status: number): Record<string, unknown> {
  return {
    http_status: status,
    ok: status < 400,
    duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    subscribers: row.subscribers,
    alerts_sent: row.alerts_sent,
    webhooks_sent: row.webhooks_sent,
    error_count: row.errors.length,
    errors: row.errors,
  };
}
