import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import type { TerrainSampler } from "../core/types";

export const LANDMARK_COORDINATES = {
  "ski-portillo": {
    lake: { x: -351, z: -2172, elevationM: 2849 },
    hotel: { x: -41, z: -689 },
  },
  heavenly: {
    lake: { x: -1450, z: -2920, elevationM: 1897 },
  },
  breckenridge: {
    townGlow: { x: 2820, z: -420 },
  },
} as const;

function fittedSpan(center: number, length: number, halfSizeM: number): {
  center: number; length: number;
} {
  if (!Number.isFinite(halfSizeM)) return { center, length };
  const fittedLength = Math.min(length, halfSizeM * 2);
  const inset = fittedLength / 2;
  return {
    center: Math.max(-halfSizeM + inset, Math.min(halfSizeM - inset, center)),
    length: fittedLength,
  };
}

function water(
  terrain: TerrainSampler, x: number, z: number, elevationM: number,
  width: number, depth: number, color: number,
): THREE.Mesh {
  const meta = (terrain as TerrainSampler & { meta?: { sizeM: number } }).meta;
  const halfSizeM = meta ? meta.sizeM / 2 : Infinity;
  const clippedX = fittedSpan(x, width, halfSizeM);
  const clippedZ = fittedSpan(z, depth, halfSizeM);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(clippedX.length, clippedZ.length),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.68, side: THREE.DoubleSide,
      fog: true, depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    clippedX.center,
    Math.min(elevationM, terrain.height(clippedX.center, clippedZ.center) - 0.5),
    clippedZ.center,
  );
  mesh.userData.terrainFootprint = { halfX: clippedX.length / 2, halfZ: clippedZ.length / 2 };
  return mesh;
}

export function createLandmarks(profile: ResortGameProfile, terrain: TerrainSampler): THREE.Group {
  const group = new THREE.Group();
  const coordinates = LANDMARK_COORDINATES[profile.slug];
  group.userData.coordinates = coordinates;
  group.name = `${profile.slug}-landmarks`;
  if (profile.slug === "ski-portillo") {
    const coordinates = LANDMARK_COORDINATES["ski-portillo"];
    const lake = water(
      terrain, coordinates.lake.x, coordinates.lake.z, coordinates.lake.elevationM,
      700, 260, 0x2a9bb2,
    );
    lake.name = "portillo-lake";
    const hotelGeometry = new THREE.BoxGeometry(48, 12, 24);
    hotelGeometry.translate(0, 6, 0);
    const hotel = new THREE.Mesh(
      hotelGeometry,
      new THREE.MeshStandardMaterial({ color: 0xf3b52d, roughness: 0.82, emissive: 0x9d5c08, emissiveIntensity: 0.12, fog: true }),
    );
    hotel.name = "portillo-hotel";
    hotel.userData.terrainFootprint = { halfX: 24, halfZ: 12 };
    hotel.position.set(coordinates.hotel.x, terrain.height(coordinates.hotel.x, coordinates.hotel.z), coordinates.hotel.z);
    group.add(lake, hotel);
  } else if (profile.slug === "heavenly") {
    const coordinates = LANDMARK_COORDINATES.heavenly;
    const lake = water(
      terrain, coordinates.lake.x, coordinates.lake.z, coordinates.lake.elevationM,
      900, 360, 0x3b86aa,
    );
    lake.name = "heavenly-lake";
    group.add(lake);
  } else {
    const coordinates = LANDMARK_COORDINATES.breckenridge;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(480, 90),
      new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }),
    );
    glow.name = "breckenridge-town-glow";
    // The billboard is rotated 90° below, so its long local-X axis lies on world Z.
    glow.userData.terrainFootprint = { halfX: 10, halfZ: 240 };
    glow.position.set(coordinates.townGlow.x, terrain.height(coordinates.townGlow.x, coordinates.townGlow.z) + 75, coordinates.townGlow.z);
    glow.rotation.y = -Math.PI / 2;
    group.add(glow);
  }
  return group;
}
