// ─────────────────────────────────────────────────────────────
// Browser-side helpers for the powder-alert signup.
//
// Deliberately free of React, Next and analytics imports so that
// lib/alerts/client.test.ts can exercise every rule under plain node:test.
// lib/alerts/use-alert-subscribe.ts composes these into the hook the forms
// call; app/alerts reads the ?resort= / ?threshold= parsers.
// ─────────────────────────────────────────────────────────────

import { POPULAR_RANK } from "@/lib/popular-resorts";

/** Inches of new snow a resort defaults to when the subscriber sets nothing. */
export const DEFAULT_THRESHOLD = 6;

/**
 * The threshold choices every alert surface offers — PowderAlertForm, the
 * resort-page capture (a prefix of this list) and AlertManagePage all read it,
 * so any value one form can save is one the manage page can show. 8″ sits
 * between 6 and 12 because "a real powder day" is the question a resort-page
 * visitor is asking.
 */
export const THRESHOLD_OPTIONS: readonly number[] = [3, 6, 8, 12, 18, 24];

/**
 * Options for a <select> that must display `value`: the shared list, plus
 * `value` itself when it came from outside it (an older preference, an API
 * caller — the server clamps to 1–48). A controlled <select> whose value
 * matches no <option> silently shows the first one: 3″ for a subscriber who
 * asked for 10″.
 */
export function thresholdOptionsFor(value: number): readonly number[] {
  return THRESHOLD_OPTIONS.includes(value) ? THRESHOLD_OPTIONS : [...THRESHOLD_OPTIONS, value].sort((a, b) => a - b);
}

/** Same shape check as lib/alerts/subscribe-core.ts — the server re-validates. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

// ── Once-per-browser conversion latch ────────────────────────
//
// The subscribe API answers an identical 200 whether it created a subscription
// or merely re-sent the manage link to an address that already had one
// (enumeration safety — see lib/alerts/subscribe-core.ts). The client cannot
// tell the two apart, so the ad-platform conversions are deduped per browser
// instead: report Lead / conversion / SignUp once, and tag every later success
// from this browser as a repeat so PostHog can separate the two.

export const LEAD_SENT_KEY = "peakcam_alert_lead_sent";

export function readLeadSent(): boolean {
  try {
    return window.localStorage.getItem(LEAD_SENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function markLeadSent(): void {
  try {
    window.localStorage.setItem(LEAD_SENT_KEY, "1");
  } catch {
    // Storage unavailable (private mode, quota): the conversion still fires
    // once per page load, which is the pre-existing behaviour.
  }
}

// ── Request shape ────────────────────────────────────────────

export interface SubscribeInput {
  email: string;
  resortIds: string[];
  /** resort id → inches. Ids missing here fall back to DEFAULT_THRESHOLD. */
  thresholds?: Record<string, number>;
  /** Analytics only — never sent to the API. Same order as `resortIds`. */
  resortSlugs?: string[];
  /** Also email the morning a selected resort opens for the season. Omitted → the API defaults to off. */
  openingAlerts?: boolean;
}

export interface SubscribePayload {
  email: string;
  resort_ids: string[];
  thresholds: Record<string, number>;
  /** Present only when the form offered the choice — older callers keep sending the three-field body. */
  opening_alerts?: boolean;
}

/** The exact body POST /api/alerts/subscribe has always received (plus `opening_alerts` when a form set it). */
export function buildSubscribePayload(input: SubscribeInput): SubscribePayload {
  const resortIds = [...new Set(input.resortIds)];
  const payload: SubscribePayload = {
    email: input.email.trim(),
    resort_ids: resortIds,
    thresholds: Object.fromEntries(
      resortIds.map((id) => [id, input.thresholds?.[id] ?? DEFAULT_THRESHOLD])
    ),
  };
  if (input.openingAlerts !== undefined) payload.opening_alerts = input.openingAlerts;
  return payload;
}

/**
 * Friendly copy for a non-2xx response. The server's own `error` strings are
 * written for logs ("No valid resort IDs provided"), not for the person typing.
 * `status` 0 is the conventional value for a network failure.
 */
export function subscribeErrorMessage(status: number): string {
  if (status === 400) return "Check your email address and pick at least one resort";
  if (status === 429) return "Too many attempts, try again in a minute";
  return "Something went wrong. Please try again.";
}

// ── /alerts query-string parsing ─────────────────────────────

const SLUG_RE = /^[a-z0-9-]+$/;

/** `?resort=breckenridge,vail` → ["breckenridge", "vail"]; junk and repeats dropped. */
export function parseResortSlugsParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const slugs = new Set<string>();
  for (const part of raw.split(",")) {
    const slug = part.trim().toLowerCase();
    if (slug && SLUG_RE.test(slug)) slugs.add(slug);
  }
  return [...slugs];
}

/**
 * `?threshold=10` → 8: snapped to the nearest picker option (ties round down)
 * so the pre-filled <select> always shows a real choice. Anything unparseable
 * → undefined, which the form treats as DEFAULT_THRESHOLD.
 */
export function parseThresholdParam(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  let best = THRESHOLD_OPTIONS[0];
  for (const option of THRESHOLD_OPTIONS) {
    if (Math.abs(option - n) < Math.abs(best - n)) best = option;
  }
  return best;
}

// ── "Add more mountains" suggestions ─────────────────────────

export interface SuggestableResort {
  id: string;
  name: string;
  slug: string;
  state: string;
}

// Own-property check rather than `in`: POPULAR_RANK is a plain object, so a
// slug like "constructor" would otherwise match Object.prototype.
function popularRank(slug: string): number {
  return Object.prototype.hasOwnProperty.call(POPULAR_RANK, slug)
    ? POPULAR_RANK[slug]
    : Number.POSITIVE_INFINITY;
}

function byPopularity(a: SuggestableResort, b: SuggestableResort): number {
  return popularRank(a.slug) - popularRank(b.slug) || a.name.localeCompare(b.name);
}

/**
 * Resorts to suggest after a subscription: the subscriber's own states first
 * (most popular leading, then alphabetical), topped up from the curated
 * popular list when a state has too few. Never repeats a subscribed resort.
 */
export function suggestMoreResorts<T extends SuggestableResort>(
  resorts: readonly T[],
  subscribedIds: Iterable<string>,
  limit = 6
): T[] {
  const chosen = new Set(subscribedIds);
  const states = new Set(resorts.filter((r) => chosen.has(r.id)).map((r) => r.state));
  const candidates = resorts.filter((r) => !chosen.has(r.id));
  const sameState = candidates.filter((r) => states.has(r.state)).sort(byPopularity);
  const popular = candidates
    .filter((r) => !states.has(r.state) && Number.isFinite(popularRank(r.slug)))
    .sort(byPopularity);
  return [...sameState, ...popular].slice(0, limit);
}
