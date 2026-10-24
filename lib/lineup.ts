// ─────────────────────────────────────────────────────────────
// Pre-signup mountain/camera lineup — validation and browser persistence.
//
// A visitor saves a resort or camera while signed out. The only state that
// has to survive the auth round trip (Google OAuth redirect, email-
// confirmation link, returning sign-in) is the typed list of favourites.
// This module keeps that queue pure and testable: the component layer owns
// the Supabase write, and this file owns the bounds, expiry, claim and shape
// checks.
//
// The mechanism is deliberately browser-local. It sits alongside the existing
// `?welcome=signup` marker (lib/auth-signup-welcome.ts) rather than inventing a
// server-side pending-intent table: there is no authenticated identity to key
// a server row on before signup, and the schema is off limits. A callback
// opened in another tab of the same browser can still read localStorage; a
// different device cannot, which is the documented limitation.
//
// FAILURE MODEL — the intent is NOT removed before the network write.
//
// A tab that is about to save first writes a short-lived claim into the
// record, re-reads it, and only then calls the database. The record therefore
// stays readable if the page closes mid-write, and the next tab (or the same
// tab after a reload) can finish it. Only a successful save clears the record,
// and only when the record is still the one that was claimed. A failure
// releases the claim and leaves the items in place; a newer selection written
// while an older save is in flight has a different `id`, so the older save can
// neither clear it nor release its claim. A failed attempt binds the record to
// the account that attempted it (`user_id`), so a later different account in
// the same browser is not handed the previous user's pending work.
//
// CROSS-TAB CAVEAT — localStorage has no compare-and-swap. The claim is read,
// modified and written back as separate operations, so two tabs writing in
// the same instant can both believe they hold it. That is a best-effort
// de-duplication of the common case, not a lock, and localStorage
// read/remove is never atomic. The final idempotency protection is the
// database's UNIQUE (user_id, item_type, item_id): the writer skips existing
// rows and treats a 23505 race as "already saved".
// ─────────────────────────────────────────────────────────────

import { MAX_RESORTS_PER_REQUEST } from "./alerts/validate";

export const LINEUP_STORAGE_KEY = "peakcam:lineup-intent:v2";
/** Where the per-tab claim identity is remembered across a reload. */
export const LINEUP_TAB_TOKEN_KEY = "peakcam:lineup-tab:v2";
export const LINEUP_INTENT_VERSION = 2;

/** The chooser's UI limit. A hub lineup is a quick morning check, not a second favourites list. */
export const MAX_LINEUP_SELECTION = 8;
/** Alias kept for the chooser's existing imports. Never use it for the write bound. */
export const MAX_LINEUP = MAX_LINEUP_SELECTION;
/**
 * The pending-intent / write bound. It must not truncate an alert selection:
 * the alert API already accepts up to 200 resorts, so the same number is the
 * largest selection that can legitimately reach the account nudge.
 */
export const MAX_LINEUP_INTENT = MAX_RESORTS_PER_REQUEST;
/** Long enough for a confirmation email to sit over a weekend, short enough to expire stale picks. */
export const LINEUP_INTENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** How long another tab may hold a claim before a reload may take it over. */
export const LINEUP_CLAIM_TTL_MS = 30_000;
/** A 200-item payload is ~12 KB; anything beyond this is not one of ours. */
const MAX_RAW_LENGTH = 32_768;
/** Accept a little clock skew between the browser and the server that stamped the page. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;

/**
 * The only source/surface labels that may reach analytics. A caller mistake
 * (an email address, a URL) collapses to "unknown" rather than being
 * partially echoed; this is an allowlist, not regex scrubbing.
 */
export const LINEUP_SOURCES = [
  "hub_lineup",
  "hub_account_benefit",
  "hub_alert",
  "resort_save",
  "resort_nudge",
  "cam_save",
  "browse_card",
  "favorites_page",
  "alert_done",
  "auth_restore",
  "header",
] as const;
export type LineupSource = (typeof LINEUP_SOURCES)[number];
export const LINEUP_SOURCE_UNKNOWN = "unknown";
const LINEUP_SOURCE_SET = new Set<string>(LINEUP_SOURCES);

export type LineupStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A typed favourite: the same two columns `user_favorites` stores. */
export type LineupItemType = "resort" | "cam";
export interface LineupItem {
  item_type: LineupItemType;
  item_id: string;
}
/** A bare UUID is read as a resort; the object form lets a camera be preserved as a camera. */
export type LineupItemInput = string | { item_type?: unknown; item_id?: unknown };

export interface LineupClaim {
  token: string;
  started_at: number;
}

