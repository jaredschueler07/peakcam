export type SurfaceKind = "powder" | "packed" | "firm" | "ice" | "slush";

export type RiderMode = "skier" | "snowboarder";
export type SnowboardStance = "regular" | "goofy";

/** SI units; area is the effective immersed leading edge, not the board footprint. */
export interface SnowResistance {
  readonly plowCoefficient: number;
  readonly densityKgM3: number;
  readonly immersedAreaM2: number;
  readonly kineticFriction: number;
}
export const DEEP_POWDER: SnowResistance = { plowCoefficient: 65, densityKgM3: 100, immersedAreaM2: 0.00035, kineticFriction: 0.06 };
export const GROOMED_CORDUROY: SnowResistance = { plowCoefficient: 3, densityKgM3: 350, immersedAreaM2: 0.00008, kineticFriction: 0.04 };
export const HARDPACK_ICE: SnowResistance = { plowCoefficient: 0, densityKgM3: 500, immersedAreaM2: 0, kineticFriction: 0.02 };
export const SPRING_SLUSH: SnowResistance = { plowCoefficient: 22, densityKgM3: 450, immersedAreaM2: 0.00012, kineticFriction: 0.11 };
const RESISTANCE: Record<SurfaceKind, SnowResistance> = { powder: DEEP_POWDER, packed: GROOMED_CORDUROY, firm: HARDPACK_ICE, ice: HARDPACK_ICE, slush: SPRING_SLUSH };

/** Game-feel forces in m/s²; kept separate from the original v1 coefficient table. */
export interface SnowFeel {
  readonly lateralLimit: number;
  readonly brakeDeceleration: number;
  readonly brakeDrag: number;
  readonly glideDrag: number;
  readonly turnAuthority: number;
}
const SNOW_FEEL: Readonly<Record<SurfaceKind, SnowFeel>> = {
  powder: { lateralLimit: 14, brakeDeceleration: 7.5, brakeDrag: .9, glideDrag: .12, turnAuthority: .76 },
  packed: { lateralLimit: 24, brakeDeceleration: 5.5, brakeDrag: .65, glideDrag: .1, turnAuthority: 1 },
  firm: { lateralLimit: 16, brakeDeceleration: 3.8, brakeDrag: .42, glideDrag: .065, turnAuthority: .98 },
  ice: { lateralLimit: 6.5, brakeDeceleration: 2.2, brakeDrag: .2, glideDrag: .025, turnAuthority: 1 },
  slush: { lateralLimit: 17, brakeDeceleration: 6.5, brakeDrag: .8, glideDrag: .16, turnAuthority: .86 },
};
export function snowFeel(surface: SurfaceKind): SnowFeel { return SNOW_FEEL[surface]; }
export function resistanceForSurface(surface: SurfaceKind): SnowResistance { return RESISTANCE[surface]; }
/** Shared by the solver and audio; explicit Free Ride surfaces have no environment. */
export function localSnowSurface(cfg: SimulationConfig, corridor: number, normalZ: number): SurfaceKind {
  const env = cfg.environment;
  if (!env) return cfg.surface;
  if (corridor >= 0.5) {
    if (env.morningIce && normalZ * env.northSign > 0.08) return "ice";
    return cfg.surface === "powder" ? "packed" : cfg.surface;
  }
  return env.powderDepthCm > 0 ? "powder" : cfg.surface;
}
export function surfaceCarve(surface: SurfaceKind): CarveParams { return V2_CARVE[surface]; }

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

export interface SimulationEnvironment {
  readonly powderDepthCm: number;
  readonly windSpeedMps: number;
  readonly morningIce: boolean;
  readonly visibilityM: number;
  /** North-facing slope sign in local game Z (southern hemisphere still geographic north). */
  readonly northSign: 1 | -1;
}

export interface SimulationConfig {
  readonly allowLifts?: boolean;
  readonly environment?: SimulationEnvironment;
  readonly riderMode?: RiderMode;
  readonly stance?: SnowboardStance;
  readonly snowResistance?: SnowResistance;
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
    turnInLag: 0.26, airAuthority: 0.9, landingWindow: 0.22,
  },
  packed: {
    gripBase: 5.0, gripEdgeGain: 8.0, gripSpeedFade: 0.3, skidDrag: 0.25,
    turnInLag: 0.08, airAuthority: 1.0, landingWindow: 0.16,
  },
  firm: {
    gripBase: 4.4, gripEdgeGain: 8.6, gripSpeedFade: 0.4, skidDrag: 0.2,
    turnInLag: 0.06, airAuthority: 1.0, landingWindow: 0.12,
  },
  slush: {
    gripBase: 4.6, gripEdgeGain: 7, gripSpeedFade: 0.3, skidDrag: 0.4,
    turnInLag: 0.12, airAuthority: 1, landingWindow: 0.18,
  },
  ice: {
    gripBase: 0.9, gripEdgeGain: 2.2, gripSpeedFade: 0.55, skidDrag: 0.04,
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
  slush: {
    surface: "slush", topSpeedMultiplier: 0.95, gripMultiplier: 1,
    landingImpactThresholdMultiplier: 1.1, sprayDepthMultiplier: 1.2,
    physicsModel: "v1", carve: V1_CARVE,
  },
  ice: {
    surface: "ice", topSpeedMultiplier: 1, gripMultiplier: 0.7,
    landingImpactThresholdMultiplier: 1, sprayDepthMultiplier: 1,
    physicsModel: "v1", carve: V1_CARVE,
  },
};

const V2_CONFIGS: Readonly<Record<SurfaceKind, SimulationConfig>> = {
  powder: { ...SURFACE_CONFIGS.powder, physicsModel: "v2", sprayDepthMultiplier: 2.2, carve: V2_CARVE.powder },
  packed: { ...SURFACE_CONFIGS.packed, physicsModel: "v2", carve: V2_CARVE.packed },
  firm: { ...SURFACE_CONFIGS.firm, physicsModel: "v2", sprayDepthMultiplier: .55, carve: V2_CARVE.firm },
  ice: { ...SURFACE_CONFIGS.ice, physicsModel: "v2", sprayDepthMultiplier: .22, carve: V2_CARVE.ice },
  slush: { ...SURFACE_CONFIGS.slush, physicsModel: "v2", carve: V2_CARVE.slush },
};

export function simulationConfig(
  surface: SurfaceKind = "packed", model: PhysicsModel = "v1", environment?: SimulationEnvironment,
  riderMode: RiderMode = "skier", stance: SnowboardStance = "regular",
): SimulationConfig {
  if (model === "v1") return SURFACE_CONFIGS[surface];
  return { ...V2_CONFIGS[surface], riderMode, stance, environment, snowResistance: RESISTANCE[surface] };
}
