#!/usr/bin/env tsx
/**
 * cam-capture-stills — grab one frame from every click-to-play cam that has
 * no provider-published still, store it in Supabase Storage (bucket
 * `cam-stills`, migration 022) and point cams.still_url at it.
 *
 * Why: the resort card shows one still per resort, and lib/cam-preview.ts can
 * only derive a still for providers with a snapshot endpoint (brownrice,
 * ipcamlive, Ozolio, roundshot, YouTube, image feeds). HLS/iframe-only players
 * (wetmet, skicooper, streamcasthd, rtsp.me, Verkada, camstreamer when it is
 * not fronted by YouTube, …) left the card empty. This job fills that gap.
 *
 * Rules:
 *   - Targets exactly the cams where providerStill(cam) is null (active, not
 *     auto-disabled, not link-outs). Provider stills are never replaced.
 *   - A new frame replaces still_url only when it passes the blank-frame check
 *     (not near-uniform, not near-black). A cam that is offline or dark now
 *     keeps its last good still, which the card labels "Still from <time>".
 *   - Nothing provider-specific is persisted except the method name; signed
 *     stream URLs stay in the log.
 *   - Old frames for a cam are deleted after RETENTION_DAYS so storage stays
 *     bounded (dated object paths, long cache headers).
 *
 * Usage: npx tsx scripts/cam-capture-stills.ts [--dry-run] [--only <slug|cam-id>] [--concurrency 4]
 * Needs: ffmpeg + ffprobe on PATH, .env.local with NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY. Scheduled on the Mac mini via
 * com.peakcam.cam-stills.plist (every 2 h).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Cam } from "../lib/types.js";
import { providerStill } from "../lib/cam-preview.js";

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
const BUCKET = "cam-stills";
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
const m3u8In = (html: string) => html.match(/https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/)?.[0]?.replace(/\\\//g, "/") ?? null;
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

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/cams?select=*,resorts(slug)&is_active=eq.true&auto_disabled=eq.false&embed_type=neq.link&order=resort_id,name`, { headers: sb });
  if (!res.ok) throw new Error(`cams GET ${res.status}`);
  const cams = ((await res.json()) as CamRow[]).filter(c => providerStill(c) === null).filter(c => !ONLY || c.id === ONLY || c.resorts?.slug === ONLY);
  console.log(`[cam-stills] ${new Date().toISOString()} ${cams.length} click-to-play cams without a provider still${DRY ? " (dry run)" : ""}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cam-stills-"));
  const summary = { stored: 0, blank: 0, failed: 0, kept: 0 };
  let i = 0;
  async function worker() {
    while (i < cams.length) {
      const cam = cams[i++]; const tag = `${cam.resorts?.slug ?? "?"}/${cam.name}`;
      const out = path.join(tmp, `${cam.id}.jpg`);
      const cap = await capture(cam, out);
      if ("error" in cap) { summary.failed++; console.log(`  ✗ ${tag}: ${cap.error}${cam.still_url ? " (keeping previous still)" : ""}`); continue; }
      let stats; try { stats = await checkFrame(out); } catch (e) { summary.failed++; console.log(`  ✗ ${tag}: unreadable frame (${(e as Error).message.slice(0, 80)})`); continue; }
      if (stats.blank) { summary.blank++; console.log(`  ○ ${tag}: blank/dark frame (mean ${stats.mean.toFixed(0)}, spread ${stats.spread.toFixed(1)})${cam.still_url ? " — keeping previous still" : ""}`); continue; }
      if (DRY) { summary.stored++; console.log(`  ✓ ${tag}: ${stats.width}x${stats.height} via ${cap.source} (dry run, not stored)`); continue; }
      try {
        const objectPath = `${cam.id}/${stamp()}.jpg`;
        const publicUrl = await upload(objectPath, out);
        await record(cam.id, { still_url: publicUrl, still_captured_at: new Date().toISOString(), still_source: cap.source });
        await pruneOld(cam.id, objectPath);
        summary.stored++; console.log(`  ✓ ${tag}: ${stats.width}x${stats.height} via ${cap.source}`);
      } catch (e) { summary.failed++; console.log(`  ✗ ${tag}: store failed: ${(e as Error).message.slice(0, 120)}`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`[cam-stills] done: ${summary.stored} stored, ${summary.blank} blank, ${summary.failed} failed`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch(e => { console.error("[cam-stills] fatal:", e); process.exit(1); });
