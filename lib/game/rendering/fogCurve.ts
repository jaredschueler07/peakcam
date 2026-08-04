/**
 * lib/game/rendering/fogCurve.ts
 * ──────────────────────────────
 * The height-fog curve, written **once**.
 *
 * It used to exist three times: hand-written arithmetic in `Atmosphere.heightFogAmount`, a
 * hand-written GLSL string in `Atmosphere.addHeightFog`, and an operator-generic expression in
 * `AtmosphereNode` that fed the TSL shader. A test pinned the first to the third; the GLSL was
 * pinned to nothing, so the two backends could silently disagree — on the near/far seam, which is
 * exactly where a disagreement is least visible in review and most visible on screen.
 *
 * Now the expression is written once against {@link FogOps} and instantiated three ways: with
 * numbers (the CPU reference and the game's own `heightFogAmount`), with GLSL source strings (the
 * WebGL shader, generated rather than transcribed), and with TSL nodes (WebGPU, in
 * `AtmosphereNode` — which stays there because it is the only file allowed to import `three/tsl`).
 *
 * This module imports nothing. That is what lets the WebGL fog path share it.
 *
 * ## The curve
 *
 * ```text
 *   above   = max(worldY - referenceHeight, 0)      // referenceHeight is the PLAYER's altitude
 *   height  = exp(-heightFalloff · above)           // thinner air higher up
 *   t       = smoothstep(FAR_START_M, FAR_FULL_M, distance)
 *   height' = mix(height, 1, t)                     // see "the altitude step" below
 *   optical = density · distance
 *   f       = 1 - exp(-(optical² · height'))
 *   result  = f · (1 - farRetention · t)            // see "the long-range envelope"
 * ```
 *
 * ## The long-range envelope
 *
 * `optical²` is quadratic in distance, so with the tuned densities the factor reaches 99.99% at
 * 2,248 m (Portillo), 1,785 m (Breckenridge) and 1,445 m (Heavenly). Every one of those is inside
 * the far field, which runs to 30 km — so before this envelope, the entire horizon was flat fog
 * colour and no density that looked right near the player could avoid it.
 *
 * Real atmospheric perspective does not do that: with meteorological visibility V, terrain retains
 * `exp(-3.912·d/V)` of its own colour, which at 24 km is 39% for V = 100 km and 53% for V = 150 km.
 * Aconcagua is plainly visible from Portillo in photographs, and that is the effect being
 * reproduced. `farRetention = 0.5` lands the long-range factor at 0.5, i.e. ~V = 140 km.
 *
 * The envelope is **exactly 1 below {@link FAR_START_M}**, which is placed past
 * `NEAR_FIELD_MAX_REACH_M + MAX_CAMERA_PULLBACK_M` — the furthest a *streamed terrain tile* pixel
 * can be from the camera. So every pixel the tile grid draws is fogged by the unmodified curve, the
 * far field is fogged identically wherever the two overlap, and divergence begins only where the
 * tile grid has stopped existing. That is what keeps the terrain seam invisible, and it is
 * structural rather than tuned.
 *
 * **This is a claim about the tile grid only, not about "everything near the player".** Other world
 * geometry is drawn without any proximity limit and *is* affected on purpose: `WorldRenderer` spreads
 * nine lift towers and the cable along the whole of `selectMainLift`'s pick — deliberately the
 * longest eligible lift — and places up to 460 trail markers along every run. A tower 2.5 km out at
 * Portillo moves from fog 0.99999 to 0.910, and at the far end of a 4 km gondola from 1.0 to 0.688.
 * That is the intended effect: those towers were previously erased into the fog at exactly the
 * distances where the new far field now shows real terrain behind them, and leaving them erased
 * would have put a visible band of "nothing" between the near field and the horizon.
 *
 * `farRetention = 0` restores the previous behaviour exactly, which is what the storm weather
 * presets use — a whiteout *should* swallow the horizon.
 *
 * ## The altitude step
 *
 * The height term multiplies the optical depth *inside* the exponent, so it does not merely
 * attenuate distant fog — it removes it. Measured at 24 km, Portillo: the factor falls from 0.9992
 * at +200 m above the player to 0.0465 at +400 m, and is exactly 0 for a peak 3.4 km up. The
 * horizon was therefore bisected by a knife-edge line rather than uniformly washed out. Blending
 * `height → 1` under the same envelope removes the step, leaving distant terrain uniformly fogged
 * at the retention floor whatever its altitude.
 */

