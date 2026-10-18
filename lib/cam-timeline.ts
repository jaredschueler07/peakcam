/**
 * cam-timeline — pure helpers for the cam-still history archive (migration
 * 024). No I/O and no env at import, so the capture job, lib/supabase.ts,
 * the resort page and the MCP `get_cam_timeline` tool all share one set of
 * rules and this module is unit-testable without Supabase.
 *
 * Vocabulary:
 *   archive  — a frame stored at archive/<camId>/<stamp>.jpg in bucket
 *              cam-stills with a cam_stills row. Only for archive_allowed cams.
 *   keeper   — an archived frame captured while the resort's latest 24 h
 *              number was >= KEEPER_MIN_SNOW_24H_IN. Kept a year, not 30 days.
 *   timeline — the shaped read model: up to STRIP_FRAMES recent frames in a
 *              window, plus the newest keeper ("last storm on tape").
 */
import type { Cam } from "./types";

export const STORAGE_BUCKET = "cam-stills";
export const ARCHIVE_PREFIX = "archive";
/** 24 h new snow (inches) at capture that makes a frame a storm keeper. */
export const KEEPER_MIN_SNOW_24H_IN = 6;
/** Non-keepers are pruned after this many days (object + row). */
export const ARCHIVE_RETENTION_DAYS = 30;
/** Keepers are pruned after this many days. */
export const KEEPER_RETENTION_DAYS = 365;
/** Frames shown in the resort page's "Last 24 h" strip. */
export const STRIP_FRAMES = 4;
/** Longest window getCamTimeline / the MCP tool will serve. */
export const MAX_TIMELINE_HOURS = 48;

const DAY_MS = 86_400_000;

/** One row of cam_stills / cam_still_timeline as the site reads it. */
export interface CamStillRow {
  id: number;
  cam_id: string;
  resort_id?: string;
  captured_at: string;
  path: string;
  source?: string | null;
  width?: number | null;
  height?: number | null;
  snow_24h_at_capture: number | null;
  keeper: boolean;
}

export interface CamTimelineFrame {
  id: number;
  camId: string;
  /** Public image URL (bucket is public). */
  url: string;
  capturedAt: string;
  /** Resort's 24 h number when the frame was taken; null when no report existed. */
  snow24hAtCapture: number | null;
  keeper: boolean;
}

export interface CamTimeline {
  camId: string;
  hours: number;
  /** Oldest → newest, at most STRIP_FRAMES, all inside the window. */
  frames: CamTimelineFrame[];
  /** Newest keeper for the cam, inside the window or not; null when none is on tape. */
  lastStorm: CamTimelineFrame | null;
}

// ─── capture-side decisions ─────────────────────────────────────────────

/** Storm keeper rule: the resort's latest 24 h number at capture is 6 in. or more. */
export function isKeeper(snow24h: number | null | undefined): boolean {
  return typeof snow24h === "number" && Number.isFinite(snow24h) && snow24h >= KEEPER_MIN_SNOW_24H_IN;
}

/**
 * Object path for an archived frame. ISO instant with the URL-hostile
 * characters removed so it sorts lexically and copies cleanly:
 * archive/<camId>/2026-10-18T15-04-05Z.jpg
 */
export function archivePath(camId: string, capturedAt: Date): string {
  const stamp = capturedAt.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  return `${ARCHIVE_PREFIX}/${camId}/${stamp}.jpg`;
}

/** Public URL for an object in the cam-stills bucket. */
export function publicStillUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

/**
 * Rows the prune pass should delete at `now`: non-keepers older than
 * ARCHIVE_RETENTION_DAYS, keepers older than KEEPER_RETENTION_DAYS.
 */
export function selectPrune<T extends Pick<CamStillRow, "captured_at" | "keeper">>(rows: readonly T[], now: Date): T[] {
  const plainCutoff = now.getTime() - ARCHIVE_RETENTION_DAYS * DAY_MS;
  const keeperCutoff = now.getTime() - KEEPER_RETENTION_DAYS * DAY_MS;
  return rows.filter((row) => {
    const t = Date.parse(row.captured_at);
    if (Number.isNaN(t)) return false;
    return row.keeper ? t < keeperCutoff : t < plainCutoff;
  });
}

/** `captured_at` lower bound for the prune query (the older of the two cutoffs). */
export function pruneCutoffs(now: Date): { plain: string; keeper: string } {
  return {
    plain: new Date(now.getTime() - ARCHIVE_RETENTION_DAYS * DAY_MS).toISOString(),
    keeper: new Date(now.getTime() - KEEPER_RETENTION_DAYS * DAY_MS).toISOString(),
  };
}

// ─── rights default ─────────────────────────────────────────────────────

