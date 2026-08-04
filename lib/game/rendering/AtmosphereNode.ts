import * as THREE from "three";
import { clamp, cameraPosition, dot, float, fog, length, max, mix, normalize, positionWorld, pow, smoothstep, uniform } from "three/tsl";
import { NUMBER_OPS, fogFactorExpression, type FogOps } from "./fogCurve";
import type { Node, UniformNode } from "three/webgpu";

/**
 * TSL port of `addHeightFog` (Atmosphere.ts) as a scene-level `fogNode`. The factor expression is
 * shared with the CPU reference below, so the shader cannot drift from `heightFogAmount`.
 */
export interface AtmosphereNodeUniforms {
  density: UniformNode<"float", number>;
  heightFalloff: UniformNode<"float", number>;
  referenceHeight: UniformNode<"float", number>;
  /** Fraction of the fog removed beyond `FAR_START_M`; 0 is the pre-envelope behaviour. */
  farRetention: UniformNode<"float", number>;
  blue: UniformNode<"color", THREE.Color>;
  warm: UniformNode<"color", THREE.Color>;
  sunDirection: UniformNode<"vec3", THREE.Vector3>;
}

export interface AtmosphereNodeSeed {
  density?: number;
  heightFalloff?: number;
  referenceHeight?: number;
  farRetention?: number;
  blue?: THREE.Color;
  warm?: THREE.Color;
  sunDirection?: THREE.Vector3;
}

/** SceneFactory.ts:8 — kept local so this module stays free of scene-construction imports. */
const SUN_DIRECTION = new THREE.Vector3(-0.46, 0.62, -0.64).normalize();

/**
 * The TSL instantiation of the shared curve (`fogCurve.ts`). This file is the only one allowed to
 * import `three/tsl`, which is why the ops live here while the expression does not.
 */
const NODE_OPS: FogOps<Node<"float">> = {
  add: (a, b) => a.add(b),
  mul: (a, b) => a.mul(b),
  sub: (a, b) => a.sub(b),
  maxZero: (a) => max(a, 0),
  exp: (a) => a.exp(),
  negate: (a) => a.negate(),
  oneMinus: (a) => a.oneMinus(),
  smoothstep: (edge0, edge1, x) => smoothstep(float(edge0), float(edge1), x),
};

export function createAtmosphereNodeUniforms(seed: AtmosphereNodeSeed = {}): AtmosphereNodeUniforms {
  return {
    density: uniform(seed.density ?? 0.012),
    heightFalloff: uniform(seed.heightFalloff ?? 0.025),
    referenceHeight: uniform(seed.referenceHeight ?? 0),
    farRetention: uniform(seed.farRetention ?? 0),
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
    farRetention: uniforms.farRetention.value,
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
      farRetention: uniforms.farRetention,
    }),
    0,
    1,
  );
  const sunAmount = pow(max(dot(normalize(ray), normalize(uniforms.sunDirection)), 0), 3);
  return fog(mix(uniforms.blue, uniforms.warm, sunAmount), factor);
}
