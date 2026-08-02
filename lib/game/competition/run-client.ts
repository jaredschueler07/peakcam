/**
 * lib/game/competition/run-client.ts
 * ──────────────────────────────────
 * Browser side of the competitive loop, steps 3–5: submit a finished run, read
 * the board, and pull one row's ghost back down to race against.
 *
 * ⚠️ Bundled into the client. Like `session-client.ts`, it deliberately imports
 * nothing from `lib/game/server/` — that tree carries `node:crypto`, the ticket
 * signing secret, and the service-role Supabase client. The response shapes
 * below are hand-mirrored from the handlers and bound by zod at runtime; the
 * mutual-assignability assertions in `run-client.test.ts` are what stop the two
 * copies drifting.
 *
 * ## The spend rule
 *
 * {@link submitRun} is the **only** place a run ticket is read and the only
 * caller of `markSubmitted()`. A ticket carries a one-time nonce: submitting it
 * twice is a 409, and a second reader would eventually become a second
 * submitter. So the whole rule is one line at the top of `submitRun` — no
 * ticket, no request — and `markSubmitted()` is called inside the 2xx branch
 * and nowhere else. UI code decides *whether to offer* submission from
 * `session.offline`; it never inspects the ticket.
 *
 * ## Never throws
 *
 * Every function returns its failure. A leaderboard that is down must not trap
 * a player in a results dialog or lose them a descent, so HTTP errors, network
 * drops, malformed bodies and aborts all come back as data to render.
 */

import { z } from "zod";

import { FIXED_HZ } from "../core/clock";
import type { CompetitiveRunMode } from "../config/modes";
import {
  decodeGhost,
  GHOST_HEADER_BYTES,
  type DecodedGhost,
  type GhostSample,
} from "../replay/codec";
import type { RunSessionTicket } from "./session-client";

export const RUN_SUBMISSION_ENDPOINT = "/api/drop-in/runs";
export const LEADERBOARD_ENDPOINT = "/api/drop-in/leaderboard";
export const GHOSTS_ENDPOINT = "/api/drop-in/ghosts";

/** The board the panel shows; also the server's own default page size. */
export const LEADERBOARD_LIMIT = 20;

/**
 * Client-side nickname bound, matching `MAX_NICKNAME_LENGTH` in
 * `lib/game/server/run-schema.ts`. This is an input affordance, not a security
 * control — the server re-sanitises (control chars, bidi overrides, whitespace
 * runs) and its answer is what everyone else sees.
 */
export const MAX_NICKNAME_INPUT_LENGTH = 24;

/** Below the server's `MIN_TIME_MS`; a shorter run cannot be submitted at all. */
const MIN_SUBMITTABLE_TIME_MS = 1_000;
const MAX_SUBMITTABLE_TIME_MS = 1_800_000;

export function ghostEndpoint(runId: string): string {
  return `${GHOSTS_ENDPOINT}/${encodeURIComponent(runId)}`;
}

// ─── Mirrored response shapes ────────────────────────────────

/** Mirrors `publicLeaderboardRowSchema` in lib/game/server/run-schema.ts. */
export const leaderboardRowSchema = z
  .object({
    id: z.string().min(1),
    rank: z.number().int().positive(),
    mode: z.enum(["time_trial", "score_attack"]),
    trailId: z.string().min(1),
    timeMs: z.number().int(),
    score: z.number().int(),
    physicsVersion: z.number().int(),
    courseVersion: z.number().int(),
    displayName: z.string().nullable(),
    isSelf: z.boolean(),
    hasGhost: z.boolean(),
    finishedAt: z.string().min(1),
  })
  .strip();

export type LeaderboardRow = z.infer<typeof leaderboardRowSchema>;

/** Mirrors `publicLeaderboardSchema`. */
export const leaderboardSchema = z
  .object({
    resortSlug: z.string().min(1),
    mode: z.enum(["time_trial", "score_attack"]),
    trailId: z.string().min(1),
    physicsVersion: z.number().int(),
    courseVersion: z.number().int(),
    rows: z.array(leaderboardRowSchema),
  })
  .strip();

export type LeaderboardBoard = z.infer<typeof leaderboardSchema>;

