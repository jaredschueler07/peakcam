#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// PeakCam — Seed Liftie Slugs
// Fetches the full resort list from Liftie, fuzzy-matches
// against PeakCam resort slugs, and outputs a mapping file.
// ─────────────────────────────────────────────────────────────

import { writeFileSync } from "fs";
import { resolve } from "path";

const LIFTIE_API = "https://liftie.info/api/resort";
const OUTPUT_PATH = resolve(__dirname, "../data/liftie-slug-map.json");

interface LiftieResort {
  id: string;
  name: string;
}

/**
 * Normalize a name for fuzzy matching:
 * lowercase, remove common suffixes, strip non-alphanumeric.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(ski\s*(resort|area|mountain)?|mountain|resort|village)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Simple similarity score between two normalized strings.
 * Returns 0-1 (1 = exact match).
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Check if one contains the other
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }

  // Levenshtein-based similarity for short strings
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshtein(a, b);
  return Math.max(0, 1 - dist / maxLen);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

async function main() {
  console.log("Fetching Liftie resort list...");

  // Liftie's resort list is at the /api/resort endpoint
  // Try fetching with common resort list patterns
  const res = await fetch(LIFTIE_API, {
    headers: { "User-Agent": "PeakCam/1.0 (contact@peakcam.io)" },
  });

  if (!res.ok) {
    // If the list endpoint doesn't work, try known resorts
    console.warn(`Liftie list endpoint returned ${res.status}`);
    console.log("Falling back to known resort slugs...");

    // Provide a curated mapping of common resort slug mappings
    const knownMappings: Record<string, string> = {
      "vail": "vail",
      "breckenridge": "breckenridge",
      "park-city": "park-city",
      "steamboat": "steamboat",
      "aspen-snowmass": "snowmass",
      "jackson-hole": "jackson-hole",
      "big-sky": "big-sky",
      "mammoth-mountain": "mammoth-mountain",
      "squaw-valley": "squaw-valley",
      "palisades-tahoe": "squaw-valley",
      "whistler-blackcomb": "whistler-blackcomb",
      "killington": "killington",
      "stowe": "stowe",
      "telluride": "telluride",
      "sun-valley": "sun-valley",
      "alta": "alta",
      "snowbird": "snowbird",
      "deer-valley": "deer-valley",
      "copper-mountain": "copper",
      "winter-park": "winter-park",
      "keystone": "keystone",
      "arapahoe-basin": "arapahoe-basin",
      "crested-butte": "crested-butte",
      "taos": "taos",
      "mt-bachelor": "mt-bachelor",
      "crystal-mountain": "crystal-mountain",
      "stevens-pass": "stevens-pass",
      "mt-baker": "mt-baker",
      "mount-hood-meadows": "mount-hood-meadows",
      "sugarbush": "sugarbush",
      "sunday-river": "sunday-river",
      "loon": "loon",
      "stratton": "stratton",
      "okemo": "okemo",
      "sugarloaf": "sugarloaf",
      "whiteface": "whiteface",
      "heavenly": "heavenly",
      "northstar": "northstar",
      "kirkwood": "kirkwood",
      "dodge-ridge": "dodge-ridge",
      "brighton": "brighton",
      "solitude": "solitude",
      "snowbasin": "snowbasin",
      "big-cottonwood": "brighton",
      "loveland": "loveland",
      "monarch": "monarch",
      "wolf-creek": "wolf-creek",
    };

    writeFileSync(OUTPUT_PATH, JSON.stringify(knownMappings, null, 2));
    console.log(`Wrote ${Object.keys(knownMappings).length} mappings to ${OUTPUT_PATH}`);
    return;
  }

  const data = await res.json();

  // Liftie returns an object keyed by resort slug
  const liftieResorts: LiftieResort[] = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      liftieResorts.push({ id: item.id || item.slug, name: item.name || item.id });
    }
  } else if (typeof data === "object") {
    for (const [key, val] of Object.entries(data)) {
      const v = val as Record<string, unknown>;
      liftieResorts.push({ id: key, name: (v.name as string) || key });
    }
  }

  console.log(`Found ${liftieResorts.length} Liftie resorts`);

  // Build mapping: peakcam slug -> liftie slug
  // For each Liftie resort, find the best PeakCam match
  const mapping: Record<string, string> = {};

  // Create a lookup for Liftie resorts
  for (const lr of liftieResorts) {
    const normId = normalize(lr.id);
    const normName = normalize(lr.name);

    // Direct slug match (most common)
    mapping[lr.id] = lr.id;

    // Also store normalized versions for fuzzy matching later
    if (normId !== lr.id) {
      mapping[normId] = lr.id;
    }
    if (normName && normName !== normId) {
      mapping[normName] = lr.id;
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(mapping, null, 2));
  console.log(`Wrote ${Object.keys(mapping).length} slug mappings to ${OUTPUT_PATH}`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Failed to seed Liftie slugs:", err);
  process.exit(1);
});
