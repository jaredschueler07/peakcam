import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { addHeightFog, heightFogAmount, type AtmosphereUniforms } from "./Atmosphere";
import {
  FAR_FULL_M,
  FAR_START_M,
  GLSL_FOG_INPUTS,
  NUMBER_OPS,
  fogFactorExpression,
  heightFogGlsl,
} from "./fogCurve";
import { NEAR_FIELD_MAX_REACH_M, TILE_SIZE } from "./nearFieldReach";

/** The configured densities, so the sweeps exercise the real operating range. */
const DENSITIES = [0.00135, 0.0017, 0.0021, 0.0046, 0.009];
const DISTANCES = [1, 50, 200, 600, 999, 1000, 1200, 1500, 2000, 6000, 12_000, 24_000, 30_000];
const ALTITUDES = [-500, 0, 100, 217, 300, 462, 1000, 3450];
const RETENTIONS = [0, 0.2, 0.5, 1];

// ─── The GLSL is generated, and evaluated against the same expression ──

/**
 * The emitted GLSL is deliberately also a valid JavaScript expression: the ops use only `exp`,
 * `max`, `smoothstep` and arithmetic, and every float literal carries a decimal point. So the real
 * shader source can be executed here rather than eyeballed.
 */
function evaluateGlsl(source: string, inputs: Record<string, number>): number {
  const smoothstep = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  // `vAtmosphereWorldPosition.y` is a member expression; bind the object, not a flat name.
  const names = ["exp", "max", "smoothstep", "vAtmosphereWorldPosition", "uFogDensity",
    "atmosphereDistance", "uFogReferenceHeight", "uFogHeightFalloff", "uFogFarRetention"];
  const fn = new Function(...names, `return ${source};`) as (...a: unknown[]) => number;
  return fn(Math.exp, Math.max, smoothstep, { y: inputs.worldY }, inputs.density,
    inputs.distance, inputs.referenceHeight, inputs.heightFalloff, inputs.farRetention);
}