/**
 * Mirrors `RunSubmissionResponseBody` in lib/game/server/handlers/runs.ts.
 *
 * Note what is *not* here: a rank. The submission route answers before the
 * board is re-read, so a placement is only knowable by looking the returned
 * `runId` up in a fresh leaderboard — which is exactly what `LeaderboardPanel`
 * does with `highlightRunId`.
 */
export const submittedRunSchema = z
  .object({
    runId: z.string().min(1),
    accepted: z.boolean(),
    rejectionCode: z.string().optional(),
    timeMs: z.number().int(),
    score: z.number().int(),
    mode: z.enum(["time_trial", "score_attack"]),
    trailId: z.string().min(1),
    physicsVersion: z.number().int(),
    courseVersion: z.number().int(),
    displayName: z.string().nullable(),
  })
  .strip();

export type SubmittedRun = z.infer<typeof submittedRunSchema>;

// ─── Inputs ──────────────────────────────────────────────────

/**
 * The shell's run session, described structurally so this module never imports
 * a component. `DropInRunSession` in `components/drop-in/DropInGame.tsx` is
 * asserted mutually assignable with this in the test file.
 */
export interface SubmittableRunSession {
  mode: "free_ski" | CompetitiveRunMode;
  trailId: string;
  /** Read here and nowhere else — see the module header. */
  ticket: RunSessionTicket | null;
  offline: boolean;
  markSubmitted(): void;
}

/** What `GameRuntime.takeFinishedRun()` hands back. */
export interface FinishedRunRecording {
  samples: readonly GhostSample[];
  /** PCGH bytes, already encoded by the runtime. */
  encoded: Uint8Array;
}

export interface RunClientFailure {
  error: string;
  /** The caller's own cancellation (dialog dismissed, unmount): not worth a notice. */
  aborted?: true;
}

export function isRunClientFailure<T extends object>(
  result: T | RunClientFailure,
): result is RunClientFailure {
  return "error" in result;
}

export interface SubmitRunOptions {
  /** The run's score as the HUD counted it; the server records it as a claim. */
  score: number;
  /** Raw input from the nickname field; trimmed and bounded here. */
  nickname?: string;
  /**
   * When the descent ended. Frozen by the caller at results time so a player
   * who reads the board for a minute before submitting still reports a wall
   * clock that agrees with the run's duration.
   */
  finishedAtMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export type SubmitRunOutcome =
  /** Not submittable: Free Ski, an offline session, or an unrecordable run. */
  | { status: "skipped"; reason: "no_ticket" | "unrecordable" }
  | { status: "submitted"; run: SubmittedRun }
  | { status: "failed"; error: string; aborted?: true };

// ─── Derivations ─────────────────────────────────────────────

/**
 * The run's duration, from the ghost's own tick span at the fixed simulation
 * rate. The server derives the same figure and rejects a submission whose
 * `timeMs` disagrees by more than ~250 ms, so a HUD readout (published at 15 Hz
 * and rounded to a tenth of a second) is not a safe source.
 */
export function runTimeMsFromSamples(samples: readonly GhostSample[]): number {
  if (samples.length < 2) return 0;
  const span = samples[samples.length - 1].tick - samples[0].tick;
  return Math.round((span / FIXED_HZ) * 1000);
}

/**
 * The `sample_hz` the runtime wrote into this ghost's PCGH header — byte 11 of
 * the header documented in `lib/game/replay/codec.ts`.
 *
 * Read from the bytes rather than taken from a constant or from `ticket.tickHz`
 * because this is the exact field the server compares the submitted `tickHz`
 * against. (The two other candidates disagree today: the sessions route
 * advertises `GHOST_TICK_HZ` = 10 while `GHOST_SAMPLE_HZ` records at 30.)
 * `run-client.test.ts` pins this against `decodeGhost`'s own reading.
 */
export function ghostSampleHz(encoded: Uint8Array): number {
  if (encoded.byteLength < GHOST_HEADER_BYTES) return 0;
  return new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength).getUint8(11);
}

/**
 * Trim and bound a nickname for display and for the wire. The server sanitises
 * again on receipt — this only keeps the field honest in the input box.
 */
export function clampNickname(raw: string): string {
  return raw.trim().slice(0, MAX_NICKNAME_INPUT_LENGTH).trim();
}

