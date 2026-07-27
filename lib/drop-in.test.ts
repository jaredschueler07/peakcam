import { test } from "node:test";
import assert from "node:assert";
import {
  DROP_IN_RESORT_SLUGS,
  getDropInGameUrl,
  getDropInProfile,
  isDropInResort,
} from "./drop-in";

test("the Drop In pilot exposes exactly Portillo, Breckenridge, and Heavenly", () => {
  assert.deepStrictEqual(DROP_IN_RESORT_SLUGS, [
    "ski-portillo",
    "breckenridge",
    "heavenly",
  ]);
});

test("every pilot resort has a complete six-run game profile", () => {
  for (const slug of DROP_IN_RESORT_SLUGS) {
    const profile = getDropInProfile(slug);
    assert.ok(profile);
    assert.strictEqual(profile.slug, slug);
    assert.ok(profile.name.length > 0);
    assert.ok(profile.tagline.length > 0);
    assert.ok(profile.summitElevationFt > 0);
    assert.ok(profile.verticalDropFt > 0);
    assert.ok(profile.terrainSeed > 0);
    assert.match(profile.accent, /^#[0-9a-f]{6}$/i);
    assert.strictEqual(profile.trailNames.length, 6);
    assert.strictEqual(new Set(profile.trailNames).size, 6);
  }
});

test("unsupported resorts do not expose Drop In", () => {
  assert.strictEqual(isDropInResort("vail"), false);
  assert.strictEqual(getDropInProfile("vail"), null);
});

test("supported resorts receive a stable encoded game URL", () => {
  assert.strictEqual(isDropInResort("heavenly"), true);
  assert.strictEqual(
    getDropInGameUrl("heavenly"),
    "/drop-in/engine.html?resort=heavenly",
  );
  assert.strictEqual(getDropInGameUrl("not a resort"), null);
});
