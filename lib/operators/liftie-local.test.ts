import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { operatorStatusRow } from "./liftie";
import { LOCAL_FAILURES, localResultToReport, parseWorkerLine, runLiftieWorker, workerEnv, type LocalSuccess } from "./liftie-local";

const FETCHED = new Date("2026-11-20T16:25:00Z");
const ROOT = join(__dirname, "..", "..");

const keystone: LocalSuccess = {
  id: "keystone",
  ok: true,
  name: "Keystone",
  href: "https://www.keystoneresort.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx",
  requestUrl: "https://www.keystoneresort.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx",
  lifts: { "Montezuma Express": "open", "Peru Express": "open", "River Run Gondola": "closed", "Outpost Gondola": "hold", "Ruby Express": "scheduled" },
  opening: null,
  httpStatus: 200,
};

test("parseWorkerLine: a success line keeps only the four states and trims names", () => {
  const parsed = parseWorkerLine(
    JSON.stringify({ ...keystone, lifts: { ...keystone.lifts, " A51 ": "open", Bogus: "maybe", Count: 3 }, opening: "2026-11-27", extra: "ignored" }),
  );
  assert.ok(parsed && "ok" in parsed && parsed.ok);
  assert.deepEqual(Object.keys(parsed.lifts), ["Montezuma Express", "Peru Express", "River Run Gondola", "Outpost Gondola", "Ruby Express", "A51"]);
  assert.equal(parsed.opening, "2026-11-27");
  assert.equal(parsed.httpStatus, 200);
});

test("parseWorkerLine: failures keep their class; unknown classes and empty successes are renamed, never passed through", () => {
  for (const reason of LOCAL_FAILURES) {
    const parsed = parseWorkerLine(JSON.stringify({ id: "breck", ok: false, reason, status: 403, detail: "d" }));
    assert.deepEqual(parsed, { id: "breck", ok: false, reason, status: 403, detail: "d" });
  }
  assert.deepEqual(parseWorkerLine('{"id":"breck","ok":false,"reason":"gremlins"}'), { id: "breck", ok: false, reason: "invalid", status: null, detail: "" });
  assert.deepEqual(parseWorkerLine('{"id":"kirkwood","ok":true,"lifts":{},"httpStatus":200}'), {
    id: "kirkwood",
    ok: false,
    reason: "parse_empty",
    status: 200,
    detail: "the parser found no lifts on the page",
  });
  assert.deepEqual(parseWorkerLine('{"id":"x","ok":true,"lifts":{"A":"nope"}}'), { id: "x", ok: false, reason: "parse_empty", status: null, detail: "the parser found no lifts on the page" });
});

test("parseWorkerLine: the meta line, and noise that is not protocol", () => {
  assert.deepEqual(parseWorkerLine('{"meta":true,"liftieVersion":"4.4.2","targets":17}'), { meta: { liftieVersion: "4.4.2", targets: 17 } });
  for (const noise of ["", "liftie:lifts fetching", "[1,2]", "{not json", '{"ok":true}', '"breck"']) assert.equal(parseWorkerLine(noise), null, noise);
  // A non-http href never becomes a source URL.
  const parsed = parseWorkerLine(JSON.stringify({ ...keystone, href: "javascript:alert(1)", requestUrl: 7 }));
  assert.ok(parsed && "ok" in parsed && parsed.ok);
  assert.equal(parsed.href, null);
  assert.equal(parsed.requestUrl, null);
});

test("localResultToReport: the same report shape as the API path, counted from the lift map, stamped with the fetch instant", () => {
  const report = localResultToReport(keystone, FETCHED);
  assert.equal(report.id, "keystone");
  assert.equal(report.name, "Keystone");
  assert.equal(report.sourceUrl, keystone.href);
  assert.deepEqual(report.stats, { open: 2, hold: 1, scheduled: 1, closed: 1, total: 5 });
  assert.equal(report.observedAt, "2026-11-20T16:25:00.000Z");
  assert.equal(report.timestamped, false);
  assert.equal(report.openingDate, null);
  assert.equal(localResultToReport({ ...keystone, opening: "2026-11-27", href: null }, FETCHED).openingDate, "2026-11-27");
  assert.equal(localResultToReport({ ...keystone, href: null }, FETCHED).sourceUrl, null);
});

test("operatorStatusRow: a local report stores lift counts, the operator page and how it was read", () => {
  const row = operatorStatusRow("resort-uuid", localResultToReport(keystone, FETCHED), FETCHED, "liftie-parsers@4.4.2");
  assert.equal(row.source, "liftie");
  assert.equal(row.source_id, "keystone");
  assert.deepEqual([row.lifts_open, row.lifts_hold, row.lifts_scheduled, row.lifts_closed, row.lifts_total], [2, 1, 1, 1, 5]);
  assert.equal(row.observed_at, "2026-11-20T16:25:00.000Z");
  assert.equal(row.source_url, keystone.href);
  assert.equal(row.trails_open, null);
  assert.equal(row.verified, false);
  assert.equal(row.payload.via, "liftie-parsers@4.4.2");
  // Without `via` the payload is exactly what the API path stored.
  assert.equal("via" in operatorStatusRow("resort-uuid", localResultToReport(keystone, FETCHED), FETCHED).payload, false);
});

test("workerEnv: the child is given a search path and nothing secret", () => {
  const env = workerEnv({
    PATH: "/usr/bin",
    TMPDIR: "/tmp/x",
    SUPABASE_SERVICE_ROLE_KEY: "secret",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    CRON_SECRET: "secret",
    ANTHROPIC_API_KEY: "secret",
    HOME: "/Users/someone",
  });
  assert.deepEqual(env, { PATH: "/usr/bin", TMPDIR: "/tmp/x" });
});

// End to end through the real child process, with an id that has no parser so
// nothing is fetched. Skips where the worker's libraries are not installed.
const installed = existsSync(join(ROOT, "scripts", "liftie-worker", "node_modules", "htmlparser2"));

test("runLiftieWorker: one result per id, in order, with no network for an unmapped id", { skip: installed ? false : "npm ci --prefix scripts/liftie-worker" }, async () => {
  const seen: string[] = [];
  const outcome = await runLiftieWorker(["no-such-resort-a", "../etc", "no-such-resort-b"], {
    root: ROOT,
    pauseMs: 0,
    robotsCachePath: join(ROOT, "scripts", "liftie-worker", "node_modules", ".robots-test-cache.json"),
    onResult: (r) => {
      seen.push(r.id);
    },
  });
  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.meta?.liftieVersion ?? "", /^\d+\.\d+\.\d+$/);
  assert.deepEqual(seen, ["no-such-resort-a", "../etc", "no-such-resort-b"]);
  assert.deepEqual(outcome.results.map((r) => (r.ok ? "ok" : r.reason)), ["no_parser", "no_parser", "no_parser"]);
});
