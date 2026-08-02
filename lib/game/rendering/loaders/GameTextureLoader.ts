import type * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import type { RendererBackend } from "../Renderer";

const TRANSCODER_PATH = "/game/basis/";

export interface GameTextureLoader {
  load(url: string): Promise<THREE.Texture>;
  dispose(): void;
}

export function resolveTranscoderPath(): string {
  return TRANSCODER_PATH;
}

export function createGameTextureLoader(renderer: RendererBackend): GameTextureLoader {
  if (!renderer) throw new Error("A renderer is required to create the game texture loader");

  const loader = new KTX2Loader();
  loader.setTranscoderPath(resolveTranscoderPath());
  // RendererBackend is the engine seam shared by WebGLRenderer and
  // WebGPURenderer. Keep either concrete renderer out of this module's type
  // imports while passing the runtime backend through to three's detector.
  loader.detectSupport(renderer as unknown as Parameters<KTX2Loader["detectSupport"]>[0]);

  return {
    load: (url) => loader.loadAsync(url),
    dispose: () => loader.dispose(),
  };
}
