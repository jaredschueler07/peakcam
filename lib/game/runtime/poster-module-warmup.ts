import { loadWebGPUBackendModule, resolveBackendKind } from "../rendering/backend";

interface PosterModuleLoaders {
  runtime(): Promise<unknown>;
  webgpu(): Promise<unknown>;
}
const moduleLoaders: PosterModuleLoaders = {
  runtime: () => import("./createGame"),
  webgpu: loadWebGPUBackendModule,
};

/** Dedicated game-poster effect only. Imports code; never constructs a runtime/GPU or starts a run.
 * Imports cannot be cancelled, but have no owned graphics resources. All failures
 * are observed and Start still uses the ordinary module loader/error path.
 */
export async function warmPosterModules(
  search: string, hasWebGPU: boolean, signal?: AbortSignal, loaders: PosterModuleLoaders = moduleLoaders,
): Promise<void> {
  if (signal?.aborted) return;
  const runtime = Promise.resolve().then(() => signal?.aborted ? undefined : loaders.runtime());
  const backend = resolveBackendKind(search, hasWebGPU) === "webgpu"
    ? Promise.resolve().then(() => signal?.aborted ? undefined : loaders.webgpu()) : Promise.resolve();
  await Promise.allSettled([runtime, backend]);
}
