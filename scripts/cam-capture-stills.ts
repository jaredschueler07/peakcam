#!/usr/bin/env tsx
/**
 * cam-capture-stills — two jobs in one pass over the cams table.
 *
 * 1. Latest frame (migration 022). For every click-to-play cam that has no
 *    provider-published still, grab one frame, store it in Supabase Storage
 *    (bucket `cam-stills`, path <camId>/<stamp>.jpg) and point cams.still_url
 *    at it. lib/cam-preview.ts can only derive a still for providers with a
 *    snapshot endpoint; HLS/iframe-only players (wetmet, skicooper,
 *    streamcasthd, rtsp.me, Verkada, camstreamer, …) left the card empty.
 *
 * 2. History archive (migration 024). For every cam with
 *    cams.archive_allowed = true — PeakCam-captured cams plus operator-public
 *    snapshot endpoints and image feeds, see docs/cams/still-archive-policy.md —
 *    store the same frame a second time under archive/<camId>/<iso>.jpg and
 *    insert a cam_stills row carrying the resort's latest 24 h number. A frame
 *    taken while that number is >= 6 in. is a storm `keeper`. Retention has
 *    three tiers (lib/cam-timeline.ts selectPrune): every frame for 48 h, then
 *    one frame per 6 h bucket (keeper preferred) to 30 days, keepers to a year;
 *    the rest is deleted, object first, then row. The site reads the archive
 *    through the cam_still_timeline view (lib/supabase.ts getCamTimeline).
 *
 * Rules:
 *   - Provider stills are never replaced on the card: cams.still_url is only
 *     written for cams where providerStill(cam) is null.
 *   - A frame is stored (either job) only when it passes the blank-frame check
 *     (not near-uniform, not near-black). A cam that is offline or dark now
 *     keeps its last good still; the archive simply has a gap.
 *   - Nothing provider-specific is persisted except the method name; signed
 *     stream URLs stay in the log.
 *   - Latest-frame objects older than RETENTION_DAYS are deleted per cam so
 *     the <camId>/ prefix stays bounded; the archive/ prefix is pruned by row.
 *   - Cadence: the job runs every 15 min (900 s) for the archive. A cam that
 *     only needs a latest frame (no archive_allowed) is still captured once per
 *     LATEST_INTERVAL_MS, so the heavy HLS grabs keep their 6 h rhythm.
 *   - Work per run is bounded by the cam count: one capture and one upload
 *     per cam, one prune query set (expired rows, limit 1000, plus the
 *     thinning band behind the 48 h edge, PRUNE_LOOKBACK_DAYS deep).
 *
 * Usage: npx tsx scripts/cam-capture-stills.ts [--dry-run] [--only <slug|cam-id>] [--concurrency 4]
 *        [--no-archive] [--force-latest] [--prune-lookback-days N] [--prune-only]
 * Needs: ffmpeg + ffprobe on PATH, .env.local with NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. Scheduled via com.peakcam.cam-stills.plist every
 * 15 min (StartInterval 900, see docs/cams/still-archive-policy.md).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Cam } from "../lib/types.js";
import { providerStill } from "../lib/cam-preview.js";
import { ARCHIVE_RETENTION_DAYS, PRUNE_LOOKBACK_DAYS, archivePath, isKeeper, pruneWindow, selectPrune, type PruneRow } from "../lib/cam-timeline.js";

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
const DRY = args.includes("--dry-run");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const CONCURRENCY = Number(args.includes("--concurrency") ? args[args.indexOf("--concurrency") + 1] : 4) || 4;
const NO_ARCHIVE = args.includes("--no-archive");
/** Capture latest-only cams even when their still is fresher than LATEST_INTERVAL_MS. */
const FORCE_LATEST = args.includes("--force-latest");
/** Skip captures; only run the archive prune (catch-up after downtime). */
const PRUNE_ONLY = args.includes("--prune-only");
/** Days behind the 48 h edge to re-thin; `--prune-lookback-days 30` is a full pass. */
const PRUNE_LOOKBACK_DAYS_ARG = Number(args.includes("--prune-lookback-days") ? args[args.indexOf("--prune-lookback-days") + 1] : PRUNE_LOOKBACK_DAYS) || PRUNE_LOOKBACK_DAYS;
const BUCKET = "cam-stills";
/** Latest-only cams (no archive) are re-captured at most this often; 5 min slack under 6 h so a 900 s schedule hits every 6 h run. */
const LATEST_INTERVAL_MS = 6 * 3_600_000 - 5 * 60_000;
/** Latest-frame objects (<camId>/ prefix) kept per cam. The archive/ prefix has its own retention in lib/cam-timeline.ts. */
const RETENTION_DAYS = 7;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";
const MAX_WIDTH = 1280;

