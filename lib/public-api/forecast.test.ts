import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_MODELS, parseModelRuns, type OpenMeteoMultiModelResponse } from "@/lib/forecast/open-meteo-models";
import type { ForecastScoreRow, StoredForecast, StoredRun } from "@/lib/forecast/store";
import { ForecastAccuracySchema, ForecastSchema, ForecastSummarySchema } from "./schema";
import { rankScores, serializeForecast, serializeForecastAccuracy, serializeForecastSummary, truthBasisFor } from "./forecast";
import { parseBatchBody } from "./batch";
import { PUBLIC_API_FORECAST_ATTRIBUTION, publicApiHeaders } from "./headers";

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "..", "forecast", "fixtures", "open-meteo-alta-summit-2026-10-18.json"), "utf8"),
) as OpenMeteoMultiModelResponse;

const NOW = new Date("2026-10-18T18:30:00Z");
const RESORT = { slug: "alta", name: "Alta Ski Area", snotel_station_id: "1308:UT:SNTL", elevation_summit_ft: 11068, elevation_base_ft: 8530 };

function stored(point: "summit" | "base" = "summit", issuedAt = "2026-10-18T12:00:00.000Z"): StoredForecast {
  const runs: StoredRun[] = parseModelRuns(FIXTURE, ALL_MODELS).map((r) => ({ id: `${point}-${r.model}`, point, issuedAt, ...r }));
  return { runs };
}

test("serializeForecast: blended days in inches and cm, byModel in provider units, Open-Meteo credit, parses against the schema", () => {
  const doc = serializeForecast(RESORT, stored(), { now: NOW });
  assert.doesNotThrow(() => ForecastSchema.parse(doc));
  assert.equal(doc.available, true);
  assert.equal(doc.point, "summit");
  assert.deepEqual(doc.points, ["summit"]);
  assert.equal(doc.daily.length, 14);
  assert.equal(doc.byModel.length, 9);
  const d23 = doc.daily.find((d) => d.date === "2026-10-23")!;
  assert.equal(d23.snowfallCm, 5.6);
  assert.equal(d23.snowfallIn, 2.2);
  assert.ok(d23.snowfallLoIn <= d23.snowfallIn && d23.snowfallIn <= d23.snowfallHiIn);
  assert.equal(d23.modelCount, 7);
  assert.equal(d23.condition, "heavy-snow");
  assert.equal(d23.tempMaxF, 31, "°C median -0.7 → °F");
  const nbm = doc.byModel.find((r) => r.model === "ncep_nbm_conus")!;
  assert.equal(nbm.horizonDays, 11);
  assert.equal(nbm.days[5].snowfallCm, 16.14, "per-model rows stay in cm");
  assert.equal(nbm.days[5].snowfallLo, null);
  assert.equal(doc.summary?.modelCount, 9);
  assert.equal(doc.summary?.issuedAt, "2026-10-18T12:00:00.000Z");
  assert.equal(doc.summary?.peak?.date, "2026-10-29");
  assert.deepEqual(doc.credits.map((c) => [c.name, c.license]), [["Open-Meteo", "CC BY 4.0"]]);
  assert.match(doc.credits[0].text, /Weather data by Open-Meteo\.com/);
  assert.equal(doc.canonicalUrl, "https://www.peakcam.io/resorts/alta");
  assert.equal(doc.generatedAt, NOW.toISOString());
});

test("serializeForecast: falls back to the other point with a note, and is available=false with empty arrays when nothing is stored", () => {
  const fallback = serializeForecast(RESORT, stored("base"), { now: NOW, point: "summit" });
  assert.equal(fallback.available, true);
  assert.equal(fallback.point, "base");
  assert.match(fallback.note ?? "", /showing base/);
  const empty = serializeForecast(RESORT, { runs: [] }, { now: NOW });
  assert.doesNotThrow(() => ForecastSchema.parse(empty));
  assert.equal(empty.available, false);
  assert.equal(empty.summary, null);
  assert.deepEqual(empty.daily, []);
  assert.deepEqual(empty.byModel, []);
  assert.deepEqual(empty.points, []);
  assert.equal(serializeForecast(RESORT, null, { now: NOW }).available, false);
});

