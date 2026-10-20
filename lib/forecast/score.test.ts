import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, measuredFromDepth, measuredFromNewSnow, pairForecasts, scoreModels, withBlendPairs, type ScorePair } from "./score";
import type { StoredRun } from "./store";

function storedRun(model: string, issuedAt: string, snowByDate: Record<string, number>): StoredRun {
  return {
    id: `${model}-${issuedAt}`,
    point: "summit",
    model,
    issuedAt,
    horizonDays: Object.keys(snowByDate).length,
    daily: Object.entries(snowByDate).map(([date, snowfallCm]) => ({ date, snowfallCm, tempMaxC: null, tempMinC: null, precipProb: null, windGustKmh: null, weatherCode: null })),
  };
}

test("measuredFromDepth: consecutive valid days only, clipped at zero, inches to cm", () => {
  const series = measuredFromDepth([
    { date: "2026-12-01", snow_depth_in: 30, qc_flag: "valid" },
    { date: "2026-12-02", snow_depth_in: 35, qc_flag: "valid" }, // +5 in = 12.7 cm
    { date: "2026-12-03", snow_depth_in: 34, qc_flag: "corrected" }, // settles → 0
    { date: "2026-12-04", snow_depth_in: 34, qc_flag: "missing" }, // carry-forward, skipped
    { date: "2026-12-05", snow_depth_in: 40, qc_flag: "valid" }, // not consecutive with the 3rd → skipped
    { date: "2026-12-06", snow_depth_in: 41, qc_flag: "valid" }, // +1 in
  ]);
  assert.deepEqual([...series.entries()], [
    ["2026-12-02", 12.7],
    ["2026-12-03", 0],
    ["2026-12-06", 2.54],
  ]);
});

test("measuredFromNewSnow converts inches and keeps the largest reading per date", () => {
  const series = measuredFromNewSnow([
    { date: "2026-12-02", new_snow_in: 4 },
    { date: "2026-12-02", new_snow_in: 6 },
    { date: "2026-12-03", new_snow_in: null },
  ]);
  assert.deepEqual([...series.entries()], [["2026-12-02", 15.24]]);
});

test("date helpers", () => {
  assert.equal(daysBetween("2026-12-01", "2026-12-08"), 7);
  assert.equal(addDays("2026-12-01", -1), "2026-11-30");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
});

test("pairForecasts uses the newest run of the issue day per model for each lead", () => {
  const measured = new Map([["2026-12-08", 10]]);
  const runs = [
    storedRun("gfs_seamless", "2026-12-07T06:00:00Z", { "2026-12-08": 4 }),
    storedRun("gfs_seamless", "2026-12-07T18:00:00Z", { "2026-12-08": 8 }), // newest day-1 run wins
    storedRun("gfs_seamless", "2026-12-05T12:00:00Z", { "2026-12-08": 20 }),
    storedRun("gfs_seamless", "2026-12-01T12:00:00Z", { "2026-12-08": 0 }),
    storedRun("ecmwf_ifs025", "2026-12-07T12:00:00Z", { "2026-12-08": 12 }),
    storedRun("ecmwf_ifs025", "2026-12-06T12:00:00Z", { "2026-12-08": 7 }), // day 2: not a scored lead
  ];
  const pairs = pairForecasts(measured, runs);
  assert.deepEqual(
    pairs.map((p) => [p.model, p.lead, p.forecastCm]),
    [
      ["gfs_seamless", 1, 8],
      ["ecmwf_ifs025", 1, 12],
      ["gfs_seamless", 3, 20],
      ["gfs_seamless", 7, 0],
    ],
  );
});

test("withBlendPairs adds a median blend pair where at least two models forecast the same date and lead", () => {
  const pairs: ScorePair[] = [
    { model: "a", lead: 1, date: "2026-12-08", forecastCm: 8, measuredCm: 10 },
    { model: "b", lead: 1, date: "2026-12-08", forecastCm: 12, measuredCm: 10 },
    { model: "c", lead: 1, date: "2026-12-08", forecastCm: 30, measuredCm: 10 },
    { model: "a", lead: 3, date: "2026-12-08", forecastCm: 20, measuredCm: 10 },
  ];
  const out = withBlendPairs(pairs);
  const blend = out.filter((p) => p.model === "blend");
  assert.deepEqual(blend, [{ model: "blend", lead: 1, date: "2026-12-08", forecastCm: 12, measuredCm: 10 }]);
  assert.equal(out.length, 5);
});

test("scoreModels: MAE per lead, bias ratio, samples as distinct dates, rank by day-1 MAE", () => {
  const pairs: ScorePair[] = [
    { model: "gfs", lead: 1, date: "2026-12-08", forecastCm: 8, measuredCm: 10 },
    { model: "gfs", lead: 1, date: "2026-12-09", forecastCm: 6, measuredCm: 0 },
    { model: "gfs", lead: 3, date: "2026-12-08", forecastCm: 20, measuredCm: 10 },
    { model: "ecmwf", lead: 1, date: "2026-12-08", forecastCm: 11, measuredCm: 10 },
    { model: "ecmwf", lead: 7, date: "2026-12-08", forecastCm: 5, measuredCm: 10 },
    { model: "icon", lead: 3, date: "2026-12-08", forecastCm: 9, measuredCm: 10 },
  ];
  const scores = scoreModels(pairs);
  assert.deepEqual(scores, [
    { model: "ecmwf", day1Mae: 1, day3Mae: null, day7Mae: 5, samples: 1, biasRatio: 0.8, rank: 1 },
    { model: "gfs", day1Mae: 4, day3Mae: 10, day7Mae: null, samples: 2, biasRatio: 1.7, rank: 2 },
    { model: "icon", day1Mae: null, day3Mae: 1, day7Mae: null, samples: 1, biasRatio: 0.9, rank: 3 },
  ]);
  assert.equal(scoreModels([{ model: "x", lead: 1, date: "d", forecastCm: 3, measuredCm: 0 }])[0].biasRatio, null, "no measured snow → no ratio");
  assert.deepEqual(scoreModels([]), []);
});
