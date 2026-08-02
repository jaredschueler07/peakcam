import * as THREE from "three";
import { clamp, cameraPosition, dot, fog, length, max, mix, normalize, positionWorld, pow, uniform } from "three/tsl";
import type { Node, UniformNode } from "three/webgpu";

/**
 * TSL port of `addHeightFog` (Atmosphere.ts) as a scene-level `fogNode`. The factor expression is
 * shared with the CPU reference below, so the shader cannot drift from `heightFogAmount`.
 */
export interface AtmosphereNodeUniforms {
  density: UniformNode<"float", number>;
  heightFalloff: UniformNode<"float", number>;
  referenceHeight: UniformNode<"float", number>;
  blue: UniformNode<"color", THREE.Color>;
  warm: UniformNode<"color", THREE.Color>;
  sunDirection: UniformNode<"vec3", THREE.Vector3>;
}

export interface AtmosphereNodeSeed {
  density?: number;
  heightFalloff?: number;
  referenceHeight?: number;
  blue?: THREE.Color;
  warm?: THREE.Color;
  sunDirection?: THREE.Vector3;
}

/** SceneFactory.ts:8 — kept local so this module stays free of scene-construction imports. */
const SUN_DIRECTION = new THREE.Vector3(-0.46, 0.62, -0.64).normalize();

/**
 * The arithmetic `heightFogAmount` performs, written once against an operator interface so the same
 * expression tree can be instantiated with TSL nodes (the shader) and with plain numbers (the
 * reference, which `heightFogReference` exposes and the tests pin to `Atmosphere.ts`).
 */
interface FogOps<T> {
  mul(a: T, b: T): T;
  sub(a: T, b: T): T;
  maxZero(a: T): T;
  exp(a: T): T;
  negate(a: T): T;
  oneMinus(a: T): T;
}

interface FogInputs<T> {
  density: T;
  distance: T;
  worldY: T;
  referenceHeight: T;
  heightFalloff: T;
}

function fogFactorExpression<T>(ops: FogOps<T>, inputs: FogInputs<T>): T {
  const above = ops.maxZero(ops.sub(inputs.worldY, inputs.referenceHeight));
  const height = ops.exp(ops.negate(ops.mul(inputs.heightFalloff, above)));
  const optical = ops.mul(inputs.density, inputs.distance);
  return ops.oneMinus(ops.exp(ops.negate(ops.mul(ops.mul(optical, optical), height))));
}

const NUMBER_OPS: FogOps<number> = {
  mul: (a, b) => a * b,
  sub: (a, b) => a - b,
  maxZero: (a) => Math.max(a, 0),
  exp: Math.exp,
  negate: (a) => -a,
  oneMinus: (a) => 1 - a,
};

const NODE_OPS: FogOps<Node<"float">> = {
  mul: (a, b) => a.mul(b),
  sub: (a, b) => a.sub(b),
  maxZero: (a) => max(a, 0),
  exp: (a) => a.exp(),
  negate: (a) => a.negate(),
  oneMinus: (a) => a.oneMinus(),
};

export function createAtmosphereNodeUniforms(seed: AtmosphereNodeSeed = {}): AtmosphereNodeUniforms {
  return {
    density: uniform(seed.density ?? 0.012),
    heightFalloff: uniform(seed.heightFalloff ?? 0.025),
    referenceHeight: uniform(seed.referenceHeight ?? 0),
    blue: uniform(seed.blue ?? new THREE.Color(0x9fc0e8)),
    warm: uniform(seed.warm ?? new THREE.Color(0xffd9a8)),
    sunDirection: uniform(seed.sunDirection ?? SUN_DIRECTION.clone()),
  };
}

/**
 * CPU evaluation of the fog factor, reading the *live* uniform values — the same objects the shader
 * samples and `Renderer.render()` writes per frame. Task 6 and any visual check can use this to
 * predict what the fog node produces at a given height and distance.
 */
export function heightFogReference(uniforms: AtmosphereNodeUniforms, worldY: number, distance: number): number {
  return fogFactorExpression(NUMBER_OPS, {
    density: uniforms.density.value,
    distance,
    worldY,
    referenceHeight: uniforms.referenceHeight.value,
    heightFalloff: uniforms.heightFalloff.value,
  });
}

/** The node to assign to `scene.fogNode`. */
export function createAtmosphereFog(uniforms: AtmosphereNodeUniforms): Node {
  const ray = positionWorld.sub(cameraPosition);
  const distance = length(ray);
  const factor = clamp(
    fogFactorExpression(NODE_OPS, {
      density: uniforms.density,
      distance,
      worldY: positionWorld.y,
      referenceHeight: uniforms.referenceHeight,
      heightFalloff: uniforms.heightFalloff,
    }),
    0,
    1,
  );
  const sunAmount = pow(max(dot(normalize(ray), normalize(uniforms.sunDirection)), 0), 3);
  return fog(mix(uniforms.blue, uniforms.warm, sunAmount), factor);
}