/**
 * Standard base64 (the runs route reads the ghost out of a JSON body, not a
 * URL). Chunked: spreading 128 KB into `String.fromCharCode` overflows the
 * argument stack.
 */
export function ghostToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ─── submitRun ───────────────────────────────────────────────

/**
 * Submit one finished competitive run. **The single owner of ticket spend.**
 *
 * Returns `skipped` — silently, without touching the network — for any run
 * that has no ticket. That covers Free Ski, a session that degraded to offline,
 * and a run whose ticket was already spent, because `markSubmitted()` clears
 * it. The caller does not have to know which.
 */
export async function submitRun(
  session: SubmittableRunSession,
  recording: FinishedRunRecording,
  options: SubmitRunOptions,
): Promise<SubmitRunOutcome> {
  const ticket = session.ticket;
  if (ticket === null) return { status: "skipped", reason: "no_ticket" };

  const timeMs = runTimeMsFromSamples(recording.samples);
  // A run outside the server's own bounds cannot be accepted; sending it would
  // burn the ticket for a guaranteed 400.
  if (timeMs < MIN_SUBMITTABLE_TIME_MS || timeMs > MAX_SUBMITTABLE_TIME_MS) {
    return { status: "skipped", reason: "unrecordable" };
  }

  const { signal } = options;
  // Wrapped rather than aliased: a detached `fetch` loses its global `this`.
  const fetchImpl =
    options.fetchImpl ?? ((url: RequestInfo | URL, init?: RequestInit) => fetch(url, init));
  if (signal?.aborted) return { status: "failed", error: "Submission cancelled", aborted: true };

  const finishedAtMs = options.finishedAtMs ?? Date.now();
  const nickname = clampNickname(options.nickname ?? "");

  const body = {
    ticket: ticket.ticket,
    ghost: ghostToBase64(recording.encoded),
    // From the ghost's own header — see `ghostSampleHz`. Never `ticket.tickHz`:
    // it says 10 while the recorder writes 30, and the validator compares this
    // field against the header, so echoing the ticket would fail every honest
    // run as `tick_hz_mismatch`.
    tickHz: ghostSampleHz(recording.encoded),
    timeMs,
    score: Math.max(0, Math.round(options.score)),
    startedAt: new Date(finishedAtMs - timeMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    // Omitted rather than empty: the schema wants ≥1 character or nothing.
    ...(nickname ? { nickname } : {}),
  };

  let response: Response;
  try {
    response = await fetchImpl(RUN_SUBMISSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (reason) {
    if (isAbort(reason, signal)) return { status: "failed", error: "Submission cancelled", aborted: true };
    return { status: "failed", error: messageOf(reason, "Could not reach the leaderboard") };
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    // Deliberately *not* spending the ticket here. A 409 means the server has
    // already recorded this nonce, so the ticket is dead either way — but the
    // shell re-mints from `markSubmitted()`, and calling it outside the 2xx
    // branch would make this function's contract "sometimes spends", which is
    // exactly the ambiguity the single-owner rule exists to remove. A 409 is a
    // dead end the player exits by dropping again.
    return {
      status: "failed",
      error: serverError(parsedBody) ?? `Submission failed (HTTP ${response.status})`,
    };
  }

  // 2xx: the nonce is spent server-side whether or not we can read the body,
  // so mark before parsing. Re-sending it could only ever earn a 409.
  session.markSubmitted();

  const parsed = submittedRunSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return { status: "failed", error: "The leaderboard sent an unexpected submission response" };
  }
  return { status: "submitted", run: parsed.data };
}

// ─── Results-screen policy ───────────────────────────────────

/**
 * What the results screen is looking at. Four cases, three of them visible:
 *
 * - `free_ski` — a local run. No submission, no board, no ghost: the whole
 *   leaderboard surface is absent rather than disabled.
 * - `submitted` — the server answered; render from that answer.
 * - `offline` — competitive, but the descent started without a live ticket (or
 *   produced no recording), so it was never submittable. The board is still
 *   worth reading; the run just is not on it.
 * - `submittable` — offer the submit card.
 *
 * Pure and exported so the rule is testable without a DOM, and so the dialog
 * cannot quietly grow a fourth visible state.
 */
export type ResultsOutcome = "free_ski" | "submitted" | "offline" | "submittable";

export function resultsOutcome(input: {
  competitive: boolean;
  /**
   * `session.offline` as it read when the dialog opened. Snapshotting matters:
   * a successful submission clears the frozen ticket, so the live value flips
   * back to offline for a run that just made the board.
   */
  offlineAtOpen: boolean;
  hasRecording: boolean;
  submitted: boolean;
}): ResultsOutcome {
  if (!input.competitive) return "free_ski";
  if (input.submitted) return "submitted";
  return !input.offlineAtOpen && input.hasRecording ? "submittable" : "offline";
}

// ─── fetchLeaderboard ────────────────────────────────────────

export interface LeaderboardInput {
  resortSlug: string;
  /** The trail the board is keyed on — `trailId` on the wire. */
  courseId: string;
  mode: CompetitiveRunMode;
}

export interface FetchOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/** Read the top of one course's board. Never throws. */
export async function fetchLeaderboard(
  input: LeaderboardInput,
  options: FetchOptions = {},
): Promise<LeaderboardBoard | RunClientFailure> {
  const query = new URLSearchParams({
    resort: input.resortSlug,
    mode: input.mode,
    trailId: input.courseId,
    limit: String(LEADERBOARD_LIMIT),
  });

  const response = await getJson(`${LEADERBOARD_ENDPOINT}?${query}`, options, "leaderboard");
  if (isRunClientFailure(response)) return response;

  const parsed = leaderboardSchema.safeParse(response.body);
  if (!parsed.success) {
    return { error: "The leaderboard sent an unexpected response" };
  }
  return parsed.data;
}

// ─── fetchGhost ──────────────────────────────────────────────

/**
 * Pull one accepted run's PCGH blob and decode it for
 * `GameRenderer.setGhost()`. The route serves raw bytes, so this is the only
 * client call that does not read JSON.
 */
export async function fetchGhost(
  runId: string,
  options: FetchOptions = {},
): Promise<DecodedGhost | RunClientFailure> {
  const { signal } = options;
  const fetchImpl =
    options.fetchImpl ?? ((url: RequestInfo | URL, init?: RequestInit) => fetch(url, init));
  if (signal?.aborted) return { error: "Ghost request cancelled", aborted: true };

  let response: Response;
  try {
    response = await fetchImpl(ghostEndpoint(runId), { signal });
  } catch (reason) {
    if (isAbort(reason, signal)) return { error: "Ghost request cancelled", aborted: true };
    return { error: messageOf(reason, "Could not reach the leaderboard") };
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      /* a non-JSON error body is not worth surfacing over the status */
    }
    return { error: serverError(body) ?? `Ghost unavailable (HTTP ${response.status})` };
  }

  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return decodeGhost(bytes);
  } catch (reason) {
    // A ghost that will not decode is a dead end for this row only; the board
    // and the run itself are unaffected.
    return { error: messageOf(reason, "This ghost could not be read") };
  }
}

