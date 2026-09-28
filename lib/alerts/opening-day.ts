// ─────────────────────────────────────────────────────────────
// Opening-day alert planning — the pure half of the trigger cron's branch.
//
// Given the resorts whose confirmed opening is today, the alert_preferences
// rows that opted in for those resorts, and the log of opening emails already
// sent today, decide who gets one email and which resorts it lists. No I/O:
// app/api/alerts/trigger/route.ts fetches, this decides, the route sends and
// logs. lib/alerts/opening-day.test.ts covers the rules.
// ─────────────────────────────────────────────────────────────

import type { OpeningDayEmailResort } from "@/lib/email";

export interface OpeningTodayResort {
  resort_id: string;
  name: string;
  slug: string;
  camCount: number;
}

export interface OpeningSubscriber {
  id: string;
  email: string;
  manage_token: string;
}

export interface OpeningPreference {
  subscriber_id: string;
  resort_id: string;
  alert_subscribers: OpeningSubscriber | null;
}

export interface OpeningLogEntry {
  subscriber_id: string;
  resort_id: string;
}

export interface OpeningDayEmailPlan {
  subscriber: OpeningSubscriber;
  resorts: OpeningDayEmailResort[];
  /** The resort ids the email covers — what gets written to powder_alert_log. */
  resortIds: string[];
}

function pairKey(subscriberId: string, resortId: string): string {
  return `${subscriberId}\u0000${resortId}`;
}

/**
 * One plan per subscriber who has at least one resort opening today that they
 * have not already been mailed about. Within an email, resorts are listed
 * alphabetically; a preference whose resort is not opening, whose subscriber
 * row failed to embed, or that already has a log row today is skipped. A
 * subscriber following the same resort twice (impossible under the unique
 * constraint, but cheap to guard) is still listed once.
 */
export function planOpeningDayEmails(
  openings: readonly OpeningTodayResort[],
  prefs: readonly OpeningPreference[],
  alreadySent: readonly OpeningLogEntry[],
): OpeningDayEmailPlan[] {
  const openingById = new Map(openings.map((o) => [o.resort_id, o]));
  const sent = new Set(alreadySent.map((row) => pairKey(row.subscriber_id, row.resort_id)));
  const plans = new Map<string, OpeningDayEmailPlan>();
  const covered = new Set<string>();

  for (const pref of prefs) {
    const opening = openingById.get(pref.resort_id);
    if (!opening || !pref.alert_subscribers) continue;
    const key = pairKey(pref.subscriber_id, pref.resort_id);
    if (sent.has(key) || covered.has(key)) continue;
    covered.add(key);

    let plan = plans.get(pref.subscriber_id);
    if (!plan) {
      plan = { subscriber: pref.alert_subscribers, resorts: [], resortIds: [] };
      plans.set(pref.subscriber_id, plan);
    }
    plan.resorts.push({ resortName: opening.name, slug: opening.slug, camCount: opening.camCount });
    plan.resortIds.push(opening.resort_id);
  }

  for (const plan of plans.values()) {
    const order = plan.resorts
      .map((resort, i) => ({ resort, id: plan.resortIds[i] }))
      .sort((a, b) => a.resort.resortName.localeCompare(b.resort.resortName, "en"));
    plan.resorts = order.map((o) => o.resort);
    plan.resortIds = order.map((o) => o.id);
  }

  return [...plans.values()];
}
