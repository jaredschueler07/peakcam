/**
 * The single dynamic boundary between the app bundle and `three/webgpu`.
 *
 * Every node-material module reaches `three/webgpu` — directly, or through `three/tsl` and
 * `three/addons/csm/CSMShadowNode.js`, both of which re-export from it. That is 2.1 MB of a
 * renderer a WebGL session never executes, and it used to ship to every session because
 * `SceneFactory`, `TerrainRenderer`, `EffectsRenderer` and `Renderer` imported those modules
 * statically. Routing them all through the dynamic imports below puts the whole node pipeline in
 * one chunk that only the WebGPU path fetches.
 *
 * The rule this rests on, pinned by `nodeFactories.test.ts`: nothing outside the listed modules
 * may import `three/webgpu`, `three/tsl`, `CSMShadowNode.js`, or any node-material module at
 * value level. `import type` is erased by TypeScript and costs nothing, so type imports stay free.
 */
export interface NodeFactories {
  readonly sky: typeof import("./SkyNodeMaterial");
  readonly snow: typeof import("./SnowNodeMaterial");
  readonly atmosphere: typeof import("./AtmosphereNode");
  readonly particles: typeof import("./ParticleNodeMaterial");
  readonly csm: typeof import("./CsmShadowsNode");
}

/** Share in-flight/successful module loads, but let Start retry a failed poster prefetch. */
export function createNodeFactoriesLoader(load: () => Promise<NodeFactories>): () => Promise<NodeFactories> {
  let pending: Promise<NodeFactories> | null = null;
  return () => {
    pending ??= Promise.resolve().then(load).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

/**
 * Resolves the node pipeline, fetching its chunk on first call. Cached, because a session builds
 * the scene once but `Renderer` and `createGame` both want the same module instances — two
 * `CSMShadowNode` copies would be two different classes to `instanceof`.
 */
export const loadNodeFactories = createNodeFactoriesLoader(() => {
  // The renderer needs this chain before prewarm too. Start its module request
  // beside the material modules, while terrain/GPU startup is already in flight.
  // Preserve optional post failure semantics: Renderer owns its normal fallback.
  void import("./NodePostProcessing").catch(() => {});
  return Promise.all([
    import("./SkyNodeMaterial"),
    import("./SnowNodeMaterial"),
    import("./AtmosphereNode"),
    import("./ParticleNodeMaterial"),
    import("./CsmShadowsNode"),
  ]).then(([sky, snow, atmosphere, particles, csm]) => ({ sky, snow, atmosphere, particles, csm }));
});
