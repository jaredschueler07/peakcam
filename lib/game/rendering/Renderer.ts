import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import type { SimulationState, SimulationWorld } from "../core/types";
import type { DecodedGhost } from "../replay/codec";
import { CameraController } from "./CameraController";
import { addHeightFog } from "./Atmosphere";
import { CsmShadows } from "./CsmShadows";
import type { CsmShadowsNode, ShadowSystem } from "./CsmShadowsNode";
import { EffectsRenderer } from "./EffectsRenderer";
import { GhostRenderer } from "./GhostRenderer";
import { disposeObjectTree, resourceCounts, type DisposalAudit, type ResourceCounts } from "./resources";
import { createScene, SUN_DIRECTION } from "./SceneFactory";
import { SkierRenderer } from "./SkierRenderer";
import { TerrainRenderer } from "./TerrainRenderer";
import { WeatherRenderer } from "./WeatherRenderer";
import { WorldRenderer } from "./WorldRenderer";
import { FarFieldRenderer } from "./FarFieldRenderer";
import type { DecodedFarField } from "../terrain/far-field-format";
import { QualityController, seedQualityRung, type DeviceQualitySignals, type QualityRung } from "./QualityController";
import type { PostProcessing } from "./PostProcessing";
import type { NodePostProcessing } from "./NodePostProcessing";
import type { NodeFactories } from "./nodeFactories";
import { visualWeatherPreset } from "./VisualPresets";
import { cameraPresetName, postBypassEnabled, snowDebugMode } from "./debugFlags";
import { CAMERA_PRESETS, type CameraPreset } from "./camera-presets";
import type { SurfaceTextures } from "./surfaceTextures";

type PostChain = Pick<PostProcessing | NodePostProcessing, "setSize" | "setQuality" | "render" | "dispose">;

/** How long pre-warm may hold the loading bar at 95% before starting anyway. */
const PREWARM_TIMEOUT_MS = 4000;

/** Module-scope scratch — `render()` must not allocate a Vector3 per frame. */
const sunPositionScratch = new THREE.Vector3();

export interface RendererBackend {
  readonly backendKind: "webgpu" | "webgl";
  readonly info?: {
    autoReset: boolean;
    reset(): void;
    render?: { calls?: number; drawCalls?: number; triangles?: number; points?: number; lines?: number };
    memory?: unknown;
    calls?: number;
  };
  // WebGLRenderer declares this as plain `string` in @types/three 0.185, so a
  // narrower ColorSpace here would reject the real renderer.
  outputColorSpace: string;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  readonly shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
  /**
   * WebGLRenderer only. `WebGPURenderer` (three 0.185.1) keeps its render lists private as
   * `_renderLists` and disposes them inside its own `dispose()`, so this is absent there and every
   * call site must guard it. Declaring it required is what let an unconditional call ship.
   */
  readonly renderLists?: { dispose(): void };
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  compileAsync?(scene: THREE.Object3D, camera: THREE.Camera): Promise<unknown>;
  dispose(): void;
  forceContextLoss?(): void;
  resetState?(): void;
}

export interface QualityChangeEvent {
  reason: "governor";
  from: QualityRung;
  to: QualityRung;
}

interface RendererOptions {
  localHour?: number;
  backend?: RendererBackend;
  devicePixelRatio?: number;
  reducedMotion?: boolean;
  disposalAudit?: DisposalAudit;
  qualitySignals?: DeviceQualitySignals;
  onQualityChange?(event: QualityChangeEvent): void;
  /**
   * The node pipeline, resolved by `loadNodeFactories()`. Required whenever `backend.backendKind`
   * is `"webgpu"` — a WebGPU device cannot compile the GLSL materials the WebGL path builds.
   */
  nodeFactories?: NodeFactories | null;
  /** Test seam: shortens the pre-warm budget so a hung compile can be exercised quickly. */
  prewarmTimeoutMs?: number;
  /** Chase-camera framing. Defaults to whatever `?cam=` selects, which is `classic` when absent. */
  cameraPreset?: CameraPreset;
}

