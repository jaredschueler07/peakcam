import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureWorld } from "../testing/fixture-world";
import { createNearestRun } from "@/lib/game/terrain/real-heightfield";

test("Breckenridge grows a dense forest below treeline with the runs cut through it", () => {
  const world = fixtureWorld("breckenridge");
  assert.ok(world.trees.length > 80_000, `planted ${world.trees.length}`);
  assert.ok(world.trees.every((tree) => tree.y <= world.treeLineM), "nothing above treeline");
  const scratch = createNearestRun();
  let onGroomed = 0;
  for (let i = 0; i < world.trees.length; i += 25) {
    const tree = world.trees[i];
    const near = world.terrain.nearestRun(tree.x, tree.z, scratch);
    if (near.run && !near.run.gladed && near.d < near.run.halfWidthM) onGroomed += 1;
  }
  assert.equal(onGroomed, 0, "no trees inside a non-gladed run corridor");
  assert.ok(world.trees.every((tree) => tree.heightM >= 3 && tree.heightM <= 16.5 && tree.radiusM > 0));
});

test("Portillo sits above treeline and gets no trees", () => {
  assert.equal(fixtureWorld("ski-portillo").trees.length, 0);
});

test("the tree spatial hash indexes every tree once", () => {
  const world = fixtureWorld("heavenly");
  let indexed = 0;
  for (const list of world.treeCells.values()) indexed += list.length;
  assert.equal(indexed, world.trees.length);
});
