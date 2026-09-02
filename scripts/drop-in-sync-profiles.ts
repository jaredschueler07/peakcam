#!/usr/bin/env node
/**
 * Generate the Drop In v1 engine's embedded resort table from TypeScript.
 *
 * `public/drop-in/engine.html` is a bundler-free static asset: it cannot import
 * from `lib/`, so it has always carried its own copy of every resort profile and
 * of a few physics constants. That copy was kept in step by hand, and it drifted
 * (`farRetention` and `siteTagline` reached the TypeScript table and never the
 * engine). TypeScript is now the single source of truth and this script rewrites
 * the engine's copy from it:
 *
 *   npm run drop-in:sync-profiles
 *
 * The rewritten text lives between BEGIN/END markers inside the engine's inline
 * module. Nothing outside those markers is touched, so the engine stays a
 * hand-edited file everywhere else. `scripts/drop-in-engine.test.ts` runs this
 * generator in memory and fails if the checked-in region differs, which is what
 * keeps the two from drifting again.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DROP_IN_GAME_PROFILES } from "../lib/game/config/profiles";
import { GATE_SPACING, GRAVITY } from "../lib/game/physics/constants";

const root = path.join(__dirname, "..");
const ENGINE_PATH = path.join(root, "public/drop-in/engine.html");
const WORLD_RENDERER_PATH = path.join(root, "lib/game/rendering/WorldRenderer.ts");

export const BEGIN_MARKER = "// BEGIN GENERATED: RESORT_PROFILES";
export const END_MARKER = "// END GENERATED";

/**
 * The fields the v1 engine actually reads, in the order it is nicest to read
 * them. Everything else in the TypeScript profile is deliberately withheld:
 *
 *  - `slug` — the engine keys the table by slug already.
 *  - `siteTagline` — site chrome copy, rendered by `lib/drop-in.ts`, never by the engine.
 *  - `summitElevationFt` / `verticalDropFt` / `terrainSeed` / `trailNames` —
 *    derived aliases the Zod transform adds for the app facade.
 *
 * v1 would ignore unknown keys harmlessly, but shipping them would inflate a
 * static asset every visitor downloads with values nothing in it can use.
 */
const ENGINE_PROFILE_FIELDS = [
  "name",
  "tagline",
  "summitFt",
  "verticalFt",
  "seed",
  "fall",
  "relief",
  "accent",
  "accent2",
  "logo",
  "glow",
  "trails",
  "forest",
  "weather",
] as const;

const TRAIL_FIELDS = [
  "name", "grade", "hex", "col", "off", "amp", "freq", "phase", "half", "ramp",
] as const;

const FOREST_FIELDS = [
  "treeline", "rockBias", "rockKeep", "treeScale", "trunk", "cone", "cap",
] as const;

/**
 * `farRetention` is absent on purpose: it tunes the v2 far field's long-range fog
 * envelope (`lib/game/rendering/fogCurve.ts`). The v1 engine has no far field —
 * its horizon is two procedural ridge bands — so `applyWeather()` has nothing to
 * do with the value.
 */
const WEATHER_FIELDS = [
  "name", "fog", "fogCol", "top", "hor", "sun", "hemi", "amb", "snow", "wind",
  "haze", "exposure",
] as const;

/** Fields whose numeric value is a packed 0xRRGGBB colour, not a magnitude. */
const PACKED_COLOR_FIELDS = new Set(["col", "trunk", "cap", "fogCol", "top", "hor"]);

function jsString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function packedColor(value: number): string {
  return `0x${value.toString(16).padStart(6, "0")}`;
}

function scalar(key: string, value: unknown): string {
  if (typeof value === "string") return jsString(value);
  if (typeof value === "number") {
    return PACKED_COLOR_FIELDS.has(key) ? packedColor(value) : String(value);
  }
  throw new Error(`Cannot serialize ${key}: ${String(value)}`);
}

function inlineObject(
  source: Record<string, unknown>,
  fields: readonly string[],
): string {
  const parts = fields.map((key) => {
    const value = source[key];
    if (value === undefined) throw new Error(`Profile is missing ${key}`);
    if (Array.isArray(value)) {
      return `${key}: [${value.map((entry) => packedColor(entry as number)).join(", ")}]`;
    }
    return `${key}: ${scalar(key, value)}`;
  });
  return `{ ${parts.join(", ")} }`;
}

