import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { FarFieldBatch } from './FarFieldBatch';
import { FarFieldRenderer } from './FarFieldRenderer';
import { staticNodeFactories } from './nodeFactories.fixture';
import { disposeObjectTree } from './resources';
import type { DecodedFarField } from '../terrain/far-field-format';

function fixture(withLod = true): DecodedFarField {
  return { meta: { formatVersion: 1, slug: 'ski-portillo', radiusM: 30000, wedgeCount: 1, centre: [-32.842, -70.129], demSource: 'fixture', bakedAt: 'fixture' },
    wedges: [{ index: 0, azimuthStartRad: 0, azimuthEndRad: Math.PI / 2, minY: 1, maxY: 3,
      positions: new Float32Array([0, 1, 0, 0, 2, -100, 100, 3, 0, 100, 2, -100]), indices: new Uint32Array([0, 1, 2, 1, 3, 2]) }],
    lodIndices: withLod ? [new Uint32Array([0, 1, 2])] : undefined };
}

test('both far-field backends restore high topology with unchanged attributes, material, clipping and wedge visibility', () => {
  for (const nodes of [null, staticNodeFactories()]) {
    const scene = new THREE.Scene(), asset = fixture(), renderer = new FarFieldRenderer(scene, asset, { nodes });
    const mesh = renderer.group.children[0] as THREE.Mesh, high = mesh.geometry, material = mesh.material;
    const sphere = new THREE.Frustum(); renderer.update(new THREE.Vector3(), sphere, { x: 0, z: 0 });
    const visible = mesh.visible, bounds = renderer.nearBounds.clone();
    renderer.setQuality(1); const low = mesh.geometry;
    assert.notEqual(low, high); assert.equal(low.index!.array, asset.lodIndices![0]);
    assert.equal(low.getAttribute('position'), high.getAttribute('position'));
    assert.equal(low.getAttribute('normal'), high.getAttribute('normal'));
    assert.equal(mesh.material, material); assert.equal(mesh.visible, visible); assert.deepEqual(renderer.nearBounds, bounds);
    renderer.setQuality(0); assert.equal(mesh.geometry, low);
    renderer.setQuality(4); assert.equal(mesh.geometry, high); assert.equal(high.index!.array, asset.wedges[0].indices);
    renderer.dispose();
  }
});

test('a missing optional LOD retains the full horizon at low quality', () => {
  const scene = new THREE.Scene(), renderer = new FarFieldRenderer(scene, fixture(false), { nodes: null });
  const mesh = renderer.group.children[0] as THREE.Mesh, high = mesh.geometry;
  renderer.setQuality(1); assert.equal(mesh.geometry, high); renderer.dispose();
});

test('scene-owned or direct disposal releases both index-owning geometries exactly once', () => {
  for (const sceneOwned of [false, true]) for (const endLow of [false, true]) {
    const scene = new THREE.Scene(), renderer = new FarFieldRenderer(scene, fixture(), { nodes: null });
    const mesh = renderer.group.children[0] as THREE.Mesh, high = mesh.geometry;
    renderer.setQuality(1); const low = mesh.geometry;
    renderer.setQuality(endLow ? 1 : 4);
    let highs = 0, lows = 0;
    high.addEventListener('dispose', () => highs++); low.addEventListener('dispose', () => lows++);
    if (sceneOwned) disposeObjectTree(scene); else { renderer.dispose(); renderer.dispose(); }
    assert.equal(highs, 1); assert.equal(lows, 1);
  }
});

test('pending adaptive movement clips the far field to the visible buffer, not the requested player tile', () => {
  for (const nodes of [null, staticNodeFactories()]) {
    const scene = new THREE.Scene(), renderer = new FarFieldRenderer(scene, fixture(), { nodes });
    const camera = new THREE.Vector3(), frustum = new THREE.Frustum();
    const active = new THREE.Vector4(-400, -200, 600, 800);
    renderer.update(camera, frustum, { x: 201, z: 201 }, active);
    assert.deepEqual(renderer.nearBounds.toArray(), [-399, -199, 599, 799]);
    active.set(-200, 0, 800, 1000);
    renderer.update(camera, frustum, { x: 201, z: 201 }, active);
    assert.deepEqual(renderer.nearBounds.toArray(), [-199, 1, 799, 999]);
    renderer.update(camera, frustum, { x: 0, z: 0 });
    assert.deepEqual(renderer.nearBounds.toArray(), [-399, -199, 599, 799]);
    renderer.dispose();
  }
});


