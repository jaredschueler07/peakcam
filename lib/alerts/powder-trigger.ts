// ─────────────────────────────────────────────────────────────
// Powder-alert selection — the decision layer of GET/POST /api/alerts/trigger.
//
// Extracted from the route handler so the rules below can be tested without a
// database or a mail provider. The route stays responsible for I/O only.
//
// Three rules decide whether a (subscriber, resort) pair earns an email:
//
//  1. Threshold — new_snow_24h must reach the subscriber's threshold_inches.
//
//  2. Report freshness — the snow report backing that number must be recent.
//     `latest_snow_reports` holds the newest row per resort with no upper bound
//     on its age, so a dead snotel-sync leaves last week's 14" sitting there
//     looking like today's. Without this rule the cron would keep mailing that
//     stale number every day until someone noticed the feed was down.
//
//  3. Storm cooldown — the reason this module exists. The alert log is unique
//     on (subscriber, resort, alert_date), which dedups only *within* one
//     calendar day, and the cron runs once a day, so that constraint never
//     rejected anything. A three-day storm that keeps new_snow_24h above the
//     threshold therefore produced three emails for what a reader experiences
//     as one event. A pair alerted within COOLDOWN_DAYS is now skipped unless
//     the new total beats the last alerted total by RE_ALERT_INCREMENT_INCHES,
//     which is what distinguishes "still snowing" from "it dumped again".
// ─────────────────────────────────────────────────────────────

/** A pair alerted this recently is inside the same storm window. */
export const COOLDOWN_DAYS = 3;

/**
 * How much more new snow a resort must show to break the cooldown. Chosen to
 * match the smallest threshold the UI offers (3") doubled: a second email
 * inside the window has to represent a materially bigger day than the first.
 */
export const RE_ALERT_INCREMENT_INCHES = 6;

/** Older than this and the report is not evidence about today. */
export const MAX_REPORT_AGE_HOURS = 36;

export interface Subscriber {
  id: string;
  email: string;
  manage_token: string;
}

export interface AlertPreference {
  subscriber_id: string;
  resort_id: string;
  threshold_inches: number;
  alert_subscribers: Subscriber | null;
  resorts: { name: string; slug: string } | null;
}

/** One row of `latest_snow_reports`, narrowed to what the rules read. */
export interface SnowSnapshot {
  resort_id: string;
  new_snow_24h: number | null;
  updated_at: string | null;
}

/** A prior send, from `powder_alert_log` over the cooldown lookback. */
export interface AlertLogRow {
  subscriber_id: string;
  resort_id: string;
  new_snow_inches: number;
  alert_date: string;
}

export interface AlertEntry {
  resortName: string;
  slug: string;
  newSnow: number;
  threshold: number;
  resort_id: string;
}

export interface SubscriberBatch {
  subscriber: Subscriber;
  alerts: AlertEntry[];
}

export type SkipReason =
  | "below_threshold"
  | "no_snow_data"
  | "stale_report"
  | "storm_cooldown"
  | "incomplete_row";

export interface SelectionResult {
  /** One batch per subscriber with at least one qualifying resort. */
  batches: SubscriberBatch[];
  /** Counts per reason, for the cron response body. */
  skipped: Record<SkipReason, number>;
}

function daysBetween(isoDate: string, now: Date): number | null {
  // alert_date is a bare YYYY-MM-DD; parse at UTC midnight to match how the
  // route writes it (toISOString().slice(0, 10)).
  const then = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return (today - then) / 86_400_000;
}

function hoursSince(iso: string, now: Date): number | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return (now.getTime() - then) / 3_600_000;
}

/**
 * Reduces the most recent alert per (subscriber, resort) out of the log rows.
 * The log can hold several rows per pair across the lookback; only the newest
 * one, and the snow total it reported, matter to the cooldown.
 */
export function latestAlertByPair(log: AlertLogRow[]): Map<string, AlertLogRow> {
  const byPair = new Map<string, AlertLogRow>();
  for (const row of log) {
    const key = `${row.subscriber_id}:${row.resort_id}`;
    const seen = byPair.get(key);
    if (!seen || row.alert_date > seen.alert_date) byPair.set(key, row);
  }
  return byPair;
}

export function selectPowderAlerts(params: {
  prefs: AlertPreference[];
  snow: SnowSnapshot[];
  recentLog: AlertLogRow[];
  now: Date;
}): SelectionResult {
  const { prefs, snow, recentLog, now } = params;

  const snowByResort = new Map(snow.map((s) => [s.resort_id, s]));
  const lastAlert = latestAlertByPair(recentLog);

  const skipped: Record<SkipReason, number> = {
    below_threshold: 0,
    no_snow_data: 0,
    stale_report: 0,
    storm_cooldown: 0,
    incomplete_row: 0,
  };
  const batches = new Map<string, SubscriberBatch>();

  for (const pref of prefs) {
    const subscriber = pref.alert_subscribers;
    const resort = pref.resorts;
    // A preference whose subscriber or resort row did not come back with the
    // embed is unusable — mailing it would mean an email with no name in it.
    if (!subscriber?.email || !subscriber.manage_token || !resort?.slug) {
      skipped.incomplete_row++;
      continue;
    }

    const snapshot = snowByResort.get(pref.resort_id);
    if (!snapshot || snapshot.new_snow_24h === null) {
      skipped.no_snow_data++;
      continue;
    }

    const newSnow = snapshot.new_snow_24h;
    if (newSnow < pref.threshold_inches) {
      skipped.below_threshold++;
      continue;
    }

    // A report with no timestamp cannot be shown to be fresh, so it is not.
    const age = snapshot.updated_at ? hoursSince(snapshot.updated_at, now) : null;
    if (age === null || age > MAX_REPORT_AGE_HOURS) {
      skipped.stale_report++;
      continue;
    }

    const previous = lastAlert.get(`${pref.subscriber_id}:${pref.resort_id}`);
    if (previous) {
      const age = daysBetween(previous.alert_date, now);
      const insideWindow = age !== null && age < COOLDOWN_DAYS;
      const grewEnough = newSnow >= previous.new_snow_inches + RE_ALERT_INCREMENT_INCHES;
      if (insideWindow && !grewEnough) {
        skipped.storm_cooldown++;
        continue;
      }
    }

    let batch = batches.get(pref.subscriber_id);
    if (!batch) {
      batch = { subscriber, alerts: [] };
      batches.set(pref.subscriber_id, batch);
    }
    batch.alerts.push({
      resortName: resort.name,
      slug: resort.slug,
      newSnow,
      threshold: pref.threshold_inches,
      resort_id: pref.resort_id,
    });
  }

  // Deepest snow first — it decides the subject line and the CTA resort.
  for (const batch of batches.values()) {
    batch.alerts.sort((a, b) => b.newSnow - a.newSnow);
  }

  return { batches: [...batches.values()], skipped };
}

/** The earliest alert_date the cooldown can still be affected by. */
export function cooldownLookbackDate(now: Date): string {
  const from = new Date(now.getTime() - COOLDOWN_DAYS * 86_400_000);
  return from.toISOString().slice(0, 10);
}
