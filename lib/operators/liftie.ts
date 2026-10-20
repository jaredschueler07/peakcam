// ─────────────────────────────────────────────────────────────
// Liftie (https://liftie.info) — operator lift status, parsed and normalised.
//
// Liftie is an open-source aggregator (github.com/pirxpilot/liftie, BSD-3)
// that parses each resort's own lift-status page once a minute while anyone
// is watching and publishes the result at
// GET https://liftie.info/api/resort/<id>. The document is
// `{ id, name, href, ll, timestamp: { lifts: <ms> }, lifts: { status:
// { "<lift>": "open" | "hold" | "scheduled" | "closed" }, stats: { open,
// hold, scheduled, closed, percentage } }, opening?: "YYYY-MM-DD" }`; the
// shape is read from the project's lib/lifts/stats.js and lib/routes/data.js
// (History.md 2.1.1 moved the map from `status` to `lifts.status`).
//
// Pure parsing here, one network call in `fetchLiftieResort`. The site sits
// behind a Cloudflare managed challenge for non-browser clients (observed
// 2026-10-20 from the Air and the Mac mini: HTTP 403, `cf-mitigated:
// challenge`, an HTML "Just a moment" body), so the fetcher names that case
// as `blocked` rather than reporting a parse error, and the sync job counts
// it. PeakCam never scrapes an operator's HTML itself; Liftie is the only
// operator source in this block.
// ─────────────────────────────────────────────────────────────

export const LIFTIE_API = "https://liftie.info/api/resort";
export const LIFTIE_SITE = "https://liftie.info";
export const LIFTIE_USER_AGENT = "PeakCam/1.0 (+https://www.peakcam.io; hello@peakcam.io)";
export const LIFTIE_ATTRIBUTION = "Lift status via Liftie (liftie.info), parsed from the operator's own status page";

export type LiftState = "open" | "hold" | "scheduled" | "closed";
export const LIFT_STATES: readonly LiftState[] = ["open", "hold", "scheduled", "closed"];

export interface LiftieStats {
  open: number;
  hold: number;
  scheduled: number;
  closed: number;
  total: number;
}

/** A Liftie resort document, normalised. */
export interface LiftieReport {
  id: string;
  name: string;
  /** The operator page Liftie parsed (`href`), when given. */
  sourceUrl: string | null;
  /** ISO instant of the lift status (`timestamp.lifts`), else the fetch instant. */
  observedAt: string;
  /** True when the document carried its own lift timestamp. */
  timestamped: boolean;
  lifts: Record<string, LiftState>;
  stats: LiftieStats;
  /** `opening` as Liftie publishes it (only while the date is ahead). */
  openingDate: string | null;
}

export type LiftieFetchFailure = "blocked" | "not_found" | "http" | "invalid" | "network";

export type LiftieFetchResult =
  | { ok: true; report: LiftieReport }
  | { ok: false; reason: LiftieFetchFailure; status: number | null; detail: string };

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function asCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function isLiftState(value: unknown): value is LiftState {
  return typeof value === "string" && (LIFT_STATES as readonly string[]).includes(value);
}

/** Per-lift map → counts, the same rule as Liftie's own lib/lifts/stats.js. */
export function statsFromLifts(lifts: Record<string, LiftState>): LiftieStats {
  const stats: LiftieStats = { open: 0, hold: 0, scheduled: 0, closed: 0, total: 0 };
  for (const state of Object.values(lifts)) {
    stats[state]++;
    stats.total++;
  }
  return stats;
}

/**
 * A Liftie document → report, or null when it is not one (no `lifts`
 * block). Counts come from `lifts.stats` when present and add up, else are
 * recounted from the per-lift map; a document with neither carries no lift
 * data and is still returned (status UNKNOWN downstream), never invented.
 */
export function parseLiftieResort(doc: unknown, fetchedAt: Date): LiftieReport | null {
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  const id = typeof d.id === "string" ? d.id : null;
  const liftsBlock = d.lifts && typeof d.lifts === "object" ? (d.lifts as Record<string, unknown>) : null;
  if (!id || !liftsBlock) return null;

  const lifts: Record<string, LiftState> = {};
  const status = liftsBlock.status && typeof liftsBlock.status === "object" ? (liftsBlock.status as Record<string, unknown>) : {};
  for (const [name, state] of Object.entries(status)) if (isLiftState(state)) lifts[name] = state;

  let stats = statsFromLifts(lifts);
  const raw = liftsBlock.stats && typeof liftsBlock.stats === "object" ? (liftsBlock.stats as Record<string, unknown>) : null;
  if (raw) {
    const open = asCount(raw.open);
    const hold = asCount(raw.hold);
    const scheduled = asCount(raw.scheduled);
    const closed = asCount(raw.closed);
    if (open != null && hold != null && scheduled != null && closed != null) {
      const total = open + hold + scheduled + closed;
      // Trust the provider's counts when they describe at least as many lifts as the map.
      if (total >= stats.total) stats = { open, hold, scheduled, closed, total };
    }
  }

  const timestamp = d.timestamp && typeof d.timestamp === "object" ? (d.timestamp as Record<string, unknown>) : null;
  const liftsMs = timestamp && typeof timestamp.lifts === "number" && Number.isFinite(timestamp.lifts) && timestamp.lifts > 0 ? timestamp.lifts : null;
  const observedAt = liftsMs ? new Date(liftsMs).toISOString() : fetchedAt.toISOString();

  const opening = typeof d.opening === "string" && ISO_DAY_RE.test(d.opening) ? d.opening : null;

  return {
    id,
    name: typeof d.name === "string" && d.name ? d.name : id,
    sourceUrl: typeof d.href === "string" && /^https?:\/\//.test(d.href) ? d.href : null,
    observedAt,
    timestamped: liftsMs != null,
    lifts,
    stats,
    openingDate: opening,
  };
}

