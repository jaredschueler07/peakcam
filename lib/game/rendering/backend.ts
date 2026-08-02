import type { RendererBackend } from "./Renderer";

export type RendererBackendKind = "webgpu" | "webgl";

export function resolveBackendOverride(
  search: string,
  hasWebGPU: boolean,
): RendererBackendKind | null {
  const requested = new URLSearchParams(search).get("gfx");
  if (requested !== "webgpu" && requested !== "webgl") return null;
  return requested === "webgpu" && hasWebGPU ? "webgpu" : "webgl";
}

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
