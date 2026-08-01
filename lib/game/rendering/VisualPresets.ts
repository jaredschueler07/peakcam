export interface VisualWeatherPreset {
  sunCol: number;
  hemiSky: number;
  hemiGround: number;
  ambientCol: number;
  mid: number;
  cloud: number;
  fogBlue: number;
  fogWarm: number;
  cloudiness: number;
  glint: number;
}

/** Renderer-only palette; keeping it separate preserves the v1 simulation/profile contract. */
export const VISUAL_WEATHER_PRESETS: readonly VisualWeatherPreset[] = [
  { sunCol: 0xfff3d4, hemiSky: 0xc5e2ff, hemiGround: 0x7897b8, ambientCol: 0xbcd7ef, mid: 0x79afe4, cloud: 0xfaf4e6, fogBlue: 0xbadcf5, fogWarm: 0xf2d8bd, cloudiness: 0.14, glint: 1 },
  { sunCol: 0xdce8f5, hemiSky: 0xc8d7e7, hemiGround: 0x95a9c0, ambientCol: 0xbdccdd, mid: 0xaebed2, cloud: 0xecf0f4, fogBlue: 0xbdcee3, fogWarm: 0xe1dbd3, cloudiness: 0.66, glint: 0.16 },
  { sunCol: 0xe4edf6, hemiSky: 0xd7e3ef, hemiGround: 0xacbacb, ambientCol: 0xd1dbe6, mid: 0xd0dae5, cloud: 0xf1f4f7, fogBlue: 0xd3e1ee, fogWarm: 0xe8e2dc, cloudiness: 0.94, glint: 0.005 },
] as const;

export const visualWeatherPreset = (index: number): VisualWeatherPreset =>
  VISUAL_WEATHER_PRESETS[Math.max(0, Math.min(VISUAL_WEATHER_PRESETS.length - 1, index))];
