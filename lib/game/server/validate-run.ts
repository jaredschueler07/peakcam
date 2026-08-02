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
 *     serverless).
 *   - **Ticket signature and expiry** are `verifyTicket`'s job. Map its typed
 *     errors here with {@link rejectionCodeForTicketError} so every failure
 *     path produces the same `rejection_code` vocabulary.
 *
 * ## Tick timebase
 *
 * `GhostSample.tick` is counted at the ghost's own `sample_hz` — one tick per
 * keyframe period, with gaps allowed. That is what makes the submission's
 * `tickHz` cross-checkable against the header's `sample_hz`, and it is how
 * elapsed time is derived: `spanMs = (lastTick - firstTick) / sampleHz * 1000`.
 */

import { simulationConfig, type SimulationConfig } from "../core/config";
import type { DecodedGhost, GhostDecodeError, GhostSample } from "../replay/codec";
import { MAX_KEYFRAMES } from "../replay/codec";
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

/** 50 m/s ≈ 180 km/h. Downhill world-cup speeds top out near 45 m/s. */
export const MAX_RUN_SPEED_CMS = 5_000;
/** 25 m/s² ≈ 2.5 g of acceleration. Gravity alone gives under 1 g. */
export const MAX_ACCEL_CMS2 = 2_500;
/** 80 m/s² of deceleration — a crash into a tree is allowed to be violent. */
export const MAX_DECEL_CMS2 = 8_000;
/** Slack on the per-step displacement bound, absorbing quantisation. */
export const TELEPORT_SLACK_CM = 100;
/** How far outside the baked box a keyframe may sit before it is a fabrication. */
export const BOUNDS_MARGIN_M = 50;
/** A run must start from a standstill-ish state: 8 m/s. */
export const MAX_START_SPEED_CMS = 800;
/** A legal descent covers at least 100 m of ground. */
export const MIN_COURSE_DISTANCE_CM = 10_000;
/** Fixed slack on the ghost-span/`timeMs` comparison, on top of one tick. */
export const DURATION_TOLERANCE_MS = 250;
/**
 * Slack between the client's wall clock and its reported elapsed time. Generous:
 * device clocks drift and the two are measured differently. Wall-clock times are
 * a sanity rail, never the ranked duration.
 */
export const WALL_CLOCK_TOLERANCE_MS = 15_000;
/** Course start/finish, when known, must be reached within this radius. */
export const START_FINISH_RADIUS_M = 60;

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
  /** False when no course registry supplied `startZ`/`finishZ` — see courses.ts. */
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
 * {@link validateRun}. When unset / not `"1"`, validateRun is byte-identical
 * to the pre-A5 baseline (no resim call, same metrics, same early returns).
 */
