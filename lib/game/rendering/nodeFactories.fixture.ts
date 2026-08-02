/**
 * Test-only assembly of the node pipeline. `loadNodeFactories()` is async and the renderer
 * constructors it feeds are synchronous, so tests that build a WebGPU scene would otherwise need
 * a top-level await this toolchain does not compile (`target: ES2017`, tsx emits CJS).
 *
 * Static imports are correct *here* and nowhere else: a `.fixture.ts` is unreachable from app
 * code, so it never pulls `three/webgpu` into a shipped chunk. `nodeFactories.test.ts` exempts
 * this file from the boundary check for exactly that reason.
 */
import * as sky from "./SkyNodeMaterial";
import * as snow from "./SnowNodeMaterial";
import * as atmosphere from "./AtmosphereNode";
import * as particles from "./ParticleNodeMaterial";
import * as csm from "./CsmShadowsNode";
import type { NodeFactories } from "./nodeFactories";

export function staticNodeFactories(): NodeFactories {
  return { sky, snow, atmosphere, particles, csm };
}