type CamRow = Cam & { resorts?: { slug: string } | null };
type Capture = { file: string; source: string } | { error: string; source: string };

// ─── network helpers ─────────────────────────────────────────────────────
async function get(url: string, opts: { referer?: string; redirect?: RequestRedirect; timeout?: number } = {}) {
  return fetch(url, { headers: { "User-Agent": UA, ...(opts.referer ? { Referer: opts.referer } : {}) }, redirect: opts.redirect ?? "follow", signal: AbortSignal.timeout(opts.timeout ?? 20_000) });
}
/** First HLS manifest a player page references. Angelcam and friends write it into a JS string with \uXXXX and \/ escapes, so decode those first. */
const m3u8In = (html: string) => {
  const text = html.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/");
  return text.match(/https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/)?.[0] ?? null;
};
const ogImage = (html: string) =>
  html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1]
  ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i)?.[1] ?? null;

// ─── frame capture ───────────────────────────────────────────────────────
async function ffmpegFrame(input: string, out: string, referer?: string) {
  // The HTTP options only exist for network inputs; ffmpeg rejects them on a local file.
  const net = /^https?:/i.test(input) ? ["-user_agent", UA, ...(referer ? ["-referer", referer] : []), "-rw_timeout", "20000000"] : [];
  await exec(FFMPEG, ["-y", "-loglevel", "error", "-nostdin", ...net, "-i", input, "-frames:v", "1", "-vf", `scale='min(${MAX_WIDTH},iw)':-2`, "-q:v", "4", out], { timeout: 60_000 });
}
async function downloadImage(url: string, out: string, referer?: string) {
  const res = await get(url, { referer });
  const buf = Buffer.from(await res.arrayBuffer());
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8, png = buf[0] === 0x89 && buf[1] === 0x50;
  if (!res.ok || buf.length < 2_000 || !(jpeg || png || (res.headers.get("content-type") ?? "").startsWith("image/"))) throw new Error(`not an image: ${res.status} ${res.headers.get("content-type")} ${buf.length}B`);
  const raw = `${out}.raw`; fs.writeFileSync(raw, buf);
  try { await ffmpegFrame(raw, out); } finally { fs.rmSync(raw, { force: true }); }
}

/** Resolve a stream or poster for a player we know, then grab a frame. */
async function capture(cam: CamRow, out: string): Promise<Capture> {
  const url = cam.embed_url ?? ""; let host = ""; try { host = new URL(url).hostname; } catch { return { error: "bad url", source: "none" }; }
  const viaStream = async (src: string, source: string, referer?: string): Promise<Capture> => { await ffmpegFrame(src, out, referer); return { file: out, source }; };
  try {
    if (host === "api.wetmet.net") {
      const html = await (await get(url)).text(); const v = html.match(/vurl\s*=\s*['"]([^'"]+)['"]/)?.[1];
      return v ? await viaStream(v, "hls") : { error: "no vurl in frame.php", source: "hls" };
    }
    if (host === "skicooper.com") return await viaStream(`https://skicooper.com:8443${new URL(url).pathname.replace(/\/$/, "")}/index.m3u8`, "hls");
    if (host === "tv.streamcasthd.com") {
      const html = await (await get(url)).text();
      return await viaStream(m3u8In(html) ?? `https://tv.streamcasthd.com:3895/live/${url.split("/").filter(Boolean).pop()}live.m3u8`, "hls");
    }
    if (host === "rtsp.me") {
      const id = url.split("/").filter(Boolean).pop(); const ref = `https://rtsp.me/embed/${id}/`;
      const tok = await (await get(`https://rtsp.me/api/embed/${id}/token`, { referer: ref })).json() as { url: string; token: string };
      const d = await (await get(`${tok.url}/token/${tok.token}`, { referer: ref })).json() as { poster?: string; hls?: string };
      if (d.poster) { await downloadImage(d.poster, out); return { file: out, source: "poster" }; }
      return d.hls ? await viaStream(d.hls, "hls") : { error: "no poster/hls", source: "poster" };
    }
    if (host === "vauth.command.verkada.com") {
      const res = await get(url, { redirect: "manual" }); const loc = res.headers.get("location") ?? "";
      const j = loc.includes("#") ? JSON.parse(decodeURIComponent(loc.slice(loc.indexOf("#") + 1))) as { urlSD?: string; urlHD?: string } : null;
      const s = j?.urlSD ?? j?.urlHD; return s ? await viaStream(s, "hls") : { error: `no stream in redirect (${res.status})`, source: "hls" };
    }
    if (host === "camstreamer.com") {
      const res = await get(url, { redirect: "manual" }); const yt = (res.headers.get("location") ?? "").match(/youtube\.com\/embed\/([\w-]{11})/)?.[1];
      if (yt) { await downloadImage(`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`, out); return { file: out, source: "youtube-poster" }; }
      return { error: `camstreamer not fronted by youtube (${res.status})`, source: "youtube-poster" };
    }
    // Generic player page: og:image, else the first HLS manifest it references.
    const page = await get(url); const html = await page.text();
    const og = ogImage(html);
    if (og) { try { await downloadImage(new URL(og, url).href, out, url); return { file: out, source: "og:image" }; } catch { /* fall through */ } }
    const m = m3u8In(html);
    if (m) return await viaStream(m, "page-m3u8", url);
    return { error: `page ${page.status}: no og:image or m3u8`, source: "none" };
  } catch (e) {
    const msg = (e as { stderr?: string; message?: string }).stderr || (e as Error).message || String(e);
    return { error: msg.replace(/\s+/g, " ").slice(0, 200), source: "none" };
  }
}

