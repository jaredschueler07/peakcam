import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ageMinutes, haversineKm, num } from "./types";
import { fetchSnotelObservation, normalizeTriplet, parseAwdbDaily, snotelObservation, stationMetaFromAwdb } from "./snotel";
import {
  fetchNwsLatestObservation,
  fetchNwsStationsByState,
  nearestStations,
  nwsStationKind,
  parseNwsObservation,
  parseNwsStations,
} from "./nws-observations";
import { ghcnDailyUrl, nearestGhcnStations, parseGhcnDaily, parseGhcndInventory, parseGhcndStations } from "./ghcn";
import { aswsColumnId, bcAswsObservation, nearestBcAswsStations, parseAswsCsv, parseBcAswsStations } from "./bc-asws";
import { bboxAround, fetchEcccObservations, parseSwobFeatures, swobItemsUrl } from "./eccc";

const FIX = join(__dirname, "fixtures");
const read = (name: string) => readFileSync(join(FIX, name), "utf8");
const json = <T>(name: string) => JSON.parse(read(name)) as T;

const ALTA = { lat: 40.5883, lng: -111.6378 };
const WHISTLER = { lat: 50.1158, lng: -122.9542 };

/** A fetch that serves fixture bodies by URL substring and records the calls. */
function fakeFetch(routes: Array<[string, string | object, number?]>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})) });
    const hit = routes.find(([needle]) => url.includes(needle));
    if (!hit) return new Response("not found", { status: 404 });
    const [, body, status = 200] = hit;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

// ── types ────────────────────────────────────────────────────

test("types: haversineKm, num sentinels, ageMinutes", () => {
  assert.ok(Math.abs(haversineKm(ALTA, { lat: 40.5905, lng: -111.6369 }) - 0.26) < 0.05);
  assert.equal(num("-99"), null);
  assert.equal(num(""), null);
  assert.equal(num(" 12.5 "), 12.5);
  assert.equal(ageMinutes("2026-10-18T22:30:00Z", new Date("2026-10-18T23:00:00Z")), 30);
  assert.equal(ageMinutes("garbage", new Date()), null);
});

// ── SNOTEL ───────────────────────────────────────────────────

test("snotel: AWDB station row → meta, daily values → QC'd observation", () => {
  const meta = stationMetaFromAwdb(json<never[]>("awdb-station-alta.json")[0]);
  assert.equal(meta.sourceId, "1308:UT:SNTL");
  assert.equal(meta.name, "Atwater");
  assert.equal(meta.kind, "snotel");
  assert.equal(meta.elevationFt, 8750);
  assert.ok(haversineKm(ALTA, meta) < 1);

  const days = parseAwdbDaily(json("awdb-data-alta.json"));
  assert.ok(days && days.length >= 7, "eight days requested");
  const obs = snotelObservation(meta, days!);
  assert.ok(obs);
  assert.equal(obs.source, "snotel");
  assert.match(obs.observedAt, /^2026-10-1[78]T23:59:59\.000Z$/);
  assert.equal(typeof obs.snowDepthIn, "number");
  assert.equal(obs.windMph, null, "SNOTEL has no anemometer in the daily set");
  assert.equal((obs.payload as { qcFlag: string }).qcFlag, "valid");
  assert.ok(obs.newSnowIn == null || obs.newSnowIn >= 0);
});

test("snotel: new snow is the positive depth delta, QC carries a spike forward", () => {
  const meta = stationMetaFromAwdb(json<never[]>("awdb-station-alta.json")[0]);
  const base = { sweIn: 1, precipAccumIn: 5, tempObsF: 20, tempMaxF: 25, tempMinF: 10 };
  const obs = snotelObservation(meta, [
    { date: "2026-12-01", snowDepthIn: 20, ...base },
    { date: "2026-12-02", snowDepthIn: 27, ...base },
  ]);
  assert.equal(obs?.newSnowIn, 7);
  const spike = snotelObservation(meta, [
    { date: "2026-12-01", snowDepthIn: 20, ...base },
    { date: "2026-12-02", snowDepthIn: 90, ...base },
  ]);
  assert.equal(spike?.snowDepthIn, 20, "a 70 in jump is a sensor fault; previous day carried forward");
  assert.equal((spike?.payload as { qcFlag: string }).qcFlag, "suspect");
  assert.equal(normalizeTriplet("842", "CO"), "842:CO:SNTL");
  assert.equal(normalizeTriplet("2041:VT:SCAN", "VT"), "2041:VT:SCAN");
  assert.equal(parseAwdbDaily([]), null);
});

