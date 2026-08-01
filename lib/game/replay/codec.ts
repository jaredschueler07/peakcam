/**
 * lib/game/replay/codec.ts
 * ────────────────────────
 * "PCGH" — the Drop In v2 binary ghost replay format (architecture report §10,
 * adopted by DESIGN.md §3.7).
 *
 * Pure TypeScript over `DataView`: no DOM, no Node built-ins, no three.js. The
 * recorder (browser), the ghost renderer (browser), the submission Route
 * Handler and the server-side validator all share this one implementation.
 *
 * ## Layout (little-endian throughout)
 *
 * Header — 34 bytes:
 * ```text
 * off  size  field
 *   0     4  magic            "PCGH"
 *   4     1  format_version   u8
 *   5     2  physics_version  u16
 *   7     4  course_version   u32
 *  11     1  sample_hz        u8    e.g. 10
 *  12     2  flags            u16   reserved; 0 today
 *  14     4  seed             u32
 *  18     4  origin_x_cm      i32
 *  22     4  origin_y_cm      i32
 *  26     4  origin_z_cm      i32
 *  30     4  keyframe_count   u32
 * ```
 *
 * Keyframes follow the header back to back. Bit 15 of the leading `delta_ticks`
 * field marks an **absolute sync frame**; the low 15 bits hold the tick delta.
 * (The report leaves the discriminator's placement open — putting it in the
 * leading field keeps the stream self-describing and walkable without changing
 * any field's order or width.)
 *
 * Delta frame — 13 bytes:
 * ```text
 *   0     2  delta_ticks       u16   bit15 = 0
 *   2     2  delta_x_cm        i16   from the previous frame
 *   4     2  delta_z_cm        i16
 *   6     2  ground_offset_cm  i16   skier Y relative to sampled terrain
 *   8     2  yaw               u16   0..65535 maps to 0..2π
 *  10     2  speed_cms         u16
 *  12     1  pose_flags        u8    airborne | tucked | braking | crashed
 * ```
 *
 * Absolute sync frame — 17 bytes (same fields, i32 positions relative to the
 * header origin instead of i16 deltas):
 * ```text
 *   0     2  delta_ticks       u16   bit15 = 1
 *   2     4  abs_x_cm          i32   relative to origin_x_cm
 *   6     4  abs_z_cm          i32   relative to origin_z_cm
 *  10     2  ground_offset_cm  i16
 *  12     2  yaw               u16
 *  14     2  speed_cms         u16
 *  16     1  pose_flags        u8
 * ```
 *
 * Frame 0 is always a sync frame, and the encoder emits another every
 * {@link SYNC_INTERVAL_SECONDS} seconds (plus whenever a delta would overflow
 * i16), so a single damaged delta corrupts only the samples up to the next sync
 * frame rather than the whole tail.
 *
 * `ground_offset_cm` is terrain-relative and therefore independent of
 * `origin_y_cm`; the origin's Y is carried purely as course metadata.
 *
 * At 13–17 bytes × 10 Hz a three-minute run is ~23 KB — comfortably inside the
 * 128 KB submission limit and cheap to store as `bytea`.
 *
 * Ghost samples are for *display*: interpolate between keyframes, and never
 * feed them back into competitive physics.
 */

// ─── Constants ───────────────────────────────────────────────

/** ASCII "PCGH". */
export const GHOST_MAGIC = 0x50434748;
/** Bumped whenever the byte layout changes; decoders reject anything else. */
export const GHOST_FORMAT_VERSION = 1;

export const GHOST_HEADER_BYTES = 34;
export const GHOST_DELTA_FRAME_BYTES = 13;
export const GHOST_SYNC_FRAME_BYTES = 17;

/** Cadence of absolute sync frames, in seconds of run time. */
export const SYNC_INTERVAL_SECONDS = 5;

/** Bit 15 of `delta_ticks`: this frame carries absolute coordinates. */
const SYNC_FLAG = 0x8000;
const TICK_MASK = 0x7fff;

/** `pose_flags` bits. */
export const POSE_AIRBORNE = 1 << 0;
export const POSE_TUCKED = 1 << 1;
export const POSE_BRAKING = 1 << 2;
export const POSE_CRASHED = 1 << 3;
const POSE_FLAG_MASK = 0xff;

const TWO_PI = Math.PI * 2;
const YAW_STEPS = 65536;

const I16_MIN = -32768;
const I16_MAX = 32767;

/** Matches the `ghost_keyframes between 2 and 20000` check in migration 012. */
export const MAX_KEYFRAMES = 20000;
/** ±200 km from the course origin: far outside any baked resort box. */
export const MAX_COORD_CM = 20_000_000;
/**
 * 200 m/s (720 km/h). A corruption guard, not a gameplay cap — the physics
 * validator owns the real speed ceiling.
 */
