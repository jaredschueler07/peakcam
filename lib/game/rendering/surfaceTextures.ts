import * as THREE from "three";
import type { GameTextureLoader } from "./loaders/GameTextureLoader";

const SNOW_NORMAL_URL = "/game/textures/snow-normal.ktx2";
const SNOW_ROUGHNESS_URL = "/game/textures/snow-roughness.ktx2";

export interface SurfaceTextures {
  snowNormal: THREE.Texture;
  snowRoughness: THREE.Texture;
}

function configureSurfaceTexture(texture: THREE.Texture): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
}

/**
 * Load the optional snow surface pair. Asset failure is deliberately soft:
 * callers retain the procedural detail normal when either KTX2 is unavailable.
 */
export async function loadSurfaceTextures(loader: GameTextureLoader): Promise<SurfaceTextures | null> {
  let snowNormal: THREE.Texture | null = null;
  try {
    snowNormal = await loader.load(SNOW_NORMAL_URL);
    const snowRoughness = await loader.load(SNOW_ROUGHNESS_URL);
    configureSurfaceTexture(snowNormal);
    configureSurfaceTexture(snowRoughness);
    return { snowNormal, snowRoughness };
  } catch {
    snowNormal?.dispose();
    return null;
  }
}
