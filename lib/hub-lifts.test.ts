import { test } from "node:test";
import assert from "node:assert/strict";
import type { OperatorStatusRow } from "./types";
import { buildHubLiftsIndex, hasOpenLifts, hubDisplayRating, hubLiftsFromRow, liftsCellLabel, liftsCellText, liftsFootnote } from "./hub-lifts";

const NOW = new Date("2026-11-20T18:00:00Z");

function row(over: Partial<OperatorStatusRow> = {}): OperatorStatusRow {
  return {
    resort_id: "r1", id: "o1", source: "liftie", source_id: "breck",
    observed_at: "2026-11-20T17:00:00Z", fetched_at: "2026-11-20T17:05:00Z",
    lifts_open: 8, lifts_hold: 0, lifts_scheduled: 0, lifts_closed: 27, lifts_total: 35,
    trails_open: null, trails_total: null, base_depth_in: null, surface: null, opening_date: null, source_url: null, verified: false,
    ...over,
  };
}

test("a current feed with counts gives the lift count, dated by the feed", () => {
  assert.deepEqual(hubLiftsFromRow(row(), NOW), { open: 8, total: 35, observedAt: "2026-11-20T17:00:00.000Z" });
  // Recent (over 3 h, under 30 h) still counts: the contract's rule, not a second threshold.
  assert.equal(hubLiftsFromRow(row({ observed_at: "2026-11-19T20:00:00Z" }), NOW)?.open, 8);
});

test("a stale feed, a missing row and a row without counts show nothing", () => {
  assert.equal(hubLiftsFromRow(row({ observed_at: "2026-11-19T11:00:00Z" }), NOW), null); // 31 h
  assert.equal(hubLiftsFromRow(null, NOW), null);
  assert.equal(hubLiftsFromRow(row({ lifts_open: null }), NOW), null);
  assert.equal(hubLiftsFromRow(row({ lifts_total: 0 }), NOW), null);
  assert.equal(hubLiftsFromRow(row({ observed_at: "not a date" }), NOW), null);
});

test("zero open lifts is a dash, not a number, and carries no Open chip", () => {
  const closed = hubLiftsFromRow(row({ lifts_open: 0, lifts_closed: 35 }), NOW);
  assert.deepEqual(closed, { open: 0, total: 35, observedAt: "2026-11-20T17:00:00.000Z" });
  assert.equal(hasOpenLifts(closed), false);
  assert.equal(liftsCellText(closed), null);
  assert.equal(liftsCellText(null), null);
  assert.equal(liftsCellText(hubLiftsFromRow(row(), NOW)), "8 of 35");
});

test("the index keeps only resorts with a current count and tolerates a missing index", () => {
  const index = buildHubLiftsIndex({ r1: row(), r2: row({ resort_id: "r2", observed_at: "2026-11-18T00:00:00Z" }) }, NOW);
  assert.deepEqual(Object.keys(index), ["r1"]);
  assert.deepEqual(buildHubLiftsIndex(null, NOW), {});
});

test("the note is dated by the newest feed reading shown and never says confirmed open", () => {
  const a = hubLiftsFromRow(row(), NOW)!;
  const b = hubLiftsFromRow(row({ observed_at: "2026-11-20T17:30:00Z", lifts_open: 4, lifts_total: 21 }), NOW)!;
  const zero = hubLiftsFromRow(row({ lifts_open: 0, observed_at: "2026-11-20T17:55:00Z" }), NOW)!;
  const note = liftsFootnote([a, null, b, zero])!;
  assert.match(note, /newest reading 10:30 a\.m\. MT Nov 20/);
  assert.match(note, /open per that feed/);
  assert.doesNotMatch(note, /confirmed open/);
  assert.equal(liftsFootnote([zero, null, undefined]), null);
  assert.equal(liftsCellLabel(a, "Breckenridge"), "Breckenridge: 8 of 35 lifts open per the operator's feed, read at 10:00 a.m. MT Nov 20");
});

test("a report without a base depth shows no rating", () => {
  assert.equal(hubDisplayRating("poor", null), null);
  assert.equal(hubDisplayRating("poor", undefined), null);
  assert.equal(hubDisplayRating("poor", 0), "poor");
  assert.equal(hubDisplayRating("great", 40), "great");
  assert.equal(hubDisplayRating(null, 12), null);
});
