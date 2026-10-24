// ─────────────────────────────────────────────────────────────
// Small shared helper for every explicit "save this" auth gate.
//
// Resort, browse-card and camera save buttons all do the same two-step thing:
// persist a typed intent, then open AuthModal. Keeping the copy and the
// storage-failure handling here means the gates cannot drift into promising a
// persistence the browser refused, and adding a new gate does not mean
// copying the queue logic.
// ─────────────────────────────────────────────────────────────

import {
  MAX_LINEUP_INTENT,
  lineupIntentNote,
  lineupStorage,
  writeLineupIntent,
  type LineupItemInput,
} from "@/lib/lineup";

/**
 * What the gate says when the browser refuses storage. Deliberately does not
 * present "turn off private browsing" as the default remedy: storage can be
 * blocked by policy, an extension or a kiosk browser, and creating the
 * account is still useful.
 */
export const LINEUP_STORAGE_BLOCKED_MESSAGE =
  "This browser isn’t letting PeakCam keep your selection between pages, so it can’t follow you through sign-in. You can still create a free account and save it from this page afterwards.";

export const LINEUP_EMPTY_MESSAGE = "Pick at least one mountain or camera first.";

export type StagedLineup =
  | { stored: true; count: number; source: string; note: string }
  | { stored: false; count: 0; message: string; reason: "blocked" | "empty" };

/**
 * Persist the clicked item(s) before opening the auth modal.
 *
 * `items` may be UUID strings (read as resorts) or `{ item_type, item_id }`
 * objects, so a camera click is preserved as that camera rather than being
 * coerced to a resort. The returned `note` is only shown after the write
 * actually succeeded.
 */
export function stageGuestLineup(
  items: LineupItemInput | LineupItemInput[],
  options: { source: string; noun?: string },
): StagedLineup {
  const list = Array.isArray(items) ? items : [items];
  const written = writeLineupIntent(lineupStorage(), list, options.source);
  if (!written.ok) {
    return {
      stored: false,
      count: 0,
      reason: written.reason === "blocked" ? "blocked" : "empty",
      message: written.reason === "blocked" ? LINEUP_STORAGE_BLOCKED_MESSAGE : LINEUP_EMPTY_MESSAGE,
    };
  }
  const count = written.intent.items.length;
  return {
    stored: true,
    count,
    source: written.intent.source,
    note: lineupIntentNote(count, options.noun ?? "mountain"),
  };
}

/** True when a selection can be handed to the pending-intent mechanism without truncation. */
export function lineupFitsIntent(count: number): boolean {
  return Number.isFinite(count) && count > 0 && count <= MAX_LINEUP_INTENT;
}
