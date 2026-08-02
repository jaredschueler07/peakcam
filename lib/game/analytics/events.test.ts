/**
 * Drop In v2 analytics events — taxonomy + trackDropIn guard tests.
 * Run: npx tsx --test lib/game/analytics/events.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import posthog from "posthog-js";
import {
  DROP_IN_EVENT_TAXONOMY,
  trackDropIn,
  type DropInEvent,
} from "./events";

/** Canonical table from DESIGN §3.8 (P8 completion plan fallback when §3.8 is narrative-only). */
const EXPECTED_TAXONOMY = {
  drop_in_mode_selected: {
    required: ["resort_slug", "mode"] as const,
    optional: [] as const,
  },
  drop_in_run_started: {
    required: ["resort_slug", "mode", "trail_id", "course_version", "surface"] as const,
    optional: [] as const,
  },
  drop_in_run_finished: {
    required: [
      "resort_slug",
      "mode",
      "duration_ms",
      "score",
      "crashed_count",
      "finished",
    ] as const,
    optional: [] as const,
  },
  drop_in_run_submitted: {
    required: ["resort_slug", "mode", "accepted"] as const,
    optional: ["rejection_code"] as const,
  },
  drop_in_leaderboard_viewed: {
    required: ["resort_slug", "mode"] as const,
    optional: [] as const,
  },
  drop_in_ghost_raced: {
    required: ["resort_slug", "ghost_run_id"] as const,
    optional: [] as const,
  },
} as const;

test("DROP_IN_EVENT_TAXONOMY matches DESIGN §3.8 / P8 canonical table verbatim", () => {
  assert.deepStrictEqual(DROP_IN_EVENT_TAXONOMY, EXPECTED_TAXONOMY);
});

test("DropInEvent samples cover every taxonomy name with required properties", () => {
  const samples: DropInEvent[] = [
    {
      name: "drop_in_mode_selected",
      properties: { resort_slug: "breckenridge", mode: "free_ride" },
    },
    {
      name: "drop_in_run_started",
      properties: {
        resort_slug: "breckenridge",
        mode: "time_trial",
        trail_id: "imperial-bowl",
        course_version: 1,
        surface: "powder",
      },
    },
    {
      name: "drop_in_run_finished",
      properties: {
        resort_slug: "heavenly",
        mode: "daily_line",
        duration_ms: 120_000,
        score: 4200,
        crashed_count: 1,
        finished: true,
      },
    },
    {
      name: "drop_in_run_submitted",
      properties: {
        resort_slug: "ski-portillo",
        mode: "time_trial",
        accepted: true,
      },
    },
    {
      name: "drop_in_run_submitted",
      properties: {
        resort_slug: "ski-portillo",
        mode: "time_trial",
        accepted: false,
        rejection_code: "overspeed",
      },
    },
    {
      name: "drop_in_leaderboard_viewed",
      properties: { resort_slug: "breckenridge", mode: "time_trial" },
    },
    {
      name: "drop_in_ghost_raced",
      properties: {
        resort_slug: "heavenly",
        ghost_run_id: "run-abc-123",
      },
    },
  ];

  const names = new Set(samples.map((e) => e.name));
  const taxonomyNames = Object.keys(EXPECTED_TAXONOMY) as Array<
    keyof typeof EXPECTED_TAXONOMY
  >;
  for (const name of taxonomyNames) {
    assert.ok(names.has(name), `missing sample for ${name}`);
  }

  for (const event of samples) {
    const entry = EXPECTED_TAXONOMY[event.name];
    for (const key of entry.required) {
      assert.ok(
        key in event.properties,
        `${event.name} sample missing required prop ${key}`,
      );
    }
  }
});

test("trackDropIn no-ops when window is undefined (SSR / node:test)", () => {
  assert.equal(typeof window, "undefined");
  // Must not throw and must not require PostHog init.
  trackDropIn({
    name: "drop_in_mode_selected",
    properties: { resort_slug: "breckenridge", mode: "free_ride" },
  });
});

/** Install a stub `window` and restore after the callback. */
function withStubWindow(fn: () => void): void {
  const g = globalThis as { window?: object };
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const prevWindow = g.window;
  g.window = {};
  try {
    fn();
  } finally {
    if (hadWindow) g.window = prevWindow;
    else Reflect.deleteProperty(g, "window");
  }
}

function withPosthogKey(key: string | undefined, fn: () => void): void {
  const prevKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (key === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_POSTHOG_KEY");
  else process.env.NEXT_PUBLIC_POSTHOG_KEY = key;
  try {
    fn();
  } finally {
    if (prevKey === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_POSTHOG_KEY");
    else process.env.NEXT_PUBLIC_POSTHOG_KEY = prevKey;
  }
}

test("trackDropIn no-ops when NEXT_PUBLIC_POSTHOG_KEY is unset even with window", () => {
  withPosthogKey(undefined, () => {
    withStubWindow(() => {
      const originalCapture = posthog.capture;
      let captureCalls = 0;
      posthog.capture = ((..._args: unknown[]) => {
        captureCalls += 1;
      }) as typeof posthog.capture;

      try {
        trackDropIn({
          name: "drop_in_leaderboard_viewed",
          properties: { resort_slug: "breckenridge", mode: "time_trial" },
        });
        assert.equal(captureCalls, 0, "must not capture without POSTHOG key");
      } finally {
        posthog.capture = originalCapture;
      }
    });
  });
});

test("trackDropIn calls posthog.capture with name and properties when available", () => {
  withPosthogKey("phc_test_key_for_unit", () => {
    withStubWindow(() => {
      const originalCapture = posthog.capture;
      const calls: Array<{ event: string; properties: Record<string, unknown> }> = [];
      posthog.capture = ((event: string, properties?: Record<string, unknown>) => {
        calls.push({ event, properties: properties ?? {} });
      }) as typeof posthog.capture;

      const payload: DropInEvent = {
        name: "drop_in_run_finished",
        properties: {
          resort_slug: "breckenridge",
          mode: "time_trial",
          duration_ms: 95_000,
          score: 1800,
          crashed_count: 0,
          finished: true,
        },
      };

      try {
        trackDropIn(payload);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.event, "drop_in_run_finished");
        assert.deepStrictEqual(calls[0]!.properties, payload.properties);
      } finally {
        posthog.capture = originalCapture;
      }
    });
  });
});
