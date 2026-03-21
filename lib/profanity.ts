// ─────────────────────────────────────────────────────────────
// PeakCam — Profanity Filter
// Simple word-list check for user-submitted conditions notes.
// Returns true if the text contains flagged content.
// ─────────────────────────────────────────────────────────────

// Common profanity patterns (whole-word matching, case-insensitive).
// Deliberately minimal — catches obvious cases without false positives.
const FLAGGED_WORDS = [
  "fuck", "fuck", "fuk", "f u c k",
  "shit", "sh1t",
  "ass", "a55",
  "bitch", "b1tch",
  "cunt",
  "cock", "c0ck",
  "dick", "d1ck",
  "pussy",
  "bastard",
  "whore",
  "nigger", "nigga",
  "faggot", "fag",
  "retard",
  "damn", // borderline — kept for moderation review rather than auto-hide
  "hell",  // borderline — same
];

// Build a single regex for efficiency
const FLAGGED_REGEX = new RegExp(
  `\\b(${FLAGGED_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i"
);

/**
 * Returns true if the text contains flagged words.
 * Used server-side to set is_flagged on user_conditions rows.
 */
export function containsProfanity(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  return FLAGGED_REGEX.test(text);
}