/** The legacy renderer path owns PostProcessing; injected backends suppress it. */
export function shouldInitializePostProcessing(options: Pick<RendererOptions, "backend">): boolean {
  return !options.backend;
}

interface ShadowMaterialSetup { setupMaterial(material: THREE.Material): void }

function sceneMaterials(scene: THREE.Scene): Map<THREE.Material, boolean> {
  const materials = new Map<THREE.Material, boolean>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) materials.set(material, Boolean(materials.get(material)) || mesh.receiveShadow);
  });
  return materials;
}

export function configureSceneMaterials(scene: THREE.Scene, csm: ShadowMaterialSetup, atmosphere: Parameters<typeof addHeightFog>[1]): void {
  for (const [material, receivesShadow] of sceneMaterials(scene)) {
    if (receivesShadow) csm.setupMaterial(material);
    if ((material as THREE.Material & { fog?: boolean }).fog !== false && !(material instanceof THREE.ShaderMaterial)) addHeightFog(material, atmosphere);
  }
}

/**
 * The node pipeline fogs every material with `fog !== false` from `scene.fogNode`, where the WebGL
 * path opted out per material via `userData.heightFog`. Translate the flag, or the skier and the
 * ghost — which are meant to stay clear at distance — fade into the haze.
 */
export function applyNodeFogOptOuts(scene: THREE.Scene): THREE.Material[] {
  const opted: THREE.Material[] = [];
  for (const [material] of sceneMaterials(scene)) {
    if (material.userData.heightFog !== false) continue;
    (material as THREE.Material & { fog?: boolean }).fog = false;
    opted.push(material);
  }
  return opted;
}

export interface RenderPerformanceSummary {
  p50FrameMs: number;
  p95FrameMs: number;
  rung: QualityRung;
  dpr: number;
  tier: "mobile" | "desktop";
}

