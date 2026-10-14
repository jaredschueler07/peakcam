import posthog from "posthog-js";

export const EVENTS = {
  BROWSE_OPENED: "browse_opened",
  RESORT_VIEWED: "resort_viewed",
  ALERT_SIGNUP_SUBMITTED: "alert_signup_submitted",
  ALERT_CONFIRMED: "alert_confirmed",
  AUTH_SIGNUP_STARTED: "auth_signup_started",
  AUTH_SIGNUP_COMPLETED: "auth_signup_completed",
  FAVORITE_ADDED: "favorite_added",
  FAVORITE_REMOVED: "favorite_removed",
  CONDITION_VOTED: "condition_voted",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export function track(event: EventName, properties?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  posthog.capture(event, properties);
}
