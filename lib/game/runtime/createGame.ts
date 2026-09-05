import { installE2eDebug } from "./e2e-debug";
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
import type { NodeFactories } from "../rendering/nodeFactories";
import { loadNodeFactories } from "../rendering/nodeFactories";
import type { RendererBackend } from "../rendering/Renderer";
import { loadSurfaceTextures, type SurfaceTextures } from "../rendering/surfaceTextures";

interface RuntimeTerrainLoader {
  load(slug: ResortGameProfile["slug"], options?: TerrainLoadOptions): Promise<RealTerrainAssets>;
}

/** Structural, like RuntimeTerrainLoader above, so tests need no cast to substitute a fake. */
interface RuntimeFarFieldLoader {
  load(slug: ResortGameProfile["slug"], options: FarFieldLoadOptions): Promise<DecodedFarField | null>;
}

/** Structural, so tests can inject a fake load without a real GPU device. */
interface RuntimeSurfaceTexturesConsumer {
  attachSurfaceTextures(surfaces: SurfaceTextures): void;
  readonly rung: number;
}

export interface CreateGameOptions {
  trailId?: string;
  mode?: "free_ski" | "time_trial" | "score_attack";
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

/** Parallel startup ownership: a late backend is released after cancellation or a peer failure. */
export async function loadStartupResources(
  loadTerrain: (signal: AbortSignal) => Promise<TerrainSource>,
  createBackend: () => Promise<RendererBackend | undefined>,
  createNodes: () => Promise<NodeFactories>,
  signal?: AbortSignal,
): Promise<{ source: TerrainSource; backend: RendererBackend | undefined; nodeFactories: NodeFactories | null }> {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) relayAbort(); else signal?.addEventListener("abort", relayAbort, { once: true });
  let backend: RendererBackend | undefined, released = false;
  const release = () => { if (backend && !released) { released = true; backend.dispose(); } };
  let rejectAbort: (reason: unknown) => void = () => {};
  const onAbort = () => { release(); rejectAbort(controller.signal.reason); };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    controller.signal.throwIfAborted();
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const terrainPromise = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return loadTerrain(controller.signal); });
    const rendererPromise = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return createBackend(); }).then(async value => {
      backend = value;
      if (controller.signal.aborted) { release(); controller.signal.throwIfAborted(); }
      const nodeFactories = backend?.backendKind === "webgpu" ? await createNodes() : null;
      controller.signal.throwIfAborted();
      return nodeFactories;
    });
    const [source, nodeFactories] = await Promise.race([Promise.all([terrainPromise, rendererPromise]), aborted]);
    controller.signal.throwIfAborted();
    return { source, backend, nodeFactories };
  } catch (reason) {
    controller.abort(reason); release(); throw reason;
  } finally {
    signal?.removeEventListener("abort", relayAbort);
    // A non-cancellable GPU init that returns later still checks the aborted
    // controller in rendererPromise and releases its own late backend.
    controller.signal.removeEventListener("abort", onAbort);
  }
}

export async function createGame(options: CreateGameOptions): Promise<GameRuntime> {
  void THREE.REVISION;
  const startedAt = performance.now();
  let assetLoadMs = 0;
  const { source, backend, nodeFactories } = await loadStartupResources(
    async signal => {
      const source = await loadTerrainForRuntime(options.profile, options.uiBridge, options.analytics, new TerrainAssetLoader(), signal);
      assetLoadMs = performance.now() - startedAt;
      return source;
    },
    () => selectRendererBackend(options.canvas), loadNodeFactories, options.signal,
  );
  let runtime: GameRuntime | undefined;
  const abortRuntime = () => runtime?.dispose();
  try {
    options.signal?.throwIfAborted();
    runtime = new GameRuntime(
      options.canvas, options.profile, options.uiBridge, options.analytics, source.sampler,
      options.conditions, options.physicsModel, options.audio, assetLoadMs, options.seed, options.spawnArcM, backend,
      nodeFactories, options.trailId, options.mode,
    );
    options.signal?.addEventListener("abort", abortRuntime, { once: true });
    const cleanup = installE2eDebug(window as Window & { __dropInDebug?: import("./e2e-debug").DropInDebugApi }, location.search, () => runtime!.createDebugApi());
    if (cleanup) runtime.setDebugCleanup(cleanup);
    void attachFarFieldWhenReady(runtime, options);
    runtime.setSurfaceTextureLoader(() => { void attachSurfaceTexturesWhenReady(runtime!, backend); });
    // Preserve the shader readiness gate; parallel I/O must never report ready early.
    await runtime.startWhenWarm();
    options.signal?.throwIfAborted();
    return runtime;
  } catch (reason) {
    if (runtime) runtime.dispose(); else backend?.dispose();
    throw reason;
  } finally { options.signal?.removeEventListener("abort", abortRuntime); }
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
 * Loads the real snow surface KTX2 pair alongside the run, mirroring `attachFarFieldWhenReady`:
 * never awaited by the caller, and every failure path leaves the procedural detail normal
 * untouched — `loadSurfaceTextures` already returns `null` rather than throwing, and the extra
 * try/catch here is defence in depth against `createGameTextureLoader` itself misbehaving.
 *
 * Requested once when live quality first reaches rung3; low-rung sessions defer the
 * download. A downshift during the load retains the maps without sampling them.
 */
export async function attachSurfaceTexturesWhenReady(
  runtime: RuntimeSurfaceTexturesConsumer,
  backend: RendererBackend | undefined,
  load?: (backend: RendererBackend) => Promise<SurfaceTextures | null>,
): Promise<void> {
  if (!backend || backend.backendKind !== "webgpu" || runtime.rung < 3) return;
  try {
    // Imported here rather than at module scope so `KTX2Loader` — and the `ktx-parse` and
    // `zstddec` it drags with it — land in their own lazy chunk instead of the eager group every
    // session downloads. The gates above already decided nobody else will ever call this, so the
    // bytes now follow the feature: WebGL sessions and rungs below 3 never fetch them. The
    // `load` seam is unchanged for tests; it just no longer names the loader in a default
    // parameter, because a default expression still has to be linked eagerly even when unused.
    const surfaces = await (load
      ? load(backend)
      : import("../rendering/loaders/GameTextureLoader").then(({ createGameTextureLoader }) =>
          loadSurfaceTextures(createGameTextureLoader(backend))));
    if (surfaces) runtime.attachSurfaceTextures(surfaces);
  } catch {
    // The procedural detail normal is still standing.
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
