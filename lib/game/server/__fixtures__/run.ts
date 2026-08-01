/**
 * lib/game/server/__fixtures__/run.ts
 * ───────────────────────────────────
 * A synthetic but *legal* competitive run, and the knobs to break it in one
 * specific way at a time.
 *
 * Test-only (nothing outside `*.test.ts` imports it), but it lives beside the
 * code rather than under `tests/` because it has to stay in step with the
 * codec and the validator's bounds. The run it builds is deliberately
 * unremarkable: 30 s at 10 Hz, a smooth acceleration to 30 m/s, well inside
 * every limit — so any rejection a test sees comes from the tamper it applied,
 * not from the fixture drifting into a bound.
 */

import { encodeGhost, type GhostSample } from "../../replay/codec";
import { COURSE_VERSION, PHYSICS_VERSION } from "../../config/versions";
import {
  courseSeed,
  resolveCourse,
  trailIdsForResort,
  utcDateStamp,
  type ServerCourse,
} from "../courses";
import { issueTicket, parseTicketKeyring, type TicketKeyring } from "../run-ticket";
import type { RunSubmissionFacts } from "../validate-run";

/** A 32-byte secret of one repeated byte — deterministic and long enough. */
function testSecret(fill: number): string {
  return Buffer.alloc(32, fill).toString("base64");
}

/** Two keys so rotation is exercised; the first signs. */
export const TEST_TICKET_KEYS = `test1:${testSecret(0x11)},test2:${testSecret(0x22)}`;

/**
 * Same `kid`, different secret. A ticket signed with {@link TEST_TICKET_KEYS}
 * verified against this keyring fails as `bad-sig` rather than `unknown-kid`.
 */
export const FOREIGN_TICKET_KEYS = `test1:${testSecret(0x33)}`;

export function testKeyring(raw: string = TEST_TICKET_KEYS): TicketKeyring {
  return parseTicketKeyring(raw);
}

export const FIXTURE_RESORT_SLUG = "breckenridge";
export const FIXTURE_SAMPLE_HZ = 10;
export const FIXTURE_KEYFRAMES = 300;
/** Fixed clock so ticket expiry and timestamps are deterministic. */
export const FIXTURE_NOW_MS = Date.UTC(2026, 6, 15, 17, 30, 0);

export interface RunFixtureOptions {
  /** Rewrite the samples after they are generated (the tamper hook). */
  mutateSamples?: (samples: GhostSample[]) => GhostSample[];
  /** Override header fields — used to forge a seed or version mismatch. */
  ghostMeta?: Partial<{ seed: number; physicsVersion: number; courseVersion: number; sampleHz: number }>;
  /** Override submission fields — used to forge a duration mismatch. */
  submission?: Partial<RunSubmissionFacts>;
  nowMs?: number;
  ticketTtlMs?: number;
  /** Bind the ticket to a Supabase user id. */
  userId?: string;
  keyring?: TicketKeyring;
  /** Force the ticket nonce, so a replay can be simulated. */
  nonce?: string;
}

export interface RunFixture {
  samples: GhostSample[];
  ghostBytes: Uint8Array;
  ghostBase64: string;
  ticket: string;
  seed: number;
  course: ServerCourse;
  submission: RunSubmissionFacts;
  nowMs: number;
  keyring: TicketKeyring;
}

/**
 * A 30-second descent: still at the gate, accelerating smoothly to 30 m/s,
 * drifting downhill in +Z with a gentle sinusoidal line in X.
 */
export function makeRunSamples(count = FIXTURE_KEYFRAMES, sampleHz = FIXTURE_SAMPLE_HZ): GhostSample[] {
  const samples: GhostSample[] = [];
  const dt = 1 / sampleHz;
  let xCm = 0;
  let zCm = -14_000;

  for (let i = 0; i < count; i++) {
    // 0 → 3000 cm/s (30 m/s) over the run: 10 cm/s per step, far under the
    // 250 cm/s per step the acceleration bound allows.
    const speedCms = Math.round((3000 * i) / Math.max(1, count - 1));
    if (i > 0) {
      zCm += Math.round(speedCms * dt * 0.98);
      xCm += Math.round(Math.sin(i / 18) * 12);
    }
    samples.push({
      tick: i,
      xCm,
      zCm,
      groundOffsetCm: 90,
      yaw: 0.1,
      speedCms,
      poseFlags: 0,
    });
  }
  return samples;
}

/** Assemble a complete, signed, encodable submission. */
export function makeRunFixture(options: RunFixtureOptions = {}): RunFixture {
  const nowMs = options.nowMs ?? FIXTURE_NOW_MS;
  const keyring = options.keyring ?? testKeyring();
  const sampleHz = options.ghostMeta?.sampleHz ?? FIXTURE_SAMPLE_HZ;

  const course = resolveCourseOrThrow();
  const seed = courseSeed(
    "time_trial",
    FIXTURE_RESORT_SLUG,
    course.trailId,
    COURSE_VERSION,
    utcDateStamp(nowMs),
  );

  const base = makeRunSamples(FIXTURE_KEYFRAMES, sampleHz);
  const samples = options.mutateSamples ? options.mutateSamples(base) : base;

  const ghostBytes = encodeGhost(samples, {
    physicsVersion: options.ghostMeta?.physicsVersion ?? PHYSICS_VERSION,
    courseVersion: options.ghostMeta?.courseVersion ?? COURSE_VERSION,
    sampleHz,
    seed: options.ghostMeta?.seed ?? seed,
  });

  const spanMs = ((samples[samples.length - 1].tick - samples[0].tick) / sampleHz) * 1000;
  const startedAt = new Date(nowMs - spanMs - 2_000).toISOString();
  const finishedAt = new Date(nowMs - 2_000).toISOString();

  const submission: RunSubmissionFacts = {
    tickHz: sampleHz,
    timeMs: Math.round(spanMs),
    score: 42_000,
    startedAt,
    finishedAt,
    ...options.submission,
  };

  const ticket = issueTicket(
    {
      resortSlug: FIXTURE_RESORT_SLUG,
      mode: "time_trial",
      trailId: course.trailId,
      seed,
      physicsVersion: PHYSICS_VERSION,
      courseVersion: COURSE_VERSION,
      userId: options.userId,
    },
    {
      key: keyring.active.key,
      kid: keyring.active.kid,
      ttlMs: options.ticketTtlMs ?? 30 * 60 * 1000,
      now: nowMs,
      ...(options.nonce ? { nonce: options.nonce } : {}),
    },
  );

  return {
    samples,
    ghostBytes,
    ghostBase64: Buffer.from(ghostBytes).toString("base64"),
    ticket,
    seed,
    course,
    submission,
    nowMs,
    keyring,
  };
}

/**
 * The fixture course. Uses the first trail Breckenridge actually defines, so
 * the fixture cannot drift away from the profile it claims to describe.
 */
export function resolveCourseOrThrow(): ServerCourse {
  const trailId = firstTrailId();
  const course = resolveCourse(FIXTURE_RESORT_SLUG, trailId);
  if (!course) {
    throw new Error(`run fixture: ${FIXTURE_RESORT_SLUG}/${trailId} is not a known course`);
  }
  return course;
}

function firstTrailId(): string {
  const ids = trailIdsForResort(FIXTURE_RESORT_SLUG);
  if (ids.length === 0) throw new Error(`run fixture: no trails for ${FIXTURE_RESORT_SLUG}`);
  return ids[0];
}
