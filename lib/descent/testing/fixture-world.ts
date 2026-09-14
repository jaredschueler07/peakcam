/**
 * lib/descent/testing/fixture-world.ts
 * ────────────────────────────────────
 * Build a real `World` from the committed terrain assets on disk — the same
 * bytes the browser downloads — so sim tests run on the actual mountains.
 * Node-only (uses fs + zlib); never imported by app code.
 */

import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import path from "node:path";
import { DROP_IN_GAME_PROFILES } from "@/lib/game/config/profiles";
import type { DropInResortSlug } from "@/lib/game/config/schema";
import type { TerrainMeta, TrailsFile } from "@/lib/game/terrain/formats";
import { buildConditionsSnapshot } from "@/lib/game/conditions";
import { buildWorld, type LandmarksFile } from "../world/loadWorld";
import type { World } from "../types";

const cache = new Map<string, World>();

export function fixtureWorld(slug: DropInResortSlug): World {
  const cached = cache.get(slug);
  if (cached) return cached;
  const dir = path.join(process.cwd(), "public", "game", "terrain");
  const meta = JSON.parse(readFileSync(path.join(dir, `${slug}.meta.json`), "utf8")) as TerrainMeta;
  const trails = JSON.parse(readFileSync(path.join(dir, `${slug}.trails.json`), "utf8")) as TrailsFile;
  const compressed = readFileSync(path.join(dir, `${slug}.height.u16.br`));
  const raw = brotliDecompressSync(compressed);
  const heightfield = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const landmarks = JSON.parse(readFileSync(path.join(dir, "landmarks.json"), "utf8")) as LandmarksFile;
  const profile = DROP_IN_GAME_PROFILES[slug];
  const conditions = buildConditionsSnapshot({ slug, cond_rating: "good" }, null, null, "v2", 12);
  const world = buildWorld({ profile, conditions, seed: profile.terrainSeed, assets: { heightfield, meta, trails }, farField: null, landmarks });
  cache.set(slug, world);
  return world;
}
