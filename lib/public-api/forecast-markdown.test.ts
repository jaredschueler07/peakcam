import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastMarkdown } from "./markdown-page";
import { serializeForecast, serializeForecastAccuracy } from "./forecast";
import type { StoredForecast, StoredRun } from "@/lib/forecast/store";

// The forecast subpage's markdown alternate, built from the same serializers
// the API route uses on hand-made stored runs (no Supabase, no Next.js).

const NOW = new Date("2026-12-20T13:00:00Z");

function run(model: string, point: "summit" | "base", cms: number[]): StoredRun {
  return {
    id: `${model}-${point}`,
    point,
    model,
    issuedAt: "2026-12-20T12:00:00.000Z",
    horizonDays: cms.length,
    daily: cms.map((cm, i) => ({
      date: `2026-12-${String(20 + i).padStart(2, "0")}`,
      snowfallCm: cm,
      tempMaxC: -4,
      tempMinC: -10,
      precipProb: 60,
      windGustKmh: 40,
      weatherCode: 73,
    })),
  };
}

const stored: StoredForecast = {
  runs: [run("gfs_seamless", "summit", [10, 0, 5]), run("ecmwf_ifs025", "summit", [20, 2, 0]), run("gfs_seamless", "base", [4, 0, 1])],
};
const resort = { slug: "alta", name: "Alta Ski Area", snotel_station_id: "766:UT:SNTL" };

test("forecast markdown carries both points, every model, the accuracy table and the credit", () => {
  const summit = serializeForecast(resort, stored, { now: NOW, point: "summit" });
  const base = serializeForecast(resort, stored, { now: NOW, point: "base" });
  const accuracy = serializeForecastAccuracy(resort, {
    scores: [
      { resort_id: "r", model: "blend", period_days: 90, day1_mae: 1.2, day3_mae: 2.1, day7_mae: 3.3, samples: 40, bias_ratio: 1.1, computed_at: "2026-12-20T07:30:00Z" },
      { resort_id: "r", model: "gfs_seamless", period_days: 90, day1_mae: 1.9, day3_mae: 2.6, day7_mae: 4.0, samples: 40, bias_ratio: 0.9, computed_at: "2026-12-20T07:30:00Z" },
    ],
    measuredDays: 40,
    truthBasis: "snotel",
    station: { id: "766:UT:SNTL", name: "Alta", elevationFt: 8720 },
    scoredPoint: "base",
  }, { now: NOW });
  const md = forecastMarkdown({ summit, base, accuracy, pageUrl: "https://www.peakcam.io/resorts/alta/snow-forecast" });
  assert.match(md, /^# Alta Ski Area snow forecast, 14-day multi-model blend/);
  assert.match(md, /JSON: https:\/\/www\.peakcam\.io\/api\/v1\/resorts\/alta\/forecast  ·  Accuracy JSON: https:\/\/www\.peakcam\.io\/api\/v1\/resorts\/alta\/forecast-accuracy/);
  assert.match(md, /## Blend at the summit/);
  assert.match(md, /## Blend at the base/);
  // Median of 10 and 20 cm on day one = 15 cm = 5.9 in; -4/-10 °C = 25/14 °F.
  assert.match(md, /\| 2026-12-20 \| 5\.9 in \| 4\.9 in – 6\.9 in \| 25° \/ 14° \| 60 \| 25 \| 2 \|/);
  assert.match(md, /## Every model, summit point/);
  assert.match(md, /\| ECMWF IFS 0\.25° \| .* \| 3 d \| 20 \| 2 \| 0 \|/);
  assert.match(md, /\| 1 \| PeakCam blend \| 1\.2 \| 2\.1 \| 3\.3 \| 1\.1 \| 40 \|/);
  assert.match(md, /graded at the base point/);
  assert.match(md, /Weather data by Open-Meteo\.com \(CC BY 4\.0/);
});

test("forecast markdown says so when nothing is stored and when nothing is scored", () => {
  const empty = serializeForecast(resort, { runs: [] }, { now: NOW });
  const accuracy = serializeForecastAccuracy({ slug: "x", name: "X" }, { scores: [], measuredDays: 0, truthBasis: "none" }, { now: NOW });
  const md = forecastMarkdown({ summit: empty, base: null, accuracy, pageUrl: "https://www.peakcam.io/resorts/alta/snow-forecast" });
  assert.match(md, /No current model run is stored/);
  assert.match(md, /No measured snow series at this resort/);
  assert.doesNotMatch(md, /## Every model/);
});
