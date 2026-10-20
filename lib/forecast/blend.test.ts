import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blendRuns, blendSnowByDate, median, percentile } from "./blend";
import { ALL_MODELS, parseModelRuns, type ModelRun, type OpenMeteoMultiModelResponse } from "./open-meteo-models";

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "open-meteo-alta-summit-2026-10-18.json"), "utf8"),
) as OpenMeteoMultiModelResponse;

function run(model: ModelRun["model"], snow: number[], extra: Partial<ModelRun["daily"][number]> = {}): ModelRun {
  return {
    model,
    horizonDays: snow.length,
    daily: snow.map((cm, i) => ({
      date: `2026-12-${String(i + 1).padStart(2, "0")}`,
      snowfallCm: cm,
      tempMaxC: -2,
      tempMinC: -9,
      precipProb: 50,
      windGustKmh: 30,
      weatherCode: cm > 0 ? 73 : 3,
      ...extra,
    })),
  };
}

test("percentile interpolates linearly and median is the 50th", () => {
  assert.equal(percentile([1, 2, 3, 4], 25), 1.75);
  assert.equal(percentile([1, 2, 3, 4], 75), 3.25);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([5]), 5);
  assert.equal(percentile([3, 1, 2], 100), 3);
  assert.ok(Number.isNaN(percentile([], 50)));
});

test("blendRuns takes the per-day median with the 25th/75th percentile as the band", () => {
  const blend = blendRuns([
    run("gfs_seamless", [0, 10, 20]),
    run("ecmwf_ifs025", [0, 2, 6]),
    run("gem_seamless", [0, 4, 8]),
    run("ukmo_seamless", [0, 6, 30]),
  ]);
  assert.equal(blend.days.length, 3);
  assert.deepEqual(blend.days.map((d) => d.snowfallCm), [0, 5, 14]);
  assert.deepEqual(blend.days.map((d) => d.snowfallLoCm), [0, 3.5, 7.5]);
  assert.deepEqual(blend.days.map((d) => d.snowfallHiCm), [0, 7, 22.5]);
  assert.equal(blend.modelCount, 4);
  assert.deepEqual(blend.models, ["ecmwf_ifs025", "gem_seamless", "gfs_seamless", "ukmo_seamless"]);
  assert.equal(blend.next48hCm, 5);
  assert.equal(blend.total7dCm, 19);
  assert.equal(blend.total14dCm, 19);
  assert.deepEqual(blend.peak, { date: "2026-12-03", cm: 14, windowDays: 2 });
});

test("blendRuns counts only the models that reach each day and never returns null padding", () => {
  const blend = blendRuns([run("gfs_seamless", [1, 1, 1, 1, 1]), run("gfs_hrrr", [9, 9]), run("meteofrance_seamless", [5, 5, 5])]);
  assert.deepEqual(blend.days.map((d) => d.modelCount), [3, 3, 2, 1, 1]);
  assert.deepEqual(blend.days.map((d) => d.snowfallCm), [5, 5, 3, 1, 1]);
  assert.deepEqual(blend.days[0].models, ["gfs_hrrr", "gfs_seamless", "meteofrance_seamless"]);
  assert.equal(blend.days[4].snowfallLoCm, 1, "a single model: band collapses to the value");
  assert.equal(blend.days[4].snowfallHiCm, 1);
  assert.equal(blend.modelCount, 3);
});

test("blendRuns: peak window spans the consecutive days with at least 1 cm; a dry forecast has no peak", () => {
  const storm = blendRuns([run("gfs_seamless", [0, 0.5, 3, 12, 4, 0.8, 0, 2])]);
  assert.deepEqual(storm.peak, { date: "2026-12-04", cm: 12, windowDays: 3 });
  assert.equal(blendRuns([run("gfs_seamless", [0, 0, 0])]).peak, null);
  assert.equal(blendRuns([]).modelCount, 0);
  assert.deepEqual(blendRuns([]).days, []);
});

test("blendRuns medians the other variables over the models that report them and takes the modal weather code", () => {
  const a = run("gfs_seamless", [2, 2]);
  const b = run("jma_seamless", [2, 2], { precipProb: null, windGustKmh: null, tempMaxC: 4, weatherCode: 75 });
  const c = run("ukmo_seamless", [2, 2], { tempMaxC: 0, weatherCode: 75 });
  const blend = blendRuns([a, b, c]);
  assert.equal(blend.days[0].precipProb, 50, "JMA's null is left out, not treated as 0");
  assert.equal(blend.days[0].windGustKmh, 30);
  assert.equal(blend.days[0].tempMaxC, 0);
  assert.equal(blend.days[0].weatherCode, 75);
  // A tie goes to the more severe code.
  assert.equal(blendRuns([a, run("ukmo_seamless", [2, 2], { weatherCode: 75 })]).days[0].weatherCode, 75);
});

test("blendRuns on the recorded Alta fixture is within 1 cm of a hand-computed median (acceptance check)", () => {
  const runs = parseModelRuns(FIXTURE, ALL_MODELS);
  const blend = blendRuns(runs);
  assert.equal(blend.days.length, 14);
  assert.equal(blend.modelCount, 9);
  // 2026-10-23: ecmwf 5.6, gfs 3.08, gem 9.03, icon 0, jma 7.56, ukmo 1.47, nbm 16.14 (mf and hrrr are past horizon) → sorted
  // [0, 1.47, 3.08, 5.6, 7.56, 9.03, 16.14], median 5.6.
  const d23 = blend.days.find((d) => d.date === "2026-10-23")!;
  assert.equal(d23.modelCount, 7);
  assert.ok(Math.abs(d23.snowfallCm - 5.6) <= 1, `median ${d23.snowfallCm}`);
  assert.ok(d23.snowfallLoCm <= d23.snowfallCm && d23.snowfallCm <= d23.snowfallHiCm);
  // The peak lands on 2026-10-29, where only ECMWF (0.14) and GFS (21.63) reach:
  // a two-model median is their mean, 10.9 cm. The API reports modelCount per
  // day precisely so a reader can discount a long-range two-model peak.
  assert.deepEqual(blend.peak, { date: "2026-10-29", cm: 10.9, windowDays: 3 });
  assert.equal(blend.days.find((d) => d.date === "2026-10-29")?.modelCount, 2);
  assert.equal(blend.days[13].modelCount, 2, "only ECMWF and GFS reach day 14");
  const byDate = blendSnowByDate(blend, 3);
  assert.deepEqual(Object.keys(byDate), ["2026-10-18", "2026-10-19", "2026-10-20"]);
});
