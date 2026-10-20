#!/usr/bin/env tsx
/**
 * cam-timelapse — render timelapse clips from the still archive.
 *
 * For every active cam with cams.archive_allowed = true (the still archive's
 * rights switch, docs/cams/still-archive-policy.md) and at least
 * MIN_FRAMES_24H archived frames in the last 24 h:
 *
 *   1. 24 h clip. List the cam's cam_stills rows for the window, download the
 *      frames (public bucket cam-stills; a local cache keeps each frame once,
 *      so a frame is fetched one time in its life, not four), write them as
 *      an image sequence, render an H.264 MP4 at 7 fps, 720p max, at or
 *      under 3 MB (lib/cam-timelapse.ts encodeAttempt ladder), plus a poster
 *      JPEG of the last frame. Upload both to bucket cam-timelapses at
 *      {resortSlug}/{camId}/24h.mp4 + 24h.jpg (replaced in place) and upsert
 *      the cam's `24h` row in cam_timelapses (frames, bounds, bytes,
 *      rendered_at). A cam whose newest frame is older than its last render
 *      is skipped, so a run after a quiet archive costs one query per cam.
 *   2. Storm clip. When the resort's measured new snow is at or past the
 *      powder threshold (latest_snow_reports.new_snow_24h or the newest
 *      snowpack_daily.new_snow_in, lib/cam-timelapse.ts stormWindow), render
 *      the storm window — from the first frame after the last dry day to
 *      now, capped at 72 h — as `storm` with storm_date, one row per
 *      (cam, storm day), re-rendered while the storm goes on, kept 365 days.
 *   3. Prune. Storm rows past retention: objects first, then rows. 24 h
 *      clips are replaced each run and never accumulate.
 *
 * Idempotent (same inputs → same objects, same rows), bounded per run
 * (--max-cams, default 400; frames per clip capped at MAX_FRAMES), and
 * nothing provider-specific is persisted: only PeakCam's own archived frames
 * go in, so a clip inherits the cam's archive_allowed.
 *
 * Usage: npx tsx scripts/cam-timelapse.ts [--dry-run] [--resort <slug>] [--cam <cam-id>]
 *        [--concurrency 2] [--max-cams 400] [--no-storms] [--prune-only] [--cache-dir <dir>]
 * Needs: ffmpeg on PATH, .env.local with NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY, migration 031 applied (poster_url & co.).
 * Scheduled via com.peakcam.cam-timelapse.plist every 6 h (StartInterval 21600).
 * `--dry-run` reads and renders to a temp dir but uploads and writes nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  MAX_CLIP_BYTES,
  MAX_FRAMES,
  MIN_FRAMES_24H,
  MIN_FRAMES_STORM,
  STORM_LOOKBACK_DAYS,
  TIMELAPSE_BUCKET,
  WINDOW_24H_HOURS,
  clipFfmpegArgs,
  clipPaths,
  encodeAttempt,
  frameFileName,
  needsRender,
  posterFfmpegArgs,
  publicTimelapseUrl,
  selectExpiredStorms,
  selectFrames,
  stormWindow,
  type CamTimelapseRow,
  type DailyNewSnow,
  type FrameRef,
  type StormWindow,
  type TimelapseWindow,
} from "../lib/cam-timelapse.js";
import { STORAGE_BUCKET as STILLS_BUCKET } from "../lib/cam-timeline.js";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─── env ─────────────────────────────────────────────────────────────────
function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const key = t.slice(0, eq).trim(); const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(ROOT, ".env.local")); loadEnv(path.join(ROOT, ".env"));
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const sb = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string, dflt: string | null = null) => (args.includes(name) ? args[args.indexOf(name) + 1] ?? dflt : dflt);
const DRY = flag("--dry-run");
const ONLY_RESORT = opt("--resort");
const ONLY_CAM = opt("--cam");
const CONCURRENCY = Math.max(1, Number(opt("--concurrency", "2")) || 2);
const MAX_CAMS = Math.max(1, Number(opt("--max-cams", "400")) || 400);
const NO_STORMS = flag("--no-storms");
const PRUNE_ONLY = flag("--prune-only");
const CACHE_DIR = opt("--cache-dir") ?? path.join(os.homedir(), ".cache", "peakcam", "cam-timelapse", "frames");
/** Cached frames older than this are deleted at the end of a run (the longest clip window plus slack). */
const CACHE_MAX_AGE_MS = 80 * 3_600_000;
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

