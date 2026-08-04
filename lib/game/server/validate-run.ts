/**
 * lib/game/server/validate-run.ts
 * ───────────────────────────────
 * Baseline run validation — the "does this trace describe a physically
 * possible descent?" gate from the architecture report §9 ("Validation levels
 * → Baseline").
 *
 * Pure functions, no IO, no env, no Supabase: `POST /api/drop-in/runs` and the
 * unit tests call exactly the same code. That is the point of the module —
 * anti-cheat rules that only exist inside a Route Handler cannot be tested
 * against fixtures.
 *
 * ## What this is and is not
 *
 * Baseline validation rejects the *impossible*: teleports, 300 km/h skiers,
 * runs that ended before they started, coordinates outside the baked world.
 * It cannot reject the merely *implausible* — a perfect line flown by a bot
 * that respects every bound looks exactly like a very good player here. The
 * report is explicit that authoritative re-simulation of the input trace
 * through the pure physics core is the real control (report §9,
 * "Recommended"), and DESIGN.md §3.7 stages it before rankings become
 * consequential. This module is the launch-day floor, not the ceiling.
 *
 * Two further checks live outside these functions because they are not pure:
 *   - **Nonce replay** is enforced by the `run_nonce` unique constraint in
 *     migration 015. The route catches the conflict; there is nothing to
 *     validate in memory (a per-instance seen-set would be worthless on
 *     serverless). See `run-repository.test.ts` (unique-violation →
 *     `nonce_replay`) and `handlers/routes.test.ts` (409 mapping).
 *   - **Ticket signature and expiry** are `verifyTicket`'s job. Map its typed
 *     errors here with {@link rejectionCodeForTicketError} so every failure
 *     path produces the same `rejection_code` vocabulary.
 *
 * ## Tick timebase
 *
 * `GhostSample.tick` is the **absolute 120 Hz simulation step index**
 * (`FIXED_HZ` from `lib/game/core/clock.ts`), not a sample-counter at
 * `sample_hz`. The real recorder emits ticks `0, 4, 8, …` when sampling at
 * 30 Hz (`FIXED_HZ / sampleHz = 4`), or `0, 12, 24, …` at 10 Hz. Elapsed time
 * is therefore:
 *
 *   `spanMs = (lastTick - firstTick) / FIXED_HZ * 1000`
 *
 * and the nominal inter-sample gap is `FIXED_HZ / sampleHz` physics ticks.
 * Dropped samples widen a gap to `k * expected` for small integer `k`; tick
 * compression (time-edit cheats) shrinks the average gap below `0.9 × expected`.
 */

import { FIXED_HZ } from "../core/clock";
import { simulationConfig, type SimulationConfig } from "../core/config";
import type { DecodedGhost, GhostDecodeError, GhostSample } from "../replay/codec";
import { MAX_KEYFRAMES, POSE_AIRBORNE, POSE_CRASHED } from "../replay/codec";
import type { RunTicketError, RunTicketPayload } from "./run-ticket";
import type { ServerCourse } from "./courses";

// ─── Rejection vocabulary ────────────────────────────────────

/**
 * Every value that may land in `drop_in_runs.rejection_code`. Stable strings:
 * they are stored, aggregated for anti-cheat telemetry, and (for the coarse
 * ones) returned to the client, so renaming one is a data migration.
 */
export type RejectionCode =
  // Ticket — from `verifyTicket`.
  | "ticket_malformed"
  | "ticket_unknown_kid"
  | "ticket_bad_sig"
  | "ticket_expired"
  | "ticket_user_mismatch"
  // Ghost decode — from `decodeGhost`.
  | "ghost_bad_magic"
  | "ghost_unsupported_version"
  | "ghost_malformed"
  | "ghost_truncated"
  | "ghost_count_mismatch"
  | "ghost_tick_regression"
  | "ghost_out_of_bounds"
  // One-time nonce, enforced by the unique constraint on `run_nonce`.
  | "nonce_replay"
  // Baseline validation — this module.
  | "course_mismatch"
  | "seed_mismatch"
  | "tick_hz_mismatch"
  | "keyframe_count"
  | "tick_regression"
  | "duration_mismatch"
  | "wall_clock_mismatch"
  | "out_of_bounds"
  | "overspeed"
  | "teleport"
  | "impossible_acceleration"
  | "bad_start"
  | "bad_finish";

