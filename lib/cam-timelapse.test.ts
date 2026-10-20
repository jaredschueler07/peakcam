import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRY_DAY_MAX_IN,
  MAX_CLIP_BYTES,
  MAX_FRAMES,
  MAX_STORMS_PER_CAM,
  STORM_MAX_HOURS,
  STORM_TRIGGER_IN,
  clipDurationSeconds,
  clipFfmpegArgs,
  clipPaths,
  encodeAttempt,
  frameFileName,
  needsRender,
  pickResortTimelapse,
  posterFfmpegArgs,
  publicTimelapseUrl,
  scaleFilter,
  selectExpiredStorms,
  selectFrames,
  shapeTimelapses,
  stormWindow,
  type CamTimelapseRow,
} from "./cam-timelapse";

const NOW = new Date("2026-12-20T12:00:00Z");
const h = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
const frame = (hoursAgo: number) => ({ path: `archive/cam/${h(hoursAgo)}.jpg`, capturedAt: h(hoursAgo) });

// ─── selectFrames ───────────────────────────────────────────────────────

test("selectFrames keeps only in-window frames, oldest first, whatever the input order", () => {
  const frames = [frame(1), frame(30), frame(23.5), frame(0.25), { path: "bad", capturedAt: "not a date" }];
  const out = selectFrames(frames, { from: new Date(NOW.getTime() - 24 * 3_600_000), to: NOW });
  assert.deepEqual(out.map((f) => f.capturedAt), [h(23.5), h(1), h(0.25)]);
});

test("selectFrames subsamples evenly to maxFrames and always keeps the first and last frame", () => {
  const frames = Array.from({ length: 288 }, (_, i) => frame(72 - i * 0.25));
  const out = selectFrames(frames, { from: new Date(NOW.getTime() - 72 * 3_600_000), to: NOW, maxFrames: 10 });
  assert.equal(out.length, 10);
  assert.equal(out[0].capturedAt, h(72));
  assert.equal(out[9].capturedAt, h(0.25));
  const gaps = out.slice(1).map((f, i) => Date.parse(f.capturedAt) - Date.parse(out[i].capturedAt));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 2 * 900_000, "gaps differ by at most two capture intervals");
  const full = selectFrames(frames, { from: new Date(NOW.getTime() - 72 * 3_600_000), to: NOW });
  assert.equal(full.length, MAX_FRAMES, "default cap");
});

test("selectFrames returns everything when the window holds fewer than maxFrames", () => {
  const frames = Array.from({ length: 96 }, (_, i) => frame(24 - i * 0.25));
  const out = selectFrames(frames, { from: new Date(NOW.getTime() - 24 * 3_600_000), to: NOW });
  assert.equal(out.length, 96);
});

// ─── needsRender ────────────────────────────────────────────────────────

test("needsRender: no clip yet → render; archive newer than the clip → render; otherwise skip", () => {
  assert.equal(needsRender(h(1), null), true);
  assert.equal(needsRender(h(1), h(2)), true);
  assert.equal(needsRender(h(3), h(2)), false);
  assert.equal(needsRender(null, null), false, "no frames: nothing to render");
  assert.equal(needsRender(h(1), "garbage"), true);
});

// ─── stormWindow ────────────────────────────────────────────────────────

test("stormWindow: nothing without snow at the threshold", () => {
  assert.equal(stormWindow({ now: NOW, daily: [{ date: "2026-12-20", newSnowIn: STORM_TRIGGER_IN - 0.5 }], latest24hIn: 3 }), null);
  assert.equal(stormWindow({ now: NOW, daily: [], latest24hIn: null }), null);
});

