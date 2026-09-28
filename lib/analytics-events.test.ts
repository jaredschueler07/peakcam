import { test } from "node:test";
import assert from "node:assert";
import posthog from "posthog-js";
import { EVENTS, track, whenPostHogReady } from "./analytics-events";

test("EVENTS has the required product event names", () => {
  assert.deepStrictEqual(EVENTS, {
    BROWSE_OPENED: "browse_opened",
    RESORT_VIEWED: "resort_viewed",
    RESORT_CARD_CLICKED: "resort_card_clicked",
    CAM_CLICKED: "cam_clicked",
    CAM_PLAYED: "cam_played",
    SEARCH_PERFORMED: "search_performed",
    FILTER_APPLIED: "filter_applied",
    ALERT_MODAL_OPENED: "alert_modal_opened",
    ALERT_SIGNUP_SUBMITTED: "alert_signup_submitted",
    ALERT_SIGNUP_SUCCEEDED: "alert_signup_succeeded",
    ALERT_CONFIRMED: "alert_confirmed",
    AUTH_SIGNUP_STARTED: "auth_signup_started",
    AUTH_SIGNUP_SUBMITTED: "auth_signup_submitted",
    AUTH_SIGNUP_COMPLETED: "auth_signup_completed",
    AUTH_CALLBACK_FAILED: "auth_callback_failed",
    AUTH_GATE_SHOWN: "auth_gate_shown",
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
  });
});

// ── Queue-before-init behaviour ──────────────────────────────────────────────
// `track()` and `whenPostHogReady()` key off posthog-js's `__loaded` flag, which
// init() sets synchronously. These tests drive that flag directly so the SDK
// never actually initialises (no network, no storage).

type Loaded = { __loaded?: boolean };
const ph = posthog as unknown as Loaded;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Browser-ish globals + a stubbed capture, restored after `fn`. */
async function withBrowserPostHog(
  fn: (calls: Array<[string, Record<string, unknown> | undefined]>) => Promise<void>
) {
  const g = globalThis as { window?: object };
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const prevWindow = g.window;
  const prevKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const prevLoaded = ph.__loaded;
  const originalCapture = posthog.capture;
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];

  g.window = {};
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test_key_for_unit";
  ph.__loaded = false;
  posthog.capture = ((event: string, properties?: Record<string, unknown>) => {
    calls.push([event, properties]);
  }) as typeof posthog.capture;

  try {
    await fn(calls);
  } finally {
    posthog.capture = originalCapture;
    ph.__loaded = prevLoaded;
    if (prevKey === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_POSTHOG_KEY");
    else process.env.NEXT_PUBLIC_POSTHOG_KEY = prevKey;
    if (hadWindow) g.window = prevWindow;
    else Reflect.deleteProperty(g, "window");
  }
}

test("track() holds events until posthog is loaded, then drains them in order", async () => {
  await withBrowserPostHog(async (calls) => {
    track(EVENTS.RESORT_VIEWED, { resort_slug: "breckenridge" });
    track(EVENTS.CAM_CLICKED, { resort_slug: "breckenridge", cam_name: "Peak 8" });
    await sleep(50);
    assert.equal(calls.length, 0, "nothing may reach capture before init()");

    ph.__loaded = true;
    await sleep(250);
    assert.deepStrictEqual(calls, [
      ["resort_viewed", { resort_slug: "breckenridge" }],
      ["cam_clicked", { resort_slug: "breckenridge", cam_name: "Peak 8" }],
    ]);

    // Once loaded, captures are synchronous.
    track(EVENTS.SEARCH_PERFORMED, { query: "vail", result_count: 1 });
    assert.equal(calls.length, 3);
    assert.equal(calls[2][0], "search_performed");
  });
});

test("whenPostHogReady() defers the task until loaded and honours cancellation", async () => {
  await withBrowserPostHog(async () => {
    let ran = 0;
    let cancelledRan = 0;
    const cancel = whenPostHogReady(() => { cancelledRan += 1; });
    whenPostHogReady(() => { ran += 1; });
    cancel();
    await sleep(50);
    assert.equal(ran, 0);

    ph.__loaded = true;
    await sleep(250);
    assert.equal(ran, 1, "deferred task runs once the SDK is loaded");
    assert.equal(cancelledRan, 0, "cancelled task never runs");

    // Already loaded: runs synchronously.
    whenPostHogReady(() => { ran += 1; });
    assert.equal(ran, 2);
  });
});

test("track() is a no-op on the server", () => {
  const originalCapture = posthog.capture;
  let captured = 0;
  posthog.capture = (() => { captured += 1; }) as typeof posthog.capture;
  try {
    assert.equal(typeof window, "undefined");
    track(EVENTS.BROWSE_OPENED);
    assert.equal(captured, 0);
  } finally {
    posthog.capture = originalCapture;
  }
});