/** True for the Cloudflare managed-challenge page Liftie serves to non-browser clients. */
export function isChallengeResponse(status: number, headers: { get(name: string): string | null }, bodyStart: string): boolean {
  if ((headers.get("cf-mitigated") ?? "").toLowerCase() === "challenge") return true;
  const type = (headers.get("content-type") ?? "").toLowerCase();
  if (status === 403 && type.includes("text/html")) return true;
  return type.includes("text/html") && /just a moment|challenges\.cloudflare\.com/i.test(bodyStart);
}

export interface LiftieFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
}

/** One GET of a Liftie resort document, with the challenge page named as `blocked`. */
export async function fetchLiftieResort(id: string, options: LiftieFetchOptions = {}): Promise<LiftieFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${LIFTIE_API}/${encodeURIComponent(id)}`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": LIFTIE_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (err) {
    return { ok: false, reason: "network", status: null, detail: err instanceof Error ? err.message : String(err) };
  }
  const text = await res.text();
  if (isChallengeResponse(res.status, res.headers, text.slice(0, 2_000))) {
    return { ok: false, reason: "blocked", status: res.status, detail: "Cloudflare managed challenge (cf-mitigated: challenge); the API is not open to non-browser clients from this host" };
  }
  if (res.status === 404) return { ok: false, reason: "not_found", status: 404, detail: `Liftie has no resort "${id}"` };
  if (!res.ok) return { ok: false, reason: "http", status: res.status, detail: `HTTP ${res.status}` };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid", status: res.status, detail: "response is not JSON" };
  }
  const report = parseLiftieResort(doc, (options.now ?? (() => new Date()))());
  if (!report) return { ok: false, reason: "invalid", status: res.status, detail: "response carries no lifts block" };
  return { ok: true, report };
}

// ── Rows ─────────────────────────────────────────────────────

/** One `operator_status` row (migration 032) as the sync inserts it. */
export interface OperatorStatusInsert {
  resort_id: string;
  source: "liftie";
  source_id: string;
  observed_at: string;
  fetched_at: string;
  lifts_open: number | null;
  lifts_hold: number | null;
  lifts_scheduled: number | null;
  lifts_closed: number | null;
  lifts_total: number | null;
  trails_open: number | null;
  trails_total: number | null;
  base_depth_in: number | null;
  surface: string | null;
  opening_date: string | null;
  source_url: string | null;
  verified: false;
  payload: Record<string, unknown>;
}

/** A report → the row to store. Lift counts are null, not zero, when the document listed no lifts at all. */
export function operatorStatusRow(resortId: string, report: LiftieReport, fetchedAt: Date): OperatorStatusInsert {
  const hasLifts = report.stats.total > 0;
  return {
    resort_id: resortId,
    source: "liftie",
    source_id: report.id,
    observed_at: report.observedAt,
    fetched_at: fetchedAt.toISOString(),
    lifts_open: hasLifts ? report.stats.open : null,
    lifts_hold: hasLifts ? report.stats.hold : null,
    lifts_scheduled: hasLifts ? report.stats.scheduled : null,
    lifts_closed: hasLifts ? report.stats.closed : null,
    lifts_total: hasLifts ? report.stats.total : null,
    // Liftie publishes lifts only; trails, base and surface wait for an operator feed that has them.
    trails_open: null,
    trails_total: null,
    base_depth_in: null,
    surface: null,
    opening_date: report.openingDate,
    source_url: report.sourceUrl,
    verified: false,
    payload: { lifts: report.lifts, stats: report.stats, timestamped: report.timestamped, liftieName: report.name },
  };
}

// ── Mapping ──────────────────────────────────────────────────

/** data/operator-sources.json: PeakCam slug → the operator feeds that cover it. */
export interface OperatorSourceMap {
  [slug: string]: { liftie?: string; note?: string };
}

export function liftieIdFor(map: OperatorSourceMap, slug: string): string | null {
  return map[slug]?.liftie ?? null;
}

/** Every (slug, liftie id) pair in the map, slug order. */
export function liftiePairs(map: OperatorSourceMap): Array<{ slug: string; liftieId: string }> {
  return Object.entries(map)
    .filter(([, v]) => typeof v.liftie === "string" && v.liftie.length > 0)
    .map(([slug, v]) => ({ slug, liftieId: v.liftie! }))
    .sort((a, b) => a.slug.localeCompare(b.slug, "en"));
}
