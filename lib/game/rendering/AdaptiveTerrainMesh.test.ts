import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import * as THREE from "three";
import { AdaptiveTerrainMesh, AdaptiveTerrainStream } from "./AdaptiveTerrainMesh";
import { createRealTerrain } from "../terrain/real-heightfield";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { triangleHeight } from "../../../scripts/measure-terrain-resolution";

function terrain() {
  const base = "public/game/terrain/breckenridge";
  const bytes = brotliDecompressSync(fs.readFileSync(`${base}.height.u16.br`));
  return createRealTerrain(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer,
    JSON.parse(fs.readFileSync(`${base}.meta.json`, "utf8")), JSON.parse(fs.readFileSync(`${base}.trails.json`, "utf8")),
    { profile: DROP_IN_GAME_PROFILES.breckenridge });
}

test("adaptive mesh is a closed triangulation with one outer boundary, exact source vertices and upward winding", () => {
  const source = terrain(), mesh = new AdaptiveTerrainMesh(source, new THREE.MeshBasicMaterial());
  for (const [x, z] of [[0, 0], [-201, -399], [199.9, 200.1]]) {
    mesh.update(x, z);
    assert.ok(mesh.triangles < 60_000);
    const p = mesh.geometry.getAttribute("position"), idx = mesh.geometry.index!;
    const edges = new Map<string, number>();
    let area = 0;
    for (let i = 0; i < mesh.vertexCount; i++) assert.equal(p.getY(i), Math.fround(source.height(p.getX(i), p.getZ(i))));
    for (let i = 0; i < mesh.geometry.drawRange.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      const cross = (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) - (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
      assert.ok(cross > 0, "every triangle has area and faces upward"); area += cross / 2;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u},${v}` : `${v},${u}`; edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.equal(area, 1_000_000, "covers exactly the existing near-field window");
    for (const [key, count] of edges) {
      assert.ok(count === 1 || count === 2);
      if (count === 2) continue;
      const [a, b] = key.split(",").map(Number), bound = mesh.bounds;
      assert.ok((p.getX(a) === p.getX(b) && (p.getX(a) === bound.x || p.getX(a) === bound.z)) ||
        (p.getZ(a) === p.getZ(b) && (p.getZ(a) === bound.y || p.getZ(a) === bound.w)), "no open internal edges or T junctions");
    }
  }
  mesh.geometry.dispose(); mesh.mesh.material.dispose();
});

test("contact sampling matches every actual triangle including all stitched fans", () => {
  const source = terrain(), mesh = new AdaptiveTerrainMesh(source, new THREE.MeshBasicMaterial());
  mesh.update(-205, 183);
  const p = mesh.geometry.getAttribute("position"), idx = mesh.geometry.index!;
  for (let i = 0; i < mesh.geometry.drawRange.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.1, 0.25, 0.65]]) {
      const x = p.getX(a) * wa + p.getX(b) * wb + p.getX(c) * wc;
      const z = p.getZ(a) * wa + p.getZ(b) * wb + p.getZ(c) * wc;
      const y = p.getY(a) * wa + p.getY(b) * wb + p.getY(c) * wc;
      assert.ok(Math.abs(mesh.sampleRenderedHeight(x, z) - y) < 1e-8, `triangle ${i / 3}`);
    }
  }
  mesh.geometry.dispose(); mesh.mesh.material.dispose();
});

test("movement and negative lattice crossings retain geometry and all buffers; rider neighbourhood is 1m", () => {
  const source = terrain(), mesh = new AdaptiveTerrainMesh(source, new THREE.MeshBasicMaterial());
  const geometry = mesh.geometry, positions = geometry.getAttribute("position").array, indices = geometry.index!.array;
  const times: number[] = [];
  for (let i = 0; i < 35; i++) {
    const x = -602 + i * 33.3, z = -403 + i * 7.8;
    mesh.update(x, z); times.push(mesh.lastBuildMs);
    assert.equal(mesh.geometry, geometry); assert.equal(geometry.getAttribute("position").array, positions); assert.equal(geometry.index!.array, indices);
    assert.ok(mesh.triangles < 60_000);
    for (const side of [-10, 0, 10]) assert.ok(Math.abs(mesh.sampleRenderedHeight(x + side, z) - triangleHeight(source.height, x + side, z, 1)) < 1e-9);
    const count = mesh.rebuilds; mesh.update(x, z); assert.equal(mesh.rebuilds, count);
  }
  console.log(JSON.stringify({ adaptiveTriangles: mesh.triangles, bufferBytes: mesh.bufferBytes, buildMs: times }));
  mesh.geometry.dispose(); mesh.mesh.material.dispose();
});


test("mobile coarsens the outer ring while retaining watertight joins and the original window", () => {
  const source = terrain(), mesh = new AdaptiveTerrainMesh(source, new THREE.MeshBasicMaterial(), true);
  for (const [x, z] of [[0, 0], [201, -201], [199.9, -0.1], [-602, -403]]) {
    mesh.update(x, z);
    assert.ok(mesh.triangles < 31_250, `mobile terrain count ${mesh.triangles} stays below baseline`);
    const p = mesh.geometry.getAttribute("position"), idx = mesh.geometry.index!;
    const edges = new Map<string, number>(); let area = 0;
    for (let i = 0; i < mesh.geometry.drawRange.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      area += ((p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) - (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a))) / 2;
      const px = (p.getX(a) + p.getX(b) + p.getX(c)) / 3, pz = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
      assert.ok(Math.abs(mesh.sampleRenderedHeight(px, pz) - (p.getY(a) + p.getY(b) + p.getY(c)) / 3) < 1e-8);
      for (const [u, v] of [[a, b], [b, c], [c, a]]) { const key = u < v ? `${u},${v}` : `${v},${u}`; edges.set(key, (edges.get(key) ?? 0) + 1); }
    }
    assert.equal(area, 1_000_000);
    for (const [key, count] of edges) {
      assert.ok(count === 1 || count === 2); if (count === 2) continue;
      const [a, b] = key.split(",").map(Number), bound = mesh.bounds;
      assert.ok((p.getX(a) === p.getX(b) && (p.getX(a) === bound.x || p.getX(a) === bound.z)) ||
        (p.getZ(a) === p.getZ(b) && (p.getZ(a) === bound.y || p.getZ(a) === bound.w)));
    }
    for (const side of [-6, 0, 6]) assert.ok(Math.abs(mesh.sampleRenderedHeight(x + side, z) - triangleHeight(source.height, x + side, z, 1)) < 1e-9);
  }
  mesh.geometry.dispose(); mesh.mesh.material.dispose();
});


test("stream keeps complete geometry and contact live until an atomic swap, with exactly two reserved buffers", () => {
  const source = terrain(), stream = new AdaptiveTerrainStream(source, new THREE.MeshBasicMaterial(), true);
  stream.update(195, -195);
  const original = stream.geometry, originalBounds = stream.bounds.clone();
  const oldHeight = stream.sampleRenderedHeight(200.25, -195);
  const observed = new Set<THREE.BufferGeometry>([original]);
  stream.update(211, -195);
  assert.equal(stream.geometry, original, "a partial build is never presented");
  assert.deepEqual(stream.bounds, originalBounds);
  assert.equal(stream.sampleRenderedHeight(200.25, -195), oldHeight);
  for (const x of [211, 243, 195, -201, 201]) {
    for (let i = 0; i < 200; i++) { stream.update(x, -195); observed.add(stream.geometry); }
    assert.equal(stream.mesh.geometry, stream.geometry);
    assert.equal(stream.rebuilding, false);
    assert.equal(stream.bounds.x, (Math.floor(x / 200) - 2) * 200);
    assert.ok(Math.abs(stream.sampleRenderedHeight(x + 0.25, -195) - triangleHeight(source.height, x + 0.25, -195, 1)) < 1e-9);
  }
  assert.equal(observed.size, 2, "only the two constructor-reserved geometries are used");
  let disposed = 0; for (const g of observed) g.addEventListener("dispose", () => disposed++);
  stream.disposeInactiveGeometry(); stream.disposeInactiveGeometry(); stream.geometry.dispose();
  assert.equal(disposed, 2); stream.mesh.material.dispose();
});