// ─── Shared plumbing ─────────────────────────────────────────

async function getJson(
  url: string,
  options: FetchOptions,
  what: string,
): Promise<{ body: unknown } | RunClientFailure> {
  const { signal } = options;
  const fetchImpl =
    options.fetchImpl ?? ((u: RequestInfo | URL, init?: RequestInit) => fetch(u, init));
  if (signal?.aborted) return { error: `The ${what} request was cancelled`, aborted: true };

  let response: Response;
  try {
    // The board is re-read the moment a submission lands, so the browser's own
    // cache must not answer with the copy taken thirty seconds earlier. (The
    // CDN's 60 s `s-maxage` on anonymous responses is out of reach from here —
    // an anonymous player may not see their brand-new row until it expires.)
    response = await fetchImpl(url, { signal, cache: "no-store" });
  } catch (reason) {
    if (isAbort(reason, signal)) return { error: `The ${what} request was cancelled`, aborted: true };
    return { error: messageOf(reason, `Could not reach the ${what}`) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return { error: serverError(body) ?? `The ${what} is unavailable (HTTP ${response.status})` };
  }
  return { body };
}

function isAbort(reason: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return reason instanceof DOMException && reason.name === "AbortError";
}

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

/** The house error shape is `{ error }`; anything else gets the status. */
function serverError(body: unknown): string | null {
  if (typeof body === "object" && body !== null) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.length > 0) return error;
  }
  return null;
}
