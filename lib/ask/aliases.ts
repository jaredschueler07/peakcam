// ─────────────────────────────────────────────────────────────
// Ask router — the names people call resorts and places by.
//
// Pure. Two consumers: the router (lib/ask/router.ts) resolves a resort
// mentioned in a question, and /api/v1/resorts/search-index publishes the
// same aliases so an agent can do the match client-side. Keeping both on one
// function means the index never promises an alias the router would miss.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData } from "@/lib/types";
import { STATE_NAMES } from "@/lib/hubs";
import { normalizeText } from "@/lib/mcp/catalog";

/**
 * Trailing words a resort's marketing name carries that nobody says when
 * asking a question ("Alta Ski Area" → "alta", "Vail Mountain" → "vail").
 * Longest suffix wins; the remainder must keep at least four characters so
 * "Ski Bowl" does not collapse to "bowl"-length noise.
 */
const GENERIC_SUFFIXES = [
  "mountain resort",
  "ski resort",
  "ski area",
  "ski mountain",
  "resort",
  "mountain",
  "ski",
];

/**
 * Derived aliases that are also ordinary words in a snow question are not
 * aliases: "Powder Mountain" is matched by its full name, never by "powder".
 */
const ALIAS_STOPWORDS = new Set(["powder", "snow", "winter", "park", "summit", "base", "peak", "mountain", "high", "sun", "june", "spirit", "red", "big", "white", "bear", "valley"]);

/** Leading "Mt"/"Mount" forms: `mt bachelor`, `mount bachelor` and `bachelor` all mean one place. */
const MOUNT_PREFIX = /^(mt|mount|mt\.)\s+/;

/**
 * Hand-kept nicknames, by slug. Only names that are not derivable from the
 * resort's own name and that skiers actually use; a nickname that is also a
 * common English word is left out on purpose.
 */
export const RESORT_NICKNAMES: Record<string, readonly string[]> = {
  breckenridge: ["breck"],
  "arapahoe-basin": ["a basin", "abasin", "a-basin"],
  "jackson-hole": ["jackson", "jhole"],
  "palisades-tahoe": ["squaw", "squaw valley", "palisades"],
  "whistler-blackcomb": ["whistler", "blackcomb"],
  "aspen-snowmass": ["aspen", "snowmass"],
  "mt-hood-meadows": ["meadows", "hood meadows"],
  "crested-butte": ["cb"],
  "copper-mountain": ["copper"],
  "winter-park": ["wp"],
  "big-sky": ["bigsky"],
  "deer-valley": ["dv"],
  "park-city": ["pcmr", "canyons"],
  "mad-river-glen": ["mrg"],
  "smugglers-notch": ["smuggs"],
  "mt-baker": ["baker"],
  "mt-bachelor": ["bachelor"],
  "mt-shasta": ["shasta"],
  "mt-ashland": ["ashland"],
  "mt-baldy": ["baldy"],
  "49-degrees-north": ["49 north", "49 degrees"],
  "ski-portillo": ["portillo"],
  "valle-nevado": ["valle"],
  "cerro-catedral": ["catedral", "bariloche"],
  "las-lenas": ["las lenas", "lenas"],
  "nevados-de-chillan": ["chillan", "nevados"],
  "ski-santa-fe": ["santa fe"],
  "ski-apache": ["apache"],
  "ski-cooper": ["cooper"],
  "ski-bluewood": ["bluewood"],
  "ski-bowl": ["skibowl", "mt hood skibowl"],
  "arizona-snowbowl": ["snowbowl"],
  "boyne-mountain": ["boyne"],
  "marquette-mountain": ["marquette"],
  "mountain-high": ["mt high"],
};

/**
 * Every normalized phrase that names this resort: the full name, the slug as
 * words, the name minus a generic suffix, Mt/Mount variants, and nicknames.
 * Deduplicated, longest first, every phrase at least three characters.
 */
