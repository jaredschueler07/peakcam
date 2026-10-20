import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleStoredRuns, issueHour, latestRunsPerModel, newestIssuedAt, runsForPoint, type ForecastDailyRow, type ForecastRunRow } from "./store";

const run = (id: string, point: "summit" | "base", model: string, issued_at: string): ForecastRunRow => ({ id, resort_id: "r1", point, model, issued_at, horizon_days: 2 });

test("latestRunsPerModel keeps the newest run per point and model, in a stable order", () => {
  const rows = [
    run("a", "summit", "gfs_seamless", "2026-12-01T06:00:00Z"),
    run("b", "summit", "gfs_seamless", "2026-12-01T12:00:00Z"),
    run("c", "base", "gfs_seamless", "2026-12-01T12:00:00Z"),
    run("d", "summit", "ecmwf_ifs025", "2026-12-01T00:00:00Z"),
    run("e", "summit", "ecmwf_ifs025", "2026-11-30T18:00:00Z"),
  ];
  assert.deepEqual(latestRunsPerModel(rows).map((r) => r.id), ["c", "d", "b"]);
});

test("assembleStoredRuns attaches days in date order and coerces PostgREST numerics", () => {
  const daily: ForecastDailyRow[] = [
    { run_id: "b", date: "2026-12-02", snowfall_cm: "3.5" as unknown as number, snowfall_lo: null, snowfall_hi: null, temp_max: -1, temp_min: -8, precip_prob: 70, wind_gust: 40, weather_code: 73 },
    { run_id: "b", date: "2026-12-01", snowfall_cm: 0, snowfall_lo: null, snowfall_hi: null, temp_max: 2, temp_min: -5, precip_prob: null, wind_gust: 20, weather_code: 3 },
  ];
  const [stored] = assembleStoredRuns([run("b", "summit", "gfs_seamless", "2026-12-01 12:00:00+00")], daily);
  assert.equal(stored.issuedAt, "2026-12-01T12:00:00.000Z");
  assert.deepEqual(stored.daily.map((d) => d.date), ["2026-12-01", "2026-12-02"]);
  assert.equal(stored.daily[1].snowfallCm, 3.5);
  assert.equal(stored.daily[0].precipProb, null);
  assert.equal(assembleStoredRuns([run("z", "base", "gfs_seamless", "2026-12-01T00:00:00Z")], [])[0].daily.length, 0);
});

test("runsForPoint falls back to the other point and newestIssuedAt picks the latest instant", () => {
  const stored = { runs: assembleStoredRuns([run("c", "base", "gfs_seamless", "2026-12-01T12:00:00Z"), run("d", "base", "ecmwf_ifs025", "2026-12-01T18:00:00Z")], []) };
  const summit = runsForPoint(stored, "summit");
  assert.equal(summit.point, "base");
  assert.equal(summit.runs.length, 2);
  assert.equal(newestIssuedAt(summit.runs), "2026-12-01T18:00:00.000Z");
  assert.equal(newestIssuedAt([]), null);
  assert.deepEqual(runsForPoint(null, "summit"), { point: "base", runs: [] });
});

test("issueHour truncates to the UTC hour", () => {
  assert.equal(issueHour(new Date("2026-12-01T13:47:12.345Z")), "2026-12-01T13:00:00.000Z");
});