test("the WebGL shader's fog expression computes exactly what the CPU reference does", () => {
  const source = heightFogGlsl();
  let checked = 0;
  for (const density of DENSITIES) {
    for (const distance of DISTANCES) {
      for (const worldY of ALTITUDES) {
        for (const farRetention of RETENTIONS) {
          const inputs = { density, distance, worldY, referenceHeight: 0, heightFalloff: 0.025, farRetention };
          const glsl = evaluateGlsl(source, inputs);
          const cpu = fogFactorExpression(NUMBER_OPS, inputs);
          assert.ok(
            Math.abs(glsl - cpu) < 1e-12,
            `GLSL ${glsl} != reference ${cpu} at ${JSON.stringify(inputs)}`,
          );
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 500, `only ${checked} samples — the sweep is not exercising the curve`);
});

test("every GLSL input name the emitter uses is one the shader actually declares", () => {
  // The emitter names variables by string. A typo produces GLSL that fails to compile at runtime
  // on the WebGL path only — invisible to every test that evaluates the expression in JS, where
  // an undeclared name is just another parameter.
  const source = heightFogGlsl();
  for (const name of Object.values(GLSL_FOG_INPUTS)) {
    assert.ok(source.includes(name), `the emitted GLSL never references ${name}`);
  }
  const declared = new Set(["uFogDensity", "uFogHeightFalloff", "uFogReferenceHeight",
    "uFogFarRetention", "atmosphereDistance", "vAtmosphereWorldPosition"]);
  for (const identifier of source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (identifier === "exp" || identifier === "max" || identifier === "smoothstep" || identifier === "y") continue;
    assert.ok(declared.has(identifier), `the emitted GLSL references undeclared '${identifier}'`);
  }
});

test("the generated expression is what actually reaches the compiled shader", () => {
  // Generating it is only half the guarantee; it has to be the string the material injects.
  const uniforms: AtmosphereUniforms = {
    density: { value: 0.00135 }, heightFalloff: { value: 0.025 }, referenceHeight: { value: 0 },
    farRetention: { value: 0.5 }, blue: { value: new THREE.Color() },
    warm: { value: new THREE.Color() }, sunDirection: { value: new THREE.Vector3(0, 1, 0) },
  };
  const material = new THREE.MeshStandardMaterial();
  addHeightFog(material, uniforms);

  const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <worldpos_vertex>", fragmentShader: "#include <common>\n#include <fog_fragment>" };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

  assert.ok(shader.fragmentShader.includes(heightFogGlsl()), "the shader does not carry the generated expression");
  assert.ok("uFogFarRetention" in shader.uniforms, "the retention uniform is not bound");
  // A stale program cache key would serve the old shader to a material compiled this session.
  assert.match(material.customProgramCacheKey(), /peakcam-height-fog-v2/);
});

// ─── The seam: the envelope must be inert wherever the near field draws ──

test("the long-range envelope is exactly inert everywhere the near field can draw", () => {
  // Derived, not asserted against a literal: if the tile grid grows, this fails rather than
  // silently opening a gap between a fogged near field and a less-fogged far field.
  assert.equal(NEAR_FIELD_MAX_REACH_M, 1000);
  assert.ok(
    FAR_START_M > NEAR_FIELD_MAX_REACH_M,
    `the envelope starts at ${FAR_START_M} m, inside the near field's ${NEAR_FIELD_MAX_REACH_M} m reach`,
  );

  // Below the reach, retention must make no difference at all — bit-identical, not merely close.
  for (const density of DENSITIES) {
    for (let d = 1; d <= NEAR_FIELD_MAX_REACH_M; d += TILE_SIZE / 8) {
      for (const worldY of ALTITUDES) {
        const base = heightFogAmount(density, d, worldY, 0, 0.025, 0);
        for (const farRetention of RETENTIONS) {
          assert.equal(
            heightFogAmount(density, d, worldY, 0, 0.025, farRetention), base,
            `retention ${farRetention} changed the fog at ${d} m, inside the near field`,
          );
        }
      }
    }
  }
});

test("...and is emphatically not inert beyond it, or the test above proves nothing", () => {
  const far = heightFogAmount(0.00135, 24_000, 0, 0, 0.025, 0.5);
  const unchanged = heightFogAmount(0.00135, 24_000, 0, 0, 0.025, 0);
  assert.equal(unchanged, 1, "without retention the far field should still saturate");
  assert.ok(Math.abs(far - 0.5) < 1e-6, `expected ~0.5 at 24 km with retention 0.5, got ${far}`);
  assert.ok(far < unchanged - 0.4, "the envelope is not actually lifting the fog");
});

test("the envelope reaches full strength by FAR_FULL_M and holds it to the horizon", () => {
  const at = (d: number) => heightFogAmount(0.00135, d, 0, 0, 0.025, 0.5);
  assert.ok(Math.abs(at(FAR_FULL_M) - 0.5) < 1e-6);
  assert.ok(Math.abs(at(30_000) - 0.5) < 1e-6);
  // The total fog is not monotone and should not be: it keeps rising toward saturation until the
  // envelope overtakes it, which is what real extinction does. What must be smooth is the
  // envelope's own CONTRIBUTION — a jump there would paint a visible ring on the horizon. Isolate
  // it by differencing against the same curve with retention off.
  const contribution = (d: number) => heightFogAmount(0.00135, d, 0, 0, 0.025, 0) - at(d);
  let previous = contribution(FAR_START_M - 200);
  let largest = 0;
  for (let d = FAR_START_M - 200; d <= FAR_FULL_M + 2000; d += 25) {
    const value = contribution(d);
    const step = Math.abs(value - previous);
    largest = Math.max(largest, step);
    assert.ok(step < 0.01, `the envelope jumped ${step.toFixed(4)} between ${d - 25} m and ${d} m — a visible ring`);
    previous = value;
  }
  assert.equal(contribution(FAR_START_M - 200), 0, "the envelope must contribute nothing near in");
  assert.ok(largest > 1e-4, "the contribution never changes — the continuity bound proves nothing");
});

// ─── The altitude step is gone ──

test("distant terrain is fogged the same whatever its altitude — the knife-edge is gone", () => {
  // Before the envelope, at 24 km the factor fell 0.9992 -> 0.0465 between +200 m and +400 m above
  // the player, bisecting the horizon with a hard line. Aconcagua, 3.4 km up, got exactly zero fog.
  const at = (worldY: number) => heightFogAmount(0.00135, 24_000, worldY, 0, 0.025, 0.5);
  const base = at(0);
  for (const worldY of ALTITUDES) {
    assert.ok(
      Math.abs(at(worldY) - base) < 1e-6,
      `fog at +${worldY} m is ${at(worldY)}, but ${base} at player altitude — the step survives`,
    );
  }
  // And the old behaviour really did have the step, so this is measuring a real change.
  const oldLow = heightFogAmount(0.00135, 24_000, 200, 0, 0.025, 0);
  const oldHigh = heightFogAmount(0.00135, 24_000, 3450, 0, 0.025, 0);
  assert.ok(oldLow > 0.99 && oldHigh === 0, `expected the old knife-edge, got ${oldLow} / ${oldHigh}`);
});

test("retention 0 reproduces the previous curve exactly, so storm presets cannot move", () => {
  for (const density of DENSITIES) {
    for (const distance of DISTANCES) {
      for (const worldY of ALTITUDES) {
        // The pre-envelope formula, written out longhand as the thing being preserved.
        const height = Math.exp(-0.025 * Math.max(worldY - 0, 0));
        const legacy = 1 - Math.exp(-((density * distance) ** 2) * height);
        assert.equal(heightFogAmount(density, distance, worldY, 0, 0.025, 0), legacy);
      }
    }
  }
});
