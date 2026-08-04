import { lerp, smoothstep } from "../core/math";
import { hashInt } from "../core/rng";

export const hash2 = (x: number, z: number): number => hashInt(x, z) / 4294967295;

export function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = smoothstep(x - xi), fz = smoothstep(z - zi);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

export function fbm(x: number, z: number, octaves: number): number {
  let frequency = 1, amplitude = 0.5, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += vnoise(x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return sum / norm;
}
