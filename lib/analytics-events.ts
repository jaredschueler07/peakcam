import posthog from "posthog-js";
import { fireMetaPixelEvent } from "./meta-pixel";
import { trackGoogleSignup } from "./google-ads";

export const EVENTS = {
  BROWSE_OPENED: "browse_opened",
  RESORT_VIEWED: "resort_viewed",
  RESORT_CARD_CLICKED: "resort_card_clicked",
  CAM_CLICKED: "cam_clicked",
  CAM_PLAYED: "cam_played",
  SEARCH_PERFORMED: "search_performed",
  FILTER_APPLIED: "filter_applied",
  ALERT_MODAL_OPENED: "alert_modal_opened",
  ALERT_SIGNUP_SUBMITTED: "alert_signup_submitted",
  // Fired only on an API 200 — the conversion the ad pixels mirror.
  ALERT_SIGNUP_SUCCEEDED: "alert_signup_succeeded",
  ALERT_CONFIRMED: "alert_confirmed",
  AUTH_SIGNUP_STARTED: "auth_signup_started",
  // The form was submitted and Supabase accepted it; the account is NOT
  // confirmed yet. AUTH_SIGNUP_COMPLETED fires from the email-confirm
  // callback (SignupWelcomeTracker) once the user actually lands signed in.
  AUTH_SIGNUP_SUBMITTED: "auth_signup_submitted",
  AUTH_SIGNUP_COMPLETED: "auth_signup_completed",
  // /auth/callback could not exchange the code and sent the user to
  // /auth?error=auth_failed. `reason` comes from the route; the
  // missing_code_verifier cohort is confirmed sign-ups whose link was opened in
  // a different browser (mail-app webview, second device) — real completions
  // that can never emit AUTH_SIGNUP_COMPLETED, so they are counted here instead.
  AUTH_CALLBACK_FAILED: "auth_callback_failed",
  // AuthModal opened for a signed-out visitor. `source` names the surface that
  // raised the gate (favorite_card, user_report, alert_done, …) so gate →
  // sign-up conversion can be read per surface; without it the account funnel
  // had a single measured step. Also used for the lineup signup prompt.
  AUTH_GATE_SHOWN: "auth_gate_shown",
  // A visible account entry point was clicked (header create-account, hub
  // "Choose my mountains"). A click is never a signup conversion: the Meta and
  // Google ads mirrors only listen to AUTH_SIGNUP_COMPLETED.
  ACCOUNT_CTA_CLICKED: "account_cta_clicked",
  // The visitor committed a lineup (pressed Save my mountains with 1..8
  // chooser picks, or the alert-success nudge with its full selection).
  // `selected_count` is coarse; names and emails never ride along.
  LINEUP_SELECTED: "lineup_selected",
  // The missing favourites were written to the account. Fires only after a
  // real successful insert, never for a guest selection or a prompt view.
  LINEUP_SAVED: "lineup_saved",
  // The write was attempted and failed. `reason` is a short code, never a
  // provider message or user data. Fired instead of LINEUP_SAVED.
  LINEUP_SAVE_FAILED: "lineup_save_failed",
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
  DROP_IN_TERRAIN_FALLBACK: "drop_in_terrain_fallback",
  DROP_IN_PERFORMANCE: "drop_in_performance",
  // The "email me the morning a selected resort opens" checkbox was switched
  // on (PowderAlertForm, AlertManagePage). `slugs_count` is how many resorts
  // it applies to; `source` names the surface.
  OPENING_ALERT_SELECTED: "opening_alert_selected",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * How an account event was initiated. The email flows predate the property
 * and still omit it, so "no method" reads as email in PostHog; Google
 * sign-in (P11) passes "google" on every auth_* event it fires.
 */
export const AUTH_METHODS = ["email", "google"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** Properties accepted by track(): free-form, except `method` is constrained. */
export type EventProperties = Record<string, unknown> & { method?: AuthMethod };

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
const pending: Array<[EventName, EventProperties | undefined]> = [];
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

/**
 * Defer `task` until posthog-js has initialized, for captures that don't go
 * through `track` (the Drop In v2 taxonomy in `lib/game/analytics/events.ts`
 * calls `posthog.capture` directly). Same readiness rule and same give-up
 * budget as `drain` above — see that comment for why the wait exists.
 */
export function whenPostHogReady(task: () => void): () => void {
  const noop = () => {};
  if (typeof window === "undefined") return noop;
  // Without a key the provider never calls init(), so the poll could only ever
  // time out — don't schedule four seconds of timers to discover that.
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return noop;
  if (isLoaded()) {
    task();
    return noop;
  }

  let attempts = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    if (cancelled) return;
    if (isLoaded()) {
      task();
      return;
    }
    if (++attempts > 40) return;
    timer = setTimeout(tick, 100);
  };
  timer = setTimeout(tick, 0);

  // Callers that unmount before the SDK loads must be able to drop the task;
  // firing it afterwards would attribute the event to whatever came next.
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

/**
 * Meta Pixel conversion mirror. Only conversion-grade events are forwarded —
 * everything else stays PostHog-only so the pixel doesn't drown in noise.
 * window.fbq is a queueing stub until fbevents.js loads, so mirroring before
 * the pixel script arrives is safe (calls replay in order).
 */
const META_EVENT_MAP: Partial<Record<EventName, string>> = {
  // Lead is emitted by useAlertSubscribe under its persistent first-success
  // latch. Mirroring ALERT_SIGNUP_SUCCEEDED here would double-count it and
  // report repeat subscriptions as new conversions.
  // Email-confirmed account creation.
  [EVENTS.AUTH_SIGNUP_COMPLETED]: "CompleteRegistration",
};

export function track(event: EventName, properties?: EventProperties) {
  if (typeof window === "undefined") return;
  const metaEvent = META_EVENT_MAP[event];
  if (metaEvent) fireMetaPixelEvent(metaEvent);
  if (event === EVENTS.AUTH_SIGNUP_COMPLETED) trackGoogleSignup();
  if (!isLoaded()) {
    pending.push([event, properties]);
    drain();
    return;
  }
  posthog.capture(event, properties);
}
