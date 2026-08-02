import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { Node } from "three/webgpu";
import { heightFogAmount } from "./Atmosphere";
import { createAtmosphereFog, createAtmosphereNodeUniforms, heightFogReference } from "./AtmosphereNode";

type Traversable = { getChildren?: () => Iterable<Traversable> };

function collectNodes(root: Node | Traversable | null): Set<unknown> {
  const seen = new Set<unknown>();
  const walk = (node: Traversable | null) => {
    if (!node || seen.has(node) || typeof node.getChildren !== "function") return;
    seen.add(node);
    for (const child of node.getChildren()) walk(child);
  };
  walk(root as Traversable | null);
  return seen;
}

test("atmosphere uniforms keep .value semantics for the per-frame writes", () => {
  const uniforms = createAtmosphereNodeUniforms();
  assert.equal(typeof uniforms.density.value, "number");
  assert.equal(typeof uniforms.heightFalloff.value, "number");
  assert.equal(typeof uniforms.referenceHeight.value, "number");
  assert.ok(uniforms.blue.value instanceof THREE.Color);
  assert.ok(uniforms.warm.value instanceof THREE.Color);
  assert.ok(uniforms.sunDirection.value instanceof THREE.Vector3);

  // Renderer.render() line 147 — the player-relative fog reference.
  uniforms.referenceHeight.value = 812.5;
  assert.equal(uniforms.referenceHeight.value, 812.5);
  // WeatherRenderer mutates the colours and density in place.
  uniforms.density.value = 0.031;
  uniforms.blue.value.setHex(0x223344);
  uniforms.warm.value.setHex(0xffddaa);
  assert.equal(uniforms.density.value, 0.031);
  assert.equal(uniforms.blue.value.getHex(), 0x223344);
  assert.equal(uniforms.warm.value.getHex(), 0xffddaa);
});

test("atmosphere uniform defaults match what SceneFactory seeded for the GLSL path", () => {
  const uniforms = createAtmosphereNodeUniforms();
  assert.equal(uniforms.heightFalloff.value, 0.025);
  assert.equal(uniforms.referenceHeight.value, 0);
  const sun = new THREE.Vector3(-0.46, 0.62, -0.64).normalize();
  assert.ok(uniforms.sunDirection.value.distanceTo(sun) < 1e-12, "the sun direction is SUN_DIRECTION");

  const seeded = createAtmosphereNodeUniforms({ density: 0.02, blue: new THREE.Color(0x101010) });
  assert.equal(seeded.density.value, 0.02);
  assert.equal(seeded.blue.value.getHex(), 0x101010);
  assert.equal(seeded.heightFalloff.value, 0.025, "unspecified fields keep their defaults");
});

test("the fog expression reproduces heightFogAmount exactly", () => {
  const uniforms = createAtmosphereNodeUniforms();
  let exercised = 0;
  for (const density of [0.00135, 0.004, 0.012, 0.03]) {
    for (const heightFalloff of [0, 0.025, 0.08]) {
      for (const referenceHeight of [-40, 0, 913.25]) {
        for (const worldY of [-120, 0, 12.5, 913.25, 2400, 6854]) {
          // Distances must straddle FAR_START_M/FAR_FULL_M, and retention must actually vary:
          // with retention pinned at 0 the envelope is inert by construction, so `NODE_OPS.add`
          // and `NODE_OPS.smoothstep` — which exist only for the envelope — went unexercised.
          for (const distance of [0, 1, 37.5, 480, 3000, 12_000, 24_000, 30_000]) {
            for (const farRetention of [0, 0.2, 0.5, 1]) {
              uniforms.density.value = density;
              uniforms.heightFalloff.value = heightFalloff;
              uniforms.referenceHeight.value = referenceHeight;
              uniforms.farRetention.value = farRetention;
              assert.equal(
                heightFogReference(uniforms, worldY, distance),
                heightFogAmount(density, distance, worldY, referenceHeight, heightFalloff, farRetention),
                `d=${density} f=${heightFalloff} ref=${referenceHeight} y=${worldY} dist=${distance} k=${farRetention}`,
              );
              exercised += 1;
            }
          }
        }
      }
    }
  }
  assert.ok(exercised > 2000, `only ${exercised} samples`);
});

test("the TSL uniform set carries the envelope, and the reference reads it live", () => {
  // The reference is the only numeric window onto the node path; if it ignored `farRetention` the
  // sweep above would pass while the WebGPU shader — the default backend — did something else.
  const uniforms = createAtmosphereNodeUniforms();
  assert.equal(uniforms.farRetention.value, 0, "defaults to the pre-envelope behaviour");
  const saturated = heightFogReference(uniforms, 0, 24_000);
  uniforms.farRetention.value = 0.5;
  const lifted = heightFogReference(uniforms, 0, 24_000);
  assert.equal(saturated, 1);
  assert.ok(Math.abs(lifted - 0.5) < 1e-6, `expected ~0.5 with retention on, got ${lifted}`);
  assert.equal(createAtmosphereNodeUniforms({ farRetention: 0.2 }).farRetention.value, 0.2);
});

test("the TSL node graph really builds with the envelope in it", () => {
  // A numeric reference cannot catch a NODE_OPS entry that throws or is missing — only building
  // the actual graph does. `add` and `smoothstep` are reached solely through the envelope.
  const uniforms = createAtmosphereNodeUniforms({ farRetention: 0.5 });
  const node = createAtmosphereFog(uniforms);
  assert.ok(node, "createAtmosphereFog returned nothing");
});

test("the fog reference reads live uniform values, so it stays player-relative", () => {
  const uniforms = createAtmosphereNodeUniforms({ density: 0.02, heightFalloff: 0.025 });
  const atPlayerHeight = heightFogReference(uniforms, 0, 600);

  // Climbing 400m above the reference thins the fog...
  assert.ok(heightFogReference(uniforms, 400, 600) < atPlayerHeight, "fog thins above the reference height");
  // ...but moving the reference up with the player restores it exactly.
  uniforms.referenceHeight.value = 400;
  assert.equal(heightFogReference(uniforms, 400, 600), atPlayerHeight, "the falloff is measured from the player");
  // Below the reference the height term is clamped, so it never densifies further.
  assert.equal(heightFogReference(uniforms, 200, 600), heightFogReference(uniforms, -9000, 600));
});

test("createAtmosphereFog returns a node graph fed by every uniform", () => {
  const uniforms = createAtmosphereNodeUniforms();
  const fogNode = createAtmosphereFog(uniforms);

  assert.ok(fogNode, "scene.fogNode gets a node");
  assert.equal(typeof (fogNode as unknown as Traversable).getChildren, "function");

  const reached = collectNodes(fogNode);
  for (const [name, node] of Object.entries(uniforms)) {
    assert.ok(reached.has(node), `the ${name} uniform feeds the fog graph`);
  }
  const stranger = createAtmosphereNodeUniforms();
  assert.equal(reached.has(stranger.density), false, "and the traversal only reaches what is wired in");
});