export interface LineupIntent {
  version: typeof LINEUP_INTENT_VERSION;
  /** Unique per selection, so a newer selection is never mistaken for an older one. */
  id: string;
  items: LineupItem[];
  /** Surface that created the intent; analytics only, allowlisted below. */
  source: string;
  created_at: number;
  /** Set by the first signed-in attempt; a later different account must not inherit it. */
  user_id: string | null;
  /** Present only while one tab is actively trying to save this intent. */
  claim: LineupClaim | null;
}

export type LineupWriteResult =
  | { ok: true; intent: LineupIntent }
  | { ok: false; reason: "invalid" | "blocked" };

export type LineupClaimResult =
  | { ok: true; intent: LineupIntent; token: string }
  | { ok: false; reason: "none" | "busy" | "blocked" | "signed_out" | "user_mismatch"; intent: LineupIntent | null };

/** window.localStorage, or null when the browser refuses (privacy mode, security policy). */
export function lineupStorage(): LineupStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function randomToken(): string {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * A stable identity for this tab across a reload. It lets a reloaded page
 * recognise its own interrupted claim immediately instead of waiting out the
 * lease. sessionStorage is per tab and, unlike localStorage, survives a
 * reload. When it is unavailable the module-level token only survives the
 * current document, so a reload falls back to the lease timeout.
 */
let memoryTabToken: string | null = null;
export function lineupTabToken(): string {
  if (typeof window === "undefined") {
    memoryTabToken ??= randomToken();
    return memoryTabToken;
  }
  try {
    const existing = window.sessionStorage.getItem(LINEUP_TAB_TOKEN_KEY);
    if (existing && TOKEN_RE.test(existing)) return existing;
    const token = randomToken();
    window.sessionStorage.setItem(LINEUP_TAB_TOKEN_KEY, token);
    return token;
  } catch {
    memoryTabToken ??= randomToken();
    return memoryTabToken;
  }
}

export function lineupItemKey(item: Pick<LineupItem, "item_type" | "item_id">): string {
  return `${item.item_type}:${item.item_id}`;
}

/** Deduped, bounded, validated typed items; junk and repeats are dropped rather than thrown. */
export function normalizeLineupItems(value: unknown): LineupItem[] {
  if (!Array.isArray(value)) return [];
  const out: LineupItem[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (out.length >= MAX_LINEUP_INTENT) break;
    let type: LineupItemType;
    let rawId: unknown;
    if (typeof candidate === "string") {
      type = "resort";
      rawId = candidate;
    } else if (typeof candidate === "object" && candidate !== null) {
      const record = candidate as Record<string, unknown>;
      if (record.item_type !== "resort" && record.item_type !== "cam") continue;
      type = record.item_type;
      rawId = record.item_id;
    } else {
      continue;
    }
    if (typeof rawId !== "string") continue;
    const id = rawId.trim().toLowerCase();
    if (!UUID_RE.test(id)) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ item_type: type, item_id: id });
  }
  return out;
}

/** Resort UUIDs from an untrusted list (the compatibility shape for legacy callers). */
export function normalizeLineupIds(value: unknown, limit = MAX_LINEUP_INTENT): string[] {
  const out: string[] = [];
  for (const item of normalizeLineupItems(value)) {
    if (out.length >= limit) break;
    if (item.item_type === "resort") out.push(item.item_id);
  }
  return out;
}

/**
 * Requested items that are not already saved. Existing favourites are never
 * touched, and the requested order is preserved so the first write is stable.
 */
export function missingFavoriteItems(existingKeys: Iterable<string>, requested: readonly LineupItemInput[]): LineupItem[] {
  const have = new Set<string>();
  for (const key of existingKeys) {
    if (typeof key === "string") have.add(key.trim().toLowerCase());
  }
  return normalizeLineupItems([...requested]).filter((item) => !have.has(lineupItemKey(item)));
}

/** Resort-id convenience wrapper around missingFavoriteItems. */
export function missingFavoriteIds(existing: Iterable<string>, requested: readonly string[]): string[] {
  const have = new Set<string>();
  for (const id of existing) {
    if (typeof id === "string" && UUID_RE.test(id.trim())) have.add(`resort:${id.trim().toLowerCase()}`);
  }
  return missingFavoriteItems(have, normalizeLineupItems([...requested])).map((item) => item.item_id);
}

/** Event sources/surfaces are allowlisted labels, never URLs, emails or user text. */
export function sanitizeLineupSource(value: unknown): string {
  if (typeof value !== "string") return LINEUP_SOURCE_UNKNOWN;
  const clean = value.trim().toLowerCase();
  return LINEUP_SOURCE_SET.has(clean) ? clean : LINEUP_SOURCE_UNKNOWN;
}