const PLAYER_ONLY_OR_AGGREGATOR = /(^|\.)(roundshot\.com|windy\.com|opensnow\.com)$/;
const BROWNRICE_SNAPSHOT = /^(player|live\d{1,3}|tsvweather)\.brownrice\.com$/;
const IPCAMLIVE_SNAPSHOT = /^(www|g\d{1,2})\.ipcamlive\.com$/;

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try { return new URL(url).host; } catch { return ""; }
}

/**
 * TypeScript mirror of migration 024's one UPDATE (the default rights
 * decision in the 2026-10-18 plan, section 1 item 3). The database column
 * `cams.archive_allowed` is the source of truth at runtime; this exists so
 * the policy doc, the tests and the importer can state the rule in one place.
 *
 * true  → PeakCam already captures the cam itself (still_url set), the feed is
 *         an operator image URL, or the player has an operator-public snapshot
 *         endpoint (brownrice, ipcamlive, Ozolio).
 * false → link-outs, YouTube, generic iframes, and any Roundshot host or
 *         aggregator re-publisher (windy.com, opensnow.com) whatever the type.
 */
export function archiveAllowedByDefault(cam: Pick<Cam, "embed_type" | "embed_url"> & { still_url?: string | null }): boolean {
  if (cam.embed_type === "link") return false;
  const host = hostOf(cam.embed_url);
  if (PLAYER_ONLY_OR_AGGREGATOR.test(host)) return false;
  if (cam.still_url) return true;
  if (cam.embed_type === "image") return true;
  if (cam.embed_type !== "iframe") return false;
  return BROWNRICE_SNAPSHOT.test(host) || IPCAMLIVE_SNAPSHOT.test(host) || host === "relay.ozolio.com";
}

// ─── read-side shaping ──────────────────────────────────────────────────

export function clampHours(hours: number | undefined): number {
  if (!Number.isFinite(hours as number) || (hours as number) <= 0) return 24;
  return Math.min(Math.floor(hours as number), MAX_TIMELINE_HOURS);
}

export function toFrame(row: CamStillRow, supabaseUrl: string): CamTimelineFrame {
  return {
    id: row.id,
    camId: row.cam_id,
    url: publicStillUrl(supabaseUrl, row.path),
    capturedAt: row.captured_at,
    snow24hAtCapture: row.snow_24h_at_capture,
    keeper: row.keeper,
  };
}

/**
 * Shape rows for one cam into the strip model. `rows` may be in any order and
 * may include frames outside the window (the keeper query returns the newest
 * keeper regardless of age); only in-window frames make the strip, the
 * newest STRIP_FRAMES of them, oldest first. `lastStorm` is the newest keeper
 * among all rows. Returns null when there is nothing to show, so callers can
 * render nothing instead of an empty strip.
 */
export function shapeTimeline(
  rows: readonly CamStillRow[],
  opts: { camId: string; hours: number; now: Date; supabaseUrl: string; max?: number },
): CamTimeline | null {
  const max = opts.max ?? STRIP_FRAMES;
  const since = opts.now.getTime() - opts.hours * 3_600_000;
  const own = rows.filter((r) => r.cam_id === opts.camId);
  const newestFirst = [...own].sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at));
  const inWindow = newestFirst.filter((r) => {
    const t = Date.parse(r.captured_at);
    return !Number.isNaN(t) && t >= since && t <= opts.now.getTime() + 60_000;
  });
  const frames = inWindow.slice(0, max).reverse().map((r) => toFrame(r, opts.supabaseUrl));
  const keeperRow = newestFirst.find((r) => r.keeper) ?? null;
  const lastStorm = keeperRow ? toFrame(keeperRow, opts.supabaseUrl) : null;
  if (frames.length === 0 && !lastStorm) return null;
  return { camId: opts.camId, hours: opts.hours, frames, lastStorm };
}

/**
 * For a resort page: pick the cam whose timeline leads the strip. Preference
 * order is the caller's cam order (the page's lead cam first), but a cam with
 * no in-window frames yields to one that has them. Returns null when no cam
 * has anything on tape.
 */
export function pickResortTimeline(
  rows: readonly CamStillRow[],
  camOrder: readonly string[],
  opts: { hours: number; now: Date; supabaseUrl: string },
): CamTimeline | null {
  const ids = new Set(rows.map((r) => r.cam_id));
  const ordered = [...camOrder.filter((id) => ids.has(id)), ...[...ids].filter((id) => !camOrder.includes(id))];
  let fallback: CamTimeline | null = null;
  for (const camId of ordered) {
    const t = shapeTimeline(rows, { ...opts, camId });
    if (!t) continue;
    if (t.frames.length > 0) return t;
    fallback ??= t;
  }
  return fallback;
}
