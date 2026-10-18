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
    OPENING_ALERT_SELECTED: "opening_alert_selected",
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

test("registration mirrors once while alert tracking leaves Lead to the existing first-success latch", async () => {
  // The Meta mirror is env-gated (lib/meta-pixel.ts); enable it for this test.
  const previousPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  process.env.NEXT_PUBLIC_META_PIXEL_ID = "910818501790206";
  try {
    await withBrowserPostHog(async (posthogCalls) => {
      ph.__loaded = true;
      const pixelCalls: unknown[][] = [];
      window.fbq = (...args: unknown[]) => { pixelCalls.push(args); };
      track(EVENTS.AUTH_SIGNUP_COMPLETED);
      track(EVENTS.ALERT_SIGNUP_SUCCEEDED, { repeat_in_browser: false });
      track(EVENTS.ALERT_SIGNUP_SUCCEEDED, { repeat_in_browser: true });
      track(EVENTS.BROWSE_OPENED);
      assert.deepStrictEqual(pixelCalls, [["track", "CompleteRegistration", undefined]]);
      assert.equal(posthogCalls.length, 4);
    });
  } finally {
    if (previousPixelId === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_META_PIXEL_ID");
    else process.env.NEXT_PUBLIC_META_PIXEL_ID = previousPixelId;
  }
});

test("the Meta mirror stays silent when the pixel is not configured", async () => {
  const previousPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  Reflect.deleteProperty(process.env, "NEXT_PUBLIC_META_PIXEL_ID");
  try {
    await withBrowserPostHog(async (posthogCalls) => {
      ph.__loaded = true;
      const pixelCalls: unknown[][] = [];
      window.fbq = (...args: unknown[]) => { pixelCalls.push(args); };
      track(EVENTS.AUTH_SIGNUP_COMPLETED);
      assert.deepStrictEqual(pixelCalls, []);
      assert.equal(posthogCalls.length, 1);
    });
  } finally {
    if (previousPixelId !== undefined) process.env.NEXT_PUBLIC_META_PIXEL_ID = previousPixelId;
  }
});

test("only completed accounts reach the Google signup conversion, without user properties", async () => {
  const previousId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  const previousLabel = process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL;
  process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "AW-123456";
  process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL = "accounts_2";
  try {
    await withBrowserPostHog(async () => {
      ph.__loaded = true;
      window.fbq = () => {};
      const calls: unknown[][] = [];
      window.gtag = (...args: unknown[]) => { calls.push(args); };
      track(EVENTS.AUTH_SIGNUP_SUBMITTED);
      track(EVENTS.AUTH_SIGNUP_COMPLETED, { email_domain: "example.com" });
      track(EVENTS.ALERT_SIGNUP_SUCCEEDED);
      track(EVENTS.BROWSE_OPENED);
      assert.deepStrictEqual(calls.filter((call) => call[0] === "event"), [
        ["event", "conversion", { send_to: "AW-123456/accounts_2" }],
      ]);
    });
  } finally {
    if (previousId === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
    else process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = previousId;
    if (previousLabel === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL;
    else process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL = previousLabel;
  }
});
