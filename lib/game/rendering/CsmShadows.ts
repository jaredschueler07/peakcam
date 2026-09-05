import * as THREE from "three";
import { CSM } from "three/addons/csm/CSM.js";
import type { ResortWeather } from "../config/schema";
import type { VisualWeatherPreset } from "./VisualPresets";
import { SUN_DIRECTION } from "./SceneFactory";
import type { QualityRung } from "./QualityController";

/**
 * The far plane CSM is allowed to see, metres.
 *
 * `SceneFactory.CAMERA_FAR` went 6,000 → 34,000 so the 30 km far field is not clipped. That is
 * not shadow-neutral: three's CSM expands each cascade's shadow box by a fade margin of
 * `0.25 · z² / (max(camera.far, maxFar) - camera.near)`, so raising the camera's far plane
 * *shrinks* the margin — measured, 2.60 m → 0.46 m at the outermost cascade, a 5.7× narrower
 * cross-fade band and a harder cascade seam. `CsmShadows` sets `fade = !mobile`, so it would have
 * hit desktop WebGL only; the WebGPU path sets `fade = false` and is unaffected.
 *
 * `camera.far` reaches CSM in exactly one place — that margin. Everywhere else CSM clamps with
 * `Math.min(camera.far, maxFar)`, and `maxFar` (250) is smaller than either value. So pinning the
 * far plane across `updateFrustums()` — the only method that computes the margin — restores the
 * previous shadows exactly, with no per-frame cost and no stale-matrix risk.
 */
export const CSM_FAR_REFERENCE = 6000;

export class CsmShadows {
  private readonly csm: CSM;
  private fullCascades = true;
  private sunIntensity: number;

  constructor(private readonly camera: THREE.PerspectiveCamera, scene: THREE.Scene, private readonly mobile: boolean, weather: ResortWeather, visual: VisualWeatherPreset) {
    this.sunIntensity = weather.sun;
    this.csm = new CSM({
      camera, parent: scene, cascades: mobile ? 1 : 2, mode: "practical", maxFar: 250,
      shadowMapSize: mobile ? 1024 : 1536, lightDirection: SUN_DIRECTION.clone().negate(),
      lightIntensity: weather.sun, shadowBias: -0.0009, lightFar: 520, lightMargin: 120,
    });
    this.csm.fade = !mobile;
    this.updateFrustums();
    this.setWeather(weather, visual);
  }

  setupMaterial(material: THREE.Material): void {
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey.bind(material);
    this.csm.setupMaterial(material);
    const csmCompile = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      csmCompile.call(material, shader, renderer);
      previous.call(material, shader, renderer);
    };
    material.customProgramCacheKey = () => `${previousKey()}|peakcam-csm-${this.csm.cascades}-${this.csm.fade ? "fade" : "hard"}`;
    material.needsUpdate = true;
  }

  setWeather(weather: ResortWeather, visual: VisualWeatherPreset): void {
    this.sunIntensity = weather.sun;
    for (const light of this.csm.lights) light.color.setHex(visual.sunCol);
    this.applyLightBudget();
  }

  setQuality(rung: QualityRung): void {
    const fullCascades = !this.mobile && rung >= 3;
    if (!this.mobile && fullCascades !== this.fullCascades) {
      this.fullCascades = fullCascades;
      if (fullCascades) this.csm.mode = "practical";
      else { this.csm.mode = "custom"; this.csm.customSplitsCallback = (_count, _near, _far, target) => target.push(1, 1); }
      this.updateFrustums();
    }
    this.applyLightBudget();
  }

  private applyLightBudget(): void {
    this.csm.lights.forEach((light, index) => {
      const active = index === 0 || this.fullCascades;
      light.visible = true; light.castShadow = active; light.intensity = active ? this.sunIntensity : 0;
    });
  }

  /** See {@link CSM_FAR_REFERENCE}: the only method that reads `camera.far`, so the only one to pin. */
  private updateFrustums(): void {
    const actual = this.camera.far;
    this.camera.far = Math.min(actual, CSM_FAR_REFERENCE);
    try { this.csm.updateFrustums(); } finally { this.camera.far = actual; }
  }

  /**
   * Each cascade's shadow-camera box as `[left, right, top, bottom]`. Exposed so a test can pin
   * that {@link CSM_FAR_REFERENCE} really does keep the cascades independent of `camera.far`.
   */
  cascadeExtents(): Array<[number, number, number, number]> {
    return this.csm.lights.map((light) => {
      const cam = light.shadow.camera;
      return [cam.left, cam.right, cam.top, cam.bottom] as [number, number, number, number];
    });
  }

  update(): void { this.csm.update(); }
  dispose(): void { this.csm.remove(); this.csm.dispose(); }
}
