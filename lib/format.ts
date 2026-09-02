// ─────────────────────────────────────────────────────────────
// PeakCam — Display formatting + the conditions-string parser
//
// Small, pure, dependency-free helpers that were previously inlined at a
// dozen-odd call sites and had drifted apart (two inch glyphs, two
// missing-data placeholders, three copies of "n minutes ago"). Everything
// here is presentation only — nothing reads the DB or the DOM.
// ─────────────────────────────────────────────────────────────

/** The one placeholder for "no reading". Not "?", not "N/A", not blank. */
export const EM_DASH = "—";

/**
 * Inches, with the double-prime glyph (″), never a straight quote (").
 * The two spellings used to alternate between the map card and the resort
 * page for the same number.
 */
export function formatInches(n: number | null | undefined): string {
  return n == null ? EM_DASH : `${n}″`;
}

/**
 * "12/40" for open-of-total counts (trails, lifts).
 *
 * No open count means no answer. A known open count with an unknown total is
 * still real data, so it renders bare rather than as "12/?" — a question mark
 * in a readout reads as a broken template.
 */
export function formatRatio(
  open: number | null | undefined,
  total: number | null | undefined,
): string {
  if (open == null) return EM_DASH;
  if (total == null) return `${open}`;
  return `${open}/${total}`;
}

/**
 * "just now" / "5m ago" / "3h ago" / "2d ago" from an ISO string, an epoch
 * millisecond number, or a Date. Returns null when the input is absent or
 * unparseable so a caller can drop the whole "Updated …" clause.
 *
 * `seconds: true` adds a sub-minute rung ("12s ago") for the cam tiles, whose
 * whole point is showing that a still refreshed moments ago.
 */
export function timeAgo(
  input: string | number | Date | null | undefined,
  opts: { seconds?: boolean } = {},
): string | null {
  if (input == null || input === "") return null;
  const then =
    input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(then)) return null;

  // Clamp: a client clock running behind the server must not print "-3m ago".
  const elapsedMs = Math.max(0, Date.now() - then);
  const secs = Math.round(elapsedMs / 1000);
  if (secs < 60) return opts.seconds ? `${secs}s ago` : "just now";
  const mins = Math.floor(elapsedMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── The overloaded conditions string ─────────────────────────

export interface ParsedConditions {
  /** Short machine tags ("powder", "fresh"). Empty when none were stored. */
  tags: string[];
  /** A real sentence, or null. Never a tag list masquerading as prose. */
  narrative: string | null;
}

/**
 * `snow_reports.conditions` is one column doing two jobs: "tag1,tag2||narrative".
 *
 * With no "||" there is no narrative — only a tag list, which is not a
 * sentence and must not be published as one (this is what put "powder,fresh"
 * into a meta description). Callers that want the legacy "show the raw string
 * anyway" behavior write `narrative ?? raw` explicitly.
 *
 * The split is on the FIRST separator, so a narrative containing "||" survives
 * intact instead of being truncated at its middle segment.
 */
export function parseConditions(
  raw: string | null | undefined,
): ParsedConditions {
  if (!raw) return { tags: [], narrative: null };
  const sep = raw.indexOf("||");
  if (sep === -1) return { tags: [], narrative: null };
  const tags = raw
    .slice(0, sep)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const narrative = raw.slice(sep + 2).trim();
  return { tags, narrative: narrative || null };
}
