import assert from "node:assert/strict";
import { test } from "node:test";

import { resortGameProfileSchema } from "./schema";
import { DROP_IN_GAME_PROFILES } from "./profiles";

test("all Drop In game profiles satisfy the complete resort schema", () => {
  for (const [slug, profile] of Object.entries(DROP_IN_GAME_PROFILES)) {
    const result = resortGameProfileSchema.safeParse(profile);
    assert.strictEqual(
      result.success,
      true,
      result.success ? undefined : `${slug}: ${result.error.message}`,
    );
  }
});
