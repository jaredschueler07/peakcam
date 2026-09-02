export type SurfaceKind = "powder" | "packed" | "firm" | "ice";

export type PhysicsModel = "v1" | "v2";

export interface CarveParams {
  readonly gripBase: number;       // lateral grip at zero edge
  readonly gripEdgeGain: number;   // added grip per unit edge angle
  readonly gripSpeedFade: number;  // grip loss factor at MAX_SPEED
  readonly skidDrag: number;       // forward drag while skidding (rightVel high, edge low)
  readonly turnInLag: number;      // seconds of edge-angle smoothing (surface feel)
  readonly airAuthority: number;   // in-air steer multiplier
  readonly landingWindow: number;  // seconds of landing absorption
}

export interface SimulationConfig {
  readonly surface: SurfaceKind;
  readonly topSpeedMultiplier: number;
  readonly gripMultiplier: number;
  readonly landingImpactThresholdMultiplier: number;
  readonly sprayDepthMultiplier: number;
  readonly physicsModel: PhysicsModel;
  readonly carve: CarveParams;
}

// Mirrors the hardcoded v1 integrator: grip is lerp(4.6, 12, edge) with no speed
// fade, and v1 has no skid drag, turn-in smoothing, air-steer scaling, or landing
// absorption. Every v1 row shares it, so the v1 table stays surface-for-surface
// identical to the pre-flag config.
const V1_CARVE: CarveParams = {
  gripBase: 4.6, gripEdgeGain: 7.4, gripSpeedFade: 0, skidDrag: 0,
  turnInLag: 0, airAuthority: 1, landingWindow: 0,
};

const V2_CARVE: Readonly<Record<SurfaceKind, CarveParams>> = {
  powder: {
    gripBase: 4.2, gripEdgeGain: 6.5, gripSpeedFade: 0.25, skidDrag: 0.35,
    turnInLag: 0.14, airAuthority: 0.9, landingWindow: 0.22,
  },
  packed: {
    gripBase: 5.0, gripEdgeGain: 8.0, gripSpeedFade: 0.3, skidDrag: 0.25,
    turnInLag: 0.08, airAuthority: 1.0, landingWindow: 0.16,
  },
  firm: {
    gripBase: 4.4, gripEdgeGain: 8.6, gripSpeedFade: 0.4, skidDrag: 0.2,
    turnInLag: 0.06, airAuthority: 1.0, landingWindow: 0.12,
  },
  ice: {
    gripBase: 2.8, gripEdgeGain: 7.2, gripSpeedFade: 0.55, skidDrag: 0.12,
    turnInLag: 0.04, airAuthority: 1.0, landingWindow: 0.08,
  },
};

const SURFACE_CONFIGS: Readonly<Record<SurfaceKind, SimulationConfig>> = {
  powder: {
    surface: "powder", topSpeedMultiplier: 0.92, gripMultiplier: 1,
    landingImpactThresholdMultiplier: 1.2, sprayDepthMultiplier: 1.4,
    physicsModel: "v1", carve: V1_CARVE,
  },
  packed: {
    surface: "packed", topSpeedMultiplier: 1, gripMultiplier: 1,
    landingImpactThresholdMultiplier: 1, sprayDepthMultiplier: 1,
    physicsModel: "v1", carve: V1_CARVE,
  },
  firm: {
    surface: "firm", topSpeedMultiplier: 1.05, gripMultiplier: 0.85,
    landingImpactThresholdMultiplier: 1, sprayDepthMultiplier: 1,
    physicsModel: "v1", carve: V1_CARVE,
  },
  ice: {
    surface: "ice", topSpeedMultiplier: 1, gripMultiplier: 0.7,
    landingImpactThresholdMultiplier: 1, sprayDepthMultiplier: 1,
    physicsModel: "v1", carve: V1_CARVE,
  },
};

const V2_CONFIGS: Readonly<Record<SurfaceKind, SimulationConfig>> = {
  powder: { ...SURFACE_CONFIGS.powder, physicsModel: "v2", carve: V2_CARVE.powder },
  packed: { ...SURFACE_CONFIGS.packed, physicsModel: "v2", carve: V2_CARVE.packed },
  firm: { ...SURFACE_CONFIGS.firm, physicsModel: "v2", carve: V2_CARVE.firm },
  ice: { ...SURFACE_CONFIGS.ice, physicsModel: "v2", carve: V2_CARVE.ice },
};

/**
 * The largest `topSpeedMultiplier` any surface can hand the integrators, over
 * both physics models. The integrators clamp 3D velocity to
 * `MAX_SPEED * topSpeedMultiplier`, so this is the factor between the physics
 * constant and the fastest speed a legal run can reach. Server-side bounds
 * derive from it rather than restating a number (see `MAX_RUN_SPEED_CMS` in
 * `lib/game/server/validate-run.ts`); adding a faster surface row widens those
 * bounds automatically instead of silently rejecting honest runs.
 */
export const MAX_TOP_SPEED_MULTIPLIER: number = Math.max(
  ...Object.values(SURFACE_CONFIGS).map((config) => config.topSpeedMultiplier),
  ...Object.values(V2_CONFIGS).map((config) => config.topSpeedMultiplier),
);

export function simulationConfig(
  surface: SurfaceKind = "packed", model: PhysicsModel = "v1",
): SimulationConfig {
  return model === "v2" ? V2_CONFIGS[surface] : SURFACE_CONFIGS[surface];
}
