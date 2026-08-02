import * as THREE from "three";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import type { ResortWeather } from "../config/schema";
import type { VisualWeatherPreset } from "./VisualPresets";
import { SUN_DIRECTION } from "./SceneFactory";
import type { QualityRung } from "./QualityController";

/** The surface `Renderer` drives, shared by the WebGL `CsmShadows` and this node-pipeline twin. */
export interface ShadowSystem {
  setupMaterial(material: THREE.Material): void;
  setWeather(weather: ResortWeather, visual: VisualWeatherPreset): void;
  setQuality(rung: QualityRung): void;
  update(): void;
  dispose(): void;
}

const MAX_FAR = 250;
const SHADOW_BIAS = -0.0009;
const LIGHT_FAR = 520;
const LIGHT_MARGIN = 120;

/** Cascade count is fixed at construction, so this is what decides when a rebuild is needed. */
export function cascadeCountFor(mobile: boolean, rung: QualityRung): number {
  return mobile || rung < 3 ? 1 : 3;
}

/**
 * `CsmShadows` reimplemented on `CSMShadowNode`, which is the WebGPU-native CSM: it hangs off
 * `light.shadow.shadowNode` and is evaluated by the node pipeline rather than injected into every
 * material. Same public surface as `CsmShadows` so Task 6 only swaps the import.
 */
export class CsmShadowsNode implements ShadowSystem {
  readonly light: THREE.DirectionalLight;
  private shadowNode: CSMShadowNode;
  private cascades: number;
  private sunIntensity: number;

  constructor(
    /** Unused: CSMShadowNode reads the camera off the NodeBuilder. Kept for API parity. */
    _camera: THREE.PerspectiveCamera,
    private readonly scene: THREE.Scene,
    private readonly mobile: boolean,
    weather: ResortWeather,
    visual: VisualWeatherPreset,
  ) {
    this.sunIntensity = weather.sun;
    // Start at the platform's best, matching CsmShadows; Renderer calls setQuality right after.
    this.cascades = cascadeCountFor(mobile, 4);

    this.light = new THREE.DirectionalLight(visual.sunCol, weather.sun);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    this.light.shadow.bias = SHADOW_BIAS;
    this.light.shadow.camera.far = LIGHT_FAR;
    // CSMShadowNode derives the light direction from target minus position, and parents its
    // cascade placeholders to `light.parent` — so both objects must live in the scene.
    this.light.position.set(0, 0, 0);
    this.light.target.position.copy(SUN_DIRECTION).negate();
    this.scene.add(this.light, this.light.target);

    this.shadowNode = this.buildShadowNode();
    this.setWeather(weather, visual);
  }

  /**
   * No-op. The WebGL `CSM` had to patch every material's shader; `CSMShadowNode` works through the
   * light, so nothing per-material is needed. Kept so `Renderer.configureSceneMaterials` compiles
   * against either implementation.
   */
  setupMaterial(material: THREE.Material): void {
    void material;
  }

  setWeather(weather: ResortWeather, visual: VisualWeatherPreset): void {
    this.sunIntensity = weather.sun;
    this.light.color.setHex(visual.sunCol);
    this.applyLightBudget();
  }

  setQuality(rung: QualityRung): void {
    const cascades = cascadeCountFor(this.mobile, rung);
    if (cascades !== this.cascades) {
      this.cascades = cascades;
      this.shadowNode.dispose();
      this.shadowNode = this.buildShadowNode();
    }
    this.applyLightBudget();
  }

  /**
   * No-op. `CSMShadowNode` extends `ShadowBaseNode`, whose `updateBeforeType` is `RENDER`, so the
   * renderer re-fits the cascades to the camera itself every frame.
   */
  update(): void {}

  dispose(): void {
    this.shadowNode.dispose();
    this.scene.remove(this.light, this.light.target);
    this.light.dispose();
  }

  private buildShadowNode(): CSMShadowNode {
    const node = new CSMShadowNode(this.light, {
      cascades: this.cascades,
      maxFar: MAX_FAR,
      mode: "practical",
      lightMargin: LIGHT_MARGIN,
    });
    node.fade = !this.mobile;
    // Deliberately not setting node.camera: `setup()` only calls `_init()` while it is null, and
    // `_init()` is what creates the per-cascade shadow maps.
    this.light.shadow.shadowNode = node;
    return node;
  }

  /**
   * WebGL `CSM` parents one real `DirectionalLight` per cascade, each at `weather.sun`, so the
   * scene was lit by `cascades × sun`. `CSMShadowNode`'s cascade placeholders are bare `Object3D`s
   * that emit nothing. Directional light is linear, so a single light at the summed intensity
   * reproduces the old illumination exactly.
   */
  private applyLightBudget(): void {
    this.light.intensity = this.sunIntensity * this.cascades;
  }
}
