import { test } from "node:test";
import assert from "node:assert/strict";
import { RESORT_BAKE_CONFIGS } from "../../lib/game/terrain/resorts";
import { attributionFor, resolveDemSource } from "./sources";

test("each pilot resort resolves to its designed source", () => {
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["breckenridge"]), {
    kind: "3dep",
    project: "CO_Central_and_WesternCO_2016_A16",
  });
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["heavenly"]), {
    kind: "3dep",
    project: "CA_SierraNevada_B22",
  });
  assert.deepEqual(resolveDemSource(RESORT_BAKE_CONFIGS["ski-portillo"]), {
    kind: "copernicus",
    tile: "S33_00_W071_00",
  });
});

test("terrarium fallback carries the attribution obligation it attaches", () => {
  const a = attributionFor({ kind: "terrarium" });
  assert.match(a.licence, /mixed/i);
  assert.ok(a.notice.length > 0, "fallback must state the obligation it creates");
});

test("3DEP and Copernicus carry their real licence terms", () => {
  assert.match(attributionFor({ kind: "3dep", project: "x" }).licence, /public domain/i);
  const cop = attributionFor({ kind: "copernicus", tile: "x" });
  // Article 6(c) requires a liability disclaimer, not merely a credit line.
  assert.ok(cop.notice.some((n) => /no warranty|liability/i.test(n)));
});
