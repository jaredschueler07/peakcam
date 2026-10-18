import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archiveAllowedByDefault,
  archivePath,
  clampHours,
  isKeeper,
  pickResortTimeline,
  publicStillUrl,
  selectPrune,
  shapeTimeline,
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

test("prune: non-keepers after 30 days, keepers after a year, nothing else", () => {
  const rows = [
    row("c", daysAgo(29)),
    row("c", daysAgo(31)),
    row("c", daysAgo(200), { keeper: true, snow_24h_at_capture: 9 }),
    row("c", daysAgo(366), { keeper: true, snow_24h_at_capture: 9 }),
    row("c", "not a date"),
  ];
  const doomed = selectPrune(rows, NOW);
  assert.deepEqual(doomed.map((r) => r.captured_at), [daysAgo(31), daysAgo(366)]);
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
