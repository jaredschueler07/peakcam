import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { loadNodeFactories } from "./nodeFactories";
import { staticNodeFactories } from "./nodeFactories.fixture";

const GAME_ROOT = path.join(process.cwd(), "lib", "game");

/** Every module `three/webgpu` is allowed to reach the bundle through. */
const NODE_MODULES = new Set([
  "rendering/SkyNodeMaterial.ts",
  "rendering/SnowNodeMaterial.ts",
  "rendering/AtmosphereNode.ts",
  "rendering/ParticleNodeMaterial.ts",
  "rendering/CsmShadowsNode.ts",
  "rendering/NodePostProcessing.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".fixture.ts")) out.push(full);
  }
  return out;
}

/**
 * `three/tsl` re-exports from `three/webgpu`, so a value import of either drags 2.1 MB of WebGPU
 * renderer in behind it. Only the node-material modules may do that, and they are reachable from
 * app code exclusively through `loadNodeFactories()`'s dynamic imports — which is what puts them
 * in a chunk a WebGL session never fetches. `import type` is erased and therefore unrestricted.
 */
test("three/webgpu is only reachable through the node-material modules", () => {
  const offenders: string[] = [];
  for (const file of walk(GAME_ROOT)) {
    const relative = path.relative(GAME_ROOT, file);
    if (NODE_MODULES.has(relative)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"(three\/webgpu|three\/tsl|three\/addons\/csm\/CSMShadowNode\.js)"/gm)) {
      offenders.push(`${relative} → ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("nothing outside the boundary statically imports a node-material module at value level", () => {
  const offenders: string[] = [];
  for (const file of walk(GAME_ROOT)) {
    const relative = path.relative(GAME_ROOT, file);
    if (NODE_MODULES.has(relative) || relative === "rendering/nodeFactories.ts") continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"\.{1,2}\/(?:rendering\/)?(\w+)"/gm)) {
      const target = `rendering/${match[1]}.ts`;
      if (NODE_MODULES.has(target)) offenders.push(`${relative} → ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("loadNodeFactories resolves the same module set the fixture assembles, and caches it", async () => {
  const loaded = await loadNodeFactories();
  assert.deepEqual(Object.keys(loaded).sort(), Object.keys(staticNodeFactories()).sort());
  assert.equal(typeof loaded.sky.createSkyNodeMaterial, "function");
  assert.equal(typeof loaded.snow.createSnowNodeMaterial, "function");
  assert.equal(typeof loaded.atmosphere.createAtmosphereFog, "function");
  assert.equal(typeof loaded.particles.createParticleNodeMaterial, "function");
  assert.equal(typeof loaded.csm.CsmShadowsNode, "function");
  assert.equal(await loadNodeFactories(), loaded, "the modules are fetched once per session");
});