/** `RunTicketError.code` → the stored rejection code. */
export function rejectionCodeForTicketError(error: RunTicketError): RejectionCode {
  switch (error.code) {
    case "unknown-kid":
      return "ticket_unknown_kid";
    case "bad-sig":
      return "ticket_bad_sig";
    case "expired":
      return "ticket_expired";
    default:
      return "ticket_malformed";
  }
}

/** `GhostDecodeError.code` → the stored rejection code. */
export function rejectionCodeForGhostError(error: GhostDecodeError): RejectionCode {
  switch (error.code) {
    case "bad-magic":
      return "ghost_bad_magic";
    case "unsupported-version":
      return "ghost_unsupported_version";
    case "truncated":
      return "ghost_truncated";
    case "count-mismatch":
      return "ghost_count_mismatch";
    case "tick-regression":
      return "ghost_tick_regression";
    case "out-of-bounds":
      return "ghost_out_of_bounds";
    default:
      return "ghost_malformed";
  }
}

// ─── Physical bounds ─────────────────────────────────────────
// Deliberately loose. These mark the boundary of the physically possible, not
// of good play: a bound tight enough to catch a subtle cheat would also reject
// honest outliers, and a false rejection on a personal best is worse than a
// cheat that survives until re-simulation lands.

/**
 * 60 m/s ≈ 216 km/h. Raised from 50 m/s (A5 fix round 1): full-tuck honest
 * procedural runs peak near 58 m/s; world-cup DH tops ~45 m/s, so 60 m/s still
 * rejects absurd teleports/speed hacks (3×+ overshoot).
 */
export const MAX_RUN_SPEED_CMS = 6_000;
/**
 * 60 m/s² ≈ 6 g. Raised from 25 m/s² (A5 fix round 1): honest braked p95 ≈
 * 2520 cm/s²; honest full-tuck grounded peaks ≈ 5250 cm/s² on packed
 * procedural. Airborne/crashed segments use the looser mult/limits below —
 * never a full skip (poseFlags is untrusted).
 */
export const MAX_ACCEL_CMS2 = 6_000;
/** 80 m/s² of deceleration — a crash into a tree is allowed to be violent. */
export const MAX_DECEL_CMS2 = 8_000;
/**
 * Airborne accel/decel multiplier (gravity + drag reality, not free pass).
 * Spoofed all-airborne ghosts no longer disable the envelope class.
 */
export const AIRBORNE_ACCEL_MULT = 3;
/**
 * Crashed-segment accel ceiling. Preferred `MAX_ACCEL_CMS2 * 3` (= 18k) is
 * below honest 30 Hz crash aliases (jump fixture crash peak ≈ 31 290 cm/s²),
 * so the bound is observed_honest_max × 2.
 */
export const CRASHED_MAX_ACCEL_CMS2 = 63_000;
/**
 * Crashed-segment decel ceiling. Preferred `MAX_DECEL_CMS2 * 3` (= 24k) is
 * far below honest impact aliases (full-tuck crash peak ≈ 111 450 cm/s²),
 * so the bound is observed_honest_max × 2.
 */
export const CRASHED_MAX_DECEL_CMS2 = 223_000;
/**
 * Minimum |groundOffsetCm| required to claim {@link POSE_AIRBORNE}.
 * Codec `groundOffsetCm` is skier Y relative to sampled terrain — the pure-sim
 * recorder writes it as `(pos.y - terrain.height) * 100`. Claiming airborne
 * while sitting on the snow (offset ≈ 0, as in the braked fixture) is a pose
 * spoof. Threshold sits above quantisation (~1 cm) but under honest jump
 * edge frames (jump fixture min offset ≈ 7 cm).
 */
export const AIRBORNE_MIN_GROUND_OFFSET_CM = 5;
/**
 * Max continuous airborne duration in seconds. Honest Drop In airtime is short
 * (jump fixture longest stretch is well under this; see generate-honest-ghost
 * jump tape). Longer = held-airborne pose spoof.
 */
export const MAX_AIRBORNE_SECONDS = 4;
/**
 * Max continuous crashed duration in seconds. Honest fixtures peak at 1.70 s
 * of continuous POSE_CRASHED (neutral/full-tuck/jump); 4 s is ~2× margin.
 * Longer = held-crash pose spoof that would otherwise mute accel envelopes.
 */