type CamRow = { id: string; name: string; resort_id: string; resorts: { slug: string } | null };
type StillRow = { path: string; captured_at: string };
type ExistingRow = Pick<CamTimelapseRow, "id" | "cam_id" | "window" | "rendered_at" | "storm_date" | "url">;

// ─── supabase helpers ────────────────────────────────────────────────────
async function rest<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: sb, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${pathAndQuery.split("?")[0]} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return (await res.json()) as T;
}

/** Create the public bucket when it is missing (same shape as migration 031). */
async function ensureBucket(): Promise<void> {
  const head = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${TIMELAPSE_BUCKET}`, { headers: sb });
  if (head.ok) return;
  if (head.status !== 404 && head.status !== 400) throw new Error(`bucket GET ${head.status}: ${(await head.text()).slice(0, 160)}`);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST", headers: { ...sb, "Content-Type": "application/json" },
    body: JSON.stringify({ id: TIMELAPSE_BUCKET, name: TIMELAPSE_BUCKET, public: true, file_size_limit: 4 * 1024 * 1024, allowed_mime_types: ["video/mp4", "image/jpeg"] }),
  });
  if (!res.ok) throw new Error(`bucket POST ${res.status}: ${(await res.text()).slice(0, 160)}`);
  console.log(`[cam-timelapse] created public bucket ${TIMELAPSE_BUCKET}`);
}

async function upload(objectPath: string, file: string, contentType: string, cacheControl: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${TIMELAPSE_BUCKET}/${objectPath}`, {
    method: "POST", headers: { ...sb, "Content-Type": contentType, "Cache-Control": cacheControl, "x-upsert": "true" }, body: fs.readFileSync(file),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`upload ${objectPath} ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

async function deleteObjects(paths: string[]): Promise<boolean> {
  if (!paths.length) return true;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${TIMELAPSE_BUCKET}`, { method: "DELETE", headers: { ...sb, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths }) });
  if (!res.ok) console.log(`  ! object DELETE ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.ok;
}

/** Insert or update the (cam, window, storm_date) row; the id map is the run's view of the table. */
async function upsertRow(existing: ExistingRow | undefined, row: Record<string, unknown>): Promise<void> {
  const res = existing
    ? await fetch(`${SUPABASE_URL}/rest/v1/cam_timelapses?id=eq.${existing.id}`, { method: "PATCH", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row) })
    : await fetch(`${SUPABASE_URL}/rest/v1/cam_timelapses`, { method: "POST", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`cam_timelapses ${existing ? "PATCH" : "POST"} ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

/** Object path inside the bucket from a stored public URL (drops the ?v= cache-buster). */
function objectPathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${TIMELAPSE_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length).split("?")[0];
}

// ─── frames ──────────────────────────────────────────────────────────────
/** Download an archived frame once into the cache; return its local path. */
async function cachedFrame(still: FrameRef): Promise<string> {
  const local = path.join(CACHE_DIR, still.path);
  if (fs.existsSync(local) && fs.statSync(local).size > 0) return local;
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${STILLS_BUCKET}/${still.path}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`frame ${still.path} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1_000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error(`frame ${still.path}: not a JPEG (${buf.length} B)`);
  const tmp = `${local}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, local);
  return local;
}

