import type { Vec3 } from "./types";

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number => v < a ? a : (v > b ? b : v);
export const clamp01 = (v: number): number => v < 0 ? 0 : (v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

export function setVec3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x; out.y = y; out.z = z;
  return out;
}

export function copyVec3(out: Vec3, value: Vec3): Vec3 {
  out.x = value.x; out.y = value.y; out.z = value.z;
  return out;
}

export function addScaledVector(out: Vec3, value: Vec3, scale: number): Vec3 {
  out.x += value.x * scale;
  out.y += value.y * scale;
  out.z += value.z * scale;
  return out;
}

export function multiplyScalar(out: Vec3, scalar: number): Vec3 {
  out.x *= scalar; out.y *= scalar; out.z *= scalar;
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function lengthSq(value: Vec3): number {
  return value.x * value.x + value.y * value.y + value.z * value.z;
}

export function length(value: Vec3): number {
  return Math.sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

export function normalize(out: Vec3): Vec3 {
  return multiplyScalar(out, 1 / length(out) || 1);
}
