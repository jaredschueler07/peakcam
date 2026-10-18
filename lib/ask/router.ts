// ─────────────────────────────────────────────────────────────
// Ask router — a question in, a tool call out. No model in the path.
//
// `planQuestion(question, resorts)` resolves the resort(s) a question names
// (full name, slug, generic-suffix-stripped name, nickname, one-typo
// tolerance), the place it names (state, province or country), and the
// intent from keyword rules, then returns the PeakCam MCP tool and arguments
// that answer it — or `intent: "unknown"` with a reason, never a guess.
// lib/ask/answer.ts executes the plan; lib/ask/router.test.ts pins the rules
// with real questions. Pure: no I/O, no clock.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData } from "@/lib/types";
import type { PeakCamToolName } from "@/lib/mcp/tool-names";
import { editDistance, matchResorts, normalizeText } from "@/lib/mcp/catalog";
import { detectPlace, resortAliases, type PlaceMention } from "./aliases";
import type { AskIntent } from "./intents";

export type { AskIntent };

/** Why a question was not answerable. */
export type UnansweredReason = "empty" | "no_resort" | "no_intent" | "unknown_resort";

export interface AskPlan {
  question: string;
  /** Lowercase ASCII form the rules ran on. */
  normalized: string;
  intent: AskIntent;
  /** The tool that answers it; null when unanswerable. */
  tool: PeakCamToolName | null;
  /** Arguments for that tool, already in its input shape. */
  args: Record<string, unknown>;
  /** Resorts the question names, in the order they appear. */
  resorts: ResortWithData[];
  place: PlaceMention | null;
  reason: UnansweredReason | null;
  /** Up to three resorts a stray proper noun might have meant. */
  didYouMean: ResortWithData[];
}

export const MAX_QUESTION_LENGTH = 300;

// ── Resort mentions ──────────────────────────────────────────

interface Mention {
  resort: ResortWithData;
  start: number;
  end: number;
  alias: string;
  distance: number;
}

/** Word-boundary occurrences of `phrase` in `text`, as [start, end) offsets. */
function occurrences(text: string, phrase: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(phrase, from);
    if (at < 0) break;
    const before = at === 0 || text[at - 1] === " ";
    const afterIdx = at + phrase.length;
    const after = afterIdx === text.length || text[afterIdx] === " ";
    if (before && after) out.push([at, afterIdx]);
    from = at + 1;
  }
  return out;
}

/** Ordinary words of a snow question that a one-edit typo must never turn into a resort. */
const FUZZY_STOPWORDS = new Set([
  "snow", "snowed", "snowing", "most", "more", "much", "many", "what", "whats", "when", "where", "which", "will", "with", "this", "that", "than", "then", "there", "their",
  "from", "into", "over", "last", "past", "next", "week", "weekend", "today", "tonight", "tomorrow", "yesterday", "morning", "hours", "days", "inches", "inch", "base",
  "depth", "open", "opening", "closed", "close", "resort", "resorts", "mountain", "mountains", "powder", "fresh", "deep", "deepest", "best", "good", "great", "like",
  "look", "looks", "looked", "show", "tell", "give", "find", "compare", "versus", "about", "near", "around", "right", "now", "still", "season", "forecast", "cams", "webcams",
  "camera", "cameras", "measured", "only", "report", "reports", "conditions", "weather", "storm", "storms", "colorado", "utah", "california", "montana", "wyoming", "idaho",
  "oregon", "washington", "vermont", "maine", "canada", "chile", "argentina", "tahoe", "normal", "percent", "history", "trend", "alert", "alerts", "notify",
]);

