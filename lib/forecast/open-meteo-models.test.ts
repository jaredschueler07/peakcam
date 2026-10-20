import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_MODELS,
  GLOBAL_MODELS,
  buildModelsUrl,
  modelsForCountry,
  parseModelRuns,
  resortPoints,
  type OpenMeteoMultiModelResponse,
} from "./open-meteo-models";

// Recorded 2026-10-18 from api.open-meteo.com for Alta's summit (40.5883,
// -111.6358, 3374 m) with all nine models — the real suffixed layout.
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "open-meteo-alta-summit-2026-10-18.json"), "utf8"),
) as OpenMeteoMultiModelResponse;

test("parseModelRuns returns one run per model with the horizon it actually answered for", () => {
  const runs = parseModelRuns(FIXTURE, ALL_MODELS);
  const horizons = Object.fromEntries(runs.map((r) => [r.model, r.horizonDays]));
  assert.deepEqual(horizons, {
    ecmwf_ifs025: 14,
    gfs_seamless: 14,
    gem_seamless: 10,
    icon_seamless: 7,
    jma_seamless: 11,
    meteofrance_seamless: 4,
    ukmo_seamless: 7,
    ncep_nbm_conus: 11,
    gfs_hrrr: 2,
  });
  for (const run of runs) {
    assert.equal(run.daily.length, run.horizonDays, `${run.model} carries no null padding`);
    assert.ok(run.daily.every((d) => d.snowfallCm != null), `${run.model} every day has snowfall`);
  }
});

test("parseModelRuns reads provider units as given and keeps nulls for variables a model lacks", () => {
  const runs = parseModelRuns(FIXTURE, ALL_MODELS);
  const nbm = runs.find((r) => r.model === "ncep_nbm_conus")!;
  assert.deepEqual(nbm.daily[5], {
    date: "2026-10-23",
    snowfallCm: 16.14,
    tempMaxC: 1.1,
    tempMinC: -4.2,
    precipProb: 94,
    windGustKmh: 43.2,
    weatherCode: 75,
  });
  const jma = runs.find((r) => r.model === "jma_seamless")!;
  assert.equal(jma.daily[0].precipProb, null, "JMA has no ensemble probability");
  assert.equal(jma.daily[0].windGustKmh, null);
  assert.equal(jma.daily[4].snowfallCm, 4.2);
});

test("parseModelRuns drops models the response does not carry and handles a single unsuffixed model", () => {
  const partial = parseModelRuns(FIXTURE, ["gfs_seamless", "ecmwf_ifs025"]);
  assert.deepEqual(partial.map((r) => r.model), ["gfs_seamless", "ecmwf_ifs025"]);
  const missing = parseModelRuns({ daily: { time: ["2026-10-18"], snowfall_sum_gfs_seamless: [1] } }, ["gfs_seamless", "ukmo_seamless"]);
  assert.deepEqual(missing.map((r) => r.model), ["gfs_seamless"]);
  const single = parseModelRuns(
    { daily: { time: ["2026-10-18", "2026-10-19"], snowfall_sum: [2, null], temperature_2m_max: [1, 2], temperature_2m_min: [0, 1], precipitation_probability_max: [50, 60], wind_gusts_10m_max: [10, 20], weathercode: [71, 3] } },
    ["ukmo_seamless"],
  );
  assert.equal(single.length, 1);
  assert.equal(single[0].horizonDays, 1);
  assert.equal(single[0].daily[0].weatherCode, 71, "legacy weathercode key is read");
  assert.deepEqual(parseModelRuns({} as OpenMeteoMultiModelResponse, ALL_MODELS), []);
});

test("modelsForCountry adds the CONUS models for US points only", () => {
  assert.deepEqual(modelsForCountry("US"), [...ALL_MODELS]);
  assert.deepEqual(modelsForCountry("CA"), [...GLOBAL_MODELS]);
  assert.deepEqual(modelsForCountry("CL"), [...GLOBAL_MODELS]);
});

test("buildModelsUrl asks for every model at once, 14 days, auto timezone and the point elevation in metres", () => {
  const url = new URL(buildModelsUrl({ lat: 40.5883, lng: -111.6358, elevationFt: 11068, models: modelsForCountry("US") }));
  assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(url.searchParams.get("models"), ALL_MODELS.join(","));
  assert.equal(url.searchParams.get("forecast_days"), "14");
  assert.equal(url.searchParams.get("timezone"), "auto");
  assert.equal(url.searchParams.get("elevation"), "3374");
  assert.match(url.searchParams.get("daily") ?? "", /^snowfall_sum,.*weather_code$/);
  const noElev = new URL(buildModelsUrl({ lat: 1, lng: 2, models: ["gfs_seamless"] }));
  assert.equal(noElev.searchParams.get("elevation"), null);
});

test("resortPoints gives summit and base when both are known, one point otherwise", () => {
  assert.deepEqual(resortPoints({ lat: 0, lng: 0, elevation_summit_ft: 11068, elevation_base_ft: 8530 }), [
    { point: "summit", elevationFt: 11068 },
    { point: "base", elevationFt: 8530 },
  ]);
  assert.deepEqual(resortPoints({ lat: 0, lng: 0, elevation_summit_ft: 9000, elevation_base_ft: null }), [{ point: "summit", elevationFt: 9000 }]);
  assert.deepEqual(resortPoints({ lat: 0, lng: 0 }), [{ point: "base", elevationFt: null }]);
  assert.deepEqual(resortPoints({ lat: 0, lng: 0, elevation_summit_ft: 7000, elevation_base_ft: 7000 }), [{ point: "summit", elevationFt: 7000 }]);
});