/** Where the long-range envelope begins, metres. Must exceed `NEAR_FIELD_MAX_REACH_M`. */
export const FAR_START_M = 1200;
/** Where it reaches full strength, metres. */
export const FAR_FULL_M = 6000;

/**
 * The operations the curve needs, so one expression can be evaluated as numbers, emitted as GLSL,
 * or built as a TSL node graph. Deliberately minimal — every addition here has to be implemented
 * three times and is therefore three chances to diverge.
 */
export interface FogOps<T> {
  add(a: T, b: T): T;
  mul(a: T, b: T): T;
  sub(a: T, b: T): T;
  maxZero(a: T): T;
  exp(a: T): T;
  negate(a: T): T;
  oneMinus(a: T): T;
  /** GLSL semantics: clamped Hermite interpolation. The edges are compile-time constants. */
  smoothstep(edge0: number, edge1: number, x: T): T;
}

export interface FogInputs<T> {
  density: T;
  distance: T;
  worldY: T;
  referenceHeight: T;
  heightFalloff: T;
  /** Fraction of the fog removed at long range; 0 reproduces the pre-envelope curve exactly. */
  farRetention: T;
}

export function fogFactorExpression<T>(ops: FogOps<T>, inputs: FogInputs<T>): T {
  const above = ops.maxZero(ops.sub(inputs.worldY, inputs.referenceHeight));
  const height = ops.exp(ops.negate(ops.mul(inputs.heightFalloff, above)));

  const t = ops.smoothstep(FAR_START_M, FAR_FULL_M, inputs.distance);
  // The neutralisation is scaled by `farRetention`, not by `t` alone, so that a preset with
  // retention 0 reproduces the old curve *bit-for-bit* — the storm presets depend on that. Any
  // non-zero retention neutralises the step completely regardless of its size, because the optical
  // depth out where `t > 0` is enormous (≈1050 at 24 km): a blend of even 0.2 saturates the
  // exponential, so the altitude no longer changes the result.
  const neutralise = ops.mul(t, inputs.farRetention);
  // mix(height, 1, neutralise) — from the primitives, so every backend agrees on it.
  const heightAtRange = ops.add(ops.mul(height, ops.oneMinus(neutralise)), neutralise);

  const optical = ops.mul(inputs.density, inputs.distance);
  const factor = ops.oneMinus(
    ops.exp(ops.negate(ops.mul(ops.mul(optical, optical), heightAtRange))),
  );
  return ops.mul(factor, ops.oneMinus(ops.mul(inputs.farRetention, t)));
}

// ─── Numbers ─────────────────────────────────────────────────

function smoothstepNumber(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const NUMBER_OPS: FogOps<number> = {
  add: (a, b) => a + b,
  mul: (a, b) => a * b,
  sub: (a, b) => a - b,
  maxZero: (a) => Math.max(a, 0),
  exp: Math.exp,
  negate: (a) => -a,
  oneMinus: (a) => 1 - a,
  smoothstep: smoothstepNumber,
};

// ─── GLSL ────────────────────────────────────────────────────

/** GLSL needs a decimal point on every float literal, or `1200` is an int and the call fails. */
function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/**
 * Emits the curve as a GLSL expression. The output is *also* a valid JavaScript expression given
 * `exp`, `max` and `smoothstep` in scope, which is how `Atmosphere.test.ts` evaluates the real
 * shader source against {@link NUMBER_OPS} instead of trusting that they match.
 */
export const GLSL_OPS: FogOps<string> = {
  add: (a, b) => `(${a}+${b})`,
  mul: (a, b) => `(${a}*${b})`,
  sub: (a, b) => `(${a}-${b})`,
  maxZero: (a) => `max(${a},0.0)`,
  exp: (a) => `exp(${a})`,
  negate: (a) => `(-${a})`,
  oneMinus: (a) => `(1.0-${a})`,
  smoothstep: (edge0, edge1, x) => `smoothstep(${glslFloat(edge0)},${glslFloat(edge1)},${x})`,
};

/** The GLSL variable names `addHeightFog` declares; shared so the emitter cannot name a ghost. */
export const GLSL_FOG_INPUTS: FogInputs<string> = {
  density: "uFogDensity",
  distance: "atmosphereDistance",
  worldY: "vAtmosphereWorldPosition.y",
  referenceHeight: "uFogReferenceHeight",
  heightFalloff: "uFogHeightFalloff",
  farRetention: "uFogFarRetention",
};

/** The fog factor as GLSL source, for injection into the fragment shader. */
export function heightFogGlsl(inputs: FogInputs<string> = GLSL_FOG_INPUTS): string {
  return fogFactorExpression(GLSL_OPS, inputs);
}
