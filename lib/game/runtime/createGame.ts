import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import { GameRuntime, type RuntimeAnalytics } from "./GameRuntime";
import { UiBridge } from "./UiBridge";
import { TerrainAssetLoader } from "../rendering/loaders/TerrainAssetLoader";
import { FarFieldAssetLoader } from "../rendering/loaders/FarFieldAssetLoader";
import type { FarFieldLoadOptions } from "../rendering/loaders/FarFieldAssetLoader";
import type { DecodedFarField } from "../terrain/far-field-format";
import { FAR_FIELD_RADIUS_M } from "../rendering/FarFieldRenderer";
import { RESORT_BAKE_CONFIGS } from "../terrain/resorts";
import { createTerrainSource } from "../terrain/terrain-source";
import type { TerrainSource } from "../terrain/terrain-source";
import type { TerrainLoadOptions } from "../rendering/loaders/TerrainAssetLoader";
import type { RealTerrainAssets } from "../terrain/terrain-source";
import type { ConditionsSnapshot } from "../conditions";
import type { PhysicsModel } from "../core/config";
import type { RuntimeAudio } from "./RuntimeAudio";
import { createRendererBackend, resolveBackendKind } from "../rendering/backend";
import { loadNodeFactories } from "../rendering/nodeFactories";
import type { RendererBackend } from "../rendering/Renderer";

interface RuntimeTerrainLoader {
  load(slug: ResortGameProfile["slug"], options?: TerrainLoadOptions): Promise<RealTerrainAssets>;
}

/** Structural, like RuntimeTerrainLoader above, so tests need no cast to substitute a fake. */
interface RuntimeFarFieldLoader {
  load(slug: ResortGameProfile["slug"], options: FarFieldLoadOptions): Promise<DecodedFarField | null>;
}

export interface CreateGameOptions {
  canvas: HTMLCanvasElement;
  profile: ResortGameProfile;
  uiBridge: UiBridge;
  analytics: RuntimeAnalytics;
  conditions: ConditionsSnapshot;
  /** Resolved once by the shell, including any explicit playtest override. */
  physicsModel: PhysicsModel;
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
  const backend = await selectRendererBackend(options.canvas);
  // The node materials and the 2.1 MB `three/webgpu` behind them are a separate chunk; fetch it
  // only once this session is known to have actually got a WebGPU device, not merely asked for one.
  const nodeFactories = backend?.backendKind === "webgpu" ? await loadNodeFactories() : null;
  const runtime = new GameRuntime(
    options.canvas, options.profile, options.uiBridge, options.analytics, source.sampler,
    options.conditions, options.physicsModel, options.audio, assetLoadMs, options.seed, options.spawnArcM, backend,
    nodeFactories,
  );
  void runtime.startWhenWarm();
  void attachFarFieldWhenReady(runtime, options);
  return runtime;
}

/**
 * Loads the baked far field alongside the run rather than before it. Deliberately not awaited:
 * the horizon is an upgrade over the procedural ridge bands, so making the player wait on it —
 * or letting it fail the run — would trade something they can see for something they cannot.
 * Every failure path inside resolves to `null` and simply leaves the ridge bands up.
 */
export async function attachFarFieldWhenReady(
  runtime: Pick<GameRuntime, "attachFarField">,
  options: Pick<CreateGameOptions, "profile" | "signal">,
  loader: RuntimeFarFieldLoader = new FarFieldAssetLoader(),
): Promise<void> {
  const centre = RESORT_BAKE_CONFIGS[options.profile.slug]?.center;
  if (!centre) return;
  try {
    const asset = await loader.load(options.profile.slug, {
      signal: options.signal,
      expect: { centre, radiusM: FAR_FIELD_RADIUS_M },
    });
    if (asset && !options.signal?.aborted) runtime.attachFarField(asset);
  } catch {
    // Aborted, or the runtime went away mid-flight. The ridge bands are still standing.
  }
}

/**
 * WebGPU is the default wherever the browser has it; everything else falls back to the legacy
 * `WebGLRenderer` that `GameRenderer` builds when no backend is injected, because the fallback
 * keeps the GLSL materials (`polishSnowMaterial`, the sky `ShaderMaterial`, `addHeightFog`) that
 * only a WebGL context can compile. `?gfx=webgl` forces that path; `?gfx=webgpu` is a no-op where
 * WebGPU is already the default and cannot conjure it where the browser lacks it.
 */
export async function selectRendererBackend(
  canvas: HTMLCanvasElement,
  search = typeof location === "undefined" ? "" : location.search,
  hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator,
  create = createRendererBackend,
): Promise<RendererBackend | undefined> {
  if (resolveBackendKind(search, hasWebGPU) !== "webgpu") return undefined;
  try {
    return await create(canvas, "webgpu");
  } catch (reason) {
    console.warn("[Drop In] WebGPU backend failed to initialise; falling back to WebGL.", reason);
    return undefined;
  }
}
