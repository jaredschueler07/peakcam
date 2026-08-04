import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  captureResortFixture,
  serializeFixture,
  V1_RESORT_SLUGS,
} from "../scripts/capture-v1-fixtures.mjs";

const fixtureDirectory = path.join(
  __dirname,
  "fixtures",
  "drop-in-v1",
);

for (const resortSlug of V1_RESORT_SLUGS) {
  test(`v1 terrain and physics parity remains byte-identical for ${resortSlug}`, () => {
    const expected = readFileSync(
      path.join(fixtureDirectory, `${resortSlug}.json`),
      "utf8",
    );

    assert.strictEqual(
      serializeFixture(captureResortFixture(resortSlug)),
      expected,
    );
  });
}
