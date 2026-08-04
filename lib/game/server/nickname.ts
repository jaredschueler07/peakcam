/**
 * lib/game/server/nickname.ts
 * ───────────────────────────
 * Normalising player nicknames before they become `drop_in_runs.display_name`.
 *
 * This is the only free-text field on the whole leaderboard, and it is
 * published to every visitor, so it is normalised on the way *in* rather than
 * escaped on the way out — one canonical stored form beats a rendering rule
 * every consumer has to remember.
 *
 * What it removes and why:
 *   - **Control characters** (C0/C1). Invisible in a name, and they turn log
 *     lines and CSV exports into something else.
 *   - **Zero-width and bidi-override characters.** These are the ones that make
 *     two different names render identically, or flip the text direction of
 *     everything after them on the page.
 *   - **Whitespace runs**, collapsed to one space, so a name padded with fifty
 *     spaces cannot push the column wide or fake an empty entry.
 *
 * What it deliberately does *not* do: reject or transliterate non-Latin
 * scripts, or fold case. "Ñandú" and "ゆき" are real names, not attacks.
 *
 * Profanity is a separate concern with a separate answer (`lib/profanity.ts`
 * flags rather than rejects, which is the pattern `user_conditions` already
 * uses). Wiring it here needs a moderation surface to review the flags, so it
 * is left for the leaderboard moderation work rather than silently dropped in.
 *
 * Pure, no IO: the submission route and the tests share it, and the client can
 * preview the result before sending.
 */

import { MAX_NICKNAME_LENGTH } from "./run-schema";

/** C0 and C1 control characters, including the DEL block. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Zero-width and directional-formatting characters: ZWSP/ZWNJ/ZWJ, the LTR/RTL
 * marks and embeds, the bidi isolates, word joiner, BOM, and the invisible
 * Mongolian vowel separator.
 */
const INVISIBLE_CHARS =
  /[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;

/** Any run of whitespace, including the exotic Unicode spaces. */
const WHITESPACE_RUN = /\s+/g;

/**
 * Canonicalise a submitted nickname, or return `null` when nothing usable is
 * left. `null` means "anonymous run", which is a normal outcome and not an
 * error — an empty or whitespace-only nickname is treated as no nickname
 * rather than rejected, so a stray keypress does not cost a player their run.
 *
 * NFC-normalised so two byte sequences that render identically compare equal,
 * and truncated *after* normalisation so the stored length always matches what
 * the database CHECK measures.
 */
export function sanitizeNickname(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  // Order matters, and neither of these is arbitrary:
  //   - Invisibles go first because `﻿` matches `\s`. Collapsing before
  //     stripping would turn a zero-width no-break space into a real gap,
  //     inventing a word boundary the player never typed.
  //   - Whitespace collapses before controls are stripped, because tabs and
  //     newlines are control characters too, and someone who typed one meant a
  //     gap between words rather than "delete this".
  const cleaned = raw
    .normalize("NFC")
    .replace(INVISIBLE_CHARS, "")
    .replace(WHITESPACE_RUN, " ")
    .replace(CONTROL_CHARS, "")
    // A control removed from between two spaces leaves them adjacent.
    .replace(WHITESPACE_RUN, " ")
    .trim();

  if (cleaned === "") return null;

  // Trim again: slicing mid-name can leave a trailing space.
  const capped = cleaned.slice(0, MAX_NICKNAME_LENGTH).trim();
  return capped === "" ? null : capped;
}