test("snotel: fetchSnotelObservation hits /stations then /data for the triplet", async () => {
  const { impl, calls } = fakeFetch([
    ["/stations?", json("awdb-station-alta.json")],
    ["/data?", json("awdb-data-alta.json")],
  ]);
  const obs = await fetchSnotelObservation("1308:UT:SNTL", { fetchImpl: impl, now: new Date("2026-10-18T20:00:00Z") });
  assert.equal(obs?.name, "Atwater");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /elements=SNWD%2CWTEQ%2CPREC%2CTOBS%2CTMAX%2CTMIN/);
  assert.match(calls[1].url, /beginDate=2026-10-10&endDate=2026-10-18/);
});

// ── NWS ──────────────────────────────────────────────────────

test("nws: the state listing carries the mesonet sensors above Alta that /points does not", () => {
  const stations = parseNwsStations(json("nws-stations-ut.json"));
  assert.ok(stations.length > 50);
  const near = nearestStations(ALTA, stations, { maxKm: 25, limit: 10 });
  const ids = near.map((s) => s.sourceId);
  assert.ok(ids.includes("AMB"), `Alta Mt Baldy in ${ids.join(",")}`);
  const baldy = near.find((s) => s.sourceId === "AMB")!;
  assert.equal(baldy.elevationFt, 11066);
  assert.equal(baldy.kind, "nws_obs");
  assert.ok(baldy.distanceKm < 3);
  assert.equal(near[0].distanceKm <= near[near.length - 1].distanceKm, true, "nearest first");
  assert.equal(nwsStationKind("KSLC"), "metar");
  assert.equal(nwsStationKind("UT224"), "nws_obs");
});

test("nws: latest observation → °F and mph, snow fields null", () => {
  const stations = parseNwsStations(json("nws-stations-ut.json"));
  const baldy = stations.find((s) => s.sourceId === "AMB")!;
  const obs = parseNwsObservation(baldy, json("nws-observation-amb.json"));
  assert.ok(obs);
  assert.equal(obs.observedAt, "2026-10-13T19:00:00.000Z");
  assert.equal(obs.tempF, 28.8); // -1.78 °C
  assert.equal(obs.windMph, 0);
  assert.equal(obs.snowDepthIn, null);
  const ut224 = parseNwsObservation(stations.find((s) => s.sourceId === "UT224")!, json("nws-observation-ut224.json"));
  assert.equal(ut224?.tempF, 64.3); // 17.95 °C
  assert.equal(ut224?.windMph, 3); // 4.86 km/h
  assert.equal(parseNwsObservation(baldy, { properties: {} }), null);
});

test("nws: fetchers send the User-Agent and follow pagination only on full pages", async () => {
  const page = json<{ features: unknown[]; pagination: { next: string } }>("nws-stations-ut.json");
  const { impl, calls } = fakeFetch([
    ["/stations?state=UT", page],
    ["/stations/AMB/observations/latest", json("nws-observation-amb.json")],
  ]);
  const stations = await fetchNwsStationsByState("ut", { fetchImpl: impl });
  assert.equal(stations.length, page.features.length);
  assert.equal(calls.length, 1, "81 rows < 500: no second page requested");
  assert.equal(calls[0].headers["User-Agent"], "PeakCam/1.0 (contact@peakcam.io)");
  const obs = await fetchNwsLatestObservation(stations.find((s) => s.sourceId === "AMB")!, { fetchImpl: impl });
  assert.equal(obs?.tempF, 28.8);
  const missing = await fetchNwsLatestObservation({ ...stations[0], sourceId: "NOPE" }, { fetchImpl: impl });
  assert.equal(missing, null, "404 is 'no observation', not an error");
});