function renderProfile(slug: string, profile: Record<string, unknown>): string {
  const lines: string[] = [`  ${jsString(slug)}: {`];

  for (const key of ENGINE_PROFILE_FIELDS) {
    const value = profile[key];
    if (value === undefined) throw new Error(`${slug} is missing ${key}`);

    if (key === "trails") {
      lines.push("    trails: [");
      for (const trail of value as Record<string, unknown>[]) {
        lines.push(`      ${inlineObject(trail, TRAIL_FIELDS)},`);
      }
      lines.push("    ],");
    } else if (key === "weather") {
      lines.push("    weather: [");
      for (const preset of value as Record<string, unknown>[]) {
        lines.push(`      ${inlineObject(preset, WEATHER_FIELDS)},`);
      }
      lines.push("    ],");
    } else if (key === "forest") {
      lines.push(
        `    forest: ${inlineObject(value as Record<string, unknown>, FOREST_FIELDS)},`,
      );
    } else {
      lines.push(`    ${key}: ${scalar(key, value)},`);
    }
  }

  lines.push("  },");
  return lines.join("\n");
}

/**
 * `TOWER_SPACING` is a module-local constant in the v2 renderer rather than an
 * export, so it is read textually. A rename or deletion there fails this script
 * (and therefore the test) loudly, which is the point — a silent fallback would
 * reintroduce exactly the drift this replaces.
 */
function readTowerSpacing(): number {
  const source = readFileSync(WORLD_RENDERER_PATH, "utf8");
  const match = source.match(/^const TOWER_SPACING = ([0-9.]+);/m);
  if (!match) {
    throw new Error(
      `Could not read TOWER_SPACING from ${WORLD_RENDERER_PATH}. If it moved or ` +
        "was renamed, update scripts/drop-in-sync-profiles.ts to follow it.",
    );
  }
  return Number(match[1]);
}

/** The full text between (and including) the markers. */
export function renderGeneratedRegion(): string {
  const profiles = Object.entries(DROP_IN_GAME_PROFILES)
    .map(([slug, profile]) => renderProfile(slug, profile as unknown as Record<string, unknown>))
    .join("\n\n");

  return [
    BEGIN_MARKER,
    "// Generated by `npm run drop-in:sync-profiles` from lib/game/config/profiles.ts,",
    "// lib/game/physics/constants.ts and lib/game/rendering/WorldRenderer.ts.",
    "// Do not edit inside this region by hand — edit the TypeScript and re-run.",
    "const RESORT_PROFILES = {",
    profiles,
    "};",
    "",
    "// Shared with the v2 TypeScript engine. Changing either copy alone is drift.",
    `const GRAVITY = ${GRAVITY};`,
    `const GATE_SPACING = ${GATE_SPACING};`,
    `const TOWER_SPACING = ${readTowerSpacing()};`,
    END_MARKER,
  ].join("\n");
}

/** Returns `html` with its generated region replaced. Throws if it has none. */
export function applyGeneratedRegion(html: string): string {
  const begin = html.indexOf(BEGIN_MARKER);
  const end = html.indexOf(END_MARKER, begin);
  if (begin < 0 || end < 0) {
    throw new Error(
      `${ENGINE_PATH} has no ${BEGIN_MARKER} / ${END_MARKER} region to fill.`,
    );
  }
  return (
    html.slice(0, begin) +
    renderGeneratedRegion() +
    html.slice(end + END_MARKER.length)
  );
}

export function readEngine(): string {
  return readFileSync(ENGINE_PATH, "utf8");
}

function main(): void {
  const current = readEngine();
  const next = applyGeneratedRegion(current);
  if (next === current) {
    console.log("engine.html resort table is already up to date.");
    return;
  }
  writeFileSync(ENGINE_PATH, next);
  console.log("Regenerated the RESORT_PROFILES region in public/drop-in/engine.html");
  console.log("Now run: npx tsx --test scripts/drop-in-engine.test.ts");
}

if (require.main === module) main();
