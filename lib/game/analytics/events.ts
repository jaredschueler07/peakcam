/**
 * Drop In v2 PostHog event taxonomy + typed track helper.
 *
 * DESIGN §3.8 describes the product funnel narratively
 * (`opened → load_started → ready → started → control_activated →
 * run_finished → run_submitted` plus pointer-lock / leaderboard / ghost /
 * settings) but does **not** ship a concrete property table. Phase 8 Task A6
 * therefore adopts this canonical set (names + required props) and documents
 * it here so call sites and tests share one source of truth:
 *
 * | Event | Required properties | Optional |
 * |---|---|---|
 * | `drop_in_mode_selected` | `resort_slug`, `mode` | — |
 * | `drop_in_run_started` | `resort_slug`, `mode`, `trail_id`, `course_version`, `surface` | — |
 * | `drop_in_run_finished` | `resort_slug`, `mode`, `duration_ms`, `score`, `crashed_count`, `finished` | — |
 * | `drop_in_run_submitted` | `resort_slug`, `mode`, `accepted` | `rejection_code` |
 * | `drop_in_leaderboard_viewed` | `resort_slug`, `mode` | — |
 * | `drop_in_ghost_raced` | `resort_slug`, `ghost_run_id` | — |
 *
 * Existing site funnel events (`drop_in_opened`, `drop_in_ready`, …) remain in
 * `lib/analytics-events.ts`. This module only adds the competitive / mode
 * surface for v2; call-site wiring is a separate task.
 *
 * Constraints: no imports from `lib/game/{core,physics,terrain}`.
 */

import posthog from "posthog-js";

// ── Taxonomy table (asserted by events.test.ts) ─────────────────────────────

/**
 * Canonical event → property keys. `required` must always be present on the
 * typed `DropInEvent` properties object; `optional` may be omitted.
 */
export const DROP_IN_EVENT_TAXONOMY = {
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

export type DropInEventName = keyof typeof DROP_IN_EVENT_TAXONOMY;

// ── Discriminated union ─────────────────────────────────────────────────────

export type DropInEvent =
  | {
      name: "drop_in_mode_selected";
      properties: {
        resort_slug: string;
        mode: string;
      };
    }
  | {
      name: "drop_in_run_started";
      properties: {
        resort_slug: string;
        mode: string;
        trail_id: string;
        course_version: number;
        surface: string;
      };
    }
  | {
      name: "drop_in_run_finished";
      properties: {
        resort_slug: string;
        mode: string;
        duration_ms: number;
        score: number;
        crashed_count: number;
        finished: boolean;
      };
    }
  | {
      name: "drop_in_run_submitted";
      properties: {
        resort_slug: string;
        mode: string;
        accepted: boolean;
        rejection_code?: string;
      };
    }
  | {
      name: "drop_in_leaderboard_viewed";
      properties: {
        resort_slug: string;
        mode: string;
      };
    }
  | {
      name: "drop_in_ghost_raced";
      properties: {
        resort_slug: string;
        ghost_run_id: string;
      };
    };

// ── Track helper ────────────────────────────────────────────────────────────

/**
 * Capture a Drop In v2 analytics event via the site PostHog client
 * (`posthog-js`, same singleton initialized in `lib/posthog.tsx`).
 *
 * No-ops when:
 * - running outside the browser (`typeof window === "undefined"`), or
 * - `NEXT_PUBLIC_POSTHOG_KEY` is unset (provider also skips init in that case).
 */
export function trackDropIn(event: DropInEvent): void {
  if (typeof window === "undefined") return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.capture(event.name, event.properties);
}