test("serializeForecastSummary is the resort document's block: summit first, inches and cm, null when nothing is stored", () => {
  const summary = serializeForecastSummary(stored());
  assert.doesNotThrow(() => ForecastSummarySchema.parse(summary));
  assert.equal(summary?.point, "summit");
  assert.equal(summary?.total14dCm, 23);
  assert.equal(summary?.total14dIn, 9.1);
  assert.equal(summary?.next48hCm, 0);
  assert.equal(serializeForecastSummary({ runs: [] }), null);
  assert.equal(serializeForecastSummary(undefined), null);
});

const score = (model: string, day1: number | null, day3: number | null, samples = 40): ForecastScoreRow => ({
  resort_id: "id-alta",
  model,
  period_days: 90,
  day1_mae: day1,
  day3_mae: day3,
  day7_mae: null,
  samples,
  bias_ratio: 1.1,
  computed_at: "2026-12-20T07:30:00Z",
});

test("rankScores ranks the 90-day rows by day-1 MAE with the blend included and ignores other windows", () => {
  const rows = [score("gfs_seamless", 4.2, 6), score("blend", 2.1, 4), score("ecmwf_ifs025", 2.5, 3), { ...score("gfs_seamless", 1, 1), period_days: 30 }, score("icon_seamless", null, 5)];
  const ranked = rankScores(rows);
  assert.deepEqual(ranked.map((r) => [r.model, r.rank]), [["blend", 1], ["ecmwf_ifs025", 2], ["gfs_seamless", 3], ["icon_seamless", 4]]);
  assert.equal(ranked[0].computedAt, "2026-12-20T07:30:00.000Z");
});

test("serializeForecastAccuracy: truth basis, measured days, station, ranked models, parses against the schema", () => {
  const doc = serializeForecastAccuracy(
    RESORT,
    { scores: [score("gfs_seamless", 4.2, 6), score("blend", 2.1, 4)], measuredDays: 41, truthBasis: "snotel", station: { id: "1308:UT:SNTL", name: "Alta", elevationFt: 8730 }, scoredPoint: "base" },
    { now: NOW },
  );
  assert.doesNotThrow(() => ForecastAccuracySchema.parse(doc));
  assert.equal(doc.periodDays, 90);
  assert.equal(doc.truthBasis, "snotel");
  assert.equal(doc.measuredDays, 41);
  assert.equal(doc.bestModel, "blend");
  assert.equal(doc.scoredPoint, "base");
  assert.equal(doc.computedAt, "2026-12-20T07:30:00.000Z");
  assert.match(doc.method, /clipped at zero/);

  const none = serializeForecastAccuracy({ slug: "x", name: "X" }, { scores: [], measuredDays: 0, truthBasis: "none" }, { now: NOW });
  assert.doesNotThrow(() => ForecastAccuracySchema.parse(none));
  assert.deepEqual(none.models, []);
  assert.equal(none.bestModel, null);
  assert.equal(none.computedAt, null);
  assert.equal(none.station, null);
});

test("truthBasisFor needs a station and measured days", () => {
  assert.equal(truthBasisFor({ snotel_station_id: "1308:UT:SNTL" }, 10), "snotel");
  assert.equal(truthBasisFor({ snotel_station_id: "1308:UT:SNTL" }, 0), "none");
  assert.equal(truthBasisFor({ snotel_station_id: null }, 10), "none");
});

test("the forecast routes are batchable and carry the Open-Meteo credit in X-Attribution", () => {
  const parsed = parseBatchBody({ requests: [{ path: "/api/v1/resorts/alta/forecast?point=base" }, { path: "/api/v1/resorts/alta/forecast-accuracy" }] });
  assert.ok(parsed.ok);
  if (parsed.ok) assert.deepEqual(parsed.paths.map((p) => [p.route, p.slug]), [["forecast", "alta"], ["forecastAccuracy", "alta"]]);
  assert.match(publicApiHeaders({ attribution: PUBLIC_API_FORECAST_ATTRIBUTION })["X-Attribution"], /Weather data by Open-Meteo\.com \(CC BY 4\.0\)$/);
  assert.doesNotMatch(publicApiHeaders()["X-Attribution"], /CC BY/);
});
