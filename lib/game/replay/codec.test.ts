import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GHOST_DELTA_FRAME_BYTES,
  GHOST_FORMAT_VERSION,
  GHOST_HEADER_BYTES,
  GHOST_SYNC_FRAME_BYTES,
  GhostDecodeError,
  MAX_KEYFRAMES,
  POSE_AIRBORNE,
  POSE_BRAKING,
  POSE_CRASHED,
  POSE_TUCKED,
  SYNC_INTERVAL_SECONDS,
  decodeGhost,
  encodeGhost,
  encodedGhostSize,
  quantizeGhostSample,
  type GhostEncodeMeta,
  type GhostSample,
} from "./codec";

const SAMPLE_HZ = 10;

const META: GhostEncodeMeta = {
  physicsVersion: 3,
  courseVersion: 20260801,
  sampleHz: SAMPLE_HZ,
  seed: 0xdeadbeef,
  originYCm: 254_000,
};

/**
 * A deterministic pseudo-run: a skidding descent down -Z with a sinusoidal
 * carve, a jump, and a crash near the end. No RNG — the fixture must be stable.
 */
function makeRun(sampleCount: number): GhostSample[] {
  const samples: GhostSample[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = i / SAMPLE_HZ;
    const airborne = i % 71 === 0 || i % 71 === 1;
    const crashed = sampleCount > 40 && i > sampleCount - 6;
    samples.push({
      tick: i * 12, // 120 Hz simulation, sampled at 10 Hz
      xCm: Math.round(1200 * Math.sin(t * 0.7)),
      zCm: -Math.round(t * 1850),
      groundOffsetCm: airborne ? 180 : 4,
      yaw: (t * 0.31) % (Math.PI * 2),
      speedCms: 900 + Math.round(500 * Math.sin(t * 0.4)),
      poseFlags:
        (airborne ? POSE_AIRBORNE : 0) |
        (i % 3 === 0 ? POSE_TUCKED : 0) |
        (i % 17 === 0 ? POSE_BRAKING : 0) |
        (crashed ? POSE_CRASHED : 0),
    });
  }
  return samples;
}

test("round-trips samples exactly after quantization", () => {
  const samples = makeRun(600);
  const decoded = decodeGhost(encodeGhost(samples, META));

  assert.equal(decoded.samples.length, samples.length);
  assert.deepEqual(decoded.samples, samples.map(quantizeGhostSample));
});

test("round-trips the header, deriving the X/Z origin from the first sample", () => {
  const samples = makeRun(64);
  const first = quantizeGhostSample(samples[0]);
  const { meta } = decodeGhost(encodeGhost(samples, META));

  assert.deepEqual(meta, {
    formatVersion: GHOST_FORMAT_VERSION,
    physicsVersion: META.physicsVersion,
    courseVersion: META.courseVersion,
    sampleHz: SAMPLE_HZ,
    flags: 0,
    seed: META.seed,
    originXCm: first.xCm,
    originYCm: 254_000,
    originZCm: first.zCm,
    keyframeCount: samples.length,
  });
});

test("survives a single sample and a run with no motion", () => {
  const still: GhostSample[] = [
    { tick: 0, xCm: -400, zCm: 900, groundOffsetCm: 0, yaw: 0, speedCms: 0, poseFlags: 0 },
  ];
  const decoded = decodeGhost(encodeGhost(still, META));
  assert.deepEqual(decoded.samples, still.map(quantizeGhostSample));
});

