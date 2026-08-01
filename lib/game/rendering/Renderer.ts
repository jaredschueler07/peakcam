import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import type { SimulationState, SimulationWorld } from "../core/types";
import { AdaptiveResolution } from "./AdaptiveResolution";
import { CameraController } from "./CameraController";
import { EffectsRenderer } from "./EffectsRenderer";
import { disposeObjectTree, resourceCounts, type DisposalAudit, type ResourceCounts } from "./resources";
import { createScene, SUN_DIRECTION } from "./SceneFactory";
import { SkierRenderer } from "./SkierRenderer";
import { TerrainRenderer } from "./TerrainRenderer";
import { WeatherRenderer } from "./WeatherRenderer";
import { WorldRenderer } from "./WorldRenderer";

export interface RendererBackend {
  outputColorSpace: THREE.ColorSpace;
  toneMapping: THREE.ToneMapping;
  toneMappingExposure: number;
  readonly shadowMap: { enabled: boolean; type: THREE.ShadowMapType };
  readonly renderLists: { dispose(): void };
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
  forceContextLoss(): void;
  resetState?(): void;
}

interface RendererOptions {
  backend?: RendererBackend;
  devicePixelRatio?: number;
  reducedMotion?: boolean;
  disposalAudit?: DisposalAudit;
}

export class GameRenderer {
  private readonly renderer: RendererBackend;
  private readonly built: ReturnType<typeof createScene>;
  private readonly terrain: TerrainRenderer;
  private readonly skier: SkierRenderer;
  private readonly worldRenderer: WorldRenderer;
  private readonly effects: EffectsRenderer;
  private readonly cameraController: CameraController;
  private readonly weather: WeatherRenderer;
  private readonly adaptive = new AdaptiveResolution();
  private readonly maxDpr: number;
  private width = 1; private height = 1; private fpsTime = 0; private fpsFrames = 0; private adaptTime = 0;
  private contextLost = false; private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, profile: ResortGameProfile, world: SimulationWorld, state: SimulationState, private readonly options: RendererOptions = {}) {
    this.renderer = options.backend ?? new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.maxDpr = Math.min(options.devicePixelRatio ?? (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1), 2);
    this.built = createScene(profile, Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight));
    this.terrain = new TerrainRenderer(this.built.scene, world);
    this.skier = new SkierRenderer(this.built.scene);
    this.worldRenderer = new WorldRenderer(this.built.scene, profile, world);
    const reducedMotion = options.reducedMotion ?? (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    this.effects = new EffectsRenderer(this.built.scene, world.seed, world.terrain, reducedMotion);
    this.cameraController = new CameraController(this.built.camera, state, reducedMotion);
    this.weather = new WeatherRenderer(profile, this.built, this.renderer);
    this.canvas.addEventListener("webglcontextlost", this.onContextLost as EventListener, false);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored as EventListener, false);
    this.resize(canvas.clientWidth || (typeof window === "undefined" ? 1 : window.innerWidth), canvas.clientHeight || (typeof window === "undefined" ? 1 : window.innerHeight));
    this.terrain.update(state.pos.x, state.pos.z); this.worldRenderer.update(state, 0);
  }

  resize(width: number, height: number): void { this.width = Math.max(1, width); this.height = Math.max(1, height); this.applySize(); }
  private applySize() { this.renderer.setPixelRatio(Math.max(0.55, this.maxDpr * this.adaptive.scale)); this.renderer.setSize(this.width, this.height, false); this.built.camera.aspect = this.width / this.height; this.built.camera.updateProjectionMatrix(); }

  setWeather(index: number): void { if (index < 0) this.weather.cycle(); else this.weather.apply(index); }

  render(state: SimulationState, world: SimulationWorld, dt: number, tuck: number): void {
    if (this.disposed || this.contextLost) return;
    this.fpsTime += dt; this.fpsFrames += 1; this.adaptTime += dt;
    if (this.fpsTime >= 0.5) {
      const fps = this.fpsFrames / this.fpsTime; this.fpsFrames = 0; this.fpsTime = 0;
      if (this.adaptTime >= 1.4) { this.adaptTime = 0; const before = this.adaptive.scale; this.adaptive.observe(fps); if (before !== this.adaptive.scale) this.applySize(); }
    }
    this.terrain.update(state.pos.x, state.pos.z); this.worldRenderer.update(state, dt); this.skier.update(state, world.terrain, dt);
    this.cameraController.update(state, world.terrain, dt, tuck);
    this.effects.update(state, this.built.camera, dt, this.weather.current.snow, this.weather.current.wind);
    this.built.sky.position.copy(this.built.camera.position); this.built.peaks.position.copy(this.built.camera.position);
    const sunPosition = this.built.camera.position.clone().addScaledVector(SUN_DIRECTION, 2400); this.built.sunDisc.position.copy(sunPosition); this.built.sunGlow.position.copy(sunPosition);
    this.built.sun.position.set(state.pos.x, state.pos.y, state.pos.z).addScaledVector(SUN_DIRECTION, 150); this.built.sun.target.position.set(state.pos.x, state.pos.y, state.pos.z); this.built.sun.target.updateMatrixWorld();
    this.renderer.render(this.built.scene, this.built.camera);
  }

  resources(): ResourceCounts { return resourceCounts(this.built.scene); }

  private onContextLost = (event: Event) => { event.preventDefault(); this.contextLost = true; };
  private onContextRestored = () => { if (this.disposed) return; this.contextLost = false; this.renderer.resetState?.(); this.applySize(); };

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost as EventListener, false);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored as EventListener, false);
    disposeObjectTree(this.built.scene, this.options.disposalAudit); this.renderer.renderLists.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
  }
}
