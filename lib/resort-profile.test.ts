import { test } from "node:test";
import assert from "node:assert/strict";
import {
  passList,
  profileAdditionalProperties,
  profileDescription,
  profileNumber,
  profilePasses,
  profileSameAs,
  resolveElevation,
  resolveVerticalFt,
  wikidataUrl,
} from "./resort-profile";

test("profileNumber accepts PostgREST numerics as strings and rejects junk", () => {
  assert.equal(profileNumber(2614), 2614);
  assert.equal(profileNumber("2614.5"), 2614.5);
  assert.equal(profileNumber(""), null);
  assert.equal(profileNumber(null), null);
  assert.equal(profileNumber(undefined), null);
  assert.equal(profileNumber(0), null);
  assert.equal(profileNumber("lots"), null);
});

test("profilePasses validates, dedupes and orders; passList reads as prose", () => {
  assert.deepEqual(profilePasses(["mountain-collective", "ikon", "ikon", "gold"]), ["ikon", "mountain-collective"]);
  assert.deepEqual(profilePasses(null), []);
  assert.deepEqual(profilePasses("ikon"), []);
  assert.equal(passList(["ikon"]), "Ikon Pass");
  assert.equal(passList(["ikon", "epic", "indy"]), "Ikon Pass, Epic Pass and Indy Pass");
});

test("additionalProperty rows exist only for values the row carries", () => {
  const rows = profileAdditionalProperties(
    { vertical_ft: 2538, annual_snowfall_in: 543, longest_run_mi: null, skiable_acres: 2614, passes: ["ikon"], runs_total: 119, lifts_total: null },
    { baseFt: 8530, summitFt: 11068 },
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["Vertical drop", "Average annual snowfall", "Skiable terrain", "Runs", "Season passes"],
  );
  assert.deepEqual(rows[0], { "@type": "PropertyValue", name: "Vertical drop", value: 2538, unitText: "ft" });
  assert.deepEqual(rows[4], { "@type": "PropertyValue", name: "Season passes", value: "Ikon Pass" });
  assert.deepEqual(profileAdditionalProperties({}, { baseFt: null, summitFt: null }), []);
  // Vertical derived from elevations when not stated.
  assert.deepEqual(profileAdditionalProperties({}, { baseFt: 8000, summitFt: 10000 }), [
    { "@type": "PropertyValue", name: "Vertical drop", value: 2000, unitText: "ft" },
  ]);
});

test("resolveElevation prefers the profile columns over resort_metadata; vertical falls back to the difference", () => {
  assert.deepEqual(resolveElevation({ elevation_base_ft: 8530, elevation_summit_ft: null }, { baseFt: 8000, summitFt: 11000 }), { baseFt: 8530, summitFt: 11000 });
  assert.deepEqual(resolveElevation({}, null), { baseFt: null, summitFt: null });
  assert.equal(resolveVerticalFt({ vertical_ft: 2538 }, { baseFt: 8530, summitFt: 11068 }), 2538);
  assert.equal(resolveVerticalFt({}, { baseFt: 8530, summitFt: 11068 }), 2538);
  assert.equal(resolveVerticalFt({}, { baseFt: 11068, summitFt: 8530 }), null);
});

test("sameAs lists site, socials and Wikidata once each, in order, skipping blanks", () => {
  assert.deepEqual(
    profileSameAs({ website_url: "https://www.alta.com", x_url: null, facebook_url: "https://facebook.com/alta", instagram_url: "https://facebook.com/alta", wikidata_id: "Q2840279" }),
    ["https://www.alta.com", "https://facebook.com/alta", "https://www.wikidata.org/wiki/Q2840279"],
  );
  assert.equal(wikidataUrl("2840279"), null);
  assert.equal(wikidataUrl(null), null);
});

test("a description is published only with a known source", () => {
  assert.deepEqual(profileDescription({ description: " Alta is… ", description_source: "operator" }), { text: "Alta is…", source: "operator" });
  assert.equal(profileDescription({ description: "Alta is…", description_source: null }), null);
  assert.equal(profileDescription({ description: "", description_source: "editor" }), null);
  assert.equal(profileDescription({}), null);
});
