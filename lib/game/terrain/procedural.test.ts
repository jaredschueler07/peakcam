import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import type { DropInResortSlug } from "../config/schema";
import { createProceduralTerrain } from "./heightfield";

const slugs: DropInResortSlug[] = ["ski-portillo", "breckenridge", "heavenly"];

for (const slug of slugs) {
  test(`procedural terrain is bit-identical to every v1 golden for ${slug}`, () => {
    const fixture = JSON.parse(readFileSync(path.join(
      process.cwd(), "tests", "fixtures", "drop-in-v1", `${slug}.json`,
    ), "utf8"));
    const terrain = createProceduralTerrain(DROP_IN_GAME_PROFILES[slug], DROP_IN_GAME_PROFILES[slug].seed);
    const out = { x: 0, y: 0, z: 0 };

    for (const sample of [...fixture.terrain.grid, ...fixture.terrain.random]) {
      assert.strictEqual(terrain.height(sample.x, sample.z), sample.height);
      terrain.normal(sample.x, sample.z, out);
      assert.deepStrictEqual([out.x, out.y, out.z], sample.normal);
      assert.ok(out.y > 0);
      assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < 1e-15);
    }
  });
}