/** Keep the longest, earliest, closest mentions that do not overlap one another. */
function pickNonOverlapping(mentions: Mention[]): Mention[] {
  const sorted = [...mentions].sort(
    (a, b) => a.distance - b.distance || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const kept: Mention[] = [];
  for (const m of sorted) {
    if (kept.some((k) => m.start < k.end && k.start < m.end)) continue;
    if (kept.some((k) => k.resort.slug === m.resort.slug)) continue;
    kept.push(m);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * The resorts a normalized question names. Exact alias matches first; when
 * none exists, one edit of slack on aliases of five characters or more
 * (`breckenrige`, `vial`) over same-length word windows.
 */
export function findMentions(normalized: string, resorts: readonly ResortWithData[]): Mention[] {
  const exact: Mention[] = [];
  const aliasTable = resorts.map((resort) => ({ resort, aliases: resortAliases(resort) }));
  for (const { resort, aliases } of aliasTable) {
    for (const alias of aliases) {
      for (const [start, end] of occurrences(normalized, alias)) exact.push({ resort, start, end, alias, distance: 0 });
    }
  }
  if (exact.length) return pickNonOverlapping(exact);

  const words = normalized.split(" ").filter(Boolean);
  const offsets: number[] = [];
  let pos = 0;
  for (const w of words) {
    offsets.push(pos);
    pos += w.length + 1;
  }
  // Typo pass. A misspelt resort name is still a rare, proper-noun-shaped
  // token: every word in the window must be a candidate word (not a
  // stopword, four letters or more), the first letter must agree (people
  // mistype the middle of a name, not its initial), and the alias must be
  // long enough that one edit cannot turn an ordinary phrase into it.
  const fuzzy: Mention[] = [];
  for (const { resort, aliases } of aliasTable) {
    for (const alias of aliases) {
      if (alias.length < 6) continue;
      const n = alias.split(" ").length;
      const budget = alias.length >= 10 ? 2 : 1;
      for (let i = 0; i + n <= words.length; i++) {
        const slice = words.slice(i, i + n);
        if (slice.some((w) => w.length < 4 || FUZZY_STOPWORDS.has(w))) continue;
        const window = slice.join(" ");
        if (window[0] !== alias[0] || Math.abs(window.length - alias.length) > budget) continue;
        const d = editDistance(window, alias);
        if (d <= budget) fuzzy.push({ resort, start: offsets[i], end: offsets[i] + window.length, alias, distance: d });
      }
    }
  }
  return pickNonOverlapping(fuzzy);
}

function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
}

// ── Intent rules ─────────────────────────────────────────────

const RE = {
  alerts: /\b(alerts?|alerting|notify|notification|notifications|webhooks?|subscribe|subscription|ical|calendar|atom|rss|feed|text me|email me|wake)\b/,
  regions: /\b(which|what|how many|list)\b.*\b(states?|provinces?|countries|regions?)\b|\b(coverage|do you (cover|track|have)|where do you|how many resorts)\b/,
  compare: /\b(compare|comparison|versus|vs|better|between|against|head to head|side by side)\b/,
  camTimeline: /\b(timeline|time ?lapse|stills?|looked like|look like (this morning|earlier|yesterday)|archive|archived|frames|earlier today)\b/,
  camWindow: /\b((last|past) (24|48) hours|yesterday|this morning|overnight)\b/,
  cams: /\b(cams?|webcams?|cameras?|live (view|feed|video|stream)|stream|watch|look at|show me)\b/,
  history: /\b(history|historical|last week|past week|over the (week|last)|a week ago|days ago|trend|changed|has (it|the base) (changed|grown|gone)|so far|fell|fallen|got|did it snow|has it snowed|snowed)\b/,
  forecast: /\b(forecast|forecasts|tomorrow|weekend|will it|going to|gonna|next (few )?days|next week|outlook|expected|expecting|coming|incoming|storm coming|chance of|predict)\b/,
  pctOfNormal: /\b(percent of normal|of normal|normal|snowpack|swe|water equivalent|above average|below average)\b/,
  openings: /\b(open|opens|opening|opened|closed|closing|closes|close|season (start|starts|end|ends|dates?)|when does|first chair|still open|operating|running|spinning)\b/,
  powder: /\b(where|most|powder|best|deepest|biggest|top|rank|ranking|leaderboard|which resort|what resort|anywhere)\b/,
  profile: /\b(where is|how high|how tall|elevation|summit|base elevation|vertical|website|social|instagram|facebook|twitter|located|location|address|tell me about|what is|who owns|how big)\b/,
  conditions: /\b(snow|base|conditions|depth|how much|report|new snow|fresh|inches|in|right now|today|current|currently|like)\b/,
  measured: /\b(measured|snotel|station|stations|sensor|telemetry)\b/,
  window48: /\b(48|48h|48 hours|two days|2 days|weekend|couple of days)\b/,
  pastTense: /\b(fell|fallen|got|did it snow|has it snowed|snowed|so far|last|past|ago|changed)\b/,
} as const;

function minInchesFrom(normalized: string): number | null {
  const m = /\b(\d{1,3})\s*(inches|inch|in|")/.exec(normalized) ?? /\bmore than (\d{1,3})\b/.exec(normalized) ?? /\bat least (\d{1,3})\b/.exec(normalized);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 500 ? n : null;
}

function historyDays(normalized: string): number {
  if (/\b(month|30 days|four weeks|4 weeks)\b/.test(normalized)) return 30;
  if (/\b(two weeks|2 weeks|fortnight|14 days)\b/.test(normalized)) return 14;
  return 7;
}

function timelineHours(normalized: string): number {
  return /\b(48|two days|2 days|yesterday)\b/.test(normalized) ? 48 : 24;
}

// ── Plan ─────────────────────────────────────────────────────

export function planQuestion(rawQuestion: string, resorts: readonly ResortWithData[]): AskPlan {
  const question = rawQuestion.trim().slice(0, MAX_QUESTION_LENGTH);
  const normalized = normalizeText(question);
  const base: Omit<AskPlan, "intent" | "tool" | "args" | "reason"> = {
    question,
    normalized,
    resorts: [],
    place: null,
    didYouMean: [],
  };
  if (!normalized) return { ...base, intent: "unknown", tool: null, args: {}, reason: "empty" };

  // 1. Resorts, then the place, each blanked out of the text the intent rules see.
  const mentions = findMentions(normalized, resorts);
  let rest = normalized;
  for (const m of mentions) rest = blank(rest, m.start, m.end);
  const place = detectPlace(question, rest);
  if (place) {
    for (const [s, e] of occurrences(rest, place.phrase)) rest = blank(rest, s, e);
  }
  const named = mentions.map((m) => m.resort);
  const first = named[0] ?? null;
  const ctx = { ...base, resorts: named, place };
  const slugArgs = first ? { slug: first.slug } : {};

  const plan = (intent: AskIntent, tool: PeakCamToolName, args: Record<string, unknown>): AskPlan => ({
    ...ctx,
    intent,
    tool,
    args,
    reason: null,
  });
  const unknown = (reason: UnansweredReason, didYouMean: ResortWithData[] = []): AskPlan => ({
    ...ctx,
    intent: "unknown",
    tool: null,
    args: {},
    reason,
    didYouMean,
  });

  // 2. Intents that need no resort.
  if (RE.alerts.test(rest)) return plan("alerts", "get_alert_options", {});
  if (!first && RE.regions.test(rest)) return plan("regions", "list_regions", {});

  // 3. Two or more resorts: a comparison unless a single-resort intent is explicit.
  if (named.length >= 2) {
    const single = RE.cams.test(rest) || RE.forecast.test(rest) || RE.history.test(rest);
    if (RE.compare.test(rest) || !single) {
      return plan("compare", "compare_resorts", { slugs: named.slice(0, 6).map((r) => r.slug) });
    }
  }

  // 4. Single-resort intents, most specific first.
  if (first) {
    if (RE.camTimeline.test(rest) || (RE.cams.test(rest) && RE.camWindow.test(rest))) {
      return plan("cam_timeline", "get_cam_timeline", { ...slugArgs, hours: timelineHours(rest) });
    }
    if (RE.cams.test(rest)) return plan("cams", "get_resort_cams", slugArgs);
    if (RE.history.test(rest) && RE.pastTense.test(rest)) return plan("history", "get_snow_history", { ...slugArgs, days: historyDays(rest) });
    if (RE.forecast.test(rest)) return plan("forecast", "get_forecast", slugArgs);
    if (RE.history.test(rest)) return plan("history", "get_snow_history", { ...slugArgs, days: historyDays(rest) });
    if (RE.openings.test(rest)) return plan("openings", "get_resort_conditions", slugArgs);
    if (RE.pctOfNormal.test(rest)) return plan("conditions", "get_resort_conditions", slugArgs);
    if (RE.profile.test(rest) && !RE.conditions.test(rest)) return plan("profile", "get_resort_profile", slugArgs);
    if (RE.profile.test(rest) && /\b(where is|how high|elevation|summit|vertical|website|located|location|tell me about)\b/.test(rest)) {
      return plan("profile", "get_resort_profile", slugArgs);
    }
    return plan("conditions", "get_resort_conditions", slugArgs);
  }

  // 5. No resort: catalogue-wide intents.
  if (RE.openings.test(rest) && !RE.powder.test(rest)) {
    return plan("openings", "get_opening_dates", { ...(place?.state ? { state: place.state } : {}), limit: 50 });
  }
  if (RE.pctOfNormal.test(rest)) {
    return plan("percent_of_normal", "get_percent_of_normal", { ...(place?.state ? { state: place.state } : {}), limit: 10 });
  }
  if (RE.powder.test(rest) || RE.conditions.test(rest) || RE.openings.test(rest)) {
    if (RE.openings.test(rest) && !/\b(snow|powder|deepest|most)\b/.test(rest)) {
      return plan("openings", "get_opening_dates", { ...(place?.state ? { state: place.state } : {}), limit: 50 });
    }
    const minInches = minInchesFrom(rest);
    return plan("powder", "find_powder", {
      window: RE.window48.test(rest) ? "48h" : "24h",
      ...(place?.state ? { state: place.state } : {}),
      ...(minInches != null ? { minInches } : {}),
      ...(RE.measured.test(rest) ? { sourceOnly: "snotel" } : {}),
      limit: 10,
    });
  }
  if (RE.forecast.test(rest) || RE.cams.test(rest) || RE.history.test(rest) || RE.profile.test(rest)) {
    // A resort-shaped question with no resort PeakCam knows: offer the closest names.
    const capitalised = (question.match(/\b[A-Z][a-zA-Z]{3,}(?:\s+[A-Z][a-zA-Z]{2,})?/g) ?? []).filter(
      (w) => !/^(What|Where|When|Which|How|Show|Does|Is|Are|Will|Can|Tell|Compare|Give)$/i.test(w),
    );
    const guess = capitalised.flatMap((w) => matchResorts(resorts, w, { limit: 3 })).slice(0, 3);
    return unknown(guess.length ? "unknown_resort" : "no_resort", guess);
  }
  return unknown("no_intent");
}
