import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RUN_WATCHDOG_MS,
  ffmpegFrameArgs,
  formatWatchdogMessage,
  frameStats,
  isBlankFrame,
  m3u8In,
  ogImage,
} from "./cam-capture-stills";

const fill = (v: number) => new Uint8Array(32 * 18).fill(v);

test("uniform grey, white and black frames are blank", () => {
  assert.equal(isBlankFrame(frameStats(fill(128))), true);
  assert.equal(isBlankFrame(frameStats(fill(250))), true);
  assert.equal(isBlankFrame(frameStats(fill(3))), true);
});

test("a dark night frame with a few bright pixels is still blank", () => {
  const g = fill(2); g[0] = 200; g[1] = 180;
  assert.equal(isBlankFrame(frameStats(g)), true);
});

test("fog (bright, low contrast) and ordinary scenes pass", () => {
  // Real fog frame from Sunlight Mountain measured mean ~205, spread ~7: bright with faint tree outlines.
  const fog = fill(205); for (let i = 0; i < fog.length; i += 3) fog[i] = 190;
  const stats = frameStats(fog);
  assert.ok(stats.spread >= 3 && stats.mean > 10, `fog spread ${stats.spread}`);
  assert.equal(isBlankFrame(stats), false);
  const scene = new Uint8Array(32 * 18).map((_, i) => (i % 32) * 8);
  assert.equal(isBlankFrame(frameStats(scene)), false);
});

test("ffmpegFrameArgs passes rw_timeout on network inputs, HLS reload caps on .m3u8 only, nothing on local files", () => {
  const net = ffmpegFrameArgs("https://skicooper.com:8443/top_mtn/index.m3u8", "/tmp/out.jpg", "https://skicooper.com/cams");
  assert.ok(net.includes("-rw_timeout") && net[net.indexOf("-rw_timeout") + 1] === "20000000");
  assert.ok(net.includes("-max_reload") && net[net.indexOf("-max_reload") + 1] === "2");
  assert.ok(net.includes("-m3u8_hold_counters") && net[net.indexOf("-m3u8_hold_counters") + 1] === "2");
  assert.ok(net.includes("-referer") && net[net.indexOf("-referer") + 1] === "https://skicooper.com/cams");

  const signed = ffmpegFrameArgs("https://cdn.example.com/live/index.m3u8?token=a.b", "/tmp/out.jpg");
  assert.ok(signed.includes("-max_reload"), "query string after .m3u8");
  assert.ok(signed.indexOf("-max_reload") < signed.indexOf("-i"), "input options precede -i");

  // ffmpeg 9 exits 8 "Option m3u8_hold_counters not found" when a non-HLS URL carries them.
  const stream = ffmpegFrameArgs("https://stream.example.com/cam1/video.mjpg?u=m3u8", "/tmp/out.jpg");
  assert.ok(stream.includes("-rw_timeout"));
  assert.equal(stream.includes("-max_reload"), false);
  assert.equal(stream.includes("-m3u8_hold_counters"), false);

  const local = ffmpegFrameArgs("/tmp/frame.jpg.raw", "/tmp/out.jpg");
  assert.equal(local.includes("-rw_timeout"), false);
  assert.equal(local.includes("-max_reload"), false);
  assert.equal(local.includes("-m3u8_hold_counters"), false);
  assert.equal(local.includes("-user_agent"), false);
});

test("m3u8In and ogImage extract stream and poster URLs from player HTML", () => {
  const escaped = `<script>var src = "https:\\/\\/cdn.example.com\\u002flive\\u002findex.m3u8?token=abc";</script>`;
  assert.equal(m3u8In(escaped), "https://cdn.example.com/live/index.m3u8?token=abc");
  assert.equal(m3u8In("<html>no stream here</html>"), null);

  assert.equal(
    ogImage(`<meta property="og:image" content="https://example.com/poster.jpg">`),
    "https://example.com/poster.jpg",
  );
  assert.equal(
    ogImage(`<meta content="https://example.com/tw.jpg" name="twitter:image">`),
    "https://example.com/tw.jpg",
  );
});

test("formatWatchdogMessage names the deadline and any cams still in flight", () => {
  assert.equal(RUN_WATCHDOG_MS, 30 * 60_000);
  assert.equal(
    formatWatchdogMessage(new Set(["skicooper/Top", "alta/High Rustler"])),
    "[cam-stills] watchdog: run exceeded 30 min, exiting (in flight: skicooper/Top, alta/High Rustler)",
  );
  assert.equal(
    formatWatchdogMessage(new Set()),
    "[cam-stills] watchdog: run exceeded 30 min, exiting (no cams in flight)",
  );
});
