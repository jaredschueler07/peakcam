import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { DEFAULT_RIDER_STYLE, OUTFITS, GEAR, type RiderCharacter, type OutfitId, type GearId } from "../config/rider-style";
import { SkierRenderer } from "./SkierRenderer";
import { createSkierState } from "../physics/skier";
import type { RiderMode, SnowboardStance } from "../config/rider-style";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createProceduralTerrain } from "../terrain/heightfield";
import { disposeObjectTree } from "./resources";

const terrain = createProceduralTerrain(DROP_IN_GAME_PROFILES.heavenly, 1);
terrain.normal = (_x, _z, out) => { out.x = 0; out.y = 1; out.z = 0; return out; };
const variants: [RiderMode, SnowboardStance, RiderCharacter][] = [["skier", "regular", "human"], ["snowboarder", "regular", "human"], ["snowboarder", "goofy", "human"], ["skier", "regular", "yeti"], ["snowboarder", "regular", "yeti"], ["snowboarder", "goofy", "yeti"]];

for (const [mode, stance, character] of variants) {
  test(`${character}/${mode}/${stance}: crouch lowers the head without moving boots through the snow`, () => {
    const scene = new THREE.Scene(), rig = new SkierRenderer(scene, { riderMode: mode, stance }, { ...DEFAULT_RIDER_STYLE, character });
    const state = Object.assign(createSkierState(), { boardRoll: 0, grabTime: 0, stumble: false });
    rig.update(state, terrain, 1);
    scene.updateMatrixWorld(true);
    const head = rig.root.getObjectByName("rider-head")!;
    const foot = rig.root.getObjectByName("left-foot")!;
    const initialHead = head.getWorldPosition(new THREE.Vector3());
    const initialFoot = foot.getWorldPosition(new THREE.Vector3());
    state.crouch = 1; state.jumpCharge = .4;
    rig.update(state, terrain, 1); scene.updateMatrixWorld(true);
    assert.ok(head.getWorldPosition(new THREE.Vector3()).y < initialHead.y - .25);
    assert.ok(foot.getWorldPosition(new THREE.Vector3()).distanceTo(initialFoot) < 1e-9);
    if (mode === "snowboarder") {
      for (const name of ["left-foot", "right-foot"]) {
        const boot = rig.root.getObjectByName(name)!;
        const toe = new THREE.Vector3(0, 0, 1).applyQuaternion(boot.quaternion);
        assert.ok(toe.z * boot.position.z > 0, "duck stance points toes away from the board center");
        const expected = boot.position.z > 0 ? Math.sin(Math.PI / 12) : -Math.sin(Math.PI / 30);
        assert.ok(Math.abs(toe.z - expected) < 1e-9, "front +15° and rear -6° in both stances");
      }
    }
    disposeObjectTree(scene);
  });

  test(`${character}/${mode}/${stance}: joints stay connected and ankle targets follow edged equipment`, () => {
    const scene = new THREE.Scene(), rig = new SkierRenderer(scene, { riderMode: mode, stance }, { ...DEFAULT_RIDER_STYLE, character });
    const state = Object.assign(createSkierState(), { boardRoll: 0, grabTime: 0, stumble: false });
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < 240; i++) {
      state.time = i / 120; state.crouch = (Math.sin(i / 30) + 1) / 2;
      state.lean = Math.sin(i / 20); state.boardRoll = state.lean * .6;
      state.onGround = i < 120; state.grabTime = i > 150 ? .5 : 0;
      state.crash = i > 200 ? .4 : 0; state.stumble = i > 220;
      rig.update(state, terrain, 1 / 120); scene.updateMatrixWorld(true);
      for (const side of ["left", "right"]) {
        for (const limb of ["arm", "leg"]) {
          const upper = rig.root.getObjectByName(`${side}-${limb}-upper`)!;
          const lower = rig.root.getObjectByName(`${side}-${limb}-lower`)!;
          a.set(0, 1, 0).applyMatrix4(upper.matrixWorld);
          b.set(0, 0, 0).applyMatrix4(lower.matrixWorld);
          assert.ok(a.distanceTo(b) < 1e-8, "upper and lower limb meet at joint");
          assert.ok(lower.matrixWorld.elements.every(Number.isFinite));
        }
        const shin = rig.root.getObjectByName(`${side}-leg-lower`)!;
        const foot = rig.root.getObjectByName(`${side}-foot`)!;
        a.set(0, 1, 0).applyMatrix4(shin.matrixWorld);
        b.set(0, .23, 0).applyMatrix4(foot.matrixWorld);
        assert.ok(a.distanceTo(b) < 1e-8, "shin ends inside boot");
      }
    }
    disposeObjectTree(scene);
  });

  test(`${character}/${mode}/${stance}: avatar stays inside its geometry budget without textures`, () => {
    const scene = new THREE.Scene(), rig = new SkierRenderer(scene, { riderMode: mode, stance }, { ...DEFAULT_RIDER_STYLE, character });
    let draws = 0, triangles = 0;
    rig.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      draws++;
      triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
      assert.ok(object.material instanceof THREE.MeshStandardMaterial);
      assert.equal(object.material.map, null);
      assert.equal(object.material.userData.heightFog, false);
    });
    assert.ok(draws <= 21, `${draws} avatar draws`);
    assert.ok(triangles < 6500, `${triangles} avatar triangles`);
    disposeObjectTree(scene);
  });
}


test("each outfit and gear print changes the actual mesh without mutating simulation state", () => {
  const state = Object.assign(createSkierState(), { boardRoll: 0, grabTime: 0, stumble: false }); state.lean = .5; state.crouch = .4;
  const before = structuredClone(state);
  const jacketColors = new Set<string>(), deckColors = new Set<string>();
  for (const outfit of Object.keys(OUTFITS) as OutfitId[]) {
    for (const gear of Object.keys(GEAR) as GearId[]) {
      const scene = new THREE.Scene();
      const style = { ...DEFAULT_RIDER_STYLE, outfit, board: gear };
      const rig = new SkierRenderer(scene, { riderMode: "snowboarder" }, style);
      rig.update(state, terrain, 1 / 120);
      const jacket = rig.root.getObjectByName("jacket") as THREE.Mesh;
      const deck = rig.root.getObjectByName("snowboard") as THREE.Mesh;
      jacketColors.add(Array.from(jacket.geometry.getAttribute("color").array).join(","));
      deckColors.add(Array.from(deck.geometry.getAttribute("color").array).join(","));
      assert.equal(rig.root.userData.riderStyle, style);
      assert.deepEqual(state, before);
      disposeObjectTree(scene);
    }
  }
  assert.equal(jacketColors.size, 3);
  assert.equal(deckColors.size, 3);
});
