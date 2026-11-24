import { test } from "node:test";
import assert from "node:assert/strict";
import { isOffSeason, parseConditionsString, seasonalDefaultViewState } from "./map-utils";

test("isOffSeason and seasonalDefaultViewState use UTC months consistently across month boundaries", () => {
  // 2026-05-01T02:00:00Z is still Apr 30 20:00 MDT locally, but May 1 UTC.
  // UTC guarantees SSR and client browsers agree on the season flip.
  const mayBoundaryUtc = new Date("2026-05-01T02:00:00Z");
  assert.equal(isOffSeason(40, mayBoundaryUtc), true); // Northern hemisphere enters May off-season
  assert.equal(isOffSeason(-33, mayBoundaryUtc), false); // Southern hemisphere enters May ski season
  assert.equal(seasonalDefaultViewState(mayBoundaryUtc).latitude < 0, true);
});

test("parseConditionsString splits tags and narrative without ever leaking raw delimiters", () => {
  assert.deepEqual(parseConditionsString(null), { tags: [], narrative: "" });
  assert.deepEqual(parseConditionsString("Packed Powder"), { tags: [], narrative: "Packed Powder" });
  assert.deepEqual(parseConditionsString("Packed,Groomed||"), {
    tags: ["Packed", "Groomed"],
    narrative: "",
  });
  assert.deepEqual(parseConditionsString("Powder,Tree Run||10 in overnight"), {
    tags: ["Powder", "Tree Run"],
    narrative: "10 in overnight",
  });
});
