export type SurfaceKind = "powder" | "packed" | "firm" | "ice";

export interface SimulationConfig {
  readonly surface: SurfaceKind;
  readonly topSpeedMultiplier: number;
  readonly gripMultiplier: number;
  readonly landingImpactThresholdMultiplier: number;
  readonly sprayDepthMultiplier: number;
}

const SURFACE_CONFIGS: Readonly<Record<SurfaceKind, SimulationConfig>> = {
  powder: {
    surface: "powder", topSpeedMultiplier: 0.92, gripMultiplier: 1,
    landingImpactThresholdMultiplier: 1.2, sprayDepthMultiplier: 1.4,
  },
  packed: {
    surface: "packed", topSpeedMultiplier: 1, gripMultiplier: 1,
    landingImpactThresholdMultiplier: 1, sprayDepthMultiplier: 1,
  },
  firm: {
    surface: "firm", topSpeedMultiplier: 1.05, gripMultiplier: 0.85,
    landingImpactThresholdMultiplier: 1, sprayDepthMultiplier: 1,
  },
  ice: {
    surface: "ice", topSpeedMultiplier: 1, gripMultiplier: 0.7,
    landingImpactThresholdMultiplier: 1, sprayDepthMultiplier: 1,
  },
};

export function simulationConfig(surface: SurfaceKind = "packed"): SimulationConfig {
  return SURFACE_CONFIGS[surface];
}