export const DROP_IN_RESIM_ENV = "DROP_IN_RESIM";

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
 * checked by {@link resimulateGhost} (trajectory envelopes + start/finish +
 * monotonic progress). The flag-off path never enters that branch.
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
  // The ghost's own tick span is the authority; `timeMs` is a client claim
  // that has to agree with it.

  const tickPeriodMs = 1000 / meta.sampleHz;
  const durationTolerance = tickPeriodMs + DURATION_TOLERANCE_MS;
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

  for (let i = 1; i < samples.length; i++) {
    const dtSeconds = (samples[i].tick - samples[i - 1].tick) / meta.sampleHz;
    const stepCm = planarDistanceCm(samples[i - 1], samples[i]);
    const allowedStepCm = MAX_RUN_SPEED_CMS * dtSeconds + TELEPORT_SLACK_CM;
    if (stepCm > allowedStepCm) {
      return fail(
        "teleport",
        `keyframe ${i} moves ${Math.round(stepCm)}cm in ${dtSeconds.toFixed(3)}s ` +
          `(at most ${Math.round(allowedStepCm)}cm is reachable)`,
      );
    }

    const deltaSpeed = samples[i].speedCms - samples[i - 1].speedCms;
    const accel = deltaSpeed / dtSeconds;
    if (accel > MAX_ACCEL_CMS2) {
      return fail(
        "impossible_acceleration",
        `keyframe ${i} accelerates at ${Math.round(accel)}cm/s² (max ${MAX_ACCEL_CMS2})`,
      );
    }
    if (-accel > MAX_DECEL_CMS2) {
      return fail(
        "impossible_acceleration",
        `keyframe ${i} decelerates at ${Math.round(-accel)}cm/s² (max ${MAX_DECEL_CMS2})`,
      );
    }
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
  // Flag-off: fall through with the same accepted payload as before A5.
  if (process.env[DROP_IN_RESIM_ENV] === "1") {
    // Config is required by the public signature (surface-aware envelopes later);
    // trajectory checks today use the shared physical constants only.
    const verdict = resimulateGhost(ghost, course, simulationConfig("packed"));
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
 * consequential (architecture report §9, DESIGN.md §3.7). The pure core is
 * what *produces* honest fixtures; the server imports core config types and
 * may later step it when input recording lands.
 *
 * Quantisation slack: PCGH stores integer centimetres and integer cm/s, so a
 * single-unit round-trip can inflate apparent step length and accel. Slack is
 * derived from that quantisation only — the named envelopes themselves are
 * never redefined.
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

  // ── Duration vs sample count ──
  // Regular cadence: (n-1) periods. Tick gaps (sync/delta) may stretch the
  // span; compression below the regular span is the time-edit tell.
  const ghostSpanMs = ((last.tick - first.tick) / sampleHz) * 1000;
  const regularSpanMs = ((samples.length - 1) / sampleHz) * 1000;
  if (ghostSpanMs + DURATION_TOLERANCE_MS < regularSpanMs) {
    return {
      accepted: false,
      code: "duration_mismatch",
      detail:
        `ghost span ${Math.round(ghostSpanMs)}ms is shorter than the ` +
        `${samples.length}-sample regular span ${Math.round(regularSpanMs)}ms ` +
        `(tolerance ${DURATION_TOLERANCE_MS}ms)`,
    };
  }
  // Also reject a span that is wildly longer than the sample count implies
  // (padded ticks without samples) — same tolerance band on the high side,
  // plus one tick period for the sync cadence.
  const tickPeriodMs = 1000 / sampleHz;
  if (ghostSpanMs - regularSpanMs > DURATION_TOLERANCE_MS + tickPeriodMs) {
    // Only fail when the *average* tick gap is absurdly large; modest gaps are
    // legal (recorder hitch). Cap: more than 4× the regular period on average.
    const avgGap = (last.tick - first.tick) / (samples.length - 1);
    if (avgGap > 4) {
      return {
        accepted: false,
        code: "duration_mismatch",
        detail:
          `ghost span ${Math.round(ghostSpanMs)}ms averages ${avgGap.toFixed(1)} ticks/sample ` +
          `(expected ~1 at ${sampleHz} Hz)`,
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

  // ── Bounds ──
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
    const dtSeconds = (s.tick - prev.tick) / sampleHz;
    if (dtSeconds <= 0) {
      return {
        accepted: false,
        code: "tick_regression",
        detail: `resim keyframe ${i} tick ${s.tick} does not advance past ${prev.tick}`,
      };
    }

    const stepCm = planarDistanceCm(prev, s);
    distanceCm += stepCm;

    // Teleport: max reachable distance + codec slack + 1 cm quantisation per axis.
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

    // Accel / decel on the reported speed field, with quantisation slack:
    // ±1 cm/s on each endpoint → 2/dt cm/s².
    const quantAccelSlack = 2 / dtSeconds;
    const accel = (s.speedCms - prev.speedCms) / dtSeconds;
    if (accel > MAX_ACCEL_CMS2 + quantAccelSlack) {
      return {
        accepted: false,
        code: "impossible_acceleration",
        detail:
          `resim keyframe ${i} accelerates at ${Math.round(accel)}cm/s² ` +
          `(max ${MAX_ACCEL_CMS2} + quant ${Math.round(quantAccelSlack)})`,
      };
    }
    if (-accel > MAX_DECEL_CMS2 + quantAccelSlack) {
      return {
        accepted: false,
        code: "impossible_acceleration",
        detail:
          `resim keyframe ${i} decelerates at ${Math.round(-accel)}cm/s² ` +
          `(max ${MAX_DECEL_CMS2} + quant ${Math.round(quantAccelSlack)})`,
      };
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
  // Allow local backtracking (skids, recoveries) but require net forward
  // progress and that forward dominates reverse.
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
  course: ServerCourse,
): RunValidationMetrics {
  const { meta, samples } = ghost;
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

    const dtSeconds = (s.tick - samples[i - 1].tick) / meta.sampleHz;
    // A non-advancing tick is caught as `tick_regression`; guard the division
    // so metrics stay finite for the rejected row we still want to store.
    if (dtSeconds > 0) {
      const accel = (s.speedCms - samples[i - 1].speedCms) / dtSeconds;
      maxAccelCms2 = Math.max(maxAccelCms2, accel);
      maxDecelCms2 = Math.max(maxDecelCms2, -accel);
    }
  }

  const wallClockMs = Date.parse(submission.finishedAt) - Date.parse(submission.startedAt);

  return {
    keyframes: samples.length,
    sampleHz: meta.sampleHz,
    ghostSpanMs: round2(((last.tick - first.tick) / meta.sampleHz) * 1000),
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
