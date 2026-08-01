import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import type { RendererBackend } from "./Renderer";
import type { GameScene } from "./SceneFactory";

export class WeatherRenderer {
  index = 0;
  constructor(private readonly profile: ResortGameProfile, private readonly built: GameScene, private readonly renderer: RendererBackend) { this.apply(0); }
  apply(index: number) { this.index = (index + this.profile.weather.length) % this.profile.weather.length; const weather = this.profile.weather[this.index], fog = this.built.scene.fog as THREE.FogExp2; fog.color.setHex(weather.fogCol); fog.density = weather.fog; (this.built.skyUniforms.uTop.value as THREE.Color).setHex(weather.top); (this.built.skyUniforms.uHorizon.value as THREE.Color).setHex(weather.hor); this.built.skyUniforms.uHaze.value = weather.haze; this.built.sun.intensity = weather.sun; this.built.hemi.intensity = weather.hemi; this.built.ambient.intensity = weather.amb; this.renderer.toneMappingExposure = weather.exposure; this.built.sunDisc.visible = this.built.sunGlow.visible = this.index === 0; for (const peak of this.built.peaks.children) peak.visible = this.index < 2; this.renderer.setClearColor(weather.fogCol, 1); }
  cycle() { this.apply(this.index + 1); }
  get current() { return this.profile.weather[this.index]; }
}