test("stormWindow walks back over snowy days to the last dry day and caps at 72 h", () => {
  const daily = [
    { date: "2026-12-16", newSnowIn: 0 },
    { date: "2026-12-17", newSnowIn: 4 },
    { date: "2026-12-18", newSnowIn: DRY_DAY_MAX_IN - 0.5 }, // dry: ends the walk
    { date: "2026-12-19", newSnowIn: 6 },
    { date: "2026-12-20", newSnowIn: 10 },
  ];
  const w = stormWindow({ now: NOW, daily, latest24hIn: 10 });
  assert.ok(w);
  assert.equal(w.stormDate, "2026-12-20");
  assert.equal(w.basis, "daily");
  assert.equal(w.from.toISOString(), "2026-12-19T00:00:00.000Z", "first frame after the dry 18th");
  assert.equal(w.to.getTime(), NOW.getTime());

  const long = stormWindow({ now: NOW, daily: daily.map((d) => ({ ...d, newSnowIn: 5 })).concat([{ date: "2026-12-20", newSnowIn: 9 }]), latest24hIn: 9 });
  assert.ok(long);
  assert.equal(long.from.getTime(), NOW.getTime() - STORM_MAX_HOURS * 3_600_000, "capped at 72 h");
});

test("stormWindow accepts yesterday's daily row (reports written after midnight) and the latest report alone", () => {
  const y = stormWindow({ now: NOW, daily: [{ date: "2026-12-19", newSnowIn: 9 }], latest24hIn: 2 });
  assert.equal(y?.stormDate, "2026-12-19");
  assert.equal(y?.from.toISOString(), "2026-12-19T00:00:00.000Z");

  const r = stormWindow({ now: NOW, daily: [], latest24hIn: 8 });
  assert.ok(r);
  assert.equal(r.basis, "report");
  assert.equal(r.stormDate, "2026-12-20");
  assert.equal(r.from.toISOString(), "2026-12-19T12:00:00.000Z", "last 24 h without a daily record");
});

// ─── ffmpeg ─────────────────────────────────────────────────────────────

test("encodeAttempt ladder: 720p crf 26 first, higher crf next, 480p last, then nothing", () => {
  assert.deepEqual(encodeAttempt(0), { crf: 26, maxWidth: 1280, maxHeight: 720 });
  assert.ok(encodeAttempt(1)!.crf > encodeAttempt(0)!.crf);
  assert.equal(encodeAttempt(3)!.maxHeight, 480);
  assert.equal(encodeAttempt(4), null);
  assert.equal(MAX_CLIP_BYTES, 3 * 1024 * 1024);
});

test("clipFfmpegArgs: image sequence at 7 fps → libx264 yuv420p faststart, no audio, 720p scale", () => {
  const args = clipFfmpegArgs({ frameDir: "/tmp/x", out: "/tmp/x/24h.mp4" });
  const at = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(at("-framerate"), "7");
  assert.equal(at("-r"), "7");
  assert.equal(at("-i"), "/tmp/x/f%05d.jpg");
  assert.equal(at("-c:v"), "libx264");
  assert.equal(at("-crf"), "26");
  assert.equal(at("-pix_fmt"), "yuv420p");
  assert.equal(at("-movflags"), "+faststart");
  assert.ok(args.includes("-an"));
  assert.ok(at("-vf").startsWith(scaleFilter()));
  assert.match(at("-vf"), /format=yuv420p$/);
  assert.equal(args.at(-1), "/tmp/x/24h.mp4");
  const small = clipFfmpegArgs({ frameDir: "/tmp/x", out: "o.mp4", attempt: encodeAttempt(3)! });
  assert.match(small[small.indexOf("-vf") + 1], /min\(854,iw\)/);
  assert.equal(small[small.indexOf("-crf") + 1], "32");
});

test("scaleFilter fits inside the box without upscaling and rounds to even", () => {
  assert.equal(scaleFilter(), "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2");
});

test("posterFfmpegArgs takes one frame through the same scale at JPEG quality 5", () => {
  const args = posterFfmpegArgs({ input: "/tmp/x/f00096.jpg", out: "/tmp/x/24h.jpg" });
  assert.equal(args[args.indexOf("-frames:v") + 1], "1");
  assert.equal(args[args.indexOf("-vf") + 1], scaleFilter());
  assert.equal(args[args.indexOf("-q:v") + 1], "5");
  assert.equal(args.at(-1), "/tmp/x/24h.jpg");
});