function validClaim(value: unknown, now: number): LineupClaim | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.token !== "string" || !TOKEN_RE.test(record.token)) return null;
  if (typeof record.started_at !== "number" || !Number.isFinite(record.started_at)) return null;
  // A claim from the far future is clock skew or tampering; treat it as no claim.
  if (record.started_at - now > CLOCK_SKEW_MS) return null;
  return { token: record.token, started_at: record.started_at };
}

/** Validate an untrusted parsed payload; returns null for anything expired, future-dated or malformed. */
export function validateLineupIntent(value: unknown, now = Date.now()): LineupIntent | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== LINEUP_INTENT_VERSION) return null;
  if (typeof candidate.id !== "string" || !TOKEN_RE.test(candidate.id)) return null;
  if (typeof candidate.created_at !== "number" || !Number.isFinite(candidate.created_at)) return null;
  const age = now - candidate.created_at;
  if (age < -CLOCK_SKEW_MS || age > LINEUP_INTENT_TTL_MS) return null;
  const items = normalizeLineupItems(candidate.items);
  if (items.length === 0) return null;
  const userId =
    typeof candidate.user_id === "string" && UUID_RE.test(candidate.user_id.trim())
      ? candidate.user_id.trim().toLowerCase()
      : null;
  return {
    version: LINEUP_INTENT_VERSION,
    id: candidate.id,
    items,
    source: sanitizeLineupSource(candidate.source),
    created_at: candidate.created_at,
    user_id: userId,
    claim: validClaim(candidate.claim, now),
  };
}

export function parseLineupIntent(raw: string | null | undefined, now = Date.now()): LineupIntent | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RAW_LENGTH) return null;
  try {
    return validateLineupIntent(JSON.parse(raw), now);
  } catch {
    return null;
  }
}

/** Read without changing anything; storage exceptions (private mode, disabled storage) read as empty. */
export function readLineupIntent(storage: LineupStorage | null | undefined, now = Date.now()): LineupIntent | null {
  if (!storage) return null;
  try {
    return parseLineupIntent(storage.getItem(LINEUP_STORAGE_KEY), now);
  } catch {
    return null;
  }
}

/**
 * Persist a new intent, bounded to MAX_LINEUP_INTENT and tagged with the
 * surface that created it. A new selection gets a new `id`, which is what
 * keeps an older in-flight save from clearing or overwriting it.
 *
 * `blocked` means storage itself is unavailable; the caller must say so
 * instead of promising the picks will survive sign-up. `invalid` means there
 * was no valid item to store.
 */
export function writeLineupIntent(
  storage: LineupStorage | null | undefined,
  items: unknown,
  source: string,
  now = Date.now(),
  id = randomToken(),
): LineupWriteResult {
  if (!storage) return { ok: false, reason: "blocked" };
  const normalized = normalizeLineupItems(items);
  if (normalized.length === 0) return { ok: false, reason: "invalid" };
  const intent: LineupIntent = {
    version: LINEUP_INTENT_VERSION,
    id,
    items: normalized,
    source: sanitizeLineupSource(source),
    created_at: now,
    user_id: null,
    claim: null,
  };
  const raw = JSON.stringify(intent);
  if (raw.length > MAX_RAW_LENGTH) return { ok: false, reason: "invalid" };
  try {
    storage.setItem(LINEUP_STORAGE_KEY, raw);
    return { ok: true, intent };
  } catch {
    return { ok: false, reason: "blocked" };
  }
}

/**
 * Claim an intent for this tab and account.
 *
 * - `none`: nothing pending, or the payload was expired/malformed (cleaned up).
 * - `busy`: another tab holds a fresh claim; back off rather than double-write.
 * - `user_mismatch`: a previous account's failed attempt owns the record; the
 *   current account must not inherit it.
 * - `blocked`: storage refused the claim write.
 * - `signed_out`: no user id was supplied.
 *
 * A claim from this same tab token is treated as interrupted work (reload) and
 * is reclaimable immediately; a claim from another tab is reclaimable only
 * after LINEUP_CLAIM_TTL_MS.
 */
