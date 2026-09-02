import { test } from "node:test";
import assert from "node:assert";
import {
  blendReadings,
  blend,
  buildConditionsInput,
  UNKNOWN_ELEV_FT,
} from "./blender";
import { emptyReading, type SourceReading, type ResortContext } from "./types";
import { PRECIP_PROB_KEY } from "./fetchers/nws";
import type { UserConditionReport } from "../conditions-engine";

const RESORT_ID = "resort-1";

/** A snotel reading that on its own rates "poor": shallow base, no new snow. */
function poorSnotelReading(): SourceReading {
  const r = emptyReading(RESORT_ID, "snotel");
  r.snow_depth_in = 10;
  r.swe_in = 2;
  r.new_snow_24h_in = 0;
  r.new_snow_48h_in = 0;
  return r;
}

/** Best-case user report: powder, clear, calm, groomed → user score 1.0. */
const GREAT_REPORT: UserConditionReport = {
  snow_quality: "powder",
  visibility: "clear",
  wind: "calm",
  trail_conditions: "groomed",
};

function userReportsReading(reports: UserConditionReport[]): SourceReading {
  const r = emptyReading(RESORT_ID, "user_reports");
  r.quality_score = 1;
  r.raw_json = { report_count: reports.length, reports };
  return r;
}

function nwsReading(): SourceReading {
  const r = emptyReading(RESORT_ID, "nws");
  r.sky_cover_pct = 50;
  r.wind_gust_mph = 5;
  r.temp_f = 30;
  r.snow_level_ft = 8000;
  return r;
}

// ── Bug A: user reports must reach the conditions engine ────

test("blendReadings ignores user reports it cannot find (baseline is the SNOTEL-only rating)", () => {
  const result = blendReadings([poorSnotelReading()], RESORT_ID);
  assert.strictEqual(result.cond_rating, "poor");
});

test("blendReadings blends caller-supplied user reports into cond_rating", () => {
  const result = blendReadings([poorSnotelReading()], RESORT_ID, {
    userReports: [GREAT_REPORT, GREAT_REPORT],
  });
  // 70% SNOTEL ("poor", idx 0) + 30% user (idx 3) = 0.9 → "fair"
  assert.strictEqual(result.cond_rating, "fair");
});

test("blendReadings recovers user reports from the user_reports reading's raw_json", () => {
  const result = blendReadings(
    [poorSnotelReading(), userReportsReading([GREAT_REPORT, GREAT_REPORT])],
    RESORT_ID,
  );
  assert.strictEqual(result.cond_rating, "fair");
});

test("blendReadings honors the engine's 2-report minimum for the user blend", () => {
  const result = blendReadings(
    [poorSnotelReading(), userReportsReading([GREAT_REPORT])],
    RESORT_ID,
  );
  assert.strictEqual(result.cond_rating, "poor");
});

test("buildConditionsInput passes user reports through to ConditionsInput", () => {
  const input = buildConditionsInput(
    [userReportsReading([GREAT_REPORT, GREAT_REPORT])],
    {
      snow_depth_in: 10,
      swe_in: 2,
      new_snow_24h_in: 0,
      new_snow_48h_in: 0,
      forecast_snow_48h_in: 0,
      forecast_high_48h_f: 30,
    },
  );
  assert.strictEqual(input.userReports?.length, 2);
});

test("blendReadings still reports pct_of_normal as null (no normals in the pipeline)", () => {
  const result = blendReadings([poorSnotelReading()], RESORT_ID);
  assert.strictEqual(result.pct_of_normal, null);
});

// ── Bug B: real base elevation, sentinel when unknown ───────

const BLENDED_ZEROS = {
  snow_depth_in: 10,
  swe_in: 2,
  new_snow_24h_in: 0,
  new_snow_48h_in: 0,
  forecast_snow_48h_in: 0,
  forecast_high_48h_f: 30,
};