test("frameFileName matches the f%05d.jpg pattern, one-based", () => {
  assert.equal(frameFileName(0), "f00001.jpg");
  assert.equal(frameFileName(95), "f00096.jpg");
});

// ─── paths and urls ─────────────────────────────────────────────────────

test("clipPaths and publicTimelapseUrl", () => {
  assert.deepEqual(clipPaths("alta", "cam-1", "24h"), { video: "alta/cam-1/24h.mp4", poster: "alta/cam-1/24h.jpg" });
  assert.deepEqual(clipPaths("alta", "cam-1", "storm", "2026-12-20"), { video: "alta/cam-1/storm-2026-12-20.mp4", poster: "alta/cam-1/storm-2026-12-20.jpg" });
  assert.equal(publicTimelapseUrl("https://x.supabase.co/", "alta/cam-1/24h.mp4"), "https://x.supabase.co/storage/v1/object/public/cam-timelapses/alta/cam-1/24h.mp4");
  assert.equal(publicTimelapseUrl("https://x.supabase.co", "alta/cam-1/24h.mp4", NOW), `https://x.supabase.co/storage/v1/object/public/cam-timelapses/alta/cam-1/24h.mp4?v=${NOW.getTime() / 1000}`);
  assert.equal(publicTimelapseUrl("https://x.supabase.co", "p", "junk"), "https://x.supabase.co/storage/v1/object/public/cam-timelapses/p");
  assert.equal(clipDurationSeconds(96), 13.7);
  assert.equal(clipDurationSeconds(null), null);
});

// ─── shaping ────────────────────────────────────────────────────────────

const row = (over: Partial<CamTimelapseRow>): CamTimelapseRow => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  cam_id: "cam-a",
  window: "24h",
  url: "https://x/24h.mp4",
  poster_url: "https://x/24h.jpg",
  frames: 96,
  starts_at: h(24),
  ends_at: h(0.25),
  bytes: 900_000,
  rendered_at: h(0),
  storm_date: null,
  ...over,
});

test("shapeTimelapses: newest 24 h clip per cam, storms newest-first capped, caller order first, empty cams dropped", () => {
  const rows = [
    row({ id: "old", rendered_at: h(7) }),
    row({ id: "cur", rendered_at: h(1) }),
    row({ id: "s1", window: "storm", storm_date: "2026-12-10" }),
    row({ id: "s2", window: "storm", storm_date: "2026-12-18" }),
    row({ id: "s3", window: "storm", storm_date: "2026-12-01" }),
    row({ id: "s4", window: "storm", storm_date: "2026-11-20" }),
    row({ id: "b", cam_id: "cam-b", rendered_at: h(2) }),
  ];
  const out = shapeTimelapses(rows, ["cam-b", "cam-zzz", "cam-a"]);
  assert.deepEqual(out.map((c) => c.camId), ["cam-b", "cam-a"]);
  const a = out[1];
  assert.equal(a.current?.id, "cur");
  assert.equal(a.current?.posterUrl, "https://x/24h.jpg");
  assert.equal(a.storms.length, MAX_STORMS_PER_CAM);
  assert.deepEqual(a.storms.map((s) => s.stormDate), ["2026-12-18", "2026-12-10", "2026-12-01"]);
  const pick = pickResortTimelapse(out);
  assert.equal(pick.current?.id, "cur", "newest render across cams");
  assert.equal(pick.current?.camId, "cam-a");
  assert.equal(pick.storm?.id, "s2");
  assert.deepEqual(pickResortTimelapse([]), { current: null, storm: null });
});

test("selectExpiredStorms keeps 24 h rows and young storms, drops storms older than a year", () => {
  const rows = [
    row({ id: "cur" }),
    row({ id: "young", window: "storm", storm_date: "2026-01-15" }),
    row({ id: "old", window: "storm", storm_date: "2025-12-01" }),
    row({ id: "nodate", window: "storm", storm_date: null, rendered_at: "2025-11-01T00:00:00Z" }),
  ];
  assert.deepEqual(selectExpiredStorms(rows, NOW).map((r) => r.id), ["old", "nodate"]);
});
