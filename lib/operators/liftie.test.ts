import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fetchLiftieResort,
  isChallengeResponse,
  liftieIdFor,
  liftiePairs,
  operatorStatusRow,
  parseLiftieResort,
  statsFromLifts,
  type OperatorSourceMap,
} from "./liftie";

const FETCHED = new Date("2026-12-20T18:30:00Z");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
const SOURCES = JSON.parse(readFileSync(join(__dirname, "..", "..", "data", "operator-sources.json"), "utf8")) as OperatorSourceMap;

// A fetch stub that answers one canned response.
function stubFetch(status: number, body: string, headers: Record<string, string> = {}): typeof fetch {
  return (async () => new Response(body, { status, headers })) as unknown as typeof fetch;
}

test("parseLiftieResort: the Alta document gives counts from stats, the provider timestamp and the operator page", () => {
  const report = parseLiftieResort(fixture("liftie-alta.json"), FETCHED)!;
  assert.equal(report.id, "alta");
  assert.equal(report.name, "Alta");
  assert.equal(report.sourceUrl, "https://www.alta.com/lift-terrain-status");
  assert.equal(report.observedAt, "2026-12-20T18:00:00.000Z");
  assert.equal(report.timestamped, true);
  assert.deepEqual(report.stats, { open: 7, hold: 1, scheduled: 0, closed: 3, total: 11 });
  assert.equal(Object.keys(report.lifts).length, 11);
  assert.equal(report.lifts.Collins, "open");
  assert.equal(report.openingDate, null);
});

test("parseLiftieResort: a pre-season document keeps scheduled lifts and the published opening date", () => {
  const report = parseLiftieResort(fixture("liftie-preseason.json"), FETCHED)!;
  assert.deepEqual(report.stats, { open: 0, hold: 0, scheduled: 2, closed: 2, total: 4 });
  assert.equal(report.openingDate, "2026-11-13");
});

test("parseLiftieResort: counts are recounted from the map when stats are missing or short, the fetch time stands in for a missing timestamp, junk is rejected", () => {
  const noStats = parseLiftieResort({ id: "x", lifts: { status: { A: "open", B: "closed", C: "bogus" } } }, FETCHED)!;
  assert.deepEqual(noStats.stats, { open: 1, hold: 0, scheduled: 0, closed: 1, total: 2 });
  assert.equal(noStats.observedAt, FETCHED.toISOString());
  assert.equal(noStats.timestamped, false);
  assert.equal(noStats.name, "x");
  const short = parseLiftieResort({ id: "y", lifts: { status: { A: "open", B: "open", C: "closed" }, stats: { open: 1, hold: 0, scheduled: 0, closed: 0 } } }, FETCHED)!;
  assert.deepEqual(short.stats, { open: 2, hold: 0, scheduled: 0, closed: 1, total: 3 });
  const empty = parseLiftieResort({ id: "z", lifts: {} }, FETCHED)!;
  assert.equal(empty.stats.total, 0);
  assert.equal(parseLiftieResort({ id: "z" }, FETCHED), null);
  assert.equal(parseLiftieResort(null, FETCHED), null);
  assert.equal(parseLiftieResort("nope", FETCHED), null);
  assert.equal(parseLiftieResort({ id: "q", lifts: { status: {} }, opening: "soon" }, FETCHED)!.openingDate, null);
  assert.deepEqual(statsFromLifts({ A: "hold", B: "scheduled" }), { open: 0, hold: 1, scheduled: 1, closed: 0, total: 2 });
});

test("operatorStatusRow: lift counts, null trails and base (Liftie has none), the provider URL, unverified", () => {
  const row = operatorStatusRow("id-alta", parseLiftieResort(fixture("liftie-alta.json"), FETCHED)!, FETCHED);
  assert.equal(row.resort_id, "id-alta");
  assert.equal(row.source, "liftie");
  assert.equal(row.source_id, "alta");
  assert.equal(row.observed_at, "2026-12-20T18:00:00.000Z");
  assert.equal(row.fetched_at, FETCHED.toISOString());
  assert.equal(row.lifts_open, 7);
  assert.equal(row.lifts_hold, 1);
  assert.equal(row.lifts_scheduled, 0);
  assert.equal(row.lifts_closed, 3);
  assert.equal(row.lifts_total, 11);
  assert.equal(row.trails_open, null);
  assert.equal(row.base_depth_in, null);
  assert.equal(row.surface, null);
  assert.equal(row.opening_date, null);
  assert.equal(row.verified, false);
  assert.equal(row.source_url, "https://www.alta.com/lift-terrain-status");
  assert.equal((row.payload.stats as { total: number }).total, 11);
  const bare = operatorStatusRow("id-z", parseLiftieResort({ id: "z", lifts: {} }, FETCHED)!, FETCHED);
  assert.equal(bare.lifts_open, null);
  assert.equal(bare.lifts_total, null);
});

