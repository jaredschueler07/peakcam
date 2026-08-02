/**
 * lib/game/competition/ticket-lifecycle.ts
 * ────────────────────────────────────────
 * The state a run ticket moves through, as a pure reducer so the rules are
 * testable without a canvas or a React tree.
 *
 * Two server facts drive the whole machine:
 *
 *  1. **A ticket is one-time-use.** `drop_in_runs.run_nonce` is unique, so
 *     submitting the same ticket twice is a 409 `nonce_replay`. A ticket that
 *     has been submitted is `spent` and must be re-minted before the next
 *     competitive run — but a run that was *never* submitted keeps its ticket,
 *     which is what stops a restart-happy player from farming the sessions
 *     endpoint into its 20-per-5-minutes rate limit.
 *
 *  2. **A ticket expires** (`SESSION_TICKET_TTL_MS`, 30 min). Starting a run on
 *     an expired ticket wastes the whole descent — the submission is refused —
 *     so expiry is checked before the run, not after it.
 *
 * `offline` is a terminal-until-reselected state: the leaderboard is
 * unreachable, the run is played and recorded locally, and nothing is
 * submitted. It never blocks play.
 */

import type { RunSessionTicket } from "./session-client";

export type TicketState =
  | { status: "none" }
  | { status: "requesting" }
  | { status: "ready"; ticket: RunSessionTicket }
  | { status: "spent"; ticket: RunSessionTicket }
  | { status: "offline" };

export type TicketEvent =
  | { type: "request" }
  | { type: "received"; ticket: RunSessionTicket }
  | { type: "failed" }
  /** The run backed by this ticket reached the submission endpoint. */
  | { type: "submitted" }
  | { type: "cleared" };

/** Free Ski, and the starting point for every other mode. */
export const NO_TICKET: TicketState = { status: "none" };

export function ticketReducer(state: TicketState, event: TicketEvent): TicketState {
  switch (event.type) {
    case "request":
      return { status: "requesting" };
    case "received":
      return { status: "ready", ticket: event.ticket };
    case "failed":
      return { status: "offline" };
    case "submitted":
      // Only a ticket we actually hold can be spent; anything else is a no-op.
      return state.status === "ready" ? { status: "spent", ticket: state.ticket } : state;
    case "cleared":
      return NO_TICKET;
  }
}

function isExpired(ticket: RunSessionTicket, nowMs: number): boolean {
  const expiresAt = Date.parse(ticket.expiresAt);
  // An unparseable expiry is treated as expired: better a silent re-mint than a
  // run the server will refuse.
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

/** The ticket a competitive run may start on right now, or `null`. */
export function usableTicket(state: TicketState, nowMs: number): RunSessionTicket | null {
  if (state.status !== "ready") return null;
  return isExpired(state.ticket, nowMs) ? null : state.ticket;
}

/**
 * Whether the next competitive run needs a fresh ticket. True once the current
 * one has been spent or has expired; false for an unspent, live ticket — and
 * false for `none`, so Free Ski never touches the network.
 */
export function needsRemint(state: TicketState, nowMs: number): boolean {
  if (state.status === "spent") return true;
  if (state.status === "ready") return isExpired(state.ticket, nowMs);
  return false;
}

/**
 * The seed the world must be built from. A ticketed run uses the server's seed
 * or the validator rejects it (`seed_mismatch`); everything else — Free Ski and
 * offline competitive play — falls back to the profile seed and is not
 * submittable. Deliberately no client-side daily seed: inventing one would
 * produce runs that look competitive and can never be accepted.
 */
export function resolveRunSeed(ticket: RunSessionTicket | null, profileSeed: number): number {
  return ticket ? ticket.seed : profileSeed;
}