// ─── blank-frame check ───────────────────────────────────────────────────
/**
 * Mean and spread of luminance on a 32×18 grey downscale. Rejects uniform
 * frames (grey/white/"no signal" cards, spread < 3) and night-black frames
 * (mean < 10). Fog and whiteouts have low spread but a high mean, so they
 * pass — a foggy mountain is still the mountain.
 */
export function frameStats(gray: Uint8Array): { mean: number; spread: number } {
  let sum = 0; for (const v of gray) sum += v; const mean = sum / gray.length;
  let sq = 0; for (const v of gray) sq += (v - mean) ** 2;
  return { mean, spread: Math.sqrt(sq / gray.length) };
}
export function isBlankFrame(stats: { mean: number; spread: number }): boolean {
  return stats.spread < 3 || stats.mean < 10;
}
async function checkFrame(file: string) {
  const { stdout } = await exec(FFMPEG, ["-loglevel", "error", "-nostdin", "-i", file, "-vf", "scale=32:18,format=gray", "-f", "rawvideo", "-"], { encoding: "buffer", timeout: 20_000, maxBuffer: 1 << 20 }) as unknown as { stdout: Buffer };
  const stats = frameStats(new Uint8Array(stdout));
  const { stdout: dims } = await exec(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { timeout: 15_000 });
  const [width, height] = dims.trim().split(",").map(Number);
  return { ...stats, width, height, blank: isBlankFrame(stats) };
}

// ─── storage + db ────────────────────────────────────────────────────────
function stamp(d = new Date()) { return d.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-"); }
async function upload(objectPath: string, file: string) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST", headers: { ...sb, "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "x-upsert": "true" }, body: fs.readFileSync(file),
  });
  if (!res.ok) throw new Error(`upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;
}
async function pruneOld(camId: string, keep: string) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: { ...sb, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: `${camId}/`, limit: 500 }) });
  if (!res.ok) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  const old = ((await res.json()) as { name: string; created_at?: string }[]).filter(o => `${camId}/${o.name}` !== keep && o.created_at && Date.parse(o.created_at) < cutoff).map(o => `${camId}/${o.name}`);
  if (old.length) await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { ...sb, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: old }) });
}
async function record(camId: string, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cams?id=eq.${camId}`, { method: "PATCH", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`cams PATCH ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ─── archive (migration 024) ─────────────────────────────────────────────
type ArchiveRow = { cam_id: string; captured_at: string; path: string; source: string; width: number; height: number; bytes: number; mean_luma: number; spread: number; snow_24h_at_capture: number | null; keeper: boolean };

/** resort_id → latest 24 h number, read once per run so every frame in the run is stamped against the same report set. */
async function latestSnow24h(): Promise<Map<string, number | null>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/latest_snow_reports?select=resort_id,new_snow_24h`, { headers: sb });
  if (!res.ok) { console.log(`  ! latest_snow_reports GET ${res.status}: frames this run get no 24 h number`); return new Map(); }
  return new Map(((await res.json()) as { resort_id: string; new_snow_24h: number | null }[]).map(r => [r.resort_id, r.new_snow_24h]));
}
async function insertArchiveRow(row: ArchiveRow) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cam_stills`, { method: "POST", headers: { ...sb, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`cam_stills POST ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
/** One PostgREST page of cam_stills rows for `filter`; `offset` for paging. */
async function fetchPruneRows(filter: string, offset = 0, limit = 1000): Promise<PruneRow[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cam_stills?select=id,cam_id,captured_at,keeper,path&${filter}&order=captured_at.asc,id.asc&limit=${limit}&offset=${offset}`, { headers: sb });
  if (!res.ok) throw new Error(`cam_stills GET ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return (await res.json()) as PruneRow[];
}
/**
 * Retention pass (lib/cam-timeline.ts selectPrune): every frame for 48 h,
 * one per 6 h bucket to 30 days, keepers to a year. Two candidate sets are
 * read: rows past their expiry cutoff (bounded at 1000 per run; the rest
 * follow next run) and the thinning band behind the 48 h edge,
 * `lookbackDays` deep, whole 6 h buckets only (pruneWindow). Objects first,
 * then rows; a failed object delete leaves the rows for the next run rather
 * than orphaning storage. Idempotent: a second pass finds nothing.
 */