export function resortAliases(resort: Pick<ResortWithData, "name" | "slug">): string[] {
  const out = new Set<string>();
  const name = normalizeText(resort.name);
  const slugWords = resort.slug.replace(/-/g, " ");
  const add = (phrase: string, derived = true) => {
    const p = phrase.trim();
    if (p.length < 3) return;
    if (derived && ALIAS_STOPWORDS.has(p)) return;
    out.add(p);
  };
  add(name, false);
  add(slugWords, false);
  for (const base of [name, slugWords]) {
    for (const suffix of GENERIC_SUFFIXES) {
      if (base.endsWith(` ${suffix}`)) {
        const rest = base.slice(0, -suffix.length - 1).trim();
        if (rest.length >= 4) add(rest);
        break;
      }
    }
  }
  for (const phrase of [...out]) {
    const m = MOUNT_PREFIX.exec(phrase);
    if (m) {
      const rest = phrase.slice(m[0].length);
      add(`mt ${rest}`);
      add(`mount ${rest}`);
      if (rest.length >= 5) add(rest);
    }
  }
  for (const nick of RESORT_NICKNAMES[resort.slug] ?? []) add(normalizeText(nick));
  return [...out].sort((a, b) => b.length - a.length || a.localeCompare(b, "en"));
}

/** The aliases minus the resort's own name and slug words: what the search index publishes. */
export function publishedAliases(resort: Pick<ResortWithData, "name" | "slug">): string[] {
  const name = normalizeText(resort.name);
  const slugWords = resort.slug.replace(/-/g, " ");
  return resortAliases(resort).filter((a) => a !== name && a !== slugWords);
}

// ── Places ───────────────────────────────────────────────────

export interface PlaceMention {
  /** `resorts.state` value as stored: a US/CA code or an Andes country name. */
  state: string | null;
  /** ISO-2 country when the question names a country rather than a state. */
  country: string | null;
  /** The phrase that matched, for removing it from the question. */
  phrase: string;
}

const COUNTRY_WORDS: Record<string, string> = {
  "united states": "US",
  usa: "US",
  america: "US",
  canada: "CA",
  canadian: "CA",
  chile: "CL",
  chilean: "CL",
  argentina: "AR",
  argentine: "AR",
  andes: "CL",
};

/** Andes rows store the country name in `state`; a mention of the country is both. */
const ANDES_STATE_BY_COUNTRY: Record<string, string> = { CL: "Chile", AR: "Argentina" };

const STATE_PHRASES: Array<{ phrase: string; code: string }> = Object.entries(STATE_NAMES)
  .map(([code, name]) => ({ phrase: normalizeText(name), code }))
  .sort((a, b) => b.phrase.length - a.phrase.length);

/** Hand-written place words that are not state names but mean one. */
const PLACE_WORDS: Array<{ phrase: string; code: string }> = [
  { phrase: "tahoe", code: "CA" },
  { phrase: "lake tahoe", code: "CA" },
  { phrase: "wasatch", code: "UT" },
  { phrase: "front range", code: "CO" },
  { phrase: "summit county", code: "CO" },
  { phrase: "tetons", code: "WY" },
  { phrase: "cascades", code: "WA" },
  { phrase: "new england", code: "VT" },
  { phrase: "bc", code: "BC" },
];

function hasWord(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${phrase} `);
}

/**
 * The state, province or country a question names, if any. State names and
 * country words are matched lowercase; two-letter codes only when the
 * original question wrote them in capitals (`CO`), since `co`, `or`, `in`
 * and `me` are ordinary words.
 */
export function detectPlace(question: string, normalized: string = normalizeText(question)): PlaceMention | null {
  for (const { phrase, code } of STATE_PHRASES) {
    if (hasWord(normalized, phrase)) return { state: code, country: null, phrase };
  }
  for (const { phrase, code } of PLACE_WORDS) {
    if (hasWord(normalized, phrase)) return { state: code, country: null, phrase };
  }
  for (const [phrase, code] of Object.entries(COUNTRY_WORDS)) {
    if (hasWord(normalized, phrase)) {
      return { state: ANDES_STATE_BY_COUNTRY[code] ?? null, country: code, phrase };
    }
  }
  const upper = question.match(/\b[A-Z]{2}\b/g) ?? [];
  for (const code of upper) {
    if (code in STATE_NAMES) return { state: code, country: null, phrase: code.toLowerCase() };
  }
  return null;
}