export const MAX_SPEED_CMS = 20000;

// ─── Types ───────────────────────────────────────────────────

/** One recorded ghost sample in absolute world units (centimetres, radians). */
export interface GhostSample {
  /** Absolute simulation tick index; strictly increasing across a run. */
  tick: number;
  /** World X, centimetres. */
  xCm: number;
  /** World Z, centimetres. */
  zCm: number;
  /** Skier Y relative to the sampled terrain height, centimetres. */
  groundOffsetCm: number;
  /** Heading, radians in `[0, 2π)`. */
  yaw: number;
  /** Speed, centimetres per second. */
  speedCms: number;
  /** Bitfield of the `POSE_*` constants. */
  poseFlags: number;
}

/** Header fields the caller supplies; the origin's X/Z default to sample 0. */
export interface GhostEncodeMeta {
  physicsVersion: number;
  courseVersion: number;
  /** Keyframe rate, Hz (10 for Drop In v2). */
  sampleHz: number;
  seed: number;
  /** Reserved for future use; defaults to 0. */
  flags?: number;
  originXCm?: number;
  originYCm?: number;
  originZCm?: number;
}

/** Everything the header carries, as returned by {@link decodeGhost}. */
export interface GhostMeta {
  formatVersion: number;
  physicsVersion: number;
  courseVersion: number;
  sampleHz: number;
  flags: number;
  seed: number;
  originXCm: number;
  originYCm: number;
  originZCm: number;
  keyframeCount: number;
}

export interface DecodedGhost {
  meta: GhostMeta;
  samples: GhostSample[];
}

export type GhostErrorCode =
  | "bad-magic"
  | "unsupported-version"
  | "malformed"
  | "truncated"
  | "count-mismatch"
  | "tick-regression"
  | "out-of-bounds";

/** Thrown by {@link decodeGhost}; `code` is safe to surface as a rejection code. */
export class GhostDecodeError extends Error {
  readonly code: GhostErrorCode;

  constructor(code: GhostErrorCode, message: string) {
    super(message);
    this.name = "GhostDecodeError";
    this.code = code;
  }
}

// ─── Quantisation ────────────────────────────────────────────

