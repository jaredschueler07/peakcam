/**
 * lib/descent/render/Renderer.ts
 * ──────────────────────────────
 * Owns the WebGL renderer, the scene, the camera and every render module,
 * and draws one frame when asked. Also watches its own frame times and
 * steps the quality rung down (resolution scale, shadows, snow density) when
 * the device can't hold ~55 fps, then back up when it can.
 */

import * as THREE from "three";
import type { CameraPreset, DescentPhase, RiderMode, RiderState, RiderStyle, SnowboardStance, World } from "../types";
import type { RenderFrame, RenderModule } from "./frame";
import { ChaseCamera } from "./Camera";
import { FarField } from "./FarField";
import { Lake } from "./Lake";
import { Lanes } from "./Lanes";
import { Lifts } from "./Lifts";
import { Particles } from "./Particles";
import { RiderMesh, type GhostPose } from "./RiderMesh";
import { Signs } from "./Signs";
import { Sky } from "./Sky";
import { TerrainMesh } from "./TerrainMesh";
import { Tracks } from "./Tracks";
import { Trees } from "./Trees";

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  world: World;
  riderStyle: RiderStyle;
  riderMode?: RiderMode;
  stance?: SnowboardStance;
  /** Start at the lowest rung and never adapt (the settings "low" toggle). */
  forceLowQuality?: boolean;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly chase: ChaseCamera;
  readonly terrain: TerrainMesh;
  readonly sky: Sky;
  readonly tracks: Tracks;
  readonly particles: Particles;
  readonly rider: RiderMesh;
  private ghost: RiderMesh | null = null;
  private readonly modules: RenderModule[] = [];
  private readonly world: World;
  private quality: 0 | 1 | 2 = 0;
  private readonly forceLow: boolean;
  private readonly frameTimes: number[] = [];
  private lastAdapt = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private readonly resize: ResizeObserver | null = null;
  readonly gpuLabel: string;
  /** Last frame's per-module update cost in ms (dev diagnostics; read via `window.__descent`). */
  readonly timings: Record<string, number> = {};

  constructor(options: RendererOptions) {
    const { canvas, world } = options;
    this.world = world;
    this.forceLow = options.forceLowQuality ?? false;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", alpha: false, stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.82;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.setClearColor(0xdde8f5, 1);
    this.gpuLabel = describeGpu(this.gl);

    this.chase = new ChaseCamera(world, 1);
    this.sky = new Sky(this.scene, world);
    this.terrain = new TerrainMesh(this.scene, world);
    const farField = new FarField(this.scene, world);
    const trees = new Trees(this.scene, world);
    const lifts = new Lifts(this.scene, world);
    const signs = new Signs(this.scene, world);
    const lake = new Lake(this.scene, world);
    const lanes = new Lanes(this.scene, world);
    this.tracks = new Tracks(this.scene, world);
    this.particles = new Particles(this.scene, world);
    this.rider = new RiderMesh(this.scene, world, options.riderStyle, { riderMode: options.riderMode, stance: options.stance });
    this.modules.push(this.sky, this.terrain, farField, trees, lifts, lake, lanes, signs, this.tracks, this.rider, this.particles);

    if (this.forceLow) this.setQuality(2);
    if (typeof ResizeObserver !== "undefined") {
      this.resize = new ResizeObserver(() => this.fit());
      this.resize.observe(canvas.parentElement ?? canvas);
    }
    this.fit();
  }

  get qualityRung(): 0 | 1 | 2 { return this.quality; }

  private fit(): void {
    const canvas = this.gl.domElement;
    const parent = canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? canvas.clientWidth ?? 1);
    const h = Math.max(1, parent?.clientHeight ?? canvas.clientHeight ?? 1);
    this.width = w; this.height = h;
    this.applySize();
  }

  private applySize(): void {
    const base = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    const scale = this.quality === 0 ? 1 : this.quality === 1 ? 0.8 : 0.62;
    this.dpr = base * scale;
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(this.width, this.height, false);
    this.chase.setAspect(this.width / this.height);
  }

  private setQuality(rung: 0 | 1 | 2): void {
    if (rung === this.quality) return;
    this.quality = rung;
    this.gl.shadowMap.enabled = rung < 2;
    this.sky.sun.castShadow = rung < 2;
    this.sky.sun.shadow.mapSize.set(rung === 0 ? 2048 : 1024, rung === 0 ? 2048 : 1024);
    this.sky.sun.shadow.map?.dispose();
    this.sky.sun.shadow.map = null;
    this.applySize();
  }

  /** Watch frame time and move the quality rung, at most once every two seconds. */
  private adapt(frameMs: number, now: number): void {
    if (this.forceLow) return;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now - this.lastAdapt < 2000 || this.frameTimes.length < 60) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    if (p75 > 22 && this.quality < 2) { this.setQuality((this.quality + 1) as 1 | 2); this.lastAdapt = now; this.frameTimes.length = 0; }
    else if (p75 < 11 && this.quality > 0) { this.setQuality((this.quality - 1) as 0 | 1); this.lastAdapt = now; this.frameTimes.length = 0; }
  }

  setGhost(style: RiderStyle | null): void {
    if (this.ghost) { this.ghost.dispose(); this.ghost = null; }
    if (style) this.ghost = new RiderMesh(this.scene, this.world, style, { ghost: true });
  }

  setGhostPose(pose: GhostPose): void { this.ghost?.setGhostPose(pose); }

  /** Called when the camera should be re-seated instantly (start, reset, preset change). */
  snapCamera(state: RiderState): void { this.chase.snap(state); }

  render(input: {
    state: RiderState; time: number; dt: number; phase: DescentPhase; cameraPreset: CameraPreset;
    weatherIndex: number; courseIndex: number; trailHint: boolean;
  }): void {
    const started = performance.now();
    this.chase.preset = input.cameraPreset;
    this.chase.update(input.state, input.dt, input.phase === "menu" ? "menu" : "ride");
    const frame: RenderFrame = {
      state: input.state, world: this.world, time: input.time, dt: input.dt, camera: this.chase.camera,
      cameraPreset: input.cameraPreset, weather: this.world.profile.weather[input.weatherIndex] ?? this.world.profile.weather[0],
      weatherIndex: input.weatherIndex, phase: input.phase, courseIndex: input.courseIndex, trailHint: input.trailHint, quality: this.quality,
    };
    for (const part of this.modules) {
      const t = performance.now();
      part.update(frame);
      this.timings[part.constructor.name] = performance.now() - t;
    }
    // In the helmet view the rider body would fill the lens.
    this.rider.root.visible = input.cameraPreset !== "helmet";
    const t = performance.now();
    this.gl.render(this.scene, this.chase.camera);
    this.timings.draw = performance.now() - t;
    this.timings.frame = performance.now() - started;
    this.adapt(this.timings.frame, started);
  }

  dispose(): void {
    this.resize?.disconnect();
    this.ghost?.dispose();
    for (const part of this.modules) part.dispose();
    this.gl.dispose();
  }
}

function describeGpu(gl: THREE.WebGLRenderer): string {
  try {
    const context = gl.getContext() as WebGL2RenderingContext;
    const info = context.getExtension("WEBGL_debug_renderer_info");
    const label = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "WebGL2";
    return label.replace(/ANGLE \((.*)\)/, "$1").split(",").slice(0, 2).join(",").slice(0, 60);
  } catch {
    return "WebGL2";
  }
}
