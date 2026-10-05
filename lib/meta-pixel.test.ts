import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { META_PIXEL_ID, META_PIXEL_SNIPPET, fireMetaPixelEvent, flushMetaPixelEvents } from "./meta-pixel";
import { trackLead, trackViewContent } from "./meta-pixel-events";

function withPixel(fbq: Window["fbq"], run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { fbq } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("pixel snippet initializes one queue before conversions without an extra PageView", () => {
  const scripts: unknown[] = [];
  const context = {
    window: {} as { fbq: { queue: IArguments[] } },
    document: {
      createElement: () => ({}),
      getElementsByTagName: () => [{ parentNode: { insertBefore: (script: unknown) => scripts.push(script) } }],
    },
  };
  Object.defineProperty(context, "fbq", { get: () => context.window.fbq });
  runInNewContext(META_PIXEL_SNIPPET, context);
  assert.equal(scripts.length, 1);
  assert.deepEqual(Array.from(context.window.fbq.queue[0]), ["init", META_PIXEL_ID]);
  assert.equal(context.window.fbq.queue.length, 1);
  withPixel(context.window.fbq as unknown as Window["fbq"], () => {
    fireMetaPixelEvent("PageView");
    trackLead();
    trackViewContent("Fixture Resort", "fixture-resort");
  });
  assert.deepEqual(Array.from(context.window.fbq.queue, (args) => Array.from(args)), [
    ["init", META_PIXEL_ID],
    ["track", "PageView", undefined],
    ["track", "Lead", { content_name: "powder_alert_subscription" }],
    ["track", "ViewContent", { content_name: "Fixture Resort", content_ids: ["fixture-resort"], content_type: "resort" }],
  ]);
});

test("all pixel helpers tolerate server rendering, missing pixels and throwing blockers", () => {
  assert.equal(typeof window, "undefined");
  assert.doesNotThrow(() => fireMetaPixelEvent("PageView"));
  for (const fbq of [undefined, () => { throw new Error("blocked"); }]) {
    withPixel(fbq, () => {
      assert.doesNotThrow(() => fireMetaPixelEvent("CompleteRegistration"));
      assert.doesNotThrow(() => trackLead());
      assert.doesNotThrow(() => trackViewContent("Fixture", "fixture"));
      window.fbq = () => {};
      flushMetaPixelEvents();
    });
  }
});


test("pre-stub conversions replay exactly once after initialization", () => {
  const calls: unknown[][] = [];
  withPixel(undefined, () => {
    fireMetaPixelEvent("CompleteRegistration");
    trackLead();
    flushMetaPixelEvents();
    window.fbq = (...args: unknown[]) => { calls.push(args); };
    flushMetaPixelEvents();
    flushMetaPixelEvents();
  });
  assert.deepEqual(calls, [
    ["track", "CompleteRegistration", undefined],
    ["track", "Lead", { content_name: "powder_alert_subscription" }],
  ]);
});