export async function pruneArchive(now = new Date(), lookbackDays = PRUNE_LOOKBACK_DAYS_ARG, dry = DRY): Promise<{ candidates: number; selected: number; removed: number }> {
  const w = pruneWindow(now, lookbackDays);
  const seen = new Map<number, PruneRow & { path: string }>();
  const add = (rows: PruneRow[]) => { for (const r of rows) seen.set(r.id, r as PruneRow & { path: string }); };
  try {
    add(await fetchPruneRows(`or=(and(keeper.eq.false,captured_at.lt.${w.plain}),and(keeper.eq.true,captured_at.lt.${w.keeper}))`));
    // Thinning band: paged, capped so one run can never read the whole table.
    for (let page = 0, offset = 0; page < 40; page++, offset += 1000) {
      const rows = await fetchPruneRows(`captured_at=gte.${w.thinFrom}&captured_at=lt.${w.thinTo}`, offset);
      add(rows);
      if (rows.length < 1000) break;
    }
  } catch (e) { console.log(`  ! prune: ${(e as Error).message}`); return { candidates: seen.size, selected: 0, removed: 0 }; }
  const candidates = [...seen.values()];
  const doomed = selectPrune(candidates, now);
  if (!doomed.length || dry) return { candidates: candidates.length, selected: doomed.length, removed: 0 };
  let removed = 0;
  for (let i = 0; i < doomed.length; i += 100) {
    const batch = doomed.slice(i, i + 100);
    const del = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { ...sb, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: batch.map(r => r.path) }) });
    if (!del.ok) { console.log(`  ! prune: object DELETE ${del.status}: ${(await del.text()).slice(0, 120)}`); continue; }
    const rowDel = await fetch(`${SUPABASE_URL}/rest/v1/cam_stills?id=in.(${batch.map(r => r.id).join(",")})`, { method: "DELETE", headers: { ...sb, Prefer: "return=minimal" } });
    if (!rowDel.ok) { console.log(`  ! prune: cam_stills DELETE ${rowDel.status}`); continue; }
    removed += batch.length;
  }
  return { candidates: candidates.length, selected: doomed.length, removed };
}

