import { test } from "node:test";
import assert from "node:assert";
import {
  estimateSnow,
  forecastToCondition,
  resolveGridPoint,
  NWS_USER_AGENT,
  NWS_TIMEOUT_MS,
  SNOW_KEYWORDS,
} from "./weather";

// estimateSnow is the single source of truth for the NWS snow heuristic.
// scripts/snotel-sync.ts used to carry its own copy that scored "wintry mix"
// as 0 instead of 1; these tests pin the canonical ladder.

test("estimateSnow scores the heavy tier at 8 inches", () => {
  assert.strictEqual(estimateSnow("Blizzard Conditions"), 8);
  assert.strictEqual(estimateSnow("Heavy Snow Likely"), 8);
});

test("estimateSnow scores plain snow forecasts at 3 inches", () => {
  assert.strictEqual(estimateSnow("Snow Showers"), 3);
  assert.strictEqual(estimateSnow("Chance of Snow"), 3);
  assert.strictEqual(estimateSnow("Snow Likely then Cloudy"), 3);
});

test("estimateSnow scores flurries and wintry mix at 1 inch", () => {
  assert.strictEqual(estimateSnow("Flurries"), 1);
  assert.strictEqual(estimateSnow("Areas of Blowing Flurries"), 1);
  assert.strictEqual(estimateSnow("Wintry Mix"), 1);
  assert.strictEqual(estimateSnow("Chance Wintry Mix"), 1);
});

// The ladder is ordered, not scored: the "snow" branch is checked before the
// flurries/wintry branch, so any string containing "snow" lands on 3 even when
// it also says "flurries".
test("estimateSnow prefers the snow tier when a string says both", () => {
  assert.strictEqual(estimateSnow("Snow Flurries"), 3);
});

test("estimateSnow scores non-snow forecasts at 0", () => {
  assert.strictEqual(estimateSnow("Sunny"), 0);
  assert.strictEqual(estimateSnow("Mostly Cloudy"), 0);
  assert.strictEqual(estimateSnow("Rain Showers"), 0);
  assert.strictEqual(estimateSnow(""), 0);
});

test("estimateSnow is case-insensitive", () => {
  assert.strictEqual(estimateSnow("HEAVY SNOW"), 8);
  assert.strictEqual(estimateSnow("wintry mix"), 1);
  assert.strictEqual(estimateSnow("SUNNY"), 0);
});

test("heavy snow outranks the plain snow tier regardless of order", () => {
  assert.strictEqual(estimateSnow("Areas of Heavy Snow"), 8);
  assert.strictEqual(estimateSnow("Snow, then Heavy Snow"), 8);
});

test("SNOW_KEYWORDS matches the wintry strings estimateSnow scores above zero", () => {
  const wintry = ["Snow Showers", "Blizzard Conditions", "Snow Flurries", "Wintry Mix", "Freezing Rain", "Sleet"];
  for (const s of wintry) {
    const lower = s.toLowerCase();
    assert.ok(
      SNOW_KEYWORDS.some((kw) => lower.includes(kw)),
      `expected SNOW_KEYWORDS to match "${s}"`,
    );
  }
  const dry = ["Sunny", "Mostly Cloudy", "Rain Showers"];
  for (const s of dry) {
    const lower = s.toLowerCase();
    assert.ok(
      !SNOW_KEYWORDS.some((kw) => lower.includes(kw)),
      `expected SNOW_KEYWORDS not to match "${s}"`,
    );
  }
});

test("forecastToCondition agrees with estimateSnow on wintry mix", () => {
  assert.strictEqual(forecastToCondition("Wintry Mix"), "mixed");
  assert.strictEqual(forecastToCondition("Blizzard"), "blizzard");
  assert.strictEqual(forecastToCondition("Sunny"), "clear");
});

test("NWS request constants are the shared values the sync script relies on", () => {
  assert.strictEqual(NWS_USER_AGENT, "PeakCam/1.0 (contact@peakcam.io)");
  assert.strictEqual(NWS_TIMEOUT_MS, 5_000);
});

// resolveGridPoint is shared with scripts/snotel-sync.ts, which needs the
// forecastGridData URL as well as the summary/hourly ones, and relies on the
// call carrying the UA header and an abort signal.
test("resolveGridPoint returns every NWS URL and sends UA + abort signal", async () => {
  const realFetch = globalThis.fetch;
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url);
    seenInit = init;
    return new Response(
      JSON.stringify({
        properties: {
          gridId: "BOU",
          gridX: 42,
          gridY: 73,
          forecast: "https://api.weather.gov/gridpoints/BOU/42,73/forecast",
          forecastHourly: "https://api.weather.gov/gridpoints/BOU/42,73/forecast/hourly",
          forecastGridData: "https://api.weather.gov/gridpoints/BOU/42,73",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    const grid = await resolveGridPoint(39.6403, -106.3742);
    assert.strictEqual(seenUrl, "https://api.weather.gov/points/39.6403,-106.3742");
    assert.strictEqual((seenInit?.headers as Record<string, string>)["User-Agent"], NWS_USER_AGENT);
    assert.ok(seenInit?.signal instanceof AbortSignal, "expected an AbortSignal on the points call");
    assert.deepStrictEqual(grid, {
      office: "BOU",
      gridX: 42,
      gridY: 73,
      forecastUrl: "https://api.weather.gov/gridpoints/BOU/42,73/forecast",
      forecastHourlyUrl: "https://api.weather.gov/gridpoints/BOU/42,73/forecast/hourly",
      forecastGridDataUrl: "https://api.weather.gov/gridpoints/BOU/42,73",
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("resolveGridPoint returns null on a non-2xx points response", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
  try {
    assert.strictEqual(await resolveGridPoint(39.6403, -106.3742), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
