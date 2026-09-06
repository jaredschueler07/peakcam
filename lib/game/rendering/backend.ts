import type { RendererBackend } from "./Renderer";

export type RendererBackendKind = "webgpu" | "webgl";

/**
 * The one decision function for which backend a session gets. WebGPU wherever the browser has it;
 * `?gfx=webgl` forces the fallback, and `?gfx=webgpu` cannot conjure an adapter that is not there.
 *
 * Task 6 flipped the default to WebGPU, which retired its predecessor `resolveBackendOverride` —
 * that one returned `null` for "no override, keep the legacy WebGL path", a distinction with no
 * meaning once WebGPU became the default rather than the opt-in.
 */
export function resolveBackendKind(
  search: string,
  hasWebGPU: boolean,
): RendererBackendKind {
  if (!hasWebGPU) return "webgl";
  return new URLSearchParams(search).get("gfx") === "webgl" ? "webgl" : "webgpu";
}

/**
 * Compile-time guard for the cast below. `createRendererBackend` has to widen a `WebGPURenderer`
 * into `RendererBackend`, and the `as unknown as` it once used checked nothing — that is how
 * `renderLists` (a WebGLRenderer-only API) sat in the interface as *required* while the real WebGPU
 * renderer lacked it, and why an unconditional `renderLists.dispose()` crashed every WebGPU user on
 * unmount rather than failing the build. This assignment type-checks the renderer against every
 * member except the `backendKind` tag we synthesise, so declaring a member that WebGPURenderer does
 * not have is now a `tsc` error here instead of a runtime crash there.
 */
type WebGPURendererType = InstanceType<typeof import("three/webgpu").WebGPURenderer>;
type BackendContract = Omit<RendererBackend, "backendKind">;
const _webgpuSatisfiesBackend: (renderer: WebGPURendererType) => BackendContract = (renderer) => renderer;
void _webgpuSatisfiesBackend;

/** Module-only warmup: evaluates renderer code but never requests an adapter/device or context. */
export function loadWebGPUBackendModule(): Promise<typeof import("three/webgpu")> {
  return import("three/webgpu");
}

export async function createRendererBackend(
  canvas: HTMLCanvasElement,
  kind: RendererBackendKind,
): Promise<RendererBackend> {
  const { WebGPURenderer } = await loadWebGPUBackendModule();
  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: kind === "webgl",
  });
  await renderer.init();
  return Object.assign(renderer as unknown as RendererBackend, { backendKind: kind });
}
