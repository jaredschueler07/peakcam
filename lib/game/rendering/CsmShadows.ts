import * as THREE from "three";
import { CSM } from "three/addons/csm/CSM.js";
import type { ResortWeather } from "../config/schema";
import type { VisualWeatherPreset } from "./VisualPresets";
import { SUN_DIRECTION } from "./SceneFactory";
import type { QualityRung } from "./QualityController";

export class CsmShadows {
  private readonly csm: CSM;
  private fullCascades = true;
  private sunIntensity: number;

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, private readonly mobile: boolean, weather: ResortWeather, visual: VisualWeatherPreset) {
    this.sunIntensity = weather.sun;
    this.csm = new CSM({
      camera, parent: scene, cascades: mobile ? 1 : 3, mode: "practical", maxFar: 250,
      shadowMapSize: mobile ? 1024 : 2048, lightDirection: SUN_DIRECTION.clone().negate(),
      lightIntensity: weather.sun, shadowBias: -0.0009, lightFar: 520, lightMargin: 120,
    });
    this.csm.fade = !mobile;
    this.csm.updateFrustums();
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
      else { this.csm.mode = "custom"; this.csm.customSplitsCallback = (_count, _near, _far, target) => target.push(1, 1, 1); }
      this.csm.updateFrustums();
    }
    this.applyLightBudget();
  }

  private applyLightBudget(): void {
    this.csm.lights.forEach((light, index) => {
      const active = index === 0 || this.fullCascades;
      light.visible = true; light.castShadow = active; light.intensity = active ? this.sunIntensity : 0;
    });
  }

  update(): void { this.csm.update(); }
  dispose(): void { this.csm.remove(); this.csm.dispose(); }
}