export const MAX_CRASHED_SECONDS = 4;
/** Slack on the per-step displacement bound, absorbing quantisation. */
export const TELEPORT_SLACK_CM = 100;
/** How far outside the baked box a keyframe may sit before it is a fabrication. */
export const BOUNDS_MARGIN_M = 50;
/** A run must start from a standstill-ish state: 8 m/s. */
export const MAX_START_SPEED_CMS = 800;
/** A legal descent covers at least 100 m of ground. */
export const MIN_COURSE_DISTANCE_CM = 10_000;
/** Fixed slack on the ghost-span/`timeMs` comparison, on top of one physics tick. */
export const DURATION_TOLERANCE_MS = 250;
/**
 * Slack between the client's wall clock and its reported elapsed time. Generous:
 * device clocks drift and the two are measured differently. Wall-clock times are
 * a sanity rail, never the ranked duration.
 */
export const WALL_CLOCK_TOLERANCE_MS = 15_000;
/** Course start/finish, when known, must be reached within this radius. */
export const START_FINISH_RADIUS_M = 60;
/**
 * Max integer multiple of the nominal inter-sample gap allowed for a single
 * step (dropped-sample slack). Larger gaps look like a hitch or sparse record;
 * beyond this the average-gap / teleport checks take over.
 */
export const MAX_SAMPLE_GAP_MULTIPLE = 4;
/**
 * Tick-compression floor ratio applied to the nominal gap. We reject when
 * `avgGap < expectedGap * MIN_AVG_GAP_RATIO`. Set to 1 so any average below
 * the nominal period (×0.8 and ×0.9 time edits) fails, while honest
 * (avg = expected) and one-dropped-sample (avg > expected) pass.
 */
export const MIN_AVG_GAP_RATIO = 1;

/** Rebuild the signed model selection server-side; never infer it from the client ghost. */
export function simulationConfigForTicket(
  ticket: Pick<RunTicketPayload, "surface" | "physicsModel">,
): SimulationConfig {
  return simulationConfig(ticket.surface, ticket.physicsModel);
}

// ─── Types ───────────────────────────────────────────────────

/** The submission fields baseline validation actually reads. */
export interface RunSubmissionFacts {
  tickHz: number;
  timeMs: number;
  score: number;
  startedAt: string;
  finishedAt: string;
}

export interface RunValidationInput {
  /** The verified ticket — authoritative for course, seed, and versions. */
  ticket: RunTicketPayload;
  submission: RunSubmissionFacts;
  ghost: DecodedGhost;
  course: ServerCourse;
}

/**
 * Everything the validator measured, stored verbatim in
 * `drop_in_runs.validation_metrics`. Server-only: it describes how close a run
 * came to each bound, which is exactly the map a cheat author would want.
 */
export interface RunValidationMetrics {
  keyframes: number;
  sampleHz: number;
  ghostSpanMs: number;
  reportedTimeMs: number;
  wallClockMs: number;
  distanceCm: number;
  maxSpeedCms: number;
  maxAccelCms2: number;
  maxDecelCms2: number;
  maxStepCm: number;
  maxAbsCoordCm: number;
  startSpeedCms: number;
  finishSpeedCms: number;
  /** Always true once COURSE_GATES supplies startZ/finishZ for every pilot trail. */
  startFinishChecked: boolean;
}

export interface RunValidationResult {
  accepted: boolean;
  rejectionCode: RejectionCode | null;
  /** Human-readable, for server logs only. Never returned to a client. */
  reason: string | null;
  metrics: RunValidationMetrics;
}

/**
 * Verdict from {@link resimulateGhost}. Same rejection vocabulary as baseline
 * validation so the route can store a single `rejection_code`.
 */
export type ResimVerdict =
  | { accepted: true }
  | { accepted: false; code: RejectionCode; detail: string };

/**
 * Env flag that enables the trajectory re-simulation gate inside
 * {@link validateRun}. When unset / not `"1"`, validateRun skips resim
 * (baseline + always-on start/finish gates still run).
 */
export const DROP_IN_RESIM_ENV = "DROP_IN_RESIM";

// ─── Tick helpers ────────────────────────────────────────────

/** Elapsed milliseconds from absolute 120 Hz tick indices. */
export function ghostSpanMsFromTicks(firstTick: number, lastTick: number): number {
  return ((lastTick - firstTick) / FIXED_HZ) * 1000;
}

/** Nominal physics-tick gap between keyframes at the ghost's sample rate. */
export function expectedSampleGapTicks(sampleHz: number): number {
  return FIXED_HZ / sampleHz;
}

function isAirborne(sample: GhostSample): boolean {
  return (sample.poseFlags & POSE_AIRBORNE) !== 0;
}

