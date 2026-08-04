/**
 * Chase-camera geometry, as a table of named framings.
 *
 * The camera is the loudest thing about how the descent *feels*, and "further back", "higher", and
 * "wider" are three different answers to the same complaint. Rather than guess one, the tunable
 * geometry lives here so a run can be shot under each framing and picked by eye (`?cam=<name>` —
 * see `cameraPresetName()` in `./debugFlags`).
 *
 * Everything not in this table — the spring, shake, roll, reduced-motion handling, the lift-ride
 * branch, the damping rates — is framing-independent and stays in `CameraController`.
 */

/** Metres, degrees, and unitless gains. Read-only: `CameraController.update()` allocates nothing. */
export interface CameraPreset {
  /** Metres behind the skier at rest. */
  readonly backBase: number;
  /** Extra metres behind at the speed reference (`BACK_SPEED_REF`). */
  readonly backSpeedGain: number;
  /** Metres above the skier at rest. */
  readonly heightBase: number;
  /** Extra metres up at the speed reference (`HEIGHT_SPEED_REF`). */
  readonly heightSpeedGain: number;
  /** Extra metres up while airborne, so a jump reads as height rather than as a lost horizon. */
  readonly airLift: number;
  /** How far in front of the skier the look-at point sits, along the heading. */
  readonly lookAheadM: number;
  /**
   * Look-at height relative to the skier's origin. Lowering this below the camera's own rise is
   * what steepens the pitch — a negative value looks down at the slope rather than out at it.
   */
  readonly lookHeightM: number;
  /** Vertical FOV in degrees at rest. */
  readonly fovBase: number;
  /** Degrees added at full speed. Halved under `prefers-reduced-motion`. */
  readonly fovSpeedGain: number;
  /** The camera never sinks closer than this to the terrain underneath it. */
  readonly floorClearance: number;
}

/** Speed (m/s) at which `backSpeedGain` is fully applied. */
export const BACK_SPEED_REF = 55;
/** Speed (m/s) at which `heightSpeedGain` is fully applied. */
export const HEIGHT_SPEED_REF = 60;

export const CAMERA_PRESETS = {
  /**
   * Shipped framing: close chase, low and tight, the slope filling most of the frame.
   * These numbers are load-bearing — a test pins them to what v2 shipped with.
   */
  classic: {
    backBase: 8.6, backSpeedGain: 5.2,
    heightBase: 3.5, heightSpeedGain: 1.4, airLift: 1,
    lookAheadM: 8, lookHeightM: 1.6,
    fovBase: 65, fovSpeedGain: 17,
    floorClearance: 1.8,
  },
  /** The literal reading of "more zoomed out": same shot, pulled back and lifted a little. */
  wide: {
    backBase: 14.6, backSpeedGain: 8.8,
    heightBase: 4.9, heightSpeedGain: 2, airLift: 1.3,
    lookAheadM: 13, lookHeightM: 2,
    fovBase: 70, fovSpeedGain: 17,
    floorClearance: 2.2,
  },
  /**
   * "Watch the mountain": way up above the skier, looking *down* the fall line. The look-at point
   * drops below the skier while the camera climbs, so the pitch — not just the distance — changes.
   */
  high: {
    backBase: 11, backSpeedGain: 5.6,
    heightBase: 13, heightSpeedGain: 3, airLift: 1.2,
    lookAheadM: 14, lookHeightM: -1,
    fovBase: 66, fovSpeedGain: 15,
    floorClearance: 4.5,
  },
  /** The maximal reading: far back, very wide, look-ahead well out front. Terrain over rider. */
  cinematic: {
    backBase: 20, backSpeedGain: 11,
    heightBase: 6.5, heightSpeedGain: 2.6, airLift: 1.5,
    lookAheadM: 22, lookHeightM: 2.4,
    fovBase: 78, fovSpeedGain: 20,
    floorClearance: 2.4,
  },
} as const satisfies Record<string, CameraPreset>;

export type CameraPresetName = keyof typeof CAMERA_PRESETS;

export const DEFAULT_CAMERA_PRESET: CameraPresetName = "classic";

/** Narrows an arbitrary string; anything unrecognised (or absent) is `classic`. */
export function resolveCameraPresetName(value: string | null | undefined): CameraPresetName {
  // `hasOwn`, not `in`: `?cam=toString` must not resolve through Object.prototype.
  return value !== null && value !== undefined && Object.hasOwn(CAMERA_PRESETS, value)
    ? (value as CameraPresetName)
    : DEFAULT_CAMERA_PRESET;
}

/**
 * The furthest the chase camera can sit behind the player, metres — `backBase + backSpeedGain`,
 * maximised over the presets (cinematic: 20 + 11 = 31).
 *
 * `NEAR_FIELD_MAX_REACH_M` is measured from the **player**, but the fog shaders measure from the
 * **camera**, so the furthest a tile-grid pixel can be from the eye is the sum of the two. The fog
 * envelope's start has to clear that sum, not just the reach; `fogCurve.test.ts` asserts it.
 */
export const MAX_CAMERA_PULLBACK_M = Math.max(
  ...Object.values(CAMERA_PRESETS).map((preset) => preset.backBase + preset.backSpeedGain),
);
