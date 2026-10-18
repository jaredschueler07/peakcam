import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archiveAllowedByDefault,
  archivePath,
  clampHours,
  isKeeper,
  pickResortTimeline,
  pruneWindow,
  publicStillUrl,
  selectPrune,
  shapeTimeline,
  thinBucket,
  type CamStillRow,
} from "./cam-timeline";

const NOW = new Date("2026-10-18T18:00:00Z");
const SB = "https://example.supabase.co";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let seq = 0;
const row = (camId: string, captured_at: string, extra: Partial<CamStillRow> = {}): CamStillRow => ({
  id: ++seq,
  cam_id: camId,
  captured_at,
  path: `archive/${camId}/${captured_at}.jpg`,
  snow_24h_at_capture: null,
  keeper: false,
  ...extra,
});

// ─── keeper decision ────────────────────────────────────────────────────

test("keeper = 24 h number at capture of 6 in. or more", () => {
  assert.equal(isKeeper(6), true);
  assert.equal(isKeeper(11.5), true);
  assert.equal(isKeeper(5.9), false);
  assert.equal(isKeeper(0), false);
  assert.equal(isKeeper(null), false);
  assert.equal(isKeeper(undefined), false);
  assert.equal(isKeeper(Number.NaN), false);
});

// ─── paths ──────────────────────────────────────────────────────────────

test("archive paths live under archive/<camId>/ and sort by time", () => {
  const a = archivePath("cam-1", new Date("2026-10-18T15:04:05.123Z"));
  const b = archivePath("cam-1", new Date("2026-10-18T21:04:05.000Z"));
  assert.equal(a, "archive/cam-1/2026-10-18T15-04-05Z.jpg");
  assert.ok(a < b);
  assert.doesNotMatch(a, /:/);
});

test("public URL points at the public bucket path", () => {
  assert.equal(publicStillUrl(`${SB}/`, "archive/c/x.jpg"), `${SB}/storage/v1/object/public/cam-stills/archive/c/x.jpg`);
});

// ─── prune selection ────────────────────────────────────────────────────

test("prune: non-keepers after 30 days, keepers after a year, bad dates ignored", () => {
  const rows = [
    row("c", daysAgo(29)),
    row("c", daysAgo(31)),
    row("c", daysAgo(200), { keeper: true, snow_24h_at_capture: 9 }),
    row("c", daysAgo(366), { keeper: true, snow_24h_at_capture: 9 }),
    row("c", "not a date"),
  ];
  const doomed = selectPrune(rows, NOW);
  assert.deepEqual(doomed.map((r) => r.captured_at).sort(), [daysAgo(31), daysAgo(366)].sort());
});

test("prune: every frame inside 48 h survives at 15-min density", () => {
  const rows = Array.from({ length: 48 * 4 }, (_, i) => row("c", hoursAgo(i / 4)));
  assert.deepEqual(selectPrune(rows, NOW), []);
});

test("prune: past 48 h one frame per 6 h bucket survives, the earliest", () => {
  // Four frames in one 6 h bucket, all ~3 days old. Bucket edges are
  // epoch-aligned, so pick times inside one bucket explicitly.
  const base = Math.floor((NOW.getTime() - 3 * 86_400_000) / 21_600_000) * 21_600_000;
  const at = (m: number) => new Date(base + m * 60_000).toISOString();
  const rows = [row("c", at(45)), row("c", at(15)), row("c", at(300)), row("c", at(120))];
  const doomed = selectPrune(rows, NOW);
  assert.deepEqual(doomed.map((r) => r.captured_at).sort(), [at(45), at(120), at(300)].sort());
  // Adjacent bucket keeps its own representative.
  const next = row("c", new Date(base + 21_600_000 + 60_000).toISOString());
  assert.deepEqual(selectPrune([...rows, next], NOW).length, 3);
});

test("prune: a keeper wins its bucket even when it is not the earliest frame", () => {
  const base = Math.floor((NOW.getTime() - 5 * 86_400_000) / 21_600_000) * 21_600_000;
  const at = (m: number) => new Date(base + m * 60_000).toISOString();
  const plainFirst = row("c", at(10));
  const keeper = row("c", at(200), { keeper: true, snow_24h_at_capture: 8 });
  const plainLast = row("c", at(330));
  const doomed = selectPrune([plainFirst, keeper, plainLast], NOW);
  assert.deepEqual(doomed.map((r) => r.id).sort(), [plainFirst.id, plainLast.id].sort());
  // Two keepers in a bucket: the earliest keeper stays.
  const keeper2 = row("c", at(250), { keeper: true, snow_24h_at_capture: 8 });
  assert.deepEqual(selectPrune([keeper, keeper2], NOW).map((r) => r.id), [keeper2.id]);
});

