/**
 * cam-timelapse — pure helpers for the rendered timelapse clips (migration
 * 025 `cam_timelapses`, migration 031 render metadata + `cam_timelapse_current`
 * view). No I/O and no env at import, so the render job on the mini,
 * lib/supabase.ts, the pages, the API serializer and the MCP `get_timelapses`
 * tool all share one set of rules and this module is unit-testable without
 * ffmpeg or Supabase.
 *
 * Vocabulary:
 *   24h clip   — the rolling day for one cam: every archived frame of the last
 *                24 h at 7 fps, replaced on every run (one object, one row).
 *   storm clip — one storm for one cam: from the first frame after the last
 *                dry day to now, capped at STORM_MAX_HOURS, rendered while the
 *                resort's measured 24 h new snow is at or past the powder
 *                threshold. One row per (cam, storm_date); kept a year.
 *   poster     — the clip's last frame as a JPEG beside the MP4; the <video>
 *                poster and the card image, so a page never has to touch the
 *                MP4 to show "what it looks like now".
 *
 * Rights: a clip is made only of frames the still archive already holds, so
 * it inherits `cams.archive_allowed`; the read view joins through it
 * (docs/cams/still-archive-policy.md section 8).
 */
import { POWDER_DAY_IN } from "./season-stats";

export const TIMELAPSE_BUCKET = "cam-timelapses";
/** Rolling clip window, hours. */
export const WINDOW_24H_HOURS = 24;
/** A cam needs at least this many archived frames in the window before a 24 h clip is rendered. */
export const MIN_FRAMES_24H = 12;
/** A storm clip needs at least this many frames (a few hours of a storm). */
export const MIN_FRAMES_STORM = 8;
/** Frames per second of every clip; 96 frames (a 15-min day) play in ~14 s. */
export const FPS = 7;
/** Longest edge limits: 720p max, downscaled when the archive is larger. */
export const MAX_WIDTH = 1280;
export const MAX_HEIGHT = 720;
/** Hard cap on frames per clip; a longer window is subsampled evenly to this. */
export const MAX_FRAMES = 240;
/** Every clip object must be at or under this many bytes (plan acceptance). */
export const MAX_CLIP_BYTES = 3 * 1024 * 1024;
/** Measured 24 h new snow (inches) at or above which a storm clip is rendered; the alert threshold. */
export const STORM_TRIGGER_IN = POWDER_DAY_IN;
/** A day with less than this much new snow ends a storm when walking back from the storm day. */
export const DRY_DAY_MAX_IN = 1;
/** Longest storm clip window, hours. */
export const STORM_MAX_HOURS = 72;
/** Storm clips (object + row) are deleted after this many days; 24 h clips are replaced each run. */
export const STORM_RETENTION_DAYS = 365;
/** Days of `snowpack_daily` the renderer reads to find the last dry day. */
export const STORM_LOOKBACK_DAYS = 5;
/** Clips per cam the API and the tool return (the 24 h clip plus the newest storms). */
export const MAX_STORMS_PER_CAM = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type TimelapseWindow = "24h" | "storm";

/** One row of `cam_timelapses` / `cam_timelapse_current` as the site reads it. */
export interface CamTimelapseRow {
  id: string;
  cam_id: string;
  resort_id?: string;
  window: string;
  url: string;
  poster_url?: string | null;
  frames: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  bytes?: number | null;
  rendered_at: string;
  storm_date: string | null;
}

/** The wire shape (lib/public-api/schema.ts CamTimelapseSchema). */
export interface CamTimelapseClip {
  id: string;
  window: string;
  url: string;
  posterUrl: string | null;
  frames: number | null;
  startsAt: string | null;
  endsAt: string | null;
  bytes: number | null;
  renderedAt: string;
  stormDate: string | null;
}

/** Per-cam read model: the current 24 h clip and the newest storm clips. */
export interface CamTimelapses {
  camId: string;
  /** The rolling clip, null when none is rendered. */
  current: CamTimelapseClip | null;
  /** Newest first, at most MAX_STORMS_PER_CAM. */
  storms: CamTimelapseClip[];
}

// ─── frame selection ────────────────────────────────────────────────────