test("buildConditionsInput uses the supplied base elevation, not a hardcoded 5000ft", () => {
  const input = buildConditionsInput([nwsReading()], BLENDED_ZEROS, {
    resortElevBaseFt: 7200,
  });
  assert.strictEqual(input.nwsGrid?.resortElevBase, 7200);
});

test("buildConditionsInput falls back to the 99999ft sentinel when elevation is unknown", () => {
  const noOption = buildConditionsInput([nwsReading()], BLENDED_ZEROS);
  assert.strictEqual(noOption.nwsGrid?.resortElevBase, UNKNOWN_ELEV_FT);

  const nullOption = buildConditionsInput([nwsReading()], BLENDED_ZEROS, {
    resortElevBaseFt: null,
  });
  assert.strictEqual(nullOption.nwsGrid?.resortElevBase, UNKNOWN_ELEV_FT);
});

test("resort metadata elevation resolves to the real base elevation (blend() input shape)", () => {
  const resort: ResortContext = {
    id: RESORT_ID,
    slug: "test-resort",
    name: "Test Resort",
    lat: 39.5,
    lng: -106.1,
    snotel_station_id: null,
    metadata: {
      resort_id: RESORT_ID,
      openskistats_id: null,
      elevation_base_ft: 9600,
      elevation_summit_ft: 12000,
      vertical_drop_ft: 2400,
      run_count: null,
      lift_count: null,
      liftie_slug: null,
      weather_unlocked_id: null,
      snodas_grid_x: null,
      snodas_grid_y: null,
    },
  };

  // blend() feeds the same options into buildConditionsInput, so assert on the
  // input it would build for these readings.
  const readings = [poorSnotelReading(), nwsReading()];
  const input = buildConditionsInput(readings, BLENDED_ZEROS, {
    resortElevBaseFt: resort.metadata?.elevation_base_ft ?? null,
  });
  assert.strictEqual(input.nwsGrid?.resortElevBase, 9600);

  // And blend() itself still produces a result for that resort.
  const result = blend(resort, readings);
  assert.strictEqual(result.resort_id, RESORT_ID);
});

test("a resort with no metadata resolves to the sentinel (blend() input shape)", () => {
  const resort: ResortContext = {
    id: RESORT_ID,
    slug: "test-resort",
    name: "Test Resort",
    lat: 39.5,
    lng: -106.1,
    snotel_station_id: null,
    metadata: null,
  };
  const input = buildConditionsInput([nwsReading()], BLENDED_ZEROS, {
    resortElevBaseFt: resort.metadata?.elevation_base_ft ?? null,
  });
  assert.strictEqual(input.nwsGrid?.resortElevBase, UNKNOWN_ELEV_FT);
});

// ── Follow-up: precipitation probability must reach the engine ──

test("buildConditionsInput reads the NWS 48h precip probability from raw_json", () => {
  const nws = nwsReading();
  nws.raw_json = { periods: [], [PRECIP_PROB_KEY]: 65 };
  const input = buildConditionsInput([nws], BLENDED_ZEROS);
  assert.strictEqual(input.nwsGrid?.probOfPrecipMax, 65);
});

test("buildConditionsInput treats a missing precip probability as 0", () => {
  const input = buildConditionsInput([nwsReading()], BLENDED_ZEROS);
  assert.strictEqual(input.nwsGrid?.probOfPrecipMax, 0);
});

test("blendReadings can emit Rain at Base once precip probability and elevation flow through", () => {
  const nws = nwsReading();
  nws.snow_level_ft = 9000; // snow level well above a 7000ft base
  nws.raw_json = { periods: [], [PRECIP_PROB_KEY]: 80 };
  const result = blendReadings([poorSnotelReading(), nws], RESORT_ID, {
    resortElevBaseFt: 7000,
  });
  assert.ok(result.tags.includes("Rain at Base"), `tags were ${JSON.stringify(result.tags)}`);
});
