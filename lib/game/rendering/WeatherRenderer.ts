import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import type { RendererBackend } from "./Renderer";
import type { GameScene } from "./SceneFactory";
import { visualWeatherPreset } from "./VisualPresets";

/**
 * Weather is event-driven only (`apply` / `cycle` on player input) — there is
 * no per-frame path. Mutations write into existing Three.js color/uniform
 * objects so a weather change never constructs new Color instances.
 */
export class WeatherRenderer {
  index = 0;
  constructor(private readonly profile: ResortGameProfile, private readonly built: GameScene, private readonly renderer: RendererBackend) { this.apply(0); }
  apply(index: number) {
    this.index = (index + this.profile.weather.length) % this.profile.weather.length;
    const weather = this.profile.weather[this.index], visual = visualWeatherPreset(this.index);
    const fog = this.built.scene.fog as THREE.FogExp2;
    fog.color.setHex(weather.fogCol); fog.density = weather.fog;
    (this.built.skyUniforms.uTop.value as THREE.Color).setHex(weather.top);
    (this.built.skyUniforms.uMid.value as THREE.Color).setHex(visual.mid);
    (this.built.skyUniforms.uHorizon.value as THREE.Color).setHex(weather.hor);
    (this.built.skyUniforms.uCloud.value as THREE.Color).setHex(visual.cloud);
    (this.built.skyUniforms.uSun.value as THREE.Color).setHex(visual.sunCol);
    this.built.skyUniforms.uCloudiness.value = visual.cloudiness;
    this.built.skyUniforms.uHaze.value = weather.haze;
    this.built.sun.color.setHex(visual.sunCol);
    this.built.hemi.color.setHex(visual.hemiSky);
    this.built.hemi.groundColor.setHex(visual.hemiGround);
    this.built.ambient.color.setHex(visual.ambientCol);
    this.built.sun.intensity = weather.sun;
    this.built.hemi.intensity = weather.hemi;
    this.built.ambient.intensity = weather.amb;
    this.built.snowUniforms.horizon.value.setHex(weather.hor);
    this.built.snowUniforms.glint.value = visual.glint;
    this.built.atmosphereUniforms.density.value = weather.fog;
    this.built.atmosphereUniforms.blue.value.setHex(visual.fogBlue);
    this.built.atmosphereUniforms.warm.value.setHex(visual.fogWarm);
    this.renderer.toneMappingExposure = weather.exposure;
    this.built.sunDisc.visible = this.built.sunGlow.visible = this.index === 0;
    for (const peak of this.built.peaks.children) peak.visible = this.index < 2;
    this.renderer.setClearColor(weather.fogCol, 1);
  }
  cycle() { this.apply(this.index + 1); }
  get current() { return this.profile.weather[this.index]; }
}
