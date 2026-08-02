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

export async function createRendererBackend(
  canvas: HTMLCanvasElement,
  kind: RendererBackendKind,
): Promise<RendererBackend> {
  const { WebGPURenderer } = await import("three/webgpu");
  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    forceWebGL: kind === "webgl",
  });
  await renderer.init();
  return Object.assign(renderer as unknown as RendererBackend, { backendKind: kind });
}