function isCrashed(sample: GhostSample): boolean {
  return (sample.poseFlags & POSE_CRASHED) !== 0;
}

/**
 * Accel envelope for a segment. Crashed / airborne use looser bounds;
 * grounded uses the base envelope. Never returns null — poseFlags is
 * untrusted client input (callers run {@link checkPoseIntegrity} first).
 */
function segmentAccelLimitCms2(prev: GhostSample, next: GhostSample): number {
  if (isCrashed(prev) || isCrashed(next)) return CRASHED_MAX_ACCEL_CMS2;
  if (isAirborne(prev) || isAirborne(next)) return MAX_ACCEL_CMS2 * AIRBORNE_ACCEL_MULT;
  return MAX_ACCEL_CMS2;
}

function segmentDecelLimitCms2(prev: GhostSample, next: GhostSample): number {
  if (isCrashed(prev) || isCrashed(next)) return CRASHED_MAX_DECEL_CMS2;
  if (isAirborne(prev) || isAirborne(next)) return MAX_DECEL_CMS2 * AIRBORNE_ACCEL_MULT;
  return MAX_DECEL_CMS2;
}

/**
 * Pose integrity over the full sample list.
 * 1. POSE_AIRBORNE requires |groundOffsetCm| ≥ {@link AIRBORNE_MIN_GROUND_OFFSET_CM}
 *    (codec terrain-relative height — no DEM load needed on the submit path).
 * 2. Continuous airborne longer than {@link MAX_AIRBORNE_SECONDS} is rejected.
 * 3. Continuous crashed longer than {@link MAX_CRASHED_SECONDS} is rejected
 *    (honest max continuous crash ≈ 1.70 s; 4 s is ~2× margin).
 */
function checkPoseIntegrity(
  samples: readonly GhostSample[],
  sampleHz: number,
): { ok: true } | { ok: false; code: RejectionCode; detail: string } {
  const maxAirborneSamples = Math.max(1, Math.ceil(MAX_AIRBORNE_SECONDS * sampleHz));
  const maxCrashedSamples = Math.max(1, Math.ceil(MAX_CRASHED_SECONDS * sampleHz));
  let airRun = 0;
  let crashRun = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (isAirborne(s)) {
      if (Math.abs(s.groundOffsetCm) < AIRBORNE_MIN_GROUND_OFFSET_CM) {
        return {
          ok: false,
          code: "impossible_acceleration",
          detail:
            `keyframe ${i} claims POSE_AIRBORNE with groundOffsetCm=${s.groundOffsetCm} ` +
            `(need |offset| ≥ ${AIRBORNE_MIN_GROUND_OFFSET_CM}cm above terrain)`,
        };
      }
      airRun += 1;
      if (airRun > maxAirborneSamples) {
        return {
          ok: false,
          code: "impossible_acceleration",
          detail:
            `continuous airborne stretch of ${airRun} samples exceeds ` +
            `${MAX_AIRBORNE_SECONDS}s cap (${maxAirborneSamples} samples at ${sampleHz} Hz)`,
        };
      }
    } else {
      airRun = 0;
    }

    if (isCrashed(s)) {
      crashRun += 1;
      if (crashRun > maxCrashedSamples) {
        return {
          ok: false,
          code: "impossible_acceleration",
          detail:
            `continuous crashed stretch of ${crashRun} samples exceeds ` +
            `${MAX_CRASHED_SECONDS}s cap (${maxCrashedSamples} samples at ${sampleHz} Hz; ` +
            `honest fixtures peak at ~1.70s)`,
        };
      }
    } else {
      crashRun = 0;
    }
  }
  return { ok: true };
}

function checkSegmentAccel(
  prev: GhostSample,
  next: GhostSample,
  dtSeconds: number,
  keyframeIndex: number,
  quantSlack: boolean,
): { ok: true } | { ok: false; code: RejectionCode; detail: string } {
  const accelLimit = segmentAccelLimitCms2(prev, next);
  const decelLimit = segmentDecelLimitCms2(prev, next);

  const quant = quantSlack && dtSeconds > 0 ? 2 / dtSeconds : 0;
  const accel = (next.speedCms - prev.speedCms) / dtSeconds;
  if (accel > accelLimit + quant) {
    return {
      ok: false,
      code: "impossible_acceleration",
      detail:
        `keyframe ${keyframeIndex} accelerates at ${Math.round(accel)}cm/s² ` +
        `(max ${accelLimit}${quant ? ` + quant ${Math.round(quant)}` : ""})`,
    };
  }
  if (-accel > decelLimit + quant) {
    return {
      ok: false,
      code: "impossible_acceleration",
      detail:
        `keyframe ${keyframeIndex} decelerates at ${Math.round(-accel)}cm/s² ` +
        `(max ${decelLimit}${quant ? ` + quant ${Math.round(quant)}` : ""})`,
    };
  }
  return { ok: true };
}