export class GameRenderer {
  private readonly renderer: RendererBackend;
  private readonly built: ReturnType<typeof createScene>;
  private readonly terrain: TerrainRenderer;
  private readonly skier: SkierRenderer;
  private readonly ghost: GhostRenderer;
  private readonly worldRenderer: WorldRenderer;
  /** Attached once the baked asset resolves; null on a missing or corrupt one. */
  private farField: FarFieldRenderer | null = null;
  private readonly farFieldFrustum = new THREE.Frustum();
  private readonly farFieldMatrix = new THREE.Matrix4();
  private readonly nodes: NodeFactories | null;
  private readonly effects: EffectsRenderer;
  private readonly cameraController: CameraController;
  private readonly weather: WeatherRenderer;
  private readonly quality: QualityController;
  private debugQualityPinned = false;
  private readonly csm: ShadowSystem;
  private post: PostChain | null = null;
  private readonly postReady: Promise<void>;
  private readonly reducedMotion: boolean;
  private readonly mobile: boolean;
  private readonly frameTimes: number[] = [];
  /**
   * The governor's own sample history, deliberately not `frameTimes`. That array stops accepting
   * pushes at 36,000 entries (~10 minutes at 60fps), so a window read from its tail would freeze on
   * ten-minute-old frames — going deaf exactly when a device starts thermally throttling. This ring
   * always holds the newest 240 samples (~4s), whatever the run has done before.
   */
  private readonly governorRing = new Float64Array(240);
  private governorSamples = 0;
  /** Sort scratch for the 1.4s governor tick, so the windowed p75 costs no allocation. */
  private readonly p75Window = new Float64Array(240);
  private readonly bypassPost: boolean;
  private readonly maxDpr: number;
  private width = 1; private height = 1; private adaptTime = 0;
  private elapsed = 0;
  private contextLost = false; private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, profile: ResortGameProfile, world: SimulationWorld, state: SimulationState, private readonly options: RendererOptions = {}) {
    // `?e2ecanvas` keeps the drawing buffer readable after compositing so an
    // automated check can sample the rendered frame. Without it a WebGL canvas
    // reads back as all-zeros outside the draw frame, which made the luminance
    // spec report a black canvas while the scene rendered perfectly.
    //
    // Deliberately NOT gated on NODE_ENV, unlike `?nopost` below: the e2e gate
    // runs against a production build, where a dev-only flag could never fire.
    // The cost is a slower present path for whoever opts in by typing the
    // parameter — no data or behaviour changes, and nothing links to it.
    const preserveDrawingBuffer =
      typeof location !== "undefined" && new URLSearchParams(location.search).has("e2ecanvas");
    this.renderer = options.backend ?? Object.assign(
      new THREE.WebGLRenderer({
        canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer,
      }),
      { backendKind: "webgl" as const },
    );
    // Our RAF owns a complete scene + shadow + post frame. Per-render-call reset
    // otherwise leaves only the final fullscreen triangle in renderer.info.
    if (this.renderer.info) this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Not gated on NODE_ENV, like ?e2ecanvas: the browser matrix is shot against a production build,
    // where a dev-only flag can never fire — which silently made an earlier bloom experiment a no-op.
    this.bypassPost = postBypassEnabled();
    this.maxDpr = Math.min(options.devicePixelRatio ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1), 2);
    const navigatorLike = typeof navigator === "undefined" ? undefined : navigator as Navigator & { deviceMemory?: number };
    const signals = options.qualitySignals ?? { hardwareConcurrency: navigatorLike?.hardwareConcurrency, deviceMemory: navigatorLike?.deviceMemory, coarsePointer: typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches, dpr: this.maxDpr };
    this.mobile = signals.coarsePointer;
    this.quality = new QualityController(seedQualityRung(signals));
    const snowDebug = snowDebugMode();
    // `nodes` is the one backend switch the scene needs: it is non-null exactly on WebGPU, and
    // carries the node-material factories that only that path fetches.
    const nodes = this.renderer.backendKind === "webgpu" ? options.nodeFactories ?? null : null;
    this.nodes = nodes;
    if (this.renderer.backendKind === "webgpu" && !nodes) {
      throw new Error("[Drop In] A WebGPU backend needs nodeFactories; await loadNodeFactories() before constructing GameRenderer.");
    }
    this.built = createScene(profile, Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight), nodes, this.quality.rung);
    this.terrain = new TerrainRenderer(this.built.scene, world, this.built.snowUniforms, nodes, snowDebug, this.quality.rung);
    this.skier = new SkierRenderer(this.built.scene);
    this.ghost = new GhostRenderer(this.built.scene);
    this.worldRenderer = new WorldRenderer(this.built.scene, profile, world);
    this.reducedMotion = options.reducedMotion ?? (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.effects = new EffectsRenderer(
      this.built.scene, world.seed, world.terrain, this.reducedMotion,
      world.config.sprayDepthMultiplier, nodes,
    );
    // Reading `?cam=` here, not inside CameraController, keeps that class pure and injectable.
    this.cameraController = new CameraController(
      this.built.camera, state, this.reducedMotion,
      options.cameraPreset ?? CAMERA_PRESETS[cameraPresetName()],
    );
    const debugWeather = typeof location !== "undefined" && new URLSearchParams(location.search).has("weather");
    this.weather = new WeatherRenderer(profile, this.built, this.renderer, debugWeather ? undefined : world.config.environment, debugWeather ? 12 : options.localHour);
    this.built.atmosphereUniforms.referenceHeight.value = state.pos.y;
    this.csm = nodes
      ? new nodes.csm.CsmShadowsNode(this.built.camera, this.built.scene, this.mobile, this.weather.current, visualWeatherPreset(this.weather.index))
      : new CsmShadows(this.built.camera, this.built.scene, this.mobile, this.weather.current, visualWeatherPreset(this.weather.index));
    this.built.sun.visible = false;
    // The node path shades fog and shadows from the scene graph, so the only per-material work
    // left is translating the height-fog opt-out that scene.fogNode does not honour.
    if (nodes) applyNodeFogOptOuts(this.built.scene);
    else configureSceneMaterials(this.built.scene, this.csm, this.built.atmosphereUniforms as Parameters<typeof addHeightFog>[1]);
    this.applyQuality(this.quality.rung);
    this.postReady = this.initializePost();
    this.canvas.addEventListener("webglcontextlost", this.onContextLost as EventListener, false);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored as EventListener, false);
    this.watchDeviceLoss();
    this.resize(canvas.clientWidth || (typeof window === "undefined" ? 1 : window.innerWidth), canvas.clientHeight || (typeof window === "undefined" ? 1 : window.innerHeight));
    this.terrain.update(state.pos.x, state.pos.z); this.worldRenderer.update(state, 0);
  }

  /**
   * Both chains are dynamically imported, and since the node materials moved behind
   * `loadNodeFactories()` the split is real: a WebGL session never fetches `three/webgpu`, and
   * `NodePostProcessing` lands in that same node chunk. `render()` falls back to a direct render
   * until the promise lands.
   */
  private async initializePost(): Promise<void> {
    try {
      await this.buildPost();
    } catch (reason) {
      // Losing the post chain costs the grade and the bloom, not the run.
      console.warn("[Drop In] Post-processing unavailable; rendering the raw scene.", reason);
      this.post = null;
    }
  }

  private async buildPost(): Promise<void> {
    if (this.renderer.backendKind === "webgpu") {
      const { NodePostProcessing } = await import("./NodePostProcessing");
      if (this.disposed) return;
      // `this.csm` is a `CsmShadowsNode` whenever `backendKind === "webgpu"`: the constructor
      // above only takes the `nodes` branch (which builds a `CsmShadowsNode`) on that backend,
      // and throws if webgpu lacks `nodes`. `.light` is that class's narrow accessor for exactly
      // this — godrays needs the CSM's directional light, not the shadow internals around it.
      this.post = new NodePostProcessing(
        this.renderer as unknown as ConstructorParameters<typeof NodePostProcessing>[0],
        this.built.scene, this.built.camera, this.cameraController.speedUniform, this.reducedMotion,
        (this.csm as CsmShadowsNode).light,
      );
    } else if (shouldInitializePostProcessing(this.options)) {
      const { PostProcessing } = await import("./PostProcessing");
      if (this.disposed) return;
      this.post = new PostProcessing(this.renderer as unknown as THREE.WebGLRenderer, this.built.scene, this.built.camera, this.cameraController.speedUniform, this.reducedMotion);
    } else return;
    this.post.setSize(this.width, this.height);
    this.post.setQuality(this.quality.rung);
  }

  /**
   * Compile every pipeline the run can reach before the first frame. Without this the first pass
   * through a rung — or the first frame a glint or a cascade appears — stalls mid-run while the
   * driver compiles. Compiles at the seeded rung, then once at rung 4 so the most expensive
   * variants are warm, then restores the rung.
   */
  async prewarm(): Promise<void> {
    await this.postReady;
    if (this.disposed || !this.renderer.compileAsync) return;
    const seeded = this.quality.rung;
    const warmup = { active: true };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.options.prewarmTimeoutMs ?? PREWARM_TIMEOUT_MS);
    });
    try {
      // A compileAsync that never settles must cost a stutter, not the run: the loading bar is
      // parked at 95% waiting on this, so it gets a budget and then we start regardless.
      await Promise.race([this.compileRungs(seeded, warmup), budget]);
    } finally {
      clearTimeout(timer);
      // Applying a compile tier does not mutate the governor. Always restore its live
      // value, and revoke the continuation before a timed-out compile can settle.
      warmup.active = false;
      if (!this.disposed) this.applyQuality(this.quality.rung);
    }
  }

  private async compileRungs(seeded: QualityRung, warmup: { active: boolean }): Promise<void> {
    if (seeded !== 4) {
      // Warm the expensive variants first, then come back to the rung we will actually start on —
      // restoring it last matters because CsmShadowsNode rebuilds its shadow node on a rung change,
      // so a compile taken before the restore would warm a node we then throw away.
      this.applyQuality(4);
      await this.renderer.compileAsync?.(this.built.scene, this.built.camera);
      if (this.disposed || !warmup.active) return;
      this.applyQuality(this.quality.rung);
    }
    await this.renderer.compileAsync?.(this.built.scene, this.built.camera);
  }

  /**
   * WebGPU has no `webglcontextlost` event; a lost device surfaces as a promise on the backend.
   * Same response as the WebGL path — stop rendering rather than draw into a dead device.
   */
  private watchDeviceLoss(): void {
    const device = (this.renderer as unknown as { backend?: { device?: { lost?: Promise<{ reason?: string }> } } }).backend?.device;
    void device?.lost?.then((info) => {
      if (this.disposed) return;
      console.warn("[Drop In] WebGPU device lost", info?.reason ?? "");
      this.contextLost = true;
    });
  }

  /**
   * p75 over roughly the last two seconds of frames. `frameTimes` grows for the whole run, so a
   * p75 across all of it would stop reflecting the device's current thermal state.
   */
  private windowedP75(): number {
    const ring = this.governorRing;
    const held = Math.min(this.governorSamples, ring.length);
    let count = 0, total = 0;
    for (let i = 0; i < held && total < 2000; i += 1) {
      const sample = ring[(this.governorSamples - 1 - i) % ring.length];
      this.p75Window[count] = sample; count += 1; total += sample;
    }
    if (count === 0) return 0;
    const window = this.p75Window.subarray(0, count);
    window.sort();
    return window[Math.floor((count - 1) * 0.75)];
  }

  resize(width: number, height: number): void { this.width = Math.max(1, width); this.height = Math.max(1, height); this.applySize(); }
  private applySize() { this.renderer.setPixelRatio(this.maxDpr * this.quality.pixelScale); this.renderer.setSize(this.width, this.height, false); this.post?.setSize(this.width, this.height); this.built.camera.aspect = this.width / this.height; this.built.camera.updateProjectionMatrix(); }

  private surfaceTextureLoader: (() => void) | null = null;
  private surfaceTextureLoadStarted = false;

  setSurfaceTextureLoader(load: () => void): void {
    if (this.disposed) return;
    this.surfaceTextureLoader = load;
    this.requestSurfaceTextures(this.quality.rung);
  }

  private requestSurfaceTextures(rung: QualityRung): void {
    if (rung < 3 || !this.surfaceTextureLoader || this.surfaceTextureLoadStarted) return;
    this.surfaceTextureLoadStarted = true;
    this.surfaceTextureLoader();
  }

  private applyQuality(rung: QualityRung): void {
    this.built.setSkyQuality?.(rung); this.terrain.setQuality(rung);
    this.requestSurfaceTextures(this.quality.rung);
    this.post?.setQuality(rung); this.csm.setQuality(rung); this.effects.setQuality(rung);
    // Snow glint is the top rung's signature, and it is the node path's to spend: the WebGL chain
    // reaches rung 4 on weaker hardware than WebGPU does, so it stays on the cheaper frame.
    const topRung = rung >= 4 && this.renderer.backendKind === "webgpu";
    this.built.snowUniforms.glint.value = topRung ? visualWeatherPreset(this.weather.index).glint : 0;
  }

  /** Which backend actually initialised — surfaced to the DOM so e2e can assert the matrix. */
  /** Opt-in debug caller only; pin the complete quality ladder for repeatable thermal inspection. */
  debugSetQuality(rung: QualityRung | null): void {
    this.debugQualityPinned = rung !== null;
    if (rung !== null) {
      this.quality.rung = rung;
      this.quality.pixelScale = 1;
      this.applyQuality(rung); this.applySize();
    }
    this.frameTimes.length = 0;
  }

  debugRendererInfo(): unknown {
    const info = this.renderer.info;
    return info ? JSON.parse(JSON.stringify({ render: info.render, memory: info.memory, calls: info.calls,
      // WebGPU render.calls is lifetime render invocations; drawCalls is the per-frame draw budget.
      frameDrawCalls: this.renderer.backendKind === "webgpu" ? info.render?.drawCalls : info.render?.calls,
      frameTriangles: info.render?.triangles,
    })) : null;
  }

  get backendKind(): "webgpu" | "webgl" { return this.renderer.backendKind; }

  /** Attach a decoded replay to render alongside the live skier, or `null` to clear it. */
  setGhost(ghost: DecodedGhost | null): void { this.ghost.setGhost(ghost); }

  noteLanding(kind: "soft" | "hard" | null): void { this.cameraController.noteLanding(kind); }

  setWeather(index: number): void { if (index < 0) this.weather.cycle(); else this.weather.apply(index); this.csm.setWeather(this.weather.current, visualWeatherPreset(this.weather.index)); this.applyQuality(this.quality.rung); }

  render(state: SimulationState, world: SimulationWorld, dt: number, tuck: number, frameMs = dt * 1000): void {
    if (this.disposed || this.contextLost) return;
    // Both initialized Three backends render synchronously here (not renderAsync).
    // Reset before CSM/scene/post work; all passes accumulate until the next RAF.
    this.renderer.info?.reset();
    this.adaptTime += dt; this.elapsed += dt;
    if (frameMs > 0) {
      if (this.frameTimes.length < 36_000) this.frameTimes.push(frameMs);
      this.governorRing[this.governorSamples % this.governorRing.length] = frameMs;
      this.governorSamples += 1;
    }
    // One gate, not two: this used to sit inside a 0.5s fps-counter tick left over from the
    // observe(fps) ladder, whose counters nothing read once the governor replaced it — and whose
    // only surviving effect was to round the adapt period up to 1.5s.
    if (!this.debugQualityPinned && this.adaptTime >= 1.4) {
      this.adaptTime = 0;
      // The governor replaces the twitchy observe(fps) ladder: sharing `rung` with both live
      // would let the fast path undo a governor step inside a single tick.
      // 45fps, not the plan's 58fps for desktop: the governor steps down whenever p75 exceeds
      // the budget, so a 58fps budget would treat an ordinary vsync-locked 60Hz display (16.7ms,
      // and above 17.2ms on any jitter) as distress and walk the ladder down to rung 0 — which
      // switches the whole poster chain off. 45fps preserves the step-down point the legacy
      // observe(fps) used.
      const budgetMs = 1000 / 45;
      const from = this.quality.rung;
      const quality = this.quality.observeFrameTimes(this.windowedP75(), budgetMs, this.elapsed);
      if (quality.changed) {
        this.applyQuality(quality.rung); this.applySize();
        // Not redundant with `changed`: at rung 0 the governor trades pixel scale instead of a
        // rung, and that step must resize without reporting a quality change that never happened.
        if (quality.rung !== from) this.options.onQualityChange?.({ reason: "governor", from, to: quality.rung });
      }
    }
    this.terrain.update(state.pos.x, state.pos.z); this.worldRenderer.update(state, dt); this.skier.update(state, world.terrain, dt); this.ghost.update(state.time, world.terrain);
    this.cameraController.update(state, world.terrain, dt, tuck);
    if (this.farField) {
      // Scratch matrix and frustum, reused: the cull is 16 box tests and zero allocation.
      this.built.camera.updateMatrixWorld();
      this.farFieldMatrix.multiplyMatrices(this.built.camera.projectionMatrix, this.built.camera.matrixWorldInverse);
      this.farFieldFrustum.setFromProjectionMatrix(this.farFieldMatrix);
      this.farField.update(this.built.camera.position, this.farFieldFrustum, state.pos);
    }
    this.effects.update(state, this.built.camera, dt, this.weather.current.snow, this.weather.windSpeed);
    this.built.atmosphereUniforms.referenceHeight.value = state.pos.y;
    this.built.skyUniforms.uTime.value += dt;
    const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
    this.built.snowUniforms.track.value.set(state.pos.x - fx * 8, state.pos.z - fz * 8, state.pos.x, state.pos.z);
    this.built.sky.position.copy(this.built.camera.position); this.built.peaks.position.copy(this.built.camera.position);
    sunPositionScratch.copy(this.built.camera.position).addScaledVector(SUN_DIRECTION, 2400);
    this.built.sunDisc.position.copy(sunPositionScratch); this.built.sunGlow.position.copy(sunPositionScratch);
    this.built.sun.position.set(state.pos.x, state.pos.y, state.pos.z).addScaledVector(SUN_DIRECTION, 150); this.built.sun.target.position.set(state.pos.x, state.pos.y, state.pos.z); this.built.sun.target.updateMatrixWorld();
    this.csm.update();
    if (this.post && !this.bypassPost) this.post.render(dt); else this.renderer.render(this.built.scene, this.built.camera);
  }

  performanceSummary(): RenderPerformanceSummary {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0;
    return { p50FrameMs: percentile(0.5), p95FrameMs: percentile(0.95), rung: this.quality.rung, dpr: this.maxDpr * this.quality.pixelScale, tier: this.mobile ? "mobile" : "desktop" };
  }

  takePerformanceSummary(): RenderPerformanceSummary { const summary = this.performanceSummary(); this.frameTimes.length = 0; return summary; }

  /**
   * Swap the procedural ridge bands for the baked far field. Called once the asset resolves, which
   * is necessarily *after* the constructor ran `configureSceneMaterials` — hence `configureMaterial`,
   * which gives this one material the same height fog the rest of the scene already has. Without it
   * the seam between near and far field reads as a colour step.
   *
   * Passing nothing is a no-op by construction: a resort with no asset simply keeps the ridge bands.
   */
  attachFarField(asset: DecodedFarField): void {
    if (this.disposed) return;
    this.farField?.dispose();
    this.farField = new FarFieldRenderer(this.built.scene, asset, {
      nodes: this.nodes,
      fallback: this.built.peaks,
      configureMaterial: (material) => {
        // WebGPU fogs from `scene.fogNode`, which needs nothing per material.
        if (this.renderer.backendKind === "webgpu") return;
        addHeightFog(material, this.built.atmosphereUniforms as Parameters<typeof addHeightFog>[1]);
      },
    });
  }

  get farFieldWedgesDrawn(): number { return this.farField?.visibleWedgeCount ?? 0; }

  /** The current governor rung; quality-gated callers read it before fetching an asset. */
  get rung(): QualityRung { return this.quality.rung; }

  /**
   * Swap the procedural snow detail normal for the real KTX2 pair once it resolves. Mirrors
   * `attachFarField`: optional, fire-and-forget from the caller's side, and a no-op past disposal
   * or below the rung `TerrainRenderer` gates on internally.
   */
  attachSurfaceTextures(surfaces: SurfaceTextures): void {
    if (this.disposed) { surfaces.snowNormal.dispose(); surfaces.snowRoughness.dispose(); return; }
    this.terrain.attachSurfaceTextures(surfaces);
  }

  /** Read-only handle for tests and debugging; the render loop owns everything in it. */
  get scene(): THREE.Scene { return this.built.scene; }

  resources(): ResourceCounts {
    const counts = resourceCounts(this.built.scene);
    counts.materials += this.terrain.inactiveMaterialCount;
    return counts;
  }

  private onContextLost = (event: Event) => { event.preventDefault(); this.contextLost = true; };
  private onContextRestored = () => { if (this.disposed) return; this.contextLost = false; this.renderer.resetState?.(); this.applySize(); };

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost as EventListener, false);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored as EventListener, false);
    this.post?.dispose(); this.post = null; this.csm.dispose(); this.ghost.setGhost(null);
    // Deliberately NOT farField.dispose(): its meshes are in the scene graph, so
    // `disposeObjectTree` releases them *and* reports them to the disposal audit. Disposing here
    // first would detach them silently and make the audit under-count.
    this.farField = null;
    this.surfaceTextureLoader = null;
    this.terrain.disposeInactiveMaterials(this.options.disposalAudit);
    disposeObjectTree(this.built.scene, this.options.disposalAudit); this.renderer.renderLists?.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss?.();
  }
}
