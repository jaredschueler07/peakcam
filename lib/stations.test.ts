import { test } from "node:test";
import assert from "node:assert/strict";

import { STATION_INDEX, stationFor, stationMeta } from "./stations";
import { resortSentence, type QuotableResort } from "./quotable";
import type { SnowReport } from "./types";

const NOW = new Date("2026-10-18T15:00:00Z");

function snow(source: SnowReport["source"]): SnowReport {
  return {
    id: "r1",
    resort_id: "id-breck",
    base_depth: null,
    new_snow_24h: 1,
    new_snow_48h: null,
    trails_open: null,
    trails_total: null,
    lifts_open: null,
    lifts_total: null,
    conditions: null,
    source,
    updated_at: "2026-10-18T12:00:00Z",
    swe_in: null,
    pct_of_normal: null,
    trend_7d: null,
    outlook: null,
    auto_cond_rating: null,
    snowing_now: false,
  };
}

function resort(station: string | null, source: SnowReport["source"] = "snotel"): QuotableResort {
  return { id: "id-breck", name: "Breckenridge", slug: "breckenridge", snotel_station_id: station, snow_report: snow(source) };
}

test("stationMeta resolves a known triplet and nulls the rest", () => {
  assert.deepEqual(stationMeta("415:CO:SNTL"), { name: "Copper Mountain", elevationFt: 10500 });
  assert.equal(stationMeta("999:ZZ:SNTL"), null);
  assert.equal(stationMeta(null), null);
  assert.equal(stationMeta(""), null);
});

test("stationMeta ignores a table row with no name", () => {
  assert.equal(stationMeta("1:XX:SNTL", { "1:XX:SNTL": { name: "", elevationFt: 100 } }), null);
  assert.deepEqual(stationMeta("2:XX:SNTL", { "2:XX:SNTL": { name: "Pass", elevationFt: null } }), { name: "Pass", elevationFt: null });
});

test("every station in the table has a name and a positive elevation", () => {
  const ids = Object.keys(STATION_INDEX);
  assert.ok(ids.length >= 70, `expected the trimmed NRCS table, got ${ids.length} rows`);
  for (const id of ids) {
    assert.match(id, /^\d+:[A-Z]{2}:[A-Z]+$/, id); // NRCS triplet; SNTL or SCAN network
    assert.ok(STATION_INDEX[id].name.length > 0, id);
    assert.ok((STATION_INDEX[id].elevationFt ?? 0) > 0, id);
  }
});

test("a known triplet puts the station name and elevation in the resort sentence", () => {
  const r = resort("415:CO:SNTL");
  const q = resortSentence(r, NOW, { station: stationFor(r) });
  assert.equal(
    q.text,
    "As of 6:00 a.m. MT Oct 18, the Breckenridge SNOTEL station (Copper Mountain, 10,500 ft) reports 1 in. of new snow in 24 h.",
  );
});

test("an unknown triplet keeps the unnamed station wording", () => {
  const r = resort("999:ZZ:SNTL");
  assert.equal(stationFor(r), null);
  const q = resortSentence(r, NOW, { station: stationFor(r) });
  assert.equal(q.text, "As of 6:00 a.m. MT Oct 18, the Breckenridge SNOTEL station reports 1 in. of new snow in 24 h.");
  assert.doesNotMatch(q.text, /\(/);
});

test("a resort without a station leaves the model wording unchanged", () => {
  const r = resort(null, "open_meteo");
  assert.equal(stationFor(r), null);
  const q = resortSentence(r, NOW, { station: stationFor(r) });
  assert.equal(q.text, "As of 6:00 a.m. MT Oct 18, a weather-model estimate for Breckenridge puts 1 in. of new snow in 24 h.");
});
