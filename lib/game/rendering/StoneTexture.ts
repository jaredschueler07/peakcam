import * as THREE from "three";
import { fbm } from "../terrain/noise";
/** Local mineral grain and fracture seams; generated once, no network assets. */
export function createStoneTexture(): THREE.DataTexture {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = fbm(x * 0.13, y * 0.13, 3);
    const seam = Math.pow(Math.max(0, Math.cos(x * 0.21 + y * 0.075 + grain * 6)), 16);
    const value = Math.round(170 + grain * 65 - seam * 55), at = (y * size + x) * 4;
    data[at] = value; data[at + 1] = value; data[at + 2] = Math.min(255, value + 4); data[at + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
