import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import path from "node:path";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createTerrainSource } from "../terrain/terrain-source";
const cache = new Map<string, ReturnType<typeof createTerrainSource>["sampler"]>();
export function rankedTerrain(slug: string) {
  const cached = cache.get(slug);
  if (cached) return cached;
  const profile = DROP_IN_GAME_PROFILES[slug as keyof typeof DROP_IN_GAME_PROFILES];
  if (!profile) throw new Error("Unknown resort");
  const base = path.join(process.cwd(), "public/game/terrain", profile.slug);
  const bytes = brotliDecompressSync(readFileSync(`${base}.height.u16.br`));
  const terrain = createTerrainSource({ profile, mode: "real", assets: {
    heightfield: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    meta: JSON.parse(readFileSync(`${base}.meta.json`, "utf8")),
    trails: JSON.parse(readFileSync(`${base}.trails.json`, "utf8")),
  } }).sampler;
  cache.set(slug, terrain);
  return terrain;
}