test("prune: buckets are per cam", () => {
  const base = Math.floor((NOW.getTime() - 4 * 86_400_000) / 21_600_000) * 21_600_000;
  const at = (m: number) => new Date(base + m * 60_000).toISOString();
  const rows = [row("a", at(5)), row("a", at(65)), row("b", at(5)), row("b", at(65))];
  const doomed = selectPrune(rows, NOW);
  assert.deepEqual(doomed.map((r) => `${r.cam_id}@${r.captured_at}`).sort(), [`a@${at(65)}`, `b@${at(65)}`]);
});

test("prune: idempotent, a second pass over the survivors deletes nothing", () => {
  const rows: CamStillRow[] = [];
  for (let h = 0; h < 29 * 24; h += 0.25) rows.push(row("c", hoursAgo(h), h > 100 && h < 106 ? { keeper: true, snow_24h_at_capture: 7 } : {}));
  rows.push(row("c", daysAgo(40)));
  const first = selectPrune(rows, NOW);
  const gone = new Set(first.map((r) => r.id));
  const survivors = rows.filter((r) => !gone.has(r.id));
  assert.deepEqual(selectPrune(survivors, NOW), []);
  // Bound: 48 h of 15-min frames plus at most one per 6 h for the rest of 30 days.
  assert.ok(survivors.length <= 48 * 4 + 1 + Math.ceil((29 * 24 - 48) / 6) + 1, `survivors ${survivors.length}`);
  assert.ok(survivors.filter((r) => r.keeper).length >= 1);
  assert.ok(!survivors.some((r) => r.captured_at === daysAgo(40)));
});

test("prune window: band ends at the 48 h edge and starts on a 6 h bucket boundary", () => {
  const w = pruneWindow(NOW, 7);
  assert.equal(w.thinTo, hoursAgo(48));
  assert.equal(Date.parse(w.thinFrom) % 21_600_000, 0);
  assert.ok(Date.parse(w.thinFrom) <= Date.parse(hoursAgo(48 + 7 * 24)));
  assert.ok(Date.parse(w.thinFrom) > Date.parse(hoursAgo(48 + 7 * 24 + 6)));
  assert.equal(w.plain, daysAgo(30));
  assert.equal(w.keeper, daysAgo(365));
  // lookback is clamped to the 30-day archive.
  assert.equal(pruneWindow(NOW, 90).thinFrom, pruneWindow(NOW, 30).thinFrom);
  assert.equal(thinBucket(21_600_000 * 5 + 1), 5);
});

// ─── archive-rights default ─────────────────────────────────────────────

test("archive default: PeakCam-captured, image feeds and snapshot endpoints are allowed", () => {
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "https://api.wetmet.net/frame.php?x=1", still_url: `${SB}/storage/v1/object/public/cam-stills/abc/x.jpg` }), true);
  assert.equal(archiveAllowedByDefault({ embed_type: "image", embed_url: "https://img.hdrelay.com/cam.jpg" }), true);
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "https://player.brownrice.com/embed/vailch11" }), true);
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "https://live2.brownrice.com/embed/x" }), true);
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "https://tsvweather.brownrice.com/poco-webcam.php" }), true);
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "https://g1.ipcamlive.com/player/player.php?alias=abc" }), true);
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "https://www.ipcamlive.com/player/player.php?alias=abc" }), true);
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "https://relay.ozolio.com/pub.api?cmd=embed&oid=X" }), true);
});

test("archive default: player-only providers, link-outs and aggregators stay false", () => {
  assert.equal(archiveAllowedByDefault({ embed_type: "youtube", embed_url: null }), false);
  assert.equal(archiveAllowedByDefault({ embed_type: "youtube", embed_url: "https://www.youtube.com/watch?v=abc" }), false);
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "https://aspen.roundshot.com/" }), false);
  assert.equal(archiveAllowedByDefault({ embed_type: "image", embed_url: "https://backend.roundshot.com/cams/x/thumbnail" }), false);
  assert.equal(archiveAllowedByDefault({ embed_type: "image", embed_url: "https://imgproxy.windy.com/x.jpg" }), false);
  assert.equal(archiveAllowedByDefault({ embed_type: "image", embed_url: "https://webcams.opensnow.com/x.jpg" }), false);
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "https://v.angelcam.com/iframe?v=abc" }), false);
  assert.equal(archiveAllowedByDefault({ embed_type: "link", embed_url: "https://skibowl.com/cams" }), false);
  assert.equal(archiveAllowedByDefault({ embed_type: "link", embed_url: "https://img.hdrelay.com/cam.jpg", still_url: "https://x" }), false);
  assert.equal(archiveAllowedByDefault({ embed_type: "iframe", embed_url: "not a url" }), false);
});

