import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { META_PIXEL_ID, buildMetaPixelSnippet, fireMetaPixelEvent, flushMetaPixelEvents, metaPixelId } from "./meta-pixel";
import { trackLead, trackViewContent } from "./meta-pixel-events";

const FIXTURE_ID = "910818501790206";

function withPixel(fbq: Window["fbq"], run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { fbq } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function withPixelId(id: string | undefined, run: () => void) {
  const previous = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (id === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_META_PIXEL_ID");
  else process.env.NEXT_PUBLIC_META_PIXEL_ID = id;
  try { run(); } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_META_PIXEL_ID");
    else process.env.NEXT_PUBLIC_META_PIXEL_ID = previous;
  }
}

test("the pixel is disabled unless NEXT_PUBLIC_META_PIXEL_ID is a numeric id", () => {
  // The unit-test env never sets the var, so the build-time constant is empty.
  assert.equal(META_PIXEL_ID, "");
  withPixelId(undefined, () => assert.equal(metaPixelId(), undefined));
  withPixelId("", () => assert.equal(metaPixelId(), undefined));
  withPixelId("');alert(1);//", () => assert.equal(metaPixelId(), undefined));
  withPixelId("abc123", () => assert.equal(metaPixelId(), undefined));
  withPixelId(` ${FIXTURE_ID} `, () => assert.equal(metaPixelId(), FIXTURE_ID));
});

test("unconfigured pixel neither queues nor forwards conversions", () => {
  const calls: unknown[][] = [];
  withPixelId(undefined, () => {
    withPixel((...args: unknown[]) => { calls.push(args); }, () => {
      fireMetaPixelEvent("PageView");
      trackLead();
      flushMetaPixelEvents();
    });
    withPixel(undefined, () => {
      fireMetaPixelEvent("CompleteRegistration");
      window.fbq = (...args: unknown[]) => { calls.push(args); };
      flushMetaPixelEvents();
    });
  });
  assert.deepEqual(calls, []);
});

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
  runInNewContext(buildMetaPixelSnippet(FIXTURE_ID), context);
  assert.equal(scripts.length, 1);
  assert.deepEqual(Array.from(context.window.fbq.queue[0]), ["init", FIXTURE_ID]);
  assert.equal(context.window.fbq.queue.length, 1);
  withPixelId(FIXTURE_ID, () => withPixel(context.window.fbq as unknown as Window["fbq"], () => {
    fireMetaPixelEvent("PageView");
    trackLead();
    trackViewContent("Fixture Resort", "fixture-resort");
  }));
  assert.deepEqual(Array.from(context.window.fbq.queue, (args) => Array.from(args)), [
    ["init", FIXTURE_ID],
    ["track", "PageView", undefined],
    ["track", "Lead", { content_name: "powder_alert_subscription" }],
    ["track", "ViewContent", { content_name: "Fixture Resort", content_ids: ["fixture-resort"], content_type: "resort" }],
  ]);
});

test("all pixel helpers tolerate server rendering, missing pixels and throwing blockers", () => {
  assert.equal(typeof window, "undefined");
  withPixelId(FIXTURE_ID, () => {
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
});

test("pre-stub conversions replay exactly once after initialization", () => {
  const calls: unknown[][] = [];
  withPixelId(FIXTURE_ID, () => withPixel(undefined, () => {
    fireMetaPixelEvent("CompleteRegistration");
    trackLead();
    flushMetaPixelEvents();
    window.fbq = (...args: unknown[]) => { calls.push(args); };
    flushMetaPixelEvents();
    flushMetaPixelEvents();
  }));
  assert.deepEqual(calls, [
    ["track", "CompleteRegistration", undefined],
    ["track", "Lead", { content_name: "powder_alert_subscription" }],
  ]);
});
