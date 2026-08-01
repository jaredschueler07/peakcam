/**
 * lib/game/terrain/noise-grad.ts
 * ──────────────────────────────
 * Analytic gradients for the value noise in `noise.ts`.
 *
 * The real-terrain sampler needs C1 normals, which means the micro-detail layer
 * has to be differentiated analytically rather than sampled with finite
 * differences. `vnoise` is built from `smoothstep` (t²(3−2t)), which is C1, so
 * the derivative exists in closed form.
 *
 * The value these functions return is computed with the *same* arithmetic, in
 * the same order, as `noise.ts` — `vnoiseWithGradient(...).value` is bit-identical
 * to `vnoise(...)`, and likewise for fbm. `noise-grad.test.ts` pins that.
 */

import { lerp, smoothstep } from "../core/math";
import { hash2 } from "./noise";

/** A noise value plus its partial derivatives with respect to the input axes. */
export interface NoiseGradient {
  value: number;
  /** ∂value/∂x, in units of value per unit of noise input. */
  dx: number;
  /** ∂value/∂z, in units of value per unit of noise input. */
  dz: number;
}

/** Derivative of `smoothstep` for an already-in-range `t`; zero outside [0, 1]. */
function smoothstepDerivative(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  return 6 * t * (1 - t);
}

/** {@link import("./noise").vnoise} with its analytic gradient. */
export function vnoiseWithGradient(x: number, z: number, out: NoiseGradient): NoiseGradient {
  const xi = Math.floor(x), zi = Math.floor(z);
  const tx = x - xi, tz = z - zi;
  const fx = smoothstep(tx), fz = smoothstep(tz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  const ab = lerp(a, b, fx), cd = lerp(c, d, fx);
  out.value = lerp(ab, cd, fz);
  out.dx = ((b - a) * (1 - fz) + (d - c) * fz) * smoothstepDerivative(tx);
  out.dz = (cd - ab) * smoothstepDerivative(tz);
  return out;
}

const octaveScratch: NoiseGradient = { value: 0, dx: 0, dz: 0 };

/** {@link import("./noise").fbm} with its analytic gradient. */
export function fbmWithGradient(
  x: number, z: number, octaves: number, out: NoiseGradient,
): NoiseGradient {
  let frequency = 1, amplitude = 0.5, sum = 0, norm = 0, gx = 0, gz = 0;
  for (let i = 0; i < octaves; i += 1) {
    vnoiseWithGradient(x * frequency, z * frequency, octaveScratch);
    sum += octaveScratch.value * amplitude;
    gx += octaveScratch.dx * frequency * amplitude;
    gz += octaveScratch.dz * frequency * amplitude;
    norm += amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  out.value = sum / norm;
  out.dx = gx / norm;
  out.dz = gz / norm;
  return out;
}