export function claimLineupIntent(
  storage: LineupStorage | null | undefined,
  userId: string | null,
  options: { now?: number; token?: string; claimTtlMs?: number } = {},
): LineupClaimResult {
  if (!storage) return { ok: false, reason: "blocked", intent: null };
  if (!userId) return { ok: false, reason: "signed_out", intent: readLineupIntent(storage, options.now) };
  const now = options.now ?? Date.now();
  const token = options.token ?? randomToken();
  const claimTtlMs = options.claimTtlMs ?? LINEUP_CLAIM_TTL_MS;

  let raw: string | null;
  try {
    raw = storage.getItem(LINEUP_STORAGE_KEY);
  } catch {
    return { ok: false, reason: "blocked", intent: null };
  }
  if (raw === null) return { ok: false, reason: "none", intent: null };
  const intent = parseLineupIntent(raw, now);
  if (!intent) {
    // Expired and malformed payloads can never be replayed; remove them so a
    // later mount does not keep re-parsing them. This is best-effort.
    try {
      storage.removeItem(LINEUP_STORAGE_KEY);
    } catch {
      // ignored — the caller still gets `none`
    }
    return { ok: false, reason: "none", intent: null };
  }

  const normalizedUser = userId.trim().toLowerCase();
  if (intent.user_id && intent.user_id !== normalizedUser) {
    return { ok: false, reason: "user_mismatch", intent };
  }

  if (intent.claim) {
    const sameTab = intent.claim.token === token;
    const fresh = now - intent.claim.started_at <= claimTtlMs;
    if (!sameTab && fresh) return { ok: false, reason: "busy", intent };
  }

  const claimed: LineupIntent = {
    ...intent,
    user_id: normalizedUser,
    claim: { token, started_at: now },
  };
  try {
    storage.setItem(LINEUP_STORAGE_KEY, JSON.stringify(claimed));
  } catch {
    return { ok: false, reason: "blocked", intent };
  }

  // Best-effort compare-and-swap: another tab may have written between our read
  // and write. Re-read and only accept the claim if ours is the one on disk.
  const after = readLineupIntent(storage, now);
  if (!after || after.id !== intent.id || after.claim?.token !== token) {
    return { ok: false, reason: "busy", intent: after ?? intent };
  }
  return { ok: true, intent: after, token };
}

/**
 * Release a failed claim without touching the items. The record stays
 * recoverable for the next retry/reload and keeps `user_id`, so it cannot be
 * silently adopted by a different account. If a newer selection replaced the
 * record (different `id`) or another tab stole the claim, this is a no-op.
 */
export function releaseLineupIntentClaim(
  storage: LineupStorage | null | undefined,
  intentId: string,
  token: string,
): boolean {
  if (!storage) return false;
  const intent = readLineupIntent(storage);
  if (!intent || intent.id !== intentId) return false;
  if (intent.claim && intent.claim.token !== token) return false;
  try {
    storage.setItem(LINEUP_STORAGE_KEY, JSON.stringify({ ...intent, claim: null }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the intent after a successful save, but only when it is still the
 * exact record this tab claimed. A newer selection written while the save was
 * in flight has a different `id` and is left untouched.
 */
export function completeLineupIntent(
  storage: LineupStorage | null | undefined,
  intentId: string,
  token: string,
): boolean {
  if (!storage) return false;
  const intent = readLineupIntent(storage);
  if (!intent || intent.id !== intentId) return false;
  if (intent.claim && intent.claim.token !== token) return false;
  try {
    storage.removeItem(LINEUP_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Remove the intent unconditionally (only for an explicit user discard). */
export function clearLineupIntent(storage: LineupStorage | null | undefined): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(LINEUP_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Bounded attribution for the existing auth events: no names, emails or free text. */
export interface LineupAttribution {
  lineup_source: string;
  lineup_count: number;
}

export function readLineupAttribution(
  storage: LineupStorage | null | undefined = lineupStorage(),
  now = Date.now(),
): LineupAttribution | null {
  const intent = readLineupIntent(storage, now);
  if (!intent) return null;
  return { lineup_source: intent.source, lineup_count: intent.items.length };
}

/** Copy shared by the chooser and the alert nudge after a real storage write. */
export function lineupIntentNote(count: number, noun = "mountain"): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const plural = safe === 1 ? noun : `${noun}s`;
  return safe === 1
    ? `We’ll keep this ${noun} ready in this browser and add it after you sign in.`
    : `We’ll keep these ${safe} ${plural} ready in this browser and add them after you sign in.`;
}

/** Personalized signup heading: the one mountain's name, or the selected count. */
export function lineupSignupHeading(count: number, singleName?: string | null): string {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.min(MAX_LINEUP_INTENT, Math.floor(count))) : 0;
  if (safeCount <= 1) {
    const name = typeof singleName === "string" ? singleName.trim() : "";
    return name ? `Save ${name}.` : "Save this mountain.";
  }
  return `Save your ${safeCount} mountains.`;
}

/** Coarse, PII-free properties for the existing track() helper. */
export function lineupEventProperties(source: string, surface: string, count: number) {
  return {
    source: sanitizeLineupSource(source),
    surface: sanitizeLineupSource(surface),
    selected_count: Number.isFinite(count) ? Math.max(0, Math.min(MAX_LINEUP_INTENT, Math.floor(count))) : 0,
  };
}
