import * as THREE from "three";

/** Two crossed cards, each sampling one complete tree from the CC0 baked atlas. */
export function createForestGeometry(wideCrown: boolean): THREE.BufferGeometry {
  const width = wideCrown ? 5.3 : 3.3;
  const height = wideCrown ? 8.2 : 9;
  const u0 = wideCrown ? 2 / 3 : 0;
  const u1 = wideCrown ? 1 : 1 / 3;
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  for (let card = 0; card < 2; card++) {
    const plane = new THREE.PlaneGeometry(width, height).toNonIndexed();
    plane.translate(0, height / 2, 0);
    plane.rotateY(card * Math.PI / 2);
    const p = plane.getAttribute("position"), n = plane.getAttribute("normal"), uv = plane.getAttribute("uv");
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(u0 + uv.getX(i) * (u1 - u0), uv.getY(i));
    }
    plane.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(positions.length).fill(1), 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createForestMaterial(): THREE.MeshStandardMaterial {
  // Node unit tests do not create DOM images; browsers always use the local asset.
  const map = typeof document !== "undefined" && typeof document.createElementNS === "function"
    ? new THREE.TextureLoader().load("/game/textures/pine-atlas.webp")
    : new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.94, color: 0xc9dfdb });
  material.name = "CC0 pine foliage";
  return material;
}