test("isChallengeResponse recognises Cloudflare's managed challenge by header, by a 403 HTML page and by body", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(isChallengeResponse(403, h({ "cf-mitigated": "challenge", "content-type": "text/html" }), ""), true);
  assert.equal(isChallengeResponse(403, h({ "content-type": "text/html; charset=UTF-8" }), "<!DOCTYPE html>"), true);
  assert.equal(isChallengeResponse(200, h({ "content-type": "text/html" }), "<title>Just a moment...</title>"), true);
  assert.equal(isChallengeResponse(200, h({ "content-type": "application/json;charset=UTF-8" }), "{\"id\":\"alta\"}"), false);
  assert.equal(isChallengeResponse(404, h({ "content-type": "text/plain" }), "Invalid resort name"), false);
});

test("fetchLiftieResort: JSON → report; the challenge page → blocked; 404 → not_found; other → http / invalid / network", async () => {
  const body = JSON.stringify(fixture("liftie-alta.json"));
  const ok = await fetchLiftieResort("alta", { fetchImpl: stubFetch(200, body, { "content-type": "application/json;charset=UTF-8" }), now: () => FETCHED });
  assert.ok(ok.ok);
  assert.equal(ok.report.stats.open, 7);

  const blocked = await fetchLiftieResort("alta", { fetchImpl: stubFetch(403, "<!DOCTYPE html><title>Just a moment...</title>", { "content-type": "text/html; charset=UTF-8", "cf-mitigated": "challenge" }) });
  assert.ok(!blocked.ok);
  assert.equal(blocked.reason, "blocked");
  assert.equal(blocked.status, 403);

  const missing = await fetchLiftieResort("nope", { fetchImpl: stubFetch(404, "", { "content-type": "text/plain" }) });
  assert.ok(!missing.ok && missing.reason === "not_found");

  const down = await fetchLiftieResort("alta", { fetchImpl: stubFetch(502, "bad gateway", { "content-type": "text/plain" }) });
  assert.ok(!down.ok && down.reason === "http" && down.status === 502);

  const junk = await fetchLiftieResort("alta", { fetchImpl: stubFetch(200, "not json", { "content-type": "application/json" }) });
  assert.ok(!junk.ok && junk.reason === "invalid");

  const noLifts = await fetchLiftieResort("alta", { fetchImpl: stubFetch(200, "{\"id\":\"alta\"}", { "content-type": "application/json" }) });
  assert.ok(!noLifts.ok && noLifts.reason === "invalid");

  const failing = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
  const network = await fetchLiftieResort("alta", { fetchImpl: failing });
  assert.ok(!network.ok && network.reason === "network" && /ECONNRESET/.test(network.detail));
});

test("data/operator-sources.json: every entry names a Liftie id in Liftie's id form, slugs exist in the catalogue CSV, and the helpers read it", () => {
  const pairs = liftiePairs(SOURCES);
  assert.ok(pairs.length >= 80, `expected 80+ mapped resorts, got ${pairs.length}`);
  const csv = readFileSync(join(__dirname, "..", "..", "data", "resorts.csv"), "utf8");
  const slugs = new Set(csv.split("\n").slice(1).map((line) => line.split(",")[1]).filter(Boolean));
  for (const { slug, liftieId } of pairs) {
    assert.ok(slugs.has(slug), `${slug} is not in data/resorts.csv`);
    assert.match(liftieId, /^[a-z0-9-]+$/, `${slug}: "${liftieId}" is not a Liftie id`);
  }
  assert.equal(liftieIdFor(SOURCES, "breckenridge"), "breck");
  assert.equal(liftieIdFor(SOURCES, "alta"), "alta");
  assert.equal(liftieIdFor(SOURCES, "ski-portillo"), null);
  const ids = pairs.map((p) => p.liftieId);
  assert.equal(new Set(ids).size, ids.length, "a Liftie id maps to one PeakCam resort");
});
