import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import fs from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { DROP_IN_GAME_PROFILES } from '../config/profiles';
import type { SimulationWorld } from '../core/types';
import { createSimulation } from '../core/simulation';
import { createProceduralWorld, createWorld } from '../terrain/obstacles';
import { createRealTerrain } from '../terrain/real-heightfield';
import { TerrainRenderer } from './TerrainRenderer';
import { SkierRenderer } from './SkierRenderer';
import { disposeObjectTree } from './resources';
const profile = DROP_IN_GAME_PROFILES['ski-portillo'];

function flat() {
  const base = createProceduralWorld(profile, profile.seed);
  const world: SimulationWorld = { ...base, terrain: { ...base.terrain, height: () => 100, normal: (_x, _z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; } } };
  const state = createSimulation(profile, profile.seed); state.pos.x = state.pos.z = 0; state.pos.y = 100; state.onGround = true; state.crash = 0; state.lean = 0; state.crouch = 0; state.vel.x = state.vel.z = 0;
  return { world, state };
}

test('grounded skis and boots stay planted when the torso tucks', () => {
  const { world, state } = flat(), scene = new THREE.Scene(), skier = new SkierRenderer(scene);
  const ground = { sampleRenderedHeight: () => 100.3 };
  skier.update(state, world.terrain, 10, ground); scene.updateMatrixWorld(true);
  const feet = skier.root.getObjectByName('skier-feet')!, body = skier.root.getObjectByName('skier-body')!;
  const matrices = feet.children.map(child => child.matrixWorld.clone()), standingBody = body.matrixWorld.clone();
  state.crouch = 1; skier.update(state, world.terrain, 10, ground); scene.updateMatrixWorld(true);
  assert.deepEqual(feet.children.map(child => child.matrixWorld), matrices);
  assert.notDeepEqual(body.matrixWorld, standingBody);
  assert.equal(skier.root.position.y, 100.3); assert.equal(state.pos.y, 100);
  disposeObjectTree(scene);
});

test('grounded contact preserves support offset while air and lift root positions stay canonical', () => {
  const { world, state } = flat(), scene = new THREE.Scene(), skier = new SkierRenderer(scene);
  const ground = { sampleRenderedHeight: () => 101 };
  state.pos.y = 99.9;
  skier.update(state, world.terrain, 10, ground); assert.ok(Math.abs(skier.root.position.y - 100.9) < 1e-9);
  state.onGround = false; state.pos.y = 104; skier.update(state, world.terrain, 10, ground); assert.equal(skier.root.position.y, 104);
  state.onGround = true; state.liftIndex = 0; skier.update(state, world.terrain, 10, ground); assert.equal(skier.root.position.y, 104);
  disposeObjectTree(scene);
});

test('Portillo captured contact clears the full ski planks at both mesh resolutions without changing physics', () => {
  const base = 'public/game/terrain/ski-portillo', raw = brotliDecompressSync(fs.readFileSync(`${base}.height.u16.br`));
  const terrain = createRealTerrain(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length), JSON.parse(fs.readFileSync(`${base}.meta.json`, 'utf8')), JSON.parse(fs.readFileSync(`${base}.trails.json`, 'utf8')), { profile });
  const world = createWorld(profile, profile.seed, terrain), state = createSimulation(profile, profile.seed);
  Object.assign(state.pos, { x: -796.3001064716124, y: 2985.6549166778073, z: -774.2831095557972 });
  state.yaw = 1.4449002993357425; state.onGround = true; state.crash = 0; state.lean = 0; state.crouch = 0;
  const original = structuredClone(state.pos), scene = new THREE.Scene(), terrainRenderer = new TerrainRenderer(scene, world), skier = new SkierRenderer(scene);
  terrainRenderer.update(state.pos.x, state.pos.z);
  for (const rung of [1, 4] as const) for (const crouch of [0, 1]) {
    terrainRenderer.setQuality(rung); state.crouch = crouch;
    const difference = terrainRenderer.sampleRenderedHeight(state.pos.x, state.pos.z) - terrain.height(state.pos.x, state.pos.z);
    assert.ok(difference > (rung === 1 ? 0.19 : 0.34), 'fixture reproduces actual surface above canonical pose');
    skier.update(state, terrain, 10, terrainRenderer); scene.updateMatrixWorld(true);
    let checked = 0;
    scene.traverse(object => {
      if (object.name !== 'ski-shell') return;
      const point = new THREE.Vector3();
      for (let z = -0.93; z <= 0.93; z += 0.031) for (const side of [-1, 1]) {
        point.set(side * 0.08, -0.0275, z).applyMatrix4(object.matrixWorld);
        assert.ok(point.y >= terrainRenderer.sampleRenderedHeight(point.x, point.z) - 0.001, `rung${rung}/crouch${crouch} ski intersects snow`); checked++;
      }
    });
    assert.ok(checked > 200); assert.deepEqual(state.pos, original);
  }
  terrainRenderer.dispose(); disposeObjectTree(scene);
});