// ─── main ────────────────────────────────────────────────────────────────
const lookbackLabel = () => PRUNE_LOOKBACK_DAYS_ARG >= ARCHIVE_RETENTION_DAYS ? "full pass" : `${PRUNE_LOOKBACK_DAYS_ARG} d lookback`;
async function main() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cams?select=*,resorts(slug)&is_active=eq.true&auto_disabled=eq.false&embed_type=neq.link&order=resort_id,name`, { headers: sb });
  if (!res.ok) throw new Error(`cams GET ${res.status}`);
  // Two target sets, one pass: cams that need a latest frame (no provider
  // still) and cams whose history we may keep (archive_allowed). A cam can be
  // both; it is captured once and stored twice.
  const wantsArchive = (c: CamRow) => !NO_ARCHIVE && c.archive_allowed === true;
  // Latest-only cams keep a 6 h rhythm under the 15 min schedule: skip them
  // while their still is fresh. Archive cams are captured every run.
  const latestFresh = (c: CamRow) => !FORCE_LATEST && !wantsArchive(c) && !!c.still_captured_at && Date.now() - Date.parse(c.still_captured_at) < LATEST_INTERVAL_MS;
  const wantsLatest = (c: CamRow) => providerStill(c) === null && !latestFresh(c);
  const cams = PRUNE_ONLY ? [] : ((await res.json()) as CamRow[]).filter(c => wantsLatest(c) || wantsArchive(c)).filter(c => !ONLY || c.id === ONLY || c.resorts?.slug === ONLY);
  const nLatest = cams.filter(wantsLatest).length, nArchive = cams.filter(wantsArchive).length;
  console.log(`[cam-stills] ${new Date().toISOString()} ${cams.length} cams: ${nLatest} need a latest frame, ${nArchive} archive-allowed${DRY ? " (dry run)" : ""}`);
  const snow24h = nArchive ? await latestSnow24h() : new Map<string, number | null>();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cam-stills-"));
  const summary = { stored: 0, archived: 0, keepers: 0, blank: 0, failed: 0 };
  let i = 0;
  async function worker() {
    while (i < cams.length) {
      const cam = cams[i++]; const tag = `${cam.resorts?.slug ?? "?"}/${cam.name}`;
      const latest = wantsLatest(cam), archive = wantsArchive(cam);
      const out = path.join(tmp, `${cam.id}.jpg`);
      // Archive-only cams have a provider still by definition; fetch that
      // snapshot directly instead of resolving a player page.
      const provider = latest ? null : providerStill(cam);
      const cap: Capture = provider
        ? await downloadImage(provider.src, out, cam.embed_url ?? undefined).then(() => ({ file: out, source: "provider-snapshot" }), (e: unknown) => ({ error: ((e as { message?: string }).message ?? String(e)).replace(/\s+/g, " ").slice(0, 200), source: "provider-snapshot" }))
        : await capture(cam, out);
      if ("error" in cap) { summary.failed++; console.log(`  ✗ ${tag}: ${cap.error}${latest && cam.still_url ? " (keeping previous still)" : ""}`); continue; }
      let stats; try { stats = await checkFrame(out); } catch (e) { summary.failed++; console.log(`  ✗ ${tag}: unreadable frame (${(e as Error).message.slice(0, 80)})`); continue; }
      if (stats.blank) { summary.blank++; console.log(`  ○ ${tag}: blank/dark frame (mean ${stats.mean.toFixed(0)}, spread ${stats.spread.toFixed(1)})${latest && cam.still_url ? " — keeping previous still" : ""}`); continue; }
      const snow = snow24h.get(cam.resort_id) ?? null; const keeper = archive && isKeeper(snow);
      const note = archive ? ` · archive${keeper ? ` KEEPER ${snow}"` : snow != null ? ` ${snow}"` : ""}` : "";
      if (DRY) { if (latest) summary.stored++; if (archive) summary.archived++; if (keeper) summary.keepers++; console.log(`  ✓ ${tag}: ${stats.width}x${stats.height} via ${cap.source}${note} (dry run, not stored)`); continue; }
      const now = new Date();
      if (latest) {
        try {
          const objectPath = `${cam.id}/${stamp(now)}.jpg`;
          const publicUrl = await upload(objectPath, out);
          await record(cam.id, { still_url: publicUrl, still_captured_at: now.toISOString(), still_source: cap.source });
          await pruneOld(cam.id, objectPath);
          summary.stored++; console.log(`  ✓ ${tag}: ${stats.width}x${stats.height} via ${cap.source}${note}`);
        } catch (e) { summary.failed++; console.log(`  ✗ ${tag}: store failed: ${(e as Error).message.slice(0, 120)}`); }
      }
      if (archive) {
        try {
          const objectPath = archivePath(cam.id, now);
          await upload(objectPath, out);
          await insertArchiveRow({ cam_id: cam.id, captured_at: now.toISOString(), path: objectPath, source: cap.source, width: stats.width, height: stats.height, bytes: fs.statSync(out).size, mean_luma: Math.round(stats.mean * 10) / 10, spread: Math.round(stats.spread * 10) / 10, snow_24h_at_capture: snow, keeper });
          summary.archived++; if (keeper) summary.keepers++;
          // Archive-only successes are counted, not logged line by line: ~250 per run.
          if (keeper && !latest) console.log(`  ✓ ${tag}: ${stats.width}x${stats.height} via ${cap.source}${note}`);
        } catch (e) { summary.failed++; console.log(`  ✗ ${tag}: archive failed: ${(e as Error).message.slice(0, 120)}`); }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.rmSync(tmp, { recursive: true, force: true });
  const prune = NO_ARCHIVE || ONLY ? { candidates: 0, selected: 0, removed: 0 } : await pruneArchive();
  const pruneNote = DRY ? `${prune.selected} of ${prune.candidates} candidate frames would be pruned` : `${prune.removed} archive frames pruned (${prune.selected} selected of ${prune.candidates} candidates, ${lookbackLabel()})`;
  console.log(`[cam-stills] done: ${summary.stored} latest stored, ${summary.archived} archived (${summary.keepers} keepers), ${summary.blank} blank, ${summary.failed} failed, ${pruneNote}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch(e => { console.error("[cam-stills] fatal:", e); process.exit(1); });