// ─── timeline shaping ───────────────────────────────────────────────────

test("timeline: newest four in-window frames, oldest first, other cams ignored", () => {
  const rows = [
    row("a", hoursAgo(30)),
    row("a", hoursAgo(18)),
    row("a", hoursAgo(12)),
    row("a", hoursAgo(6)),
    row("a", hoursAgo(1)),
    row("a", hoursAgo(23)),
    row("b", hoursAgo(2)),
  ];
  const t = shapeTimeline(rows, { camId: "a", hours: 24, now: NOW, supabaseUrl: SB });
  assert.ok(t);
  assert.equal(t.frames.length, 4);
  assert.deepEqual(t.frames.map((f) => f.capturedAt), [hoursAgo(18), hoursAgo(12), hoursAgo(6), hoursAgo(1)]);
  assert.equal(t.lastStorm, null);
  assert.equal(t.frames[0].url, publicStillUrl(SB, rows[1].path));
  assert.ok(t.frames.every((f) => f.camId === "a"));
});

test("timeline: last storm is the newest keeper even when outside the window", () => {
  const rows = [
    row("a", daysAgo(20), { keeper: true, snow_24h_at_capture: 7 }),
    row("a", daysAgo(5), { keeper: true, snow_24h_at_capture: 12 }),
    row("a", hoursAgo(3)),
  ];
  const t = shapeTimeline(rows, { camId: "a", hours: 24, now: NOW, supabaseUrl: SB });
  assert.ok(t);
  assert.equal(t.frames.length, 1);
  assert.equal(t.lastStorm?.capturedAt, daysAgo(5));
  assert.equal(t.lastStorm?.snow24hAtCapture, 12);
});

test("timeline: nothing on tape → null, so the strip renders nothing", () => {
  assert.equal(shapeTimeline([], { camId: "a", hours: 24, now: NOW, supabaseUrl: SB }), null);
  assert.equal(shapeTimeline([row("b", hoursAgo(1))], { camId: "a", hours: 24, now: NOW, supabaseUrl: SB }), null);
  // Only a stale non-keeper: nothing in the window and no storm.
  assert.equal(shapeTimeline([row("a", daysAgo(3))], { camId: "a", hours: 24, now: NOW, supabaseUrl: SB }), null);
});

test("timeline: a keeper inside the window appears in both places", () => {
  const rows = [row("a", hoursAgo(5), { keeper: true, snow_24h_at_capture: 8 })];
  const t = shapeTimeline(rows, { camId: "a", hours: 24, now: NOW, supabaseUrl: SB });
  assert.equal(t?.frames.length, 1);
  assert.equal(t?.lastStorm?.id, rows[0].id);
});

test("clampHours: defaults to 24, caps at 48, rejects junk", () => {
  assert.equal(clampHours(undefined), 24);
  assert.equal(clampHours(0), 24);
  assert.equal(clampHours(-4), 24);
  assert.equal(clampHours(12.7), 12);
  assert.equal(clampHours(500), 48);
});

test("resort pick: lead cam wins when it has frames, else the first cam that does", () => {
  const rows = [
    row("lead", daysAgo(10), { keeper: true, snow_24h_at_capture: 9 }),
    row("second", hoursAgo(4)),
    row("third", hoursAgo(2)),
  ];
  const t = pickResortTimeline(rows, ["lead", "second", "third"], { hours: 24, now: NOW, supabaseUrl: SB });
  assert.equal(t?.camId, "second");
  const withLead = pickResortTimeline([...rows, row("lead", hoursAgo(1))], ["lead", "second"], { hours: 24, now: NOW, supabaseUrl: SB });
  assert.equal(withLead?.camId, "lead");
  assert.equal(withLead?.lastStorm?.camId, "lead");
});

test("resort pick: only a storm on tape still returns it; nothing → null", () => {
  const rows = [row("lead", daysAgo(10), { keeper: true, snow_24h_at_capture: 9 })];
  const t = pickResortTimeline(rows, ["lead"], { hours: 24, now: NOW, supabaseUrl: SB });
  assert.equal(t?.frames.length, 0);
  assert.equal(t?.lastStorm?.snow24hAtCapture, 9);
  assert.equal(pickResortTimeline([], ["lead"], { hours: 24, now: NOW, supabaseUrl: SB }), null);
});
