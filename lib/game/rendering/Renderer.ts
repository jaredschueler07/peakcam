import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import type { SimulationState, SimulationWorld } from "../core/types";
import type { DecodedGhost } from "../replay/codec";
import { CameraController } from "./CameraController";
import { addHeightFog } from "./Atmosphere";
import { CsmShadows } from "./CsmShadows";
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
import { visualWeatherPreset } from "./VisualPresets";

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
  readonly renderLists: { dispose(): void };
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  compileAsync?(scene: THREE.Object3D, camera: THREE.Camera): Promise<unknown>;
  dispose(): void;
  forceContextLoss?(): void;
  resetState?(): void;
}

interface RendererOptions {
  backend?: RendererBackend;
  devicePixelRatio?: number;
  reducedMotion?: boolean;
  disposalAudit?: DisposalAudit;
  qualitySignals?: DeviceQualitySignals;
}

/** The legacy renderer path owns PostProcessing; injected backends suppress it. */
export function shouldInitializePostProcessing(options: Pick<RendererOptions, "backend">): boolean {
  return !options.backend;
}

interface ShadowMaterialSetup { setupMaterial(material: THREE.Material): void }

export function configureSceneMaterials(scene: THREE.Scene, csm: ShadowMaterialSetup, atmosphere: Parameters<typeof addHeightFog>[1]): void {
  const materials = new Map<THREE.Material, boolean>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) materials.set(material, Boolean(materials.get(material)) || mesh.receiveShadow);
  });
  for (const [material, receivesShadow] of materials) {
    if (receivesShadow) csm.setupMaterial(material);
    if ((material as THREE.Material & { fog?: boolean }).fog !== false && !(material instanceof THREE.ShaderMaterial)) addHeightFog(material, atmosphere);
  }
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
  private readonly csm: CsmShadows;
  private post: PostProcessing | null = null;
  private readonly reducedMotion: boolean;
  private readonly mobile: boolean;
  private readonly frameTimes: number[] = [];
  private readonly bypassPost: boolean;
  private readonly maxDpr: number;
  private width = 1; private height = 1; private fpsTime = 0; private fpsFrames = 0; private adaptTime = 0;
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
    this.bypassPost = process.env.NODE_ENV !== "production" && typeof location !== "undefined" && new URLSearchParams(location.search).has("nopost");
    this.maxDpr = Math.min(options.devicePixelRatio ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1), 2);
    const navigatorLike = typeof navigator === "undefined" ? undefined : navigator as Navigator & { deviceMemory?: number };
    const signals = options.qualitySignals ?? { hardwareConcurrency: navigatorLike?.hardwareConcurrency, deviceMemory: navigatorLike?.deviceMemory, coarsePointer: typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches, dpr: this.maxDpr };
    this.mobile = signals.coarsePointer;
    this.quality = new QualityController(seedQualityRung(signals));
    this.built = createScene(profile, Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight));
    this.terrain = new TerrainRenderer(this.built.scene, world, this.built.snowUniforms);
    this.skier = new SkierRenderer(this.built.scene);
    this.ghost = new GhostRenderer(this.built.scene);
    this.worldRenderer = new WorldRenderer(this.built.scene, profile, world);
    this.reducedMotion = options.reducedMotion ?? (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.effects = new EffectsRenderer(
      this.built.scene, world.seed, world.terrain, this.reducedMotion,
      world.config.sprayDepthMultiplier,
    );
    this.cameraController = new CameraController(this.built.camera, state, this.reducedMotion);
    this.weather = new WeatherRenderer(profile, this.built, this.renderer);
    this.built.atmosphereUniforms.referenceHeight.value = state.pos.y;
    this.csm = new CsmShadows(this.built.camera, this.built.scene, this.mobile, this.weather.current, visualWeatherPreset(this.weather.index));
    this.built.sun.visible = false;
    configureSceneMaterials(this.built.scene, this.csm, this.built.atmosphereUniforms);
    this.applyQuality(this.quality.rung);
    if (shouldInitializePostProcessing(options)) {
      void import("./PostProcessing").then(({ PostProcessing: PostProcessingClass }) => {
        if (this.disposed) return;
        this.post = new PostProcessingClass(this.renderer as unknown as THREE.WebGLRenderer, this.built.scene, this.built.camera, this.cameraController.speedUniform, this.reducedMotion);
        this.post.setSize(this.width, this.height); this.post.setQuality(this.quality.rung);
      });
    }
    this.canvas.addEventListener("webglcontextlost", this.onContextLost as EventListener, false);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored as EventListener, false);
    this.resize(canvas.clientWidth || (typeof window === "undefined" ? 1 : window.innerWidth), canvas.clientHeight || (typeof window === "undefined" ? 1 : window.innerHeight));
    this.terrain.update(state.pos.x, state.pos.z); this.worldRenderer.update(state, 0);
  }

  resize(width: number, height: number): void { this.width = Math.max(1, width); this.height = Math.max(1, height); this.applySize(); }
  private applySize() { this.renderer.setPixelRatio(this.maxDpr * this.quality.pixelScale); this.renderer.setSize(this.width, this.height, false); this.post?.setSize(this.width, this.height); this.built.camera.aspect = this.width / this.height; this.built.camera.updateProjectionMatrix(); }

  private applyQuality(rung: QualityRung): void {
    this.post?.setQuality(rung); this.csm.setQuality(rung); this.effects.setQuality(rung);
    this.built.snowUniforms.glint.value = rung >= 4 ? visualWeatherPreset(this.weather.index).glint : 0;
  }

  /** Attach a decoded replay to render alongside the live skier, or `null` to clear it. */
  setGhost(ghost: DecodedGhost | null): void { this.ghost.setGhost(ghost); }

  setWeather(index: number): void { if (index < 0) this.weather.cycle(); else this.weather.apply(index); this.csm.setWeather(this.weather.current, visualWeatherPreset(this.weather.index)); this.applyQuality(this.quality.rung); }

  render(state: SimulationState, world: SimulationWorld, dt: number, tuck: number, frameMs = dt * 1000): void {
    if (this.disposed || this.contextLost) return;
    this.fpsTime += dt; this.fpsFrames += 1; this.adaptTime += dt;
    if (frameMs > 0 && this.frameTimes.length < 36_000) this.frameTimes.push(frameMs);
    if (this.fpsTime >= 0.5) {
      const fps = this.fpsFrames / this.fpsTime; this.fpsFrames = 0; this.fpsTime = 0;
      if (this.adaptTime >= 1.4) { this.adaptTime = 0; const quality = this.quality.observe(fps); if (quality.changed) { this.applyQuality(quality.rung); this.applySize(); } }
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
    disposeObjectTree(this.built.scene, this.options.disposalAudit); this.renderer.renderLists.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss?.();
  }
}