test("wraps and quantizes yaw into [0, 2π)", () => {
  const yaws = [0, Math.PI / 4, Math.PI, (3 * Math.PI) / 2, Math.PI * 2, -Math.PI / 3, 9.5];
  const samples: GhostSample[] = yaws.map((yaw, i) => ({
    tick: i,
    xCm: 0,
    zCm: -i,
    groundOffsetCm: 0,
    yaw,
    speedCms: 100,
    poseFlags: 0,
  }));

  const decoded = decodeGhost(encodeGhost(samples, META));
  for (let i = 0; i < yaws.length; i++) {
    const expected = ((yaws[i] % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    assert.ok(decoded.samples[i].yaw >= 0 && decoded.samples[i].yaw < Math.PI * 2);
    // One quantum is 2π/65536 ≈ 9.6e-5 rad; allow a half-quantum of error.
    const err = Math.min(
      Math.abs(decoded.samples[i].yaw - expected),
      Math.PI * 2 - Math.abs(decoded.samples[i].yaw - expected),
    );
    assert.ok(err <= Math.PI / 65536, `yaw ${yaws[i]} drifted by ${err}`);
  }
});

test("emits an absolute sync frame every 5 seconds", () => {
  const samples = makeRun(300); // 30 s
  const bytes = encodeGhost(samples, META);
  const interval = SAMPLE_HZ * SYNC_INTERVAL_SECONDS;
  const expectedSyncs = Math.ceil(samples.length / interval);
  const expectedBytes =
    GHOST_HEADER_BYTES +
    expectedSyncs * GHOST_SYNC_FRAME_BYTES +
    (samples.length - expectedSyncs) * GHOST_DELTA_FRAME_BYTES;

  assert.equal(bytes.byteLength, expectedBytes);
  assert.equal(encodedGhostSize(samples, SAMPLE_HZ), expectedBytes);
});

test("promotes frames whose delta would overflow i16 to sync frames", () => {
  // A 500 m jump between samples cannot fit in an i16 centimetre delta.
  const samples: GhostSample[] = [
    { tick: 0, xCm: 0, zCm: 0, groundOffsetCm: 0, yaw: 0, speedCms: 0, poseFlags: 0 },
    { tick: 12, xCm: 50_000, zCm: 0, groundOffsetCm: 0, yaw: 0, speedCms: 0, poseFlags: 0 },
  ];
  const bytes = encodeGhost(samples, META);
  assert.equal(bytes.byteLength, GHOST_HEADER_BYTES + 2 * GHOST_SYNC_FRAME_BYTES);
  assert.deepEqual(decodeGhost(bytes).samples, samples.map(quantizeGhostSample));
});

test("a 3-minute run at 10 Hz stays under 35 KB", () => {
  const samples = makeRun(3 * 60 * SAMPLE_HZ);
  const bytes = encodeGhost(samples, META);
  assert.equal(samples.length, 1800);
  assert.ok(
    bytes.byteLength <= 35 * 1024,
    `3-minute ghost is ${bytes.byteLength} bytes, over the 35 KB budget`,
  );
  // Also assert the report's ~25–32 KB expectation is not wildly off.
  assert.ok(bytes.byteLength >= 20 * 1024, `suspiciously small: ${bytes.byteLength} bytes`);
});

// ─── Rejection ───────────────────────────────────────────────

function decodeError(bytes: Uint8Array): GhostDecodeError {
  try {
    decodeGhost(bytes);
  } catch (err) {
    assert.ok(err instanceof GhostDecodeError, `expected GhostDecodeError, got ${String(err)}`);
    return err;
  }
  throw new assert.AssertionError({ message: "expected decodeGhost to throw" });
}

test("rejects a corrupted magic", () => {
  const bytes = encodeGhost(makeRun(20), META);
  bytes[1] = 0x58; // "PXGH"
  assert.equal(decodeError(bytes).code, "bad-magic");
});

test("rejects an unknown format version", () => {
  const bytes = encodeGhost(makeRun(20), META);
  bytes[4] = GHOST_FORMAT_VERSION + 1;
  assert.equal(decodeError(bytes).code, "unsupported-version");
});

test("rejects a buffer shorter than the header", () => {
  const bytes = encodeGhost(makeRun(20), META);
  assert.equal(decodeError(bytes.slice(0, GHOST_HEADER_BYTES - 1)).code, "truncated");
});

test("rejects truncation mid-stream", () => {
  const bytes = encodeGhost(makeRun(60), META);
  assert.equal(decodeError(bytes.slice(0, bytes.byteLength - 5)).code, "truncated");
  assert.equal(decodeError(bytes.slice(0, GHOST_HEADER_BYTES + 4)).code, "truncated");
});

test("rejects trailing bytes past the declared keyframe count", () => {
  const bytes = encodeGhost(makeRun(30), META);
  const padded = new Uint8Array(bytes.byteLength + 3);
  padded.set(bytes);
  assert.equal(decodeError(padded).code, "count-mismatch");
});

test("rejects a keyframe_count the payload cannot satisfy", () => {
  const bytes = encodeGhost(makeRun(30), META);
  new DataView(bytes.buffer).setUint32(30, 0, true);
  assert.equal(decodeError(bytes).code, "count-mismatch");

  const tooMany = encodeGhost(makeRun(30), META);
  new DataView(tooMany.buffer).setUint32(30, MAX_KEYFRAMES + 1, true);
  assert.equal(decodeError(tooMany).code, "count-mismatch");
});

test("rejects a keyframe that does not advance the tick counter", () => {
  const samples = makeRun(20);
  const bytes = encodeGhost(samples, META);
  // Frame 0 is a sync frame; frame 1 is a delta frame right after it.
  const frame1 = GHOST_HEADER_BYTES + GHOST_SYNC_FRAME_BYTES;
  new DataView(bytes.buffer).setUint16(frame1, 0, true); // delta_ticks = 0, still a delta frame
  assert.equal(decodeError(bytes).code, "tick-regression");
});

test("rejects a first keyframe that is not a sync frame", () => {
  const bytes = encodeGhost(makeRun(20), META);
  const view = new DataView(bytes.buffer);
  view.setUint16(GHOST_HEADER_BYTES, 0, true); // clear the sync bit on frame 0
  assert.equal(decodeError(bytes).code, "malformed");
});

test("rejects an out-of-range sample_hz", () => {
  const bytes = encodeGhost(makeRun(20), META);
  bytes[11] = 0;
  assert.equal(decodeError(bytes).code, "malformed");
});

test("rejects coordinates outside the world bounds", () => {
  const bytes = encodeGhost(makeRun(20), META);
  // Push the header origin far enough that every sync frame lands out of bounds.
  new DataView(bytes.buffer).setInt32(18, 1_000_000_000, true);
  assert.equal(decodeError(bytes).code, "out-of-bounds");
});

test("rejects an impossible speed", () => {
  const bytes = encodeGhost(makeRun(20), META);
  // speed_cms of the first (sync) frame: header + 2 (ticks) + 8 (i32 x/z) + 2 + 2.
  new DataView(bytes.buffer).setUint16(GHOST_HEADER_BYTES + 14, 65535, true);
  assert.equal(decodeError(bytes).code, "out-of-bounds");
});

test("encodeGhost refuses empty, oversized, and non-monotonic input", () => {
  assert.throws(() => encodeGhost([], META), /at least one sample/);
  assert.throws(
    () => encodeGhost(makeRun(MAX_KEYFRAMES + 1), META),
    /exceeds the 20000 keyframe limit/,
  );
  const backwards = makeRun(5);
  backwards[3].tick = backwards[2].tick - 1;
  assert.throws(() => encodeGhost(backwards, META), /ticks must strictly increase/);
});

// ─── Sync-frame recovery ─────────────────────────────────────

test("a damaged delta frame corrupts only up to the next sync frame", () => {
  const samples = makeRun(300);
  const expected = samples.map(quantizeGhostSample);
  const bytes = encodeGhost(samples, META);
  const interval = SAMPLE_HZ * SYNC_INTERVAL_SECONDS; // 50 frames

  // Byte offset of frame 61 — a delta frame between the sync frames at 50 and 100.
  const damagedIndex = 61;
  let offset = GHOST_HEADER_BYTES;
  for (let i = 0; i < damagedIndex; i++) {
    offset += i % interval === 0 ? GHOST_SYNC_FRAME_BYTES : GHOST_DELTA_FRAME_BYTES;
  }
  const view = new DataView(bytes.buffer);
  view.setInt16(offset + 2, view.getInt16(offset + 2, true) + 777, true); // bend delta_x_cm

  const decoded = decodeGhost(bytes);
  assert.equal(decoded.samples.length, expected.length);

  // Everything before the damage is untouched.
  assert.deepEqual(decoded.samples.slice(0, damagedIndex), expected.slice(0, damagedIndex));

  // The damage propagates through the remaining deltas of this segment...
  const nextSync = Math.ceil((damagedIndex + 1) / interval) * interval;
  for (let i = damagedIndex; i < nextSync; i++) {
    assert.equal(decoded.samples[i].xCm, expected[i].xCm + 777, `sample ${i} should be offset`);
  }

  // ...and the next absolute sync frame resynchronises the stream exactly.
  assert.deepEqual(decoded.samples.slice(nextSync), expected.slice(nextSync));
});
