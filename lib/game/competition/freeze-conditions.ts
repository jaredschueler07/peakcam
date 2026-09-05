import type { ConditionsSnapshot } from "../conditions";
import type { PhysicsModel } from "../core/config";
import { COURSE_VERSION, PHYSICS_VERSION } from "../config/versions";
import { GHOST_SAMPLE_HZ } from "../replay/recorder";
import type { RunSessionTicket } from "./session-client";
import { usableTicket, type TicketState } from "./ticket-lifecycle";

/** Freeze the signed mountain before constructing it; URL model overrides stay offline. */
export function freezeConditions(
  live: ConditionsSnapshot, state: TicketState, model: PhysicsModel,
  resortSlug: string, mode: "free_ski" | "time_trial" | "score_attack", trailId: string, now: number,
): { ticket: RunSessionTicket | null; conditions: ConditionsSnapshot; trailId: string } {
  const held = mode === "free_ski" ? null : usableTicket(state, now);
  const ticket = held && held.physicsModel === model && held.physicsVersion === PHYSICS_VERSION &&
    held.courseVersion === COURSE_VERSION && held.tickHz === GHOST_SAMPLE_HZ &&
    held.resortSlug === resortSlug && held.mode === mode &&
    (mode === "score_attack" || held.trailId === trailId) ? held : null;
  if (!ticket) return { ticket: null, conditions: { ...live, physicsModel: model }, trailId };
  const environment = ticket.environment;
  return { ticket, trailId: ticket.trailId, conditions: {
    ...live, surface: ticket.surface, physicsModel: ticket.physicsModel, environment,
    weatherDefault: environment && environment.visibilityM <= 800 ? 1 : 0,
    powderDay: ticket.surface === "powder",
    snow24In: environment ? environment.powderDepthCm / 2.54 : null,
    stamp: mode === "time_trial" ? "Time Trial · fixed conditions" : `Daily Line · ${ticket.conditionsDate ?? "morning"}`,
    narrative: null,
  } };
}
