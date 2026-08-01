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
  DROP_IN_OPENED: "drop_in_opened",
  DROP_IN_LOAD_STARTED: "drop_in_load_started",
  DROP_IN_READY: "drop_in_ready",
  DROP_IN_STARTED: "drop_in_started",
  DROP_IN_CONTROL_ACTIVATED: "drop_in_control_activated",
  DROP_IN_POINTER_LOCK_RESULT: "drop_in_pointer_lock_result",
  DROP_IN_FAILED: "drop_in_failed",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * PostHogProvider is mounted through `dynamic(..., { ssr: false })`, which makes
 * it and the page subtree commit together — and React flushes child effects
 * before parent ones. So any event captured from a mount effect on a cold page
 * load fires before `posthog.init()` has run, and posthog-js discards it. That
 * silently cost us every DROP_IN_OPENED, RESORT_VIEWED and BROWSE_OPENED on
 * direct arrivals; only in-app navigations were being counted.
 *
 * Queue until the SDK is loaded, then drain in order. If init never happens
 * (no key configured, blocked script), give up after a few seconds rather than
 * holding the events forever.
 */
const pending: Array<[EventName, Record<string, unknown> | undefined]> = [];
let draining = false;

function isLoaded() {
  return Boolean((posthog as unknown as { __loaded?: boolean }).__loaded);
}

function drain() {
  if (draining) return;
  draining = true;
  let attempts = 0;
  const tick = () => {
    if (isLoaded()) {
      draining = false;
      for (const [event, properties] of pending.splice(0, pending.length)) {
        posthog.capture(event, properties);
      }
      return;
    }
    if (++attempts > 40) {
      draining = false;
      pending.length = 0;
      return;
    }
    setTimeout(tick, 100);
  };
  setTimeout(tick, 0);
}

export function track(event: EventName, properties?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  if (!isLoaded()) {
    pending.push([event, properties]);
    drain();
    return;
  }
  posthog.capture(event, properties);
}