function pruneCache(now: number): number {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  let removed = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); continue; }
      try { if (now - fs.statSync(p).mtimeMs > CACHE_MAX_AGE_MS || p.endsWith(".part")) { fs.rmSync(p, { force: true }); removed++; } } catch { /* raced */ }
    }
  };
  walk(CACHE_DIR);
  return removed;
}

// ─── render ──────────────────────────────────────────────────────────────
type Rendered = { video: string; poster: string; bytes: number; frames: number; attempt: number; width: number; height: number };

/**
 * Image sequence → MP4 + poster in `workDir`, walking the size ladder until
 * the clip is at or under MAX_CLIP_BYTES. Frames that fail to download are
 * dropped (a gap, like the archive's own gaps); the clip still needs the
 * minimum after that.
 */
async function render(frames: FrameRef[], workDir: string, minFrames: number): Promise<Rendered | { error: string }> {
  const seqDir = path.join(workDir, "seq");
  fs.mkdirSync(seqDir, { recursive: true });
  let i = 0;
  let missing = 0;
  for (const f of frames) {
    try {
      fs.copyFileSync(await cachedFrame(f), path.join(seqDir, frameFileName(i)));
      i++;
    } catch { missing++; }
  }
  if (i < minFrames) return { error: `${i} usable frames (${missing} failed to download), need ${minFrames}` };
  const video = path.join(workDir, "clip.mp4");
  const poster = path.join(workDir, "poster.jpg");
  for (let attempt = 0; ; attempt++) {
    const a = encodeAttempt(attempt);
    if (!a) return { error: `clip still over ${MAX_CLIP_BYTES} B after the whole encode ladder` };
    try {
      await exec(FFMPEG, clipFfmpegArgs({ frameDir: seqDir, out: video, attempt: a }), { timeout: 300_000 });
    } catch (e) {
      const msg = (e as { stderr?: string; message?: string }).stderr || (e as Error).message || String(e);
      return { error: `ffmpeg: ${msg.replace(/\s+/g, " ").slice(0, 200)}` };
    }
    const bytes = fs.statSync(video).size;
    if (bytes > MAX_CLIP_BYTES) continue;
    await exec(FFMPEG, posterFfmpegArgs({ input: path.join(seqDir, frameFileName(i - 1)), out: poster, attempt: a }), { timeout: 60_000 });
    const { stdout } = await exec(process.env.FFPROBE ?? "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video], { timeout: 15_000 });
    const [width, height] = stdout.trim().split(",").map(Number);
    return { video, poster, bytes, frames: i, attempt, width, height };
  }
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  const now = new Date();
  try { await exec(FFMPEG, ["-version"], { timeout: 10_000 }); } catch { throw new Error(`${FFMPEG} not found on PATH (brew install ffmpeg)`); }
  if (!DRY) await ensureBucket();

  // Existing rows: the run's view of cam_timelapses, so upserts need no extra
  // GET. Paged, because PostgREST answers at most 1,000 rows per request and a
  // season of storm reels across ~374 cams passes that.
  const existing: ExistingRow[] = [];
  for (let page = 0; page < 50; page++) {
    const rows = await rest<ExistingRow[]>(`cam_timelapses?select=id,cam_id,window,rendered_at,storm_date,url&order=rendered_at.desc,id.asc&limit=1000&offset=${page * 1000}`);
    existing.push(...rows);
    if (rows.length < 1000) break;
  }
  const key = (camId: string, window: string, stormDate: string | null) => `${camId}|${window}|${stormDate ?? ""}`;
  const byKey = new Map<string, ExistingRow>();
  for (const r of existing) if (!byKey.has(key(r.cam_id, r.window, r.storm_date))) byKey.set(key(r.cam_id, r.window, r.storm_date), r);

  const summary = { cams: 0, rendered24h: 0, renderedStorm: 0, fresh: 0, sparse: 0, failed: 0, bytes: 0, pruned: 0 };

  if (!PRUNE_ONLY) {
    const camsAll = await rest<CamRow[]>(`cams?select=id,name,resort_id,resorts(slug)&archive_allowed=eq.true&is_active=eq.true&auto_disabled=eq.false&embed_type=neq.link&order=resort_id,name`);
    const cams = camsAll
      .filter((c) => c.resorts?.slug)
      .filter((c) => (!ONLY_RESORT || c.resorts!.slug === ONLY_RESORT) && (!ONLY_CAM || c.id === ONLY_CAM))
      // Oldest render first, so a bounded run rotates through every cam.
      .sort((a, b) => Date.parse(byKey.get(key(a.id, "24h", null))?.rendered_at ?? "1970-01-01") - Date.parse(byKey.get(key(b.id, "24h", null))?.rendered_at ?? "1970-01-01"))
      .slice(0, MAX_CAMS);
    summary.cams = cams.length;

    // Storm detection inputs, read once per run.
    const snow24h = new Map<string, number | null>();
    const dailyByResort = new Map<string, DailyNewSnow[]>();
    if (!NO_STORMS) {
      try {
        for (const r of await rest<{ resort_id: string; new_snow_24h: number | null }[]>("latest_snow_reports?select=resort_id,new_snow_24h")) snow24h.set(r.resort_id, r.new_snow_24h);
      } catch (e) { console.log(`  ! latest_snow_reports: ${(e as Error).message} — storm detection from daily rows only`); }
      try {
        const since = new Date(now.getTime() - STORM_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
        for (const r of await rest<{ resort_id: string; date: string; new_snow_in: number | null }[]>(`snowpack_daily?select=resort_id,date,new_snow_in&date=gte.${since}&order=date.asc&limit=5000`)) {
          const list = dailyByResort.get(r.resort_id) ?? [];
          list.push({ date: r.date, newSnowIn: r.new_snow_in == null ? null : Number(r.new_snow_in) });
          dailyByResort.set(r.resort_id, list);
        }
      } catch (e) { console.log(`  ! snowpack_daily.new_snow_in: ${(e as Error).message} — storm windows from the latest report only (apply migration 030)`); }
    }

    console.log(`[cam-timelapse] ${now.toISOString()} ${cams.length} archive-allowed cams${ONLY_RESORT ? ` at ${ONLY_RESORT}` : ""}${DRY ? " (dry run)" : ""}, concurrency ${CONCURRENCY}`);
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cam-timelapse-"));
    let i = 0;

    async function renderClip(cam: CamRow, tag: string, window: TimelapseWindow, frames: FrameRef[], storm: StormWindow | null): Promise<void> {
      const slug = cam.resorts!.slug;
      const stormDate = window === "storm" ? storm!.stormDate : null;
      const work = fs.mkdtempSync(path.join(tmpRoot, `${cam.id}-${window}-`));
      try {
        const out = await render(frames, work, window === "storm" ? MIN_FRAMES_STORM : MIN_FRAMES_24H);
        if ("error" in out) { summary.failed++; console.log(`  ✗ ${tag} ${window}: ${out.error}`); return; }
        const paths = clipPaths(slug, cam.id, window, stormDate);
        const first = frames[0].capturedAt;
        const last = frames[frames.length - 1].capturedAt;
        const label = `${out.frames} frames ${out.width}x${out.height} ${(out.bytes / 1024).toFixed(0)} KB${out.attempt ? ` (ladder step ${out.attempt})` : ""}${stormDate ? ` storm ${stormDate} (${storm!.basis})` : ""}`;
        if (DRY) { console.log(`  ✓ ${tag} ${window}: ${label} (dry run, not stored)`); }
        else {
          const renderedAt = new Date();
          const cache = window === "storm" ? "public, max-age=86400" : "public, max-age=900";
          await upload(paths.video, out.video, "video/mp4", cache);
          await upload(paths.poster, out.poster, "image/jpeg", cache);
          await upsertRow(byKey.get(key(cam.id, window, stormDate)), {
            cam_id: cam.id,
            window,
            url: publicTimelapseUrl(SUPABASE_URL!, paths.video, renderedAt),
            poster_url: publicTimelapseUrl(SUPABASE_URL!, paths.poster, renderedAt),
            frames: out.frames,
            starts_at: first,
            ends_at: last,
            bytes: out.bytes,
            rendered_at: renderedAt.toISOString(),
            storm_date: stormDate,
          });
          console.log(`  ✓ ${tag} ${window}: ${label}`);
        }
        summary.bytes += out.bytes;
        if (window === "storm") summary.renderedStorm++; else summary.rendered24h++;
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    }

    async function worker() {
      while (i < cams.length) {
        const cam = cams[i++];
        const tag = `${cam.resorts!.slug}/${cam.name}`;
        try {
          const storm = NO_STORMS ? null : stormWindow({ now, daily: dailyByResort.get(cam.resort_id) ?? [], latest24hIn: snow24h.get(cam.resort_id) });
          const from24 = new Date(now.getTime() - WINDOW_24H_HOURS * 3_600_000);
          const from = storm && storm.from < from24 ? storm.from : from24;
          const stills = await rest<StillRow[]>(`cam_stills?select=path,captured_at&cam_id=eq.${cam.id}&captured_at=gte.${from.toISOString()}&order=captured_at.asc&limit=1000`);
          const refs: FrameRef[] = stills.map((s) => ({ path: s.path, capturedAt: s.captured_at }));
          const newest = refs.length ? refs[refs.length - 1].capturedAt : null;

          const frames24 = selectFrames(refs, { from: from24, to: now, maxFrames: MAX_FRAMES });
          if (frames24.length < MIN_FRAMES_24H) summary.sparse++;
          else if (!needsRender(newest, byKey.get(key(cam.id, "24h", null))?.rendered_at)) summary.fresh++;
          else await renderClip(cam, tag, "24h", frames24, null);

          if (storm) {
            const framesStorm = selectFrames(refs, { from: storm.from, to: storm.to, maxFrames: MAX_FRAMES });
            if (framesStorm.length >= MIN_FRAMES_STORM && needsRender(newest, byKey.get(key(cam.id, "storm", storm.stormDate))?.rendered_at)) {
              await renderClip(cam, tag, "storm", framesStorm, storm);
            }
          }
        } catch (e) {
          summary.failed++;
          console.log(`  ✗ ${tag}: ${((e as Error).message ?? String(e)).replace(/\s+/g, " ").slice(0, 200)}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  // Retention: storm clips past a year, objects first, then rows.
  const expired = selectExpiredStorms(existing, now);
  if (expired.length && !DRY) {
    const paths = expired.flatMap((r) => { const p = objectPathFromUrl(r.url); return p ? [p, p.replace(/\.mp4$/, ".jpg")] : []; });
    if (await deleteObjects(paths)) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/cam_timelapses?id=in.(${expired.map((r) => r.id).join(",")})`, { method: "DELETE", headers: { ...sb, Prefer: "return=minimal" } });
      if (res.ok) summary.pruned = expired.length; else console.log(`  ! cam_timelapses DELETE ${res.status}`);
    }
  }
  const cacheRemoved = pruneCache(Date.now());

  console.log(
    `[cam-timelapse] done: ${summary.rendered24h} × 24 h and ${summary.renderedStorm} storm clips rendered (${(summary.bytes / 1_048_576).toFixed(1)} MB), ` +
    `${summary.fresh} already current, ${summary.sparse} with fewer than ${MIN_FRAMES_24H} frames, ${summary.failed} failed, ` +
    `${DRY ? `${expired.length} expired storm clips would be pruned` : `${summary.pruned} expired storm clips pruned`}, ${cacheRemoved} cached frames expired`,
  );
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((e) => { console.error("[cam-timelapse] fatal:", e); process.exit(1); });
