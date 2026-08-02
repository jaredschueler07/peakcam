import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  capturePhysicsV2Fixture,
  PHYSICS_V2_SURFACES,
  PHYSICS_V2_TAPES,
  serializeFixture,
} from "../../../scripts/capture-v1-fixtures.mjs";

const fixtureDirectory = path.join(__dirname, "fixtures", "physics-v2");

for (const surface of PHYSICS_V2_SURFACES) {
  for (const tape of PHYSICS_V2_TAPES) {
    test(`physicsV2 ${surface} ${tape} trace remains byte-identical`, async () => {
      const expected = readFileSync(
        path.join(fixtureDirectory, `${surface}-${tape}.json`),
        "utf8",
      );

      assert.strictEqual(
        serializeFixture(await capturePhysicsV2Fixture(surface, tape)),
        expected,
      );
    });
  }
}