// ─── Validation ──────────────────────────────────────────────

/**
 * Run every baseline check and return the first failure.
 *
 * Order is deliberate — cheap identity checks (does this ghost even belong to
 * this ticket?) before the per-keyframe sweep, and within the sweep the most
 * specific diagnosis first, so a doctored speed field reports `overspeed`
 * rather than the `impossible_acceleration` it also implies.
 *
 * When `process.env.DROP_IN_RESIM === "1"`, a passing baseline run is then
 * checked by {@link resimulateGhost}. The flag-off path never enters that
 * branch. Note: start/finish gates are always-on (COURSE_GATES) — flag-off is
 * not byte-identical to pre-A5 baseline.
 */
export function validateRun(input: RunValidationInput): RunValidationResult {
  const { ticket, submission, ghost, course } = input;
  const { meta, samples } = ghost;

  const metrics = measure(ghost, submission, course);
  const fail = (rejectionCode: RejectionCode, reason: string): RunValidationResult => ({
    accepted: false,
    rejectionCode,
    reason,
    metrics,
  });

  // ── Identity: the ghost must be the run the ticket authorised ──

  if (meta.physicsVersion !== ticket.physicsVersion || meta.courseVersion !== ticket.courseVersion) {
    return fail(
      "course_mismatch",
      `ghost is v${meta.physicsVersion}/${meta.courseVersion}, ticket is ` +
        `v${ticket.physicsVersion}/${ticket.courseVersion}`,
    );
  }
  if (meta.seed !== (ticket.seed >>> 0)) {
    return fail("seed_mismatch", `ghost seed ${meta.seed} does not match ticket seed ${ticket.seed}`);
  }
  if (meta.sampleHz !== submission.tickHz) {
    return fail(
      "tick_hz_mismatch",
      `ghost sample_hz ${meta.sampleHz} does not match submitted tickHz ${submission.tickHz}`,
    );
  }

  // ── Shape ──

  if (samples.length < 2 || samples.length > MAX_KEYFRAMES) {
    return fail("keyframe_count", `${samples.length} keyframes is outside 2..${MAX_KEYFRAMES}`);
  }

  for (let i = 1; i < samples.length; i++) {
    if (samples[i].tick <= samples[i - 1].tick) {
      return fail(
        "tick_regression",
        `keyframe ${i} ticks ${samples[i].tick} after ${samples[i - 1].tick}`,
      );
    }
  }

  // ── Duration ──
  // Absolute 120 Hz ticks are the authority; `timeMs` is a client claim.

  const physicsTickMs = 1000 / FIXED_HZ;
  const durationTolerance = physicsTickMs + DURATION_TOLERANCE_MS;
  if (Math.abs(submission.timeMs - metrics.ghostSpanMs) > durationTolerance) {
    return fail(
      "duration_mismatch",
      `reported ${submission.timeMs}ms but the ghost spans ${metrics.ghostSpanMs}ms ` +
        `(tolerance ±${Math.round(durationTolerance)}ms)`,
    );
  }
  if (Math.abs(metrics.wallClockMs - submission.timeMs) > WALL_CLOCK_TOLERANCE_MS) {
    return fail(
      "wall_clock_mismatch",
      `wall clock spans ${metrics.wallClockMs}ms but the run reports ${submission.timeMs}ms`,
    );
  }

  // ── Per-keyframe sweep ──

  const maxAbsCoordCm = (course.halfSizeM + BOUNDS_MARGIN_M) * 100;
  if (metrics.maxAbsCoordCm > maxAbsCoordCm) {
    return fail(
      "out_of_bounds",
      `a keyframe sits ${metrics.maxAbsCoordCm}cm from the origin, outside the ` +
        `${course.resortSlug} box (±${maxAbsCoordCm}cm)`,
    );
  }
  if (metrics.maxSpeedCms > MAX_RUN_SPEED_CMS) {
    return fail(
      "overspeed",
      `peak speed ${metrics.maxSpeedCms}cm/s exceeds ${MAX_RUN_SPEED_CMS}cm/s`,
    );
  }

  // Checked before the sweep: a run that is already moving at the gate never
  // started legally, and diagnosing that is more useful than the violent
  // deceleration such a trace also implies a moment later.
  const first = samples[0];
  if (first.speedCms > MAX_START_SPEED_CMS) {
    return fail(
      "bad_start",
      `run opens at ${first.speedCms}cm/s, above the ${MAX_START_SPEED_CMS}cm/s gate speed`,
    );
  }
  if (Math.abs(first.zCm / 100 - course.startZ) > START_FINISH_RADIUS_M) {
    return fail(
      "bad_start",
      `run opens at z=${first.zCm / 100}m, more than ${START_FINISH_RADIUS_M}m from the start`,
    );
  }

  // poseFlags is client-controlled: ground-offset cross-check + airtime cap
  // before any accel envelope trust of the airborne bit.
  const pose = checkPoseIntegrity(samples, meta.sampleHz);
  if (!pose.ok) return fail(pose.code, pose.detail);

  for (let i = 1; i < samples.length; i++) {
    const dtSeconds = (samples[i].tick - samples[i - 1].tick) / FIXED_HZ;
    const stepCm = planarDistanceCm(samples[i - 1], samples[i]);
    const allowedStepCm = MAX_RUN_SPEED_CMS * dtSeconds + TELEPORT_SLACK_CM;
    if (stepCm > allowedStepCm) {
      return fail(
        "teleport",
        `keyframe ${i} moves ${Math.round(stepCm)}cm in ${dtSeconds.toFixed(3)}s ` +
          `(at most ${Math.round(allowedStepCm)}cm is reachable)`,
      );
    }

    const accelCheck = checkSegmentAccel(samples[i - 1], samples[i], dtSeconds, i, false);
    if (!accelCheck.ok) return fail(accelCheck.code, accelCheck.detail);
  }

  // ── Finish ──

  const last = samples[samples.length - 1];

  if (metrics.distanceCm < MIN_COURSE_DISTANCE_CM) {
    return fail(
      "bad_finish",
      `run covers ${Math.round(metrics.distanceCm)}cm, under the ${MIN_COURSE_DISTANCE_CM}cm minimum`,
    );
  }
  if (Math.abs(last.zCm / 100 - course.finishZ) > START_FINISH_RADIUS_M) {
    return fail(
      "bad_finish",
      `run ends at z=${last.zCm / 100}m, more than ${START_FINISH_RADIUS_M}m from the finish`,
    );
  }

  // ── Optional re-simulation gate (A5) ──
  if (process.env[DROP_IN_RESIM_ENV] === "1") {
    const verdict = resimulateGhost(ghost, course, simulationConfigForTicket(ticket));
    if (!verdict.accepted) {
      return fail(verdict.code, verdict.detail);
    }
  }

  return { accepted: true, rejectionCode: null, reason: null, metrics };
}

