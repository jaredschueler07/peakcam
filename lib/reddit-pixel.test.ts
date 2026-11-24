import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PENDING_REDDIT_EVENTS,
  flushRedditPixelEvents,
  readRedditPixelId,
  redditTrack,
  trackRedditSignUp,
} from "./reddit-pixel-helpers";

function withRedditWindow(rdt: Window["rdt"], run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { rdt } });
  try { run(); } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function withRedditId(id: string | undefined, run: () => void) {
  const previous = process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID;
  if (id === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_REDDIT_PIXEL_ID");
  else process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID = id;
  try { run(); } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_REDDIT_PIXEL_ID");
    else process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID = previous;
  }
}

test("readRedditPixelId rejects unset or script-unsafe values", () => {
  withRedditId(undefined, () => assert.equal(readRedditPixelId(), undefined));
  withRedditId("", () => assert.equal(readRedditPixelId(), undefined));
  withRedditId("t2_123';alert(1)//", () => assert.equal(readRedditPixelId(), undefined));
  withRedditId(" t2_abc123 ", () => assert.equal(readRedditPixelId(), "t2_abc123"));
});

test("unconfigured Reddit pixel is a silent no-op and never queues", () => {
  const calls: unknown[][] = [];
  withRedditId(undefined, () => {
    withRedditWindow(undefined, () => {
      trackRedditSignUp();
      window.rdt = (...args: unknown[]) => { calls.push(args); };
      flushRedditPixelEvents();
    });
  });
  assert.deepEqual(calls, []);
});

test("pre-stub Reddit events queue up to cap, replay once on flush, and tolerate throwing blockers", () => {
  const calls: unknown[][] = [];
  withRedditId("t2_abc123", () => {
    withRedditWindow(undefined, () => {
      for (let i = 0; i < MAX_PENDING_REDDIT_EVENTS + 10; i++) {
        redditTrack("Custom", { i });
      }
      window.rdt = (...args: unknown[]) => { calls.push(args); };
      flushRedditPixelEvents();
      flushRedditPixelEvents();
      assert.equal(calls.length, MAX_PENDING_REDDIT_EVENTS);
      assert.deepEqual(calls[0], ["track", "Custom", { i: 0 }]);
      assert.deepEqual(calls.at(-1), ["track", "Custom", { i: MAX_PENDING_REDDIT_EVENTS - 1 }]);
    });

    withRedditWindow(() => { throw new Error("blocked by extension"); }, () => {
      assert.doesNotThrow(() => trackRedditSignUp());
    });
  });
});
