/**
 * lib/game/server/__fixtures__/ghosts.ts
 * ──────────────────────────────────────
 * Load commit-able honest ghosts and produce the canonical trajectory tampers
 * used by the re-simulation gate tests.
 *
 * Honest sources (regenerate via `generate-honest-ghost.ts`):
 *   - honest-ghost.pcgh            braked crawl
 *   - honest-ghost-neutral.pcgh    neutral input
 *   - honest-ghost-full-tuck.pcgh  full tuck
 *   - honest-ghost-jump.pcgh       jumpHeld pulses (real POSE_AIRBORNE)
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  decodeGhost,
  encodeGhost,
  POSE_AIRBORNE,
  POSE_CRASHED,
  type DecodedGhost,
  type GhostSample,
} from "../../replay/codec";
import { resolveCourseOrThrow } from "./run";

const FIXTURE_DIR = path.join(process.cwd(), "lib/game/server/__fixtures__");

export type HonestKind = "braked" | "neutral" | "full-tuck" | "jump";

export interface HonestGhostFixture {
  ghost: DecodedGhost;
  bytes: Uint8Array;
  sampleHz: number;
  seed: number;
  kind: HonestKind;
  course: ReturnType<typeof resolveCourseOrThrow>;
}

function stemFor(kind: HonestKind): string {
  return kind === "braked" ? "honest-ghost" : `honest-ghost-${kind}`;
}

/** Decode a committed honest ghost (PCGH bytes on disk). */
export function loadHonestGhost(kind: HonestKind = "braked"): HonestGhostFixture {
  const stem = stemFor(kind);
  const bytes = new Uint8Array(readFileSync(path.join(FIXTURE_DIR, `${stem}.pcgh`)));
  const ghost = decodeGhost(bytes);
  const meta = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${stem}.json`), "utf8")) as {
    sampleHz: number;
    seed: number;
    kind?: HonestKind;
  };
  return {
    ghost,
    bytes,
    sampleHz: meta.sampleHz,
    seed: meta.seed,
    kind: meta.kind ?? kind,
    course: resolveCourseOrThrow(),
  };
}

function reencode(ghost: DecodedGhost): DecodedGhost {
  const bytes = encodeGhost(ghost.samples, {
    physicsVersion: ghost.meta.physicsVersion,
    courseVersion: ghost.meta.courseVersion,
    sampleHz: ghost.meta.sampleHz,
    seed: ghost.meta.seed,
  });
  return decodeGhost(bytes);
}

/**
 * Time edit via **tick compression**: same trajectory, ticks scaled by `scale`
 * (< 1). The run claims to have finished faster while positions are unchanged.
 * Detection is average inter-sample gap < 0.9 × expected (FIXED_HZ / sampleHz).
 */
export function tamperTickCompression(
  honest: DecodedGhost,
  scale: number,
): DecodedGhost {
  if (!(scale > 0 && scale < 1)) {
    throw new Error(`tamperTickCompression: scale must be in (0,1), got ${scale}`);
  }
  const first = honest.samples[0].tick;
  const samples: GhostSample[] = honest.samples.map((s) => ({
    ...s,
    // Keep first tick anchored; compress the rest toward it.
    tick: first + Math.round((s.tick - first) * scale),
  }));
  // Strictly increasing after rounding collisions.
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].tick <= samples[i - 1].tick) {
      samples[i] = { ...samples[i], tick: samples[i - 1].tick + 1 };
    }
  }
  return reencode({ meta: honest.meta, samples });
}

/** @deprecated use {@link tamperTickCompression} — kept name for older call sites. */
export function tamperDurationShrink(honest: DecodedGhost): DecodedGhost {
  return tamperTickCompression(honest, 0.8);
}

/**
 * Drop a single mid-run sample (honest hitch / dropped frame). Gaps become
 * 2× expected; the resim cadence check must still accept this.
 */
export function dropOneSample(honest: DecodedGhost): DecodedGhost {
  const mid = Math.floor(honest.samples.length / 2);
  const samples = honest.samples.filter((_, i) => i !== mid);
  return reencode({ meta: honest.meta, samples });
}

/** Teleport — jump a mid-run sample by 600 m along Z. */
export function tamperTeleport(honest: DecodedGhost): DecodedGhost {
  const mid = Math.floor(honest.samples.length / 2);
  const samples = honest.samples.map((s, i) =>
    i === mid ? { ...s, zCm: s.zCm + 60_000 } : s,
  );
  return reencode({ meta: honest.meta, samples });
}

/**
 * Speed hack — spike a mid-run sample well above MAX_RUN_SPEED_CMS
 * (3×+ overshoot of the retuned 60 m/s envelope).
 */
export function tamperSpeedHack(honest: DecodedGhost): DecodedGhost {
  const mid = Math.floor(honest.samples.length / 2);
  const samples = honest.samples.map((s, i) =>
    i === mid ? { ...s, speedCms: 20_000 } : s,
  );
  return reencode({ meta: honest.meta, samples });
}

/**
 * Pose spoof: mark every sample airborne without lifting groundOffsetCm.
 * Pose integrity must reject (POSE_AIRBORNE while sitting on the snow).
 */
export function tamperAllAirborneSpoof(honest: DecodedGhost): DecodedGhost {
  const samples = honest.samples.map((s) => ({
    ...s,
    poseFlags: s.poseFlags | POSE_AIRBORNE,
    // Leave groundOffsetCm unchanged (braked fixture is ~0) so the
    // ground-offset cross-check fires rather than the airtime-cap alone.
  }));
  return reencode({ meta: honest.meta, samples });
}

/**
 * Pose spoof: mark every sample crashed and oscillate speed by 30× the local
 * peak so a full-skip of crash envelopes would accept the cheat. Must be
 * rejected by continuous-crash cap and/or the crashed accel/decel bounds.
 * Start sample keeps a legal gate speed so bad_start does not fire first.
 */
export function tamperAllCrashedSpoof(honest: DecodedGhost): DecodedGhost {
  const peak = Math.max(1, ...honest.samples.map((s) => s.speedCms));
  const amp = peak * 30;
  const samples = honest.samples.map((s, i) => ({
    ...s,
    poseFlags: s.poseFlags | POSE_CRASHED,
    // Keep sample 0 at a legal start speed; oscillate from sample 1.
    speedCms: i === 0 ? Math.min(s.speedCms, 100) : i % 2 === 0 ? amp : 0,
  }));
  return reencode({ meta: honest.meta, samples });
}