// ─── Re-simulation / trajectory gate ─────────────────────────

/**
 * Trajectory re-simulation gate: walk the decoded ghost against the physical
 * envelopes and the course start/finish contract.
 *
 * This is not a full input-trace re-step of the physics core (the PCGH format
 * carries samples, not InputFrames). It is the authoritative *trajectory*
 * check that the baseline launch-day validator stages for before rankings are
 * consequential (architecture report §9, DESIGN.md §3.7).
 *
 * Tick timebase is absolute {@link FIXED_HZ} (see module header). Quantisation
 * slack absorbs integer cm / cm/s round-trips only.
 *
 * `config` is accepted for API stability (surface-specific envelopes later);
 * current checks use the shared constants above.
 */
export function resimulateGhost(
  ghost: DecodedGhost,
  course: ServerCourse,
  _config: SimulationConfig,
): ResimVerdict {
  const { meta, samples } = ghost;

  if (samples.length < 2) {
    return {
      accepted: false,
      code: "keyframe_count",
      detail: `resim needs at least 2 keyframes, got ${samples.length}`,
    };
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const sampleHz = meta.sampleHz;
  const expectedGap = expectedSampleGapTicks(sampleHz);
  const ghostSpanMs = ghostSpanMsFromTicks(first.tick, last.tick);

  // ── Cadence: tick compression vs dropped samples ──
  const avgGap = (last.tick - first.tick) / (samples.length - 1);
  if (avgGap < expectedGap * MIN_AVG_GAP_RATIO) {
    return {
      accepted: false,
      code: "duration_mismatch",
      detail:
        `resim average tick gap ${avgGap.toFixed(2)} is below ` +
        `${MIN_AVG_GAP_RATIO}× expected ${expectedGap} (tick compression / time edit)`,
    };
  }

  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].tick - samples[i - 1].tick;
    if (gap <= 0) {
      return {
        accepted: false,
        code: "tick_regression",
        detail: `resim keyframe ${i} tick ${samples[i].tick} does not advance past ${samples[i - 1].tick}`,
      };
    }
    // Allow gap = k * expected for small integer k (dropped samples). A gap that
    // is not a near-multiple and is also far below expected is compression noise
    // on individual steps; the avg check already catches global ×0.8/×0.9.
    if (gap > expectedGap * MAX_SAMPLE_GAP_MULTIPLE) {
      return {
        accepted: false,
        code: "duration_mismatch",
        detail:
          `resim keyframe ${i} tick gap ${gap} exceeds ${MAX_SAMPLE_GAP_MULTIPLE}×` +
          ` expected ${expectedGap}`,
      };
    }
  }

  // ── Start gate ──
  if (first.speedCms > MAX_START_SPEED_CMS) {
    return {
      accepted: false,
      code: "bad_start",
      detail: `resim start speed ${first.speedCms}cm/s exceeds ${MAX_START_SPEED_CMS}cm/s`,
    };
  }
  if (Math.abs(first.zCm / 100 - course.startZ) > START_FINISH_RADIUS_M) {
    return {
      accepted: false,
      code: "bad_start",
      detail:
        `resim opens at z=${first.zCm / 100}m, more than ${START_FINISH_RADIUS_M}m ` +
        `from startZ=${course.startZ}`,
    };
  }

  // ── Pose integrity (untrusted client poseFlags) ──
  const pose = checkPoseIntegrity(samples, sampleHz);
  if (!pose.ok) {
    return { accepted: false, code: pose.code, detail: `resim ${pose.detail}` };
  }

  // ── Bounds + sweep ──
  const maxAbsCoordCm = (course.halfSizeM + BOUNDS_MARGIN_M) * 100;

  let distanceCm = 0;
  let forwardProgressCm = 0;
  let backwardProgressCm = 0;
  const fallDir = course.finishZ >= course.startZ ? 1 : -1;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const absCoord = Math.max(Math.abs(s.xCm), Math.abs(s.zCm));
    if (absCoord > maxAbsCoordCm) {
      return {
        accepted: false,
        code: "out_of_bounds",
        detail: `resim keyframe ${i} at ${absCoord}cm exceeds box ±${maxAbsCoordCm}cm`,
      };
    }
    // Quantisation can nudge reported speed by 1 cm/s.
    if (s.speedCms > MAX_RUN_SPEED_CMS + 1) {
      return {
        accepted: false,
        code: "overspeed",
        detail: `resim keyframe ${i} speed ${s.speedCms}cm/s exceeds ${MAX_RUN_SPEED_CMS}cm/s`,
      };
    }

    if (i === 0) continue;

    const prev = samples[i - 1];
    const dtSeconds = (s.tick - prev.tick) / FIXED_HZ;

    const stepCm = planarDistanceCm(prev, s);
    distanceCm += stepCm;

    const quantStepSlackCm = Math.SQRT2;
    const allowedStepCm = MAX_RUN_SPEED_CMS * dtSeconds + TELEPORT_SLACK_CM + quantStepSlackCm;
    if (stepCm > allowedStepCm) {
      return {
        accepted: false,
        code: "teleport",
        detail:
          `resim keyframe ${i} moves ${Math.round(stepCm)}cm in ${dtSeconds.toFixed(3)}s ` +
          `(cap ${Math.round(allowedStepCm)}cm)`,
      };
    }

    const accelCheck = checkSegmentAccel(prev, s, dtSeconds, i, true);
    if (!accelCheck.ok) {
      return { accepted: false, code: accelCheck.code, detail: `resim ${accelCheck.detail}` };
    }

    const dzCm = s.zCm - prev.zCm;
    const progress = dzCm * fallDir;
    if (progress > 0) forwardProgressCm += progress;
    else backwardProgressCm += -progress;
  }

  // ── Distance floor ──
  if (distanceCm < MIN_COURSE_DISTANCE_CM) {
    return {
      accepted: false,
      code: "bad_finish",
      detail: `resim covers ${Math.round(distanceCm)}cm, under ${MIN_COURSE_DISTANCE_CM}cm`,
    };
  }

  // ── Finish crossing ──
  const lastZ = last.zCm / 100;
  const crossedFinish =
    course.finishZ >= course.startZ ? lastZ >= course.finishZ : lastZ <= course.finishZ;
  const nearFinish = Math.abs(lastZ - course.finishZ) <= START_FINISH_RADIUS_M;
  if (!crossedFinish && !nearFinish) {
    return {
      accepted: false,
      code: "bad_finish",
      detail:
        `resim ends at z=${lastZ}m without crossing finishZ=${course.finishZ} ` +
        `(radius ${START_FINISH_RADIUS_M}m)`,
    };
  }

  // ── Monotonic course progress (overall) ──
  const netProgressCm = (last.zCm - first.zCm) * fallDir;
  if (netProgressCm <= 0) {
    return {
      accepted: false,
      code: "bad_finish",
      detail: `resim makes no net progress toward the finish (net ${Math.round(netProgressCm)}cm along fall line)`,
    };
  }
  if (backwardProgressCm > forwardProgressCm) {
    return {
      accepted: false,
      code: "bad_finish",
      detail:
        `resim reverse progress ${Math.round(backwardProgressCm)}cm exceeds ` +
        `forward ${Math.round(forwardProgressCm)}cm`,
    };
  }

  // Silence unused-span warning in case future cross-checks need it; span is
  // already enforced via avgGap and the baseline timeMs path.
  void ghostSpanMs;

  return { accepted: true };
}