/** `Math.round` without the negative-zero surprise (decoding never yields -0). */
function roundInt(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

function clampInt(value: number, lo: number, hi: number): number {
  const rounded = roundInt(value);
  return rounded < lo ? lo : rounded > hi ? hi : rounded;
}

/** Radians → the u16 code stored in a keyframe. */
export function quantizeYaw(yaw: number): number {
  const wrapped = ((yaw % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round((wrapped / TWO_PI) * YAW_STEPS) % YAW_STEPS;
}

/** Inverse of {@link quantizeYaw}. */
export function dequantizeYaw(code: number): number {
  return (code / YAW_STEPS) * TWO_PI;
}

/**
 * The sample as it will survive a round trip. Encoding is lossy (integer
 * centimetres, 1/65536-turn yaw); comparing against this rather than the raw
 * input is how callers and tests assert exactness.
 */
export function quantizeGhostSample(sample: GhostSample): GhostSample {
  return {
    tick: roundInt(sample.tick),
    xCm: roundInt(sample.xCm),
    zCm: roundInt(sample.zCm),
    groundOffsetCm: clampInt(sample.groundOffsetCm, I16_MIN, I16_MAX),
    yaw: dequantizeYaw(quantizeYaw(sample.yaw)),
    speedCms: clampInt(sample.speedCms, 0, MAX_SPEED_CMS),
    poseFlags: roundInt(sample.poseFlags) & POSE_FLAG_MASK,
  };
}

// ─── Encode ──────────────────────────────────────────────────

/** Byte length {@link encodeGhost} will produce for these samples. */
export function encodedGhostSize(samples: readonly GhostSample[], sampleHz: number): number {
  return encodePlan(samples, sampleHz).bytes;
}

interface EncodePlan {
  /** True where the frame at that index must carry absolute coordinates. */
  sync: boolean[];
  bytes: number;
}

function encodePlan(samples: readonly GhostSample[], sampleHz: number): EncodePlan {
  const interval = Math.max(1, Math.round(sampleHz * SYNC_INTERVAL_SECONDS));
  const sync: boolean[] = new Array(samples.length).fill(false);
  let bytes = GHOST_HEADER_BYTES;
  let prevX = 0;
  let prevZ = 0;

  for (let i = 0; i < samples.length; i++) {
    const x = Math.round(samples[i].xCm);
    const z = Math.round(samples[i].zCm);
    // Frame 0 anchors the stream; then every `interval` frames; plus any frame
    // whose delta would not fit in i16 (a lift ride or a teleporting fixture).
    const overflows =
      i > 0 && (!fitsI16(x - prevX) || !fitsI16(z - prevZ));
    const isSync = i === 0 || i % interval === 0 || overflows;
    sync[i] = isSync;
    bytes += isSync ? GHOST_SYNC_FRAME_BYTES : GHOST_DELTA_FRAME_BYTES;
    prevX = x;
    prevZ = z;
  }

  return { sync, bytes };
}

function fitsI16(v: number): boolean {
  return v >= I16_MIN && v <= I16_MAX;
}

/**
 * Encode recorded samples into a PCGH buffer.
 *
 * Throws (plain `Error` — encoding failures are programmer errors, not
 * untrusted input) when the samples are empty, exceed {@link MAX_KEYFRAMES},
 * or have non-increasing ticks.
 */
export function encodeGhost(
  samples: readonly GhostSample[],
  meta: GhostEncodeMeta,
): Uint8Array {
  if (samples.length === 0) {
    throw new Error("encodeGhost: at least one sample is required");
  }
  if (samples.length > MAX_KEYFRAMES) {
    throw new Error(
      `encodeGhost: ${samples.length} samples exceeds the ${MAX_KEYFRAMES} keyframe limit`,
    );
  }
  if (!Number.isInteger(meta.sampleHz) || meta.sampleHz < 1 || meta.sampleHz > 240) {
    throw new Error(`encodeGhost: sampleHz must be an integer in 1..240, got ${meta.sampleHz}`);
  }

  const originXCm = roundInt(meta.originXCm ?? samples[0].xCm);
  const originYCm = roundInt(meta.originYCm ?? 0);
  const originZCm = roundInt(meta.originZCm ?? samples[0].zCm);

  const plan = encodePlan(samples, meta.sampleHz);
  const bytes = new Uint8Array(plan.bytes);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, GHOST_MAGIC, false); // magic reads as "PCGH" in a hex dump
  view.setUint8(4, GHOST_FORMAT_VERSION);
  view.setUint16(5, meta.physicsVersion, true);
  view.setUint32(7, meta.courseVersion, true);
  view.setUint8(11, meta.sampleHz);
  view.setUint16(12, meta.flags ?? 0, true);
  view.setUint32(14, meta.seed >>> 0, true);
  view.setInt32(18, originXCm, true);
  view.setInt32(22, originYCm, true);
  view.setInt32(26, originZCm, true);
  view.setUint32(30, samples.length, true);

  let offset = GHOST_HEADER_BYTES;
  let prevTick = 0;
  let prevX = 0;
  let prevZ = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const tick = roundInt(s.tick);
    const x = roundInt(s.xCm);
    const z = roundInt(s.zCm);

    let deltaTicks: number;
    if (i === 0) {
      deltaTicks = 0;
    } else {
      deltaTicks = tick - prevTick;
      if (deltaTicks < 1) {
        throw new Error(
          `encodeGhost: ticks must strictly increase (sample ${i}: ${prevTick} → ${tick})`,
        );
      }
      if (deltaTicks > TICK_MASK) {
        throw new Error(
          `encodeGhost: tick gap ${deltaTicks} at sample ${i} exceeds the ${TICK_MASK} maximum`,
        );
      }
    }

    const isSync = plan.sync[i];
    view.setUint16(offset, isSync ? deltaTicks | SYNC_FLAG : deltaTicks, true);
    offset += 2;

    if (isSync) {
      view.setInt32(offset, x - originXCm, true);
      view.setInt32(offset + 4, z - originZCm, true);
      offset += 8;
    } else {
      view.setInt16(offset, x - prevX, true);
      view.setInt16(offset + 2, z - prevZ, true);
      offset += 4;
    }

    view.setInt16(offset, clampInt(s.groundOffsetCm, I16_MIN, I16_MAX), true);
    view.setUint16(offset + 2, quantizeYaw(s.yaw), true);
    view.setUint16(offset + 4, clampInt(s.speedCms, 0, MAX_SPEED_CMS), true);
    view.setUint8(offset + 6, roundInt(s.poseFlags) & POSE_FLAG_MASK);
    offset += 7;

    prevTick = tick;
    prevX = x;
    prevZ = z;
  }

  return bytes;
}

// ─── Decode ──────────────────────────────────────────────────

/**
 * Decode and validate a PCGH buffer. Every failure mode raises a
 * {@link GhostDecodeError} with a stable `code` — this runs on untrusted
 * submissions, so it never trusts a length, count, or tick from the payload.
 */
export function decodeGhost(bytes: Uint8Array): DecodedGhost {
  if (bytes.byteLength < GHOST_HEADER_BYTES) {
    throw new GhostDecodeError(
      "truncated",
      `ghost is ${bytes.byteLength} bytes, shorter than the ${GHOST_HEADER_BYTES}-byte header`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(0, false) !== GHOST_MAGIC) {
    throw new GhostDecodeError("bad-magic", "ghost does not start with the PCGH magic");
  }

  const formatVersion = view.getUint8(4);
  if (formatVersion !== GHOST_FORMAT_VERSION) {
    throw new GhostDecodeError(
      "unsupported-version",
      `ghost format version ${formatVersion} is not supported (expected ${GHOST_FORMAT_VERSION})`,
    );
  }

  const sampleHz = view.getUint8(11);
  if (sampleHz < 1 || sampleHz > 240) {
    throw new GhostDecodeError("malformed", `sample_hz ${sampleHz} is outside 1..240`);
  }

  const keyframeCount = view.getUint32(30, true);
  if (keyframeCount < 1 || keyframeCount > MAX_KEYFRAMES) {
    throw new GhostDecodeError(
      "count-mismatch",
      `keyframe_count ${keyframeCount} is outside 1..${MAX_KEYFRAMES}`,
    );
  }

  const meta: GhostMeta = {
    formatVersion,
    physicsVersion: view.getUint16(5, true),
    courseVersion: view.getUint32(7, true),
    sampleHz,
    flags: view.getUint16(12, true),
    seed: view.getUint32(14, true),
    originXCm: view.getInt32(18, true),
    originYCm: view.getInt32(22, true),
    originZCm: view.getInt32(26, true),
    keyframeCount,
  };

  const samples: GhostSample[] = [];
  let offset = GHOST_HEADER_BYTES;
  let tick = 0;
  let x = 0;
  let z = 0;

  for (let i = 0; i < keyframeCount; i++) {
    if (offset + 2 > bytes.byteLength) {
      throw new GhostDecodeError(
        "truncated",
        `ghost ends inside keyframe ${i} of ${keyframeCount}`,
      );
    }
    const rawTicks = view.getUint16(offset, true);
    const isSync = (rawTicks & SYNC_FLAG) !== 0;
    const deltaTicks = rawTicks & TICK_MASK;
    const frameBytes = isSync ? GHOST_SYNC_FRAME_BYTES : GHOST_DELTA_FRAME_BYTES;

    if (offset + frameBytes > bytes.byteLength) {
      throw new GhostDecodeError(
        "truncated",
        `ghost ends inside keyframe ${i} of ${keyframeCount}`,
      );
    }

    if (i === 0) {
      if (!isSync) {
        throw new GhostDecodeError("malformed", "the first keyframe must be a sync frame");
      }
      tick = 0;
    } else {
      if (deltaTicks < 1) {
        throw new GhostDecodeError(
          "tick-regression",
          `keyframe ${i} does not advance the tick counter`,
        );
      }
      tick += deltaTicks;
    }

    let cursor = offset + 2;
    if (isSync) {
      x = meta.originXCm + view.getInt32(cursor, true);
      z = meta.originZCm + view.getInt32(cursor + 4, true);
      cursor += 8;
    } else {
      x += view.getInt16(cursor, true);
      z += view.getInt16(cursor + 2, true);
      cursor += 4;
    }

    if (Math.abs(x) > MAX_COORD_CM || Math.abs(z) > MAX_COORD_CM) {
      throw new GhostDecodeError(
        "out-of-bounds",
        `keyframe ${i} is at (${x}, ${z}) cm, outside ±${MAX_COORD_CM} cm`,
      );
    }

    const speedCms = view.getUint16(cursor + 4, true);
    if (speedCms > MAX_SPEED_CMS) {
      throw new GhostDecodeError(
        "out-of-bounds",
        `keyframe ${i} speed ${speedCms} cm/s exceeds ${MAX_SPEED_CMS}`,
      );
    }

    samples.push({
      tick,
      xCm: x,
      zCm: z,
      groundOffsetCm: view.getInt16(cursor, true),
      yaw: dequantizeYaw(view.getUint16(cursor + 2, true)),
      speedCms,
      poseFlags: view.getUint8(cursor + 6),
    });

    offset += frameBytes;
  }

  if (offset !== bytes.byteLength) {
    throw new GhostDecodeError(
      "count-mismatch",
      `${bytes.byteLength - offset} trailing bytes after ${keyframeCount} keyframes`,
    );
  }

  return { meta, samples };
}