/** What the renderer needs to know about one archived frame. */
export interface FrameRef {
  path: string;
  capturedAt: string;
}

/**
 * Frames for a clip: those captured inside [from, to], oldest first, evenly
 * subsampled to `maxFrames` when there are more (first and last always
 * kept, so the clip spans the whole window). Unparseable timestamps are
 * dropped. Pure; order of the input does not matter.
 */
export function selectFrames<T extends FrameRef>(frames: readonly T[], opts: { from: Date; to: Date; maxFrames?: number }): T[] {
  const max = Math.max(2, opts.maxFrames ?? MAX_FRAMES);
  const fromMs = opts.from.getTime();
  const toMs = opts.to.getTime();
  const inWindow = frames
    .map((f) => ({ f, t: Date.parse(f.capturedAt) }))
    .filter((x) => !Number.isNaN(x.t) && x.t >= fromMs && x.t <= toMs)
    .sort((a, b) => a.t - b.t || a.f.path.localeCompare(b.f.path))
    .map((x) => x.f);
  if (inWindow.length <= max) return inWindow;
  const out: T[] = [];
  const step = (inWindow.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(inWindow[Math.round(i * step)]);
  return out;
}

/** True when a cam's archive has moved since its clip was rendered (or no clip exists). */
export function needsRender(newestFrameAt: string | null | undefined, lastRenderedAt: string | null | undefined): boolean {
  if (!newestFrameAt) return false;
  if (!lastRenderedAt) return true;
  const a = Date.parse(newestFrameAt);
  const b = Date.parse(lastRenderedAt);
  if (Number.isNaN(a)) return false;
  if (Number.isNaN(b)) return true;
  return a > b;
}

// ─── storm detection ────────────────────────────────────────────────────

/** One `snowpack_daily` row the storm walk reads. */
export interface DailyNewSnow {
  /** YYYY-MM-DD. */
  date: string;
  newSnowIn: number | null;
}

export interface StormWindow {
  from: Date;
  to: Date;
  /** YYYY-MM-DD of the day that triggered the clip. */
  stormDate: string;
  /** How the storm was detected: the daily record or only the latest report's 24 h number. */
  basis: "daily" | "report";
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * Is a storm on, and which window does its clip cover?
 *
 * Trigger: the latest daily `new_snow_in` for the resort (today or
 * yesterday, so a report written after midnight still counts) or the latest
 * snow report's `new_snow_24h` is at or above STORM_TRIGGER_IN. Window: walk
 * back from the storm day over consecutive days with at least DRY_DAY_MAX_IN
 * of new snow; the clip starts at the first frame after the last dry day
 * (00:00 UTC of the first snowy day) and ends now, capped at STORM_MAX_HOURS
 * back from now. Without daily rows the window is the last 24 h.
 * Returns null when nothing qualifies. Pure.
 */
export function stormWindow(opts: { now: Date; daily: readonly DailyNewSnow[]; latest24hIn: number | null | undefined }): StormWindow | null {
  const now = opts.now;
  const today = utcDay(now);
  const yesterday = utcDay(new Date(now.getTime() - DAY_MS));
  const byDate = new Map<string, number>();
  for (const row of opts.daily) {
    if (typeof row.newSnowIn === "number" && Number.isFinite(row.newSnowIn) && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) byDate.set(row.date, row.newSnowIn);
  }
  const trigger = (v: number | null | undefined) => typeof v === "number" && Number.isFinite(v) && v >= STORM_TRIGGER_IN;
  let stormDate: string | null = null;
  let basis: StormWindow["basis"] = "daily";
  if (trigger(byDate.get(today))) stormDate = today;
  else if (trigger(byDate.get(yesterday))) stormDate = yesterday;
  else if (trigger(opts.latest24hIn)) {
    stormDate = today;
    basis = "report";
  }
  if (!stormDate) return null;

  // Walk back over snowy days to the last dry one.
  let firstSnowy = stormDate;
  for (let i = 1; i <= STORM_LOOKBACK_DAYS; i++) {
    const day = utcDay(new Date(startOfUtcDay(firstSnowy).getTime() - DAY_MS));
    const v = byDate.get(day);
    if (v == null || v < DRY_DAY_MAX_IN) break;
    firstSnowy = day;
  }
  const cap = now.getTime() - STORM_MAX_HOURS * HOUR_MS;
  const start = basis === "report" && !byDate.has(stormDate) ? now.getTime() - WINDOW_24H_HOURS * HOUR_MS : startOfUtcDay(firstSnowy).getTime();
  return { from: new Date(Math.max(start, cap)), to: now, stormDate, basis };
}

// ─── ffmpeg ─────────────────────────────────────────────────────────────

export interface EncodeAttempt {
  /** libx264 constant rate factor; higher is smaller. */
  crf: number;
  maxWidth: number;
  maxHeight: number;
}

/**
 * Size ladder: start at 720p / crf 26 and, while the MP4 is over
 * MAX_CLIP_BYTES, step to a higher crf, then to 480p. Four attempts; null
 * after the last. A 96-frame 720p clip lands around 1 MB at crf 26, so the
 * ladder is for the rare high-detail cams.
 */
export function encodeAttempt(attempt: number): EncodeAttempt | null {
  const ladder: EncodeAttempt[] = [
    { crf: 26, maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT },
    { crf: 30, maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT },
    { crf: 34, maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT },
    { crf: 32, maxWidth: 854, maxHeight: 480 },
  ];
  return ladder[attempt] ?? null;
}

/**
 * The scale filter every clip and poster goes through: fit inside
 * maxWidth × maxHeight without upscaling, then round to even dimensions
 * (yuv420p needs them). Frames in one archive can differ in size when an
 * operator changes a feed, so every frame is also fitted to the first
 * frame's box by padding, keeping the stream a single size.
 */
export function scaleFilter(maxWidth = MAX_WIDTH, maxHeight = MAX_HEIGHT): string {
  return `scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

/**
 * ffmpeg arguments for the clip: an image sequence `f%05d.jpg` in `frameDir`
 * at FPS, H.264 (libx264, yuv420p for every player), faststart so the
 * browser can play while downloading, no audio. The renderer writes the
 * selected frames into `frameDir` under those names first.
 */
export function clipFfmpegArgs(opts: { frameDir: string; out: string; attempt?: EncodeAttempt; fps?: number }): string[] {
  const a = opts.attempt ?? encodeAttempt(0)!;
  const fps = opts.fps ?? FPS;
  return [
    "-y",
    "-loglevel", "error",
    "-nostdin",
    "-framerate", String(fps),
    "-i", `${opts.frameDir}/f%05d.jpg`,
    "-vf", `${scaleFilter(a.maxWidth, a.maxHeight)},format=yuv420p`,
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", String(a.crf),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    opts.out,
  ];
}

/** ffmpeg arguments for the poster: one frame scaled like the clip, JPEG quality 5 (about 60–90 KB at 720p). */
export function posterFfmpegArgs(opts: { input: string; out: string; attempt?: EncodeAttempt }): string[] {
  const a = opts.attempt ?? encodeAttempt(0)!;
  return ["-y", "-loglevel", "error", "-nostdin", "-i", opts.input, "-frames:v", "1", "-vf", scaleFilter(a.maxWidth, a.maxHeight), "-q:v", "5", opts.out];
}

/** Sequential frame file name for index `i` (zero-based), matching the `f%05d.jpg` pattern. */
export function frameFileName(i: number): string {
  return `f${String(i + 1).padStart(5, "0")}.jpg`;
}

// ─── storage paths and urls ─────────────────────────────────────────────

/**
 * Object paths in the cam-timelapses bucket:
 *   {resortSlug}/{camId}/24h.mp4 + 24h.jpg            (replaced each run)
 *   {resortSlug}/{camId}/storm-YYYY-MM-DD.mp4 + .jpg  (one per storm day)
 */
export function clipPaths(resortSlug: string, camId: string, window: TimelapseWindow, stormDate?: string | null): { video: string; poster: string } {
  const stem = window === "storm" ? `storm-${stormDate ?? "unknown"}` : "24h";
  return { video: `${resortSlug}/${camId}/${stem}.mp4`, poster: `${resortSlug}/${camId}/${stem}.jpg` };
}

/**
 * Public URL for an object in the cam-timelapses bucket. `version` (the
 * render instant) is appended as a query string so a replaced 24 h clip is
 * never served stale from an edge cache that keyed on the path.
 */
export function publicTimelapseUrl(supabaseUrl: string, path: string, version?: Date | string | null): string {
  const base = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${TIMELAPSE_BUCKET}/${path}`;
  if (!version) return base;
  const t = typeof version === "string" ? Date.parse(version) : version.getTime();
  return Number.isNaN(t) ? base : `${base}?v=${Math.floor(t / 1000)}`;
}

/** Clip duration in seconds at FPS, for captions and `VideoObject.duration`. */
export function clipDurationSeconds(frames: number | null | undefined, fps = FPS): number | null {
  if (!frames || !Number.isFinite(frames) || frames <= 0) return null;
  return Math.round((frames / fps) * 10) / 10;
}

// ─── read-side shaping ──────────────────────────────────────────────────

export function toClip(row: CamTimelapseRow): CamTimelapseClip {
  return {
    id: row.id,
    window: row.window,
    url: row.url,
    posterUrl: row.poster_url ?? null,
    frames: row.frames ?? null,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    bytes: row.bytes ?? null,
    renderedAt: row.rendered_at,
    stormDate: row.storm_date ?? null,
  };
}

/**
 * Rows for one or many cams → per-cam read model, in `camOrder` (cams the
 * caller did not list follow, in first-seen order). The current 24 h clip is
 * the newest `24h` row; storms are the newest MAX_STORMS_PER_CAM `storm`
 * rows by storm date. Cams with nothing are left out.
 */
export function shapeTimelapses(rows: readonly CamTimelapseRow[], camOrder: readonly string[] = []): CamTimelapses[] {
  const byCam = new Map<string, CamTimelapseRow[]>();
  for (const row of rows) {
    const list = byCam.get(row.cam_id) ?? [];
    list.push(row);
    byCam.set(row.cam_id, list);
  }
  const ordered = [...camOrder.filter((id) => byCam.has(id)), ...[...byCam.keys()].filter((id) => !camOrder.includes(id))];
  const out: CamTimelapses[] = [];
  for (const camId of ordered) {
    const list = byCam.get(camId)!;
    const newest = (a: CamTimelapseRow, b: CamTimelapseRow) => Date.parse(b.rendered_at) - Date.parse(a.rendered_at);
    const current = list.filter((r) => r.window === "24h").sort(newest)[0] ?? null;
    const storms = list
      .filter((r) => r.window === "storm")
      .sort((a, b) => (b.storm_date ?? "").localeCompare(a.storm_date ?? "") || newest(a, b))
      .slice(0, MAX_STORMS_PER_CAM)
      .map(toClip);
    if (!current && !storms.length) continue;
    out.push({ camId, current: current ? toClip(current) : null, storms });
  }
  return out;
}

/** Across a resort: the newest 24 h clip and the newest storm clip, for the overview tile. */
export function pickResortTimelapse(cams: readonly CamTimelapses[]): { current: (CamTimelapseClip & { camId: string }) | null; storm: (CamTimelapseClip & { camId: string }) | null } {
  let current: (CamTimelapseClip & { camId: string }) | null = null;
  let storm: (CamTimelapseClip & { camId: string }) | null = null;
  for (const cam of cams) {
    if (cam.current && (!current || Date.parse(cam.current.renderedAt) > Date.parse(current.renderedAt))) current = { ...cam.current, camId: cam.camId };
    const s = cam.storms[0];
    if (s && (!storm || (s.stormDate ?? "") > (storm.stormDate ?? ""))) storm = { ...s, camId: cam.camId };
  }
  return { current, storm };
}

/** Storm rows past their retention at `now`, for the renderer's prune pass. Pure. */
export function selectExpiredStorms<T extends Pick<CamTimelapseRow, "window" | "rendered_at" | "storm_date">>(rows: readonly T[], now: Date): T[] {
  const cutoff = now.getTime() - STORM_RETENTION_DAYS * DAY_MS;
  return rows.filter((r) => {
    if (r.window !== "storm") return false;
    const t = r.storm_date ? Date.parse(`${r.storm_date}T00:00:00Z`) : Date.parse(r.rendered_at);
    return !Number.isNaN(t) && t < cutoff;
  });
}