// ── GHCN ─────────────────────────────────────────────────────

const GHCND_STATIONS = [
  "USC00420072  40.5905 -111.6369 2660.9 UT ALTA                                                ",
  "USW00024127  40.7781 -111.9694 1288.1 UT SALT LAKE CITY INTL AP           GSN HCN 72572     ",
  "CA001100875  50.1289 -122.9546  661.8    WHISTLER - NESTERS                              71687",
  "AF000040930  35.3170   69.0170 3366.0    NORTH-SALANG                   GSN     40930        ",
].join("\n");

const GHCND_INVENTORY = [
  "USC00420072  40.5905 -111.6369 SNWD 1945 2026",
  "USC00420072  40.5905 -111.6369 SNOW 1945 2026",
  "USW00024127  40.7781 -111.9694 SNWD 1948 2019",
  "CA001100875  50.1289 -122.9546 SNWD 1977 2026",
].join("\n");

test("ghcn: fixed-width inventory → stations filtered to active snow reporters", () => {
  const stations = parseGhcndStations(GHCND_STATIONS);
  assert.deepEqual(
    stations.map((s) => s.sourceId),
    ["USC00420072", "USW00024127", "CA001100875"],
    "Afghanistan filtered out by country",
  );
  assert.equal(stations[0].name, "ALTA");
  assert.equal(stations[0].state, "UT");
  assert.equal(stations[0].elevationFt, 8730);
  assert.equal(stations[2].state, null);
  const active = parseGhcndInventory(GHCND_INVENTORY, 2025);
  assert.deepEqual([...active].sort(), ["CA001100875", "USC00420072"]);
  const near = nearestGhcnStations(ALTA, stations, { active });
  assert.deepEqual(
    near.map((s) => s.sourceId),
    ["USC00420072"],
    "SLC airport is 35 km away and stopped reporting SNWD in 2019",
  );
});

test("ghcn: daily rows → newest measured day; blank trailing row ignored", () => {
  const meta = parseGhcndStations(GHCND_STATIONS)[0];
  const obs = parseGhcnDaily(meta, json("ghcn-daily-alta.json"));
  assert.ok(obs);
  assert.equal(obs.observedAt, "2026-10-14T23:59:59.000Z");
  assert.equal(obs.snowDepthIn, 7);
  assert.equal(obs.newSnowIn, 2);
  assert.equal(obs.tempF, 28); // mean of 36/20
  assert.equal(obs.name, "ALTA, UT US");
  assert.equal(parseGhcnDaily(meta, []), null);
  const url = ghcnDailyUrl("USC00420072", "2026-10-05", "2026-10-18");
  assert.match(url, /dataset=daily-summaries/);
  assert.match(url, /dataTypes=SNOW%2CSNWD%2CTMAX%2CTMIN/);
  assert.match(url, /units=standard/);
  assert.doesNotMatch(url, /token/);
});

// ── BC ASWS ──────────────────────────────────────────────────

test("bc-asws: WFS stations + element CSVs → an observation in inches and °F", () => {
  const stations = parseBcAswsStations(json("bc-asws-stations.json"));
  assert.ok(stations.length >= 5);
  const callaghan = stations.find((s) => s.sourceId === "3A20P")!;
  assert.equal(callaghan.name, "Callaghan Creek");
  assert.ok(callaghan.elevationFt! > 3000);
  const near = nearestBcAswsStations(WHISTLER, stations, { maxKm: 25 });
  assert.ok(near.some((s) => s.sourceId === "3A20P"), "Callaghan Creek is within 25 km of Whistler");

  assert.equal(aswsColumnId("3A25P Squamish River Upper"), "3A25P");
  const maps = { depthCm: parseAswsCsv(read("bc-asws-SD.csv")), sweMm: parseAswsCsv(read("bc-asws-SW.csv")), tempC: parseAswsCsv(read("bc-asws-TA.csv")) };
  assert.equal(maps.depthCm.get("1D06P")?.value, 3);
  assert.equal(maps.depthCm.get("1D06P")?.observedAt, "2026-10-18T22:00:00.000Z");
  assert.equal(maps.depthCm.has("1A01P"), false, "blank column has no reading");

  // Tenquille Lake (1D06P) is the column with all three elements in the recorded hour.
  const tenquille = { ...callaghan, sourceId: "1D06P", name: "Tenquille Lake", lat: 50.5333, lng: -122.9333, elevationFt: 5446 };
  const obs = bcAswsObservation(tenquille, maps);
  assert.ok(obs);
  assert.equal(obs.source, "bc_asws");
  assert.equal(obs.snowDepthIn, 1.2); // 3 cm
  assert.equal(obs.sweIn, 0); // 0 mm
  assert.equal(obs.tempF, 40.3); // 4.6 °C
  assert.equal(obs.observedAt, "2026-10-18T22:00:00.000Z");
  const earlier = bcAswsObservation(callaghan, maps);
  assert.equal(earlier?.observedAt, "2026-10-18T20:00:00.000Z", "Callaghan's newest cell is two hours older; the stamp follows the data");
  assert.equal(bcAswsObservation({ ...callaghan, sourceId: "9Z99P" }, maps), null, "a station absent from every file has no observation");
});

