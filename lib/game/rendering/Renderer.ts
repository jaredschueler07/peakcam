import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import type { SimulationState, SimulationWorld } from "../core/types";
import { CameraController } from "./CameraController";
import { createScene } from "./SceneFactory";
import { TerrainRenderer } from "./TerrainRenderer";

export class GameRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly skier: THREE.Group;
  private readonly terrain: TerrainRenderer;
  private readonly cameraController: CameraController;

  constructor(canvas: HTMLCanvasElement, profile: ResortGameProfile, world: SimulationWorld, state: SimulationState) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const built = createScene(profile, Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight));
    this.scene = built.scene; this.camera = built.camera; this.skier = built.skier;
    this.terrain = new TerrainRenderer(this.scene, world);
    this.cameraController = new CameraController(this.camera, state);
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  render(state: SimulationState, world: SimulationWorld, dt: number, tuck: number): void {
    this.terrain.update(state.pos.x, state.pos.z);
    this.skier.position.set(state.pos.x, state.pos.y, state.pos.z);
    this.skier.rotation.set(state.crash > 0 ? 1.1 : 0, state.yaw, -state.lean * 0.45);
    this.cameraController.update(state, world.terrain, dt, tuck);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.terrain.dispose();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

