import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import type { SimulationState, SimulationWorld } from "../core/types";
import type { DecodedGhost } from "../replay/codec";
import { CameraController } from "./CameraController";
import { addHeightFog } from "./Atmosphere";
import { CsmShadows } from "./CsmShadows";
import type { ShadowSystem } from "./CsmShadowsNode";
import { EffectsRenderer } from "./EffectsRenderer";
import { GhostRenderer } from "./GhostRenderer";
import { disposeObjectTree, resourceCounts, type DisposalAudit, type ResourceCounts } from "./resources";
import { createScene, SUN_DIRECTION } from "./SceneFactory";
import { SkierRenderer } from "./SkierRenderer";
import { TerrainRenderer } from "./TerrainRenderer";
import { WeatherRenderer } from "./WeatherRenderer";
import { WorldRenderer } from "./WorldRenderer";
import { QualityController, seedQualityRung, type DeviceQualitySignals, type QualityRung } from "./QualityController";
import type { PostProcessing } from "./PostProcessing";
import type { NodePostProcessing } from "./NodePostProcessing";
import type { NodeFactories } from "./nodeFactories";
import { visualWeatherPreset } from "./VisualPresets";
import { postBypassEnabled, snowDebugMode } from "./debugFlags";

type PostChain = Pick<PostProcessing | NodePostProcessing, "setSize" | "setQuality" | "render" | "dispose">;

/** How long pre-warm may hold the loading bar at 95% before starting anyway. */
const PREWARM_TIMEOUT_MS = 4000;

/** Module-scope scratch — `render()` must not allocate a Vector3 per frame. */
const sunPositionScratch = new THREE.Vector3();

export interface RendererBackend {
  readonly backendKind: "webgpu" | "webgl";
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
  private readonly effects: EffectsRenderer;
  private readonly cameraController: CameraController;
  private readonly weather: WeatherRenderer;
  private readonly quality: QualityController;
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
    if (this.renderer.backendKind === "webgpu" && !nodes) {
      throw new Error("[Drop In] A WebGPU backend needs nodeFactories; await loadNodeFactories() before constructing GameRenderer.");
    }
    this.built = createScene(profile, Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight), nodes);
    this.terrain = new TerrainRenderer(this.built.scene, world, this.built.snowUniforms, nodes, snowDebug);
    this.skier = new SkierRenderer(this.built.scene);
    this.ghost = new GhostRenderer(this.built.scene);
    this.worldRenderer = new WorldRenderer(this.built.scene, profile, world);
    this.reducedMotion = options.reducedMotion ?? (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.effects = new EffectsRenderer(
      this.built.scene, world.seed, world.terrain, this.reducedMotion,
      world.config.sprayDepthMultiplier, nodes,
    );
    this.cameraController = new CameraController(this.built.camera, state, this.reducedMotion);
    this.weather = new WeatherRenderer(profile, this.built, this.renderer);
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
      this.post = new NodePostProcessing(
        this.renderer as unknown as ConstructorParameters<typeof NodePostProcessing>[0],
        this.built.scene, this.built.camera, this.cameraController.speedUniform, this.reducedMotion,
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.options.prewarmTimeoutMs ?? PREWARM_TIMEOUT_MS);
    });
    try {
      // A compileAsync that never settles must cost a stutter, not the run: the loading bar is
      // parked at 95% waiting on this, so it gets a budget and then we start regardless.
      await Promise.race([this.compileRungs(seeded), budget]);
    } finally {
      clearTimeout(timer);
      // If the budget won mid-sequence the rung can be left at 4; put it back.
      if (!this.disposed && this.quality.rung !== seeded) this.applyQuality(seeded);
    }
  }

  private async compileRungs(seeded: QualityRung): Promise<void> {
    if (seeded !== 4) {
      // Warm the expensive variants first, then come back to the rung we will actually start on —
      // restoring it last matters because CsmShadowsNode rebuilds its shadow node on a rung change,
      // so a compile taken before the restore would warm a node we then throw away.
      this.applyQuality(4);
      await this.renderer.compileAsync?.(this.built.scene, this.built.camera);
      if (this.disposed) return;
      this.applyQuality(seeded);
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

  private applyQuality(rung: QualityRung): void {
    this.post?.setQuality(rung); this.csm.setQuality(rung); this.effects.setQuality(rung);
    // Snow glint is the top rung's signature, and it is the node path's to spend: the WebGL chain
    // reaches rung 4 on weaker hardware than WebGPU does, so it stays on the cheaper frame.
    const topRung = rung >= 4 && this.renderer.backendKind === "webgpu";
    this.built.snowUniforms.glint.value = topRung ? visualWeatherPreset(this.weather.index).glint : 0;
  }

  /** Which backend actually initialised — surfaced to the DOM so e2e can assert the matrix. */
  get backendKind(): "webgpu" | "webgl" { return this.renderer.backendKind; }

  /** Attach a decoded replay to render alongside the live skier, or `null` to clear it. */
  setGhost(ghost: DecodedGhost | null): void { this.ghost.setGhost(ghost); }

  setWeather(index: number): void { if (index < 0) this.weather.cycle(); else this.weather.apply(index); this.csm.setWeather(this.weather.current, visualWeatherPreset(this.weather.index)); this.applyQuality(this.quality.rung); }

  render(state: SimulationState, world: SimulationWorld, dt: number, tuck: number, frameMs = dt * 1000): void {
    if (this.disposed || this.contextLost) return;
    this.adaptTime += dt; this.elapsed += dt;
    if (frameMs > 0) {
      if (this.frameTimes.length < 36_000) this.frameTimes.push(frameMs);
      this.governorRing[this.governorSamples % this.governorRing.length] = frameMs;
      this.governorSamples += 1;
    }
    // One gate, not two: this used to sit inside a 0.5s fps-counter tick left over from the
    // observe(fps) ladder, whose counters nothing read once the governor replaced it — and whose
    // only surviving effect was to round the adapt period up to 1.5s.
    if (this.adaptTime >= 1.4) {
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
    this.effects.update(state, this.built.camera, dt, this.weather.current.snow, this.weather.current.wind);
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

  resources(): ResourceCounts { return resourceCounts(this.built.scene); }

  private onContextLost = (event: Event) => { event.preventDefault(); this.contextLost = true; };
  private onContextRestored = () => { if (this.disposed) return; this.contextLost = false; this.renderer.resetState?.(); this.applySize(); };

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost as EventListener, false);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored as EventListener, false);
    this.post?.dispose(); this.post = null; this.csm.dispose(); this.ghost.setGhost(null);
    disposeObjectTree(this.built.scene, this.options.disposalAudit); this.renderer.renderLists?.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss?.();
  }
}
