process.env.NEXT_PUBLIC_DROP_IN_ENABLED = "true";

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
    "/resorts/heavenly/drop-in",
  );
  assert.strictEqual(getDropInGameUrl("not a resort"), null);
});

test("with the kill switch off, every Drop In lookup denies and the roster is empty", async () => {
  const prev = process.env.NEXT_PUBLIC_DROP_IN_ENABLED;
  process.env.NEXT_PUBLIC_DROP_IN_ENABLED = "false";
  try {
    const mod = await import("./drop-in");
    assert.strictEqual(mod.isDropInEnabled(), false);
    assert.strictEqual(mod.isDropInResort("heavenly"), false);
    assert.strictEqual(mod.getDropInProfile("breckenridge"), null);
    assert.strictEqual(mod.getDropInGameUrl("ski-portillo"), null);
    assert.deepStrictEqual(mod.getDropInRoster(), []);
    assert.strictEqual(mod.dropInDisabledResponse().status, 404);
  } finally {
    process.env.NEXT_PUBLIC_DROP_IN_ENABLED = prev;
  }
});
