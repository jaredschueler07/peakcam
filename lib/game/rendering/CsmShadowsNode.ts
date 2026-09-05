import * as THREE from "three";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import type { ResortWeather } from "../config/schema";
import type { VisualWeatherPreset } from "./VisualPresets";
import { SUN_DIRECTION } from "./SceneFactory";
import type { QualityRung } from "./QualityController";
import { CSM_DEBUG, csmDebugMode } from "./debugFlags";

/** The surface `Renderer` drives, shared by the WebGL `CsmShadows` and this node-pipeline twin. */
export interface ShadowSystem {
  setupMaterial(material: THREE.Material): void;
  setWeather(weather: ResortWeather, visual: VisualWeatherPreset): void;
  setQuality(rung: QualityRung): void;
  update(): void;
  dispose(): void;
}

// Two 1536px cascades retain 250m coverage while cutting shadow-map pixels
// by 62.5% versus three 2048px maps; low/mobile quality retains one cascade.
const MAX_FAR = 250;
const SHADOW_BIAS = -0.0009;
const LIGHT_FAR = 520;
const LIGHT_MARGIN = 120;

/** Cascade count is fixed at construction, so this is what decides when a rebuild is needed. */
export function cascadeCountFor(mobile: boolean, rung: QualityRung): number {
  return mobile || rung < 3 ? 1 : 2;
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
    // `?csmdbg=1` keeps the light but drops the shadow node entirely, partitioning "the light is
    // wrong" from "the cascades are wrong" in a single frame.
    this.light.castShadow = csmDebugMode() !== CSM_DEBUG.NO_SHADOW;
    this.light.shadow.mapSize.set(mobile ? 1024 : 1536, mobile ? 1024 : 1536);
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
      cascades: csmDebugMode() === CSM_DEBUG.ONE_CASCADE ? 1 : this.cascades,
      maxFar: MAX_FAR,
      mode: "practical",
      lightMargin: LIGHT_MARGIN,
    });
    // Fade stays OFF, unlike the WebGL path. The two implementations accumulate differently:
    // `CSMShader`'s fade branch *blends* (`mix(prevLight, reflectedLight, ratio)`), which is
    // bounded, while `CSMShadowNode._setupFade` *subtracts* into one shared value
    // (`ret.subAssign(shadowNode.oneMinus().mul(ratio))`). Cascade ranges overlap by their margins,
    // so two shadowed cascades each subtract up to 1.0 from a value that started at 1.0 and drive
    // it negative — black, at a hard cascade-shaped distance boundary. `_setupStandard` assigns
    // from a single cascade and starts fully lit, so it cannot go below zero. The cost is a harder
    // seam between cascades instead of a cross-fade.
    node.fade = false;
    // Deliberately not setting node.camera: `setup()` only calls `_init()` while it is null, and
    // `_init()` is what creates the per-cascade shadow maps.
    this.light.shadow.shadowNode = node;
    return node;
  }

  /**
   * One light's worth, not `cascades ×`. The WebGL `CSM` does parent a real `DirectionalLight` per
   * cascade, but its shader chunk gates `RE_Direct` inside the cascade's depth test
   * (`CSMShader.js:190`), so **exactly one** of them lights any given fragment — three's own comment
   * puts it plainly: "all CSM lights are in fact one light only". Summing them tripled the key
   * light, which blew out the near field on WebGPU and is the residual brightness on Portillo.
   */
  private applyLightBudget(): void {
    this.light.intensity = this.sunIntensity;
  }
}
