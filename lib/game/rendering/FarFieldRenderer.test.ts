import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
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