test("bc-asws: parseAswsCsv takes the newest non-blank cell per station, skips negatives", () => {
  const csv = ["DATE(UTC),1X01P One,1X02P Two", "2026-10-18 20:00,10,5", "2026-10-18 21:00,,-1", "2026-10-18 22:00,12,"].join("\n");
  const m = parseAswsCsv(csv);
  assert.deepEqual(m.get("1X01P"), { observedAt: "2026-10-18T22:00:00.000Z", value: 12 });
  assert.deepEqual(m.get("1X02P"), { observedAt: "2026-10-18T20:00:00.000Z", value: 5 });
});

// ── ECCC ─────────────────────────────────────────────────────

test("eccc: SWOB hourly features → one observation per station, metric converted, missing depth null", () => {
  const obs = parseSwobFeatures(json("eccc-swob-whistler.json"));
  const byName = Object.fromEntries(obs.map((o) => [o.name, o]));
  const callaghan = byName["CALLAGHAN VALLEY"];
  assert.ok(callaghan);
  assert.equal(callaghan.source, "eccc");
  assert.equal(callaghan.sourceId, "1101300");
  assert.equal(callaghan.tempF, 48.2); // 9.0 °C
  assert.equal(callaghan.windMph, 1.4); // 2.3 km/h
  assert.equal(callaghan.snowDepthIn, 1.2); // 3 cm
  assert.equal(callaghan.elevationFt, 2911);
  assert.equal(callaghan.observedAt, "2026-10-18T23:00:00.000Z");
  const nesters = byName["WHISTLER - NESTERS"];
  assert.equal(nesters.snowDepthIn, null, "-1 cm is a missing sensor");
  const navcan = byName["Whistler"];
  assert.equal(navcan.kind, "metar");
  assert.match(String(navcan.payload.data_attrib_not), /NAV CANADA/);
  assert.ok(haversineKm(WHISTLER, callaghan) < 15);
});

test("eccc: minutely rows are skipped; the request filters them server-side and sorts newest first", async () => {
  const minutely = { features: [{ geometry: { coordinates: [-122.9, 50.1, 600] }, properties: { "msc_id-value": "x", "date_tm-value": "2026-10-18T23:11:00Z", "_is-minutely_obs-value": true, air_temp: 1 } }] };
  assert.deepEqual(parseSwobFeatures(minutely), []);
  const url = swobItemsUrl(WHISTLER, 25);
  assert.match(url, /_is-minutely_obs-value=false/);
  assert.match(url, /sortby=-date_tm-value/);
  assert.match(bboxAround(WHISTLER, 25), /^-123\.\d+,49\.\d+,-122\.\d+,50\.\d+$/);
  const { impl } = fakeFetch([["swob-realtime", json("eccc-swob-whistler.json")]]);
  const near = await fetchEcccObservations(WHISTLER, { fetchImpl: impl, radiusKm: 25 });
  assert.equal(near.length, 3);
  assert.ok(near[0].distanceKm <= near[1].distanceKm);
});
