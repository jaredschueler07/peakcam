import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import { GameRuntime, type RuntimeAnalytics } from "./GameRuntime";
import { UiBridge } from "./UiBridge";
import { TerrainAssetLoader } from "../rendering/loaders/TerrainAssetLoader";
import { createTerrainSource } from "../terrain/terrain-source";
import type { TerrainSource } from "../terrain/terrain-source";
import type { TerrainLoadOptions } from "../rendering/loaders/TerrainAssetLoader";
import type { RealTerrainAssets } from "../terrain/terrain-source";
import type { ConditionsSnapshot } from "../conditions";
import type { RuntimeAudio } from "./RuntimeAudio";
import { createRendererBackend, resolveBackendOverride } from "../rendering/backend";

interface RuntimeTerrainLoader {
  load(slug: ResortGameProfile["slug"], options?: TerrainLoadOptions): Promise<RealTerrainAssets>;
}

export interface CreateGameOptions {
  canvas: HTMLCanvasElement;
  profile: ResortGameProfile;
  uiBridge: UiBridge;
  analytics: RuntimeAnalytics;
  conditions: ConditionsSnapshot;
  audio: RuntimeAudio;
  signal?: AbortSignal;
  /**
   * World seed for this run. Competitive runs MUST pass the seed from their
   * server-issued ticket: the ghost header carries `world.seed`, and the
   * validator rejects any run whose seed differs from the ticket's
   * (`validate-run.ts` → `seed_mismatch`). Free Ski and offline runs omit it
   * and get the profile seed.
   */
  seed?: number;
  /**
   * Test-only: start this many metres along the selected course instead of at
   * the top. See `spawnOnRunAtArcLength`; the resulting run is unsubmittable.
   */
  spawnArcM?: number;
}

export async function loadTerrainForRuntime(
  profile: ResortGameProfile,
  uiBridge: UiBridge,
  analytics: RuntimeAnalytics,
  loader: RuntimeTerrainLoader = new TerrainAssetLoader(),
  signal?: AbortSignal,
): Promise<TerrainSource> {
  try {
    const assets = await loader.load(profile.slug, {
      signal,
      onProgress: (progress) => uiBridge.setLoadingProgress(progress),
    });
    return createTerrainSource({ profile, assets, mode: "real" });
  } catch (reason) {
    if (signal?.aborted || (reason instanceof DOMException && reason.name === "AbortError")) throw reason;
    const errorName = reason instanceof Error ? reason.name : "TerrainAssetError";
    console.warn(`[Drop In] Real terrain failed for ${profile.slug}; using procedural fallback.`, reason);
    analytics.terrainFallback(errorName);
    return createTerrainSource({ profile, mode: "procedural" });
  }
}

export async function createGame(options: CreateGameOptions): Promise<GameRuntime> {
  void THREE.REVISION;
  const startedAt = performance.now();
  const source = await loadTerrainForRuntime(
    options.profile, options.uiBridge, options.analytics, new TerrainAssetLoader(), options.signal,
  );
  const assetLoadMs = performance.now() - startedAt;
  const override = resolveBackendOverride(
    typeof location === "undefined" ? "" : location.search,
    typeof navigator !== "undefined" && "gpu" in navigator,
  );
  const backend = override === null ? undefined : await createRendererBackend(options.canvas, override);
  const runtime = new GameRuntime(
    options.canvas, options.profile, options.uiBridge, options.analytics, source.sampler,
    options.conditions, options.audio, assetLoadMs, options.seed, options.spawnArcM, backend,
  );
  runtime.start();
  return runtime;
}