test('mobile adaptive far field retains source LOD indices through shader upgrades on both backends', () => {
  for (const nodes of [null, staticNodeFactories()]) {
    const scene = new THREE.Scene(), asset = fixture(), renderer = new FarFieldRenderer(scene, asset, { nodes, mobileGeometry: true });
    const mesh = renderer.group.children[0] as THREE.Mesh;
    renderer.setQuality(1); const coarse = mesh.geometry, material = mesh.material;
    for (const rung of [0, 2, 4, 1, 3] as const) {
      renderer.setQuality(rung); assert.equal(mesh.geometry, coarse);
      assert.equal(mesh.geometry.index!.array, asset.lodIndices![0]); assert.equal(mesh.material, material);
    }
    renderer.dispose();
  }
});


test('batched far-field visibility preserves exact source triangles and stable backing storage', () => {
  const geometries = [0, 1, 2].map(i => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([i * 20, 0, 0, i * 20, 2, 10, i * 20 + 10, 3, 0]), 3));
    g.setIndex([0, 1, 2]); g.computeVertexNormals(); return g;
  });
  const material = new THREE.MeshBasicMaterial(), batch = new FarFieldBatch(geometries, material);
  const geometry = batch.mesh.geometry, positions = geometry.getAttribute('position'), indices = geometry.index!;
  for (let w = 0; w < 3; w++) for (let v = 0; v < 3; v++) {
    assert.equal(positions.getX(w * 3 + v), geometries[w].getAttribute('position').getX(v));
    assert.equal(positions.getY(w * 3 + v), geometries[w].getAttribute('position').getY(v));
    assert.equal(positions.getZ(w * 3 + v), geometries[w].getAttribute('position').getZ(v));
  }
  const visibility = new Uint8Array([1, 0, 1]); batch.update(visibility);
  assert.deepEqual(Array.from(indices.array.slice(0, geometry.drawRange.count)), [0, 1, 2, 6, 7, 8]);
  const version = indices.version, backing = indices.array; batch.update(visibility); assert.equal(indices.version, version);
  visibility.set([0, 1, 0]); batch.update(visibility);
  assert.deepEqual(Array.from(indices.array.slice(0, geometry.drawRange.count)), [3, 4, 5]);
  assert.equal(indices.array, backing); assert.equal(batch.mesh.geometry, geometry);
  visibility.fill(0); batch.update(visibility); assert.equal(geometry.drawRange.count, 0); assert.equal(batch.mesh.visible, false);
  geometry.dispose(); for (const g of geometries) g.dispose(); material.dispose();
});

test('mobile far-field batch is the only visible terrain draw and is released with either teardown owner', () => {
  for (const sceneOwned of [false, true]) for (const nodes of [null, staticNodeFactories()]) {
    const scene = new THREE.Scene(), renderer = new FarFieldRenderer(scene, fixture(), { nodes, mobileGeometry: true });
    renderer.setQuality(4); renderer.update(new THREE.Vector3(), new THREE.Frustum(), { x: 0, z: 0 });
    const batch = renderer.group.getObjectByName('far-field-mobile-batch') as THREE.Mesh;
    assert.equal(renderer.group.children.filter(c => c.visible).length, 1); assert.equal(batch.visible, true);
    assert.equal(batch.geometry.drawRange.count, 3);
    let disposed = 0; batch.geometry.addEventListener('dispose', () => disposed++);
    if (sceneOwned) disposeObjectTree(scene); else { renderer.dispose(); renderer.dispose(); }
    assert.equal(disposed, 1);
  }
});
