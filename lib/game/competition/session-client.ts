/**
 * lib/game/competition/session-client.ts
 * ──────────────────────────────────────
 * Browser-side wrapper over `POST /api/drop-in/sessions` — step 1 of the
 * competitive flow: ask the server for a signed run ticket before the run
 * starts, hold it, and hand it back with the submission (Task A4).
 *
 * ⚠️ This module is bundled into the client. It deliberately does **not**
 * import `lib/game/server/run-ticket.ts` (node:crypto + the signing secret) or
 * anything else under `lib/game/server/`. The response type below mirrors
 * `SessionResponseBody` from `lib/game/server/handlers/sessions.ts` by hand;
 * the zod schema is what actually binds, so a server-side shape change shows up
 * as a parse failure here rather than as an undefined field three screens later.
 *
 * Nothing in here throws. A missing leaderboard must never stop someone
 * skiing, so every failure — HTTP, network, malformed body, abort — comes back
 * as `{ error }` for the caller to render as a notice and carry on offline.
 */

import { z } from "zod";

import type { CompetitiveRunMode } from "../config/modes";
import type { PhysicsModel, SurfaceKind } from "../core/config";

export const RUN_SESSIONS_ENDPOINT = "/api/drop-in/sessions";

/** Mirrors `SessionResponseBody` in lib/game/server/handlers/sessions.ts. */
export const runSessionTicketSchema = z
  .object({
    ticket: z.string().min(1),
    seed: z.number().finite(),
    resortSlug: z.string().min(1),
    mode: z.enum(["time_trial", "score_attack"]),
    trailId: z.string().min(1),
    surface: z.enum(["powder", "packed", "firm", "ice"]),
    physicsModel: z.enum(["v1", "v2"]),
    physicsVersion: z.number().finite(),
    courseVersion: z.number().finite(),
    tickHz: z.number().finite().positive(),
    expiresAt: z.string().min(1),
  })
  .strip();

export type RunSessionTicket = z.infer<typeof runSessionTicketSchema>;

export interface RunSessionInput {
  resortSlug: string;
  mode: CompetitiveRunMode;
  trailId: string;
  surface: SurfaceKind;
  physicsModel: PhysicsModel;
}

/**
 * `aborted` marks the caller's own cancellation (unmount, mode re-pick). Those
 * are not worth telling the player about; every other failure is.
 */
export interface RunSessionFailure {
  error: string;
  aborted?: true;
}

export type RunSessionResult = RunSessionTicket | RunSessionFailure;

export function isRunSessionFailure(result: RunSessionResult): result is RunSessionFailure {
  return "error" in result;
}

export interface RequestRunSessionOptions {
  signal?: AbortSignal;
  /** Injectable for tests; production uses the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Ask the server to mint a ticket for one competitive run. Never throws. */
export async function requestRunSession(
  input: RunSessionInput,
  options: RequestRunSessionOptions = {},
): Promise<RunSessionResult> {
  const { signal } = options;
  // Wrapped rather than aliased: a detached `fetch` reference loses its global
  // `this` and throws "Illegal invocation" in some engines.
  const fetchImpl = options.fetchImpl ?? ((url: RequestInfo | URL, init?: RequestInit) => fetch(url, init));
  if (signal?.aborted) return { error: "Run session request was cancelled", aborted: true };

  let response: Response;
  try {
    response = await fetchImpl(RUN_SESSIONS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resortSlug: input.resortSlug,
        mode: input.mode,
        trailId: input.trailId,
        surface: input.surface,
        physicsModel: input.physicsModel,
      }),
      // A ticket carries a one-time nonce; a cached one is a dead ticket.
      cache: "no-store",
      signal,
    });
  } catch (reason) {
    if (isAbort(reason, signal)) return { error: "Run session request was cancelled", aborted: true };
    return { error: reason instanceof Error ? reason.message : "Could not reach the leaderboard" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return { error: serverError(body) ?? `Leaderboard session failed (HTTP ${response.status})` };
  }

  const parsed = runSessionTicketSchema.safeParse(body);
  if (!parsed.success) {
    return { error: "The leaderboard sent an unexpected session response" };
  }
  return parsed.data;
}

function isAbort(reason: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return reason instanceof DOMException && reason.name === "AbortError";
}

/** The house error shape is `{ error }`; anything else gets the status text. */
function serverError(body: unknown): string | null {
  if (typeof body === "object" && body !== null) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.length > 0) return error;
  }
  return null;
}