/**
 * Whether a rejected run can be stored for telemetry.
 *
 * Migration 015 checks `ghost_keyframes between 2 and 20000`, so a run rejected
 * *for* its keyframe count cannot be written as a row — the insert would fail
 * the CHECK and surface as a 500. Those rejections are reported to the client
 * and dropped; every other rejection is retained.
 */
export function canPersistRejection(ghost: DecodedGhost): boolean {
  return ghost.samples.length >= 2 && ghost.samples.length <= MAX_KEYFRAMES;
}

// ─── Measurement ─────────────────────────────────────────────

function measure(
  ghost: DecodedGhost,
  submission: RunSubmissionFacts,
  _course: ServerCourse,
): RunValidationMetrics {
  const { samples } = ghost;
  const first = samples[0];
  const last = samples[samples.length - 1];

  let distanceCm = 0;
  let maxSpeedCms = 0;
  let maxAccelCms2 = 0;
  let maxDecelCms2 = 0;
  let maxStepCm = 0;
  let maxAbsCoordCm = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    maxSpeedCms = Math.max(maxSpeedCms, s.speedCms);
    maxAbsCoordCm = Math.max(maxAbsCoordCm, Math.abs(s.xCm), Math.abs(s.zCm));

    if (i === 0) continue;
    const stepCm = planarDistanceCm(samples[i - 1], s);
    distanceCm += stepCm;
    maxStepCm = Math.max(maxStepCm, stepCm);

    const dtSeconds = (s.tick - samples[i - 1].tick) / FIXED_HZ;
    // Metrics include every segment (crash/airborne under looser classes).
    if (dtSeconds > 0) {
      const accel = (s.speedCms - samples[i - 1].speedCms) / dtSeconds;
      maxAccelCms2 = Math.max(maxAccelCms2, accel);
      maxDecelCms2 = Math.max(maxDecelCms2, -accel);
    }
  }

  const wallClockMs = Date.parse(submission.finishedAt) - Date.parse(submission.startedAt);

  return {
    keyframes: samples.length,
    sampleHz: ghost.meta.sampleHz,
    ghostSpanMs: round2(ghostSpanMsFromTicks(first.tick, last.tick)),
    reportedTimeMs: submission.timeMs,
    wallClockMs: Number.isFinite(wallClockMs) ? wallClockMs : 0,
    distanceCm: round2(distanceCm),
    maxSpeedCms,
    maxAccelCms2: round2(maxAccelCms2),
    maxDecelCms2: round2(maxDecelCms2),
    maxStepCm: round2(maxStepCm),
    maxAbsCoordCm,
    startSpeedCms: first.speedCms,
    finishSpeedCms: last.speedCms,
    startFinishChecked: true,
  };
}

function planarDistanceCm(a: GhostSample, b: GhostSample): number {
  const dx = b.xCm - a.xCm;
  const dz = b.zCm - a.zCm;
  return Math.hypot(dx, dz);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
