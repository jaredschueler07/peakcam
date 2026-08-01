import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import * as THREE from "three";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createProceduralTerrain } from "../terrain/heightfield";
import type { TerrainMeta, TrailsFile } from "../terrain/formats";
import { createRealTerrain, type RealTerrainSampler } from "../terrain/real-heightfield";
import { createLandmarks, LANDMARK_COORDINATES } from "./LandmarkRenderer";

function loadRealTerrain(slug: "ski-portillo" | "heavenly"): RealTerrainSampler {
  const directory = path.join(process.cwd(), "public", "game", "terrain");
  const packed = brotliDecompressSync(readFileSync(path.join(directory, `${slug}.height.u16.br`)));
  return createRealTerrain(
    packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength) as ArrayBuffer,
    JSON.parse(readFileSync(path.join(directory, `${slug}.meta.json`), "utf8")) as TerrainMeta,
    JSON.parse(readFileSync(path.join(directory, `${slug}.trails.json`), "utf8")) as TrailsFile,
    { profile: DROP_IN_GAME_PROFILES[slug] },
  );
}

for (const slug of ["ski-portillo", "breckenridge", "heavenly"] as const) {
  test(`${slug} landmark dressing stays below 200 triangles and uses documented local coordinates`, () => {
    const profile = DROP_IN_GAME_PROFILES[slug];
    const group = createLandmarks(profile, createProceduralTerrain(profile, profile.seed));
    let triangles = 0;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      triangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute("position").count / 3;
    });
    assert.ok(triangles > 0 && triangles < 200, `triangle count was ${triangles}`);
    assert.deepEqual(group.userData.coordinates, LANDMARK_COORDINATES[slug]);
  });
}

test("Portillo hotel landmark is anchored at the real sampler height", () => {
  const terrain = loadRealTerrain("ski-portillo");
  const group = createLandmarks(DROP_IN_GAME_PROFILES["ski-portillo"], terrain);
  const hotel = group.children.find((child) =>
    child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry);
  assert.ok(hotel instanceof THREE.Mesh);
  const { x, z } = LANDMARK_COORDINATES["ski-portillo"].hotel;
  assert.ok(Math.abs(hotel.position.y - terrain.height(x, z)) <= 0.5,
    `hotel y=${hotel.position.y}, terrain y=${terrain.height(x, z)}`);
});

for (const slug of ["ski-portillo", "heavenly"] as const) {
  test(`${slug} water stays fogged, below terrain, and inside the real heightfield bbox`, () => {
    const terrain = loadRealTerrain(slug);
    const group = createLandmarks(DROP_IN_GAME_PROFILES[slug], terrain);
    const lake = group.children.find((child) =>
      child instanceof THREE.Mesh && child.geometry instanceof THREE.PlaneGeometry);
    assert.ok(lake instanceof THREE.Mesh);
    assert.ok(lake.material instanceof THREE.MeshBasicMaterial);
    assert.equal(lake.material.fog, true);
    const width = lake.geometry.parameters.width;
    const depth = lake.geometry.parameters.height;
    const half = terrain.meta.sizeM / 2;
    assert.ok(lake.position.x - width / 2 >= -half);
    assert.ok(lake.position.x + width / 2 <= half);
    assert.ok(lake.position.z - depth / 2 >= -half);
    assert.ok(lake.position.z + depth / 2 <= half);
    assert.ok(lake.position.y <= terrain.height(lake.position.x, lake.position.z));
  });
}
