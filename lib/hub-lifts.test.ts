import { test } from "node:test";
import assert from "node:assert/strict";
import type { OperatorStatusRow } from "./types";
import { buildHubLiftsIndex, hasOpenLifts, hubDisplayRating, hubLiftsFromRow, liftsCellLabel, liftsCellText, liftsFootnote, liftsMobileText, opensToday } from "./hub-lifts";

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
  assert.deepEqual(hubLiftsFromRow(row(), NOW), { state: "operated", open: 8, total: 35, scheduled: null, observedAt: "2026-11-20T17:00:00.000Z", current: true, carried: false });
  // Earlier the same local day (over 3 h old) still counts: the contract's freshness rule, not a second threshold.
  assert.equal(hubLiftsFromRow(row({ observed_at: "2026-11-20T14:30:00Z" }), NOW)?.open, 8);
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
  assert.equal(closed, null); // 10:00 Mountain, 0 open and none scheduled: the feed says closed, the table says nothing
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
  const zero = hubLiftsFromRow(row({ lifts_open: 0, observed_at: "2026-11-20T17:55:00Z" }), NOW);
  const note = liftsFootnote([a, null, b, zero])!;
  assert.match(note, /the newest of them at 10:30 a\.m\. MT Nov 20/);
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

// ── Day rules (lib/operator-day.ts) through the hub helpers ──

const reading = (observed_at: string, lifts_open: number, lifts_scheduled: number, lifts_total: number) => ({ observed_at, lifts_open, lifts_scheduled, lifts_total });
// Vail, 2026-11-20 (Mountain = UTC−7): 2 open through 15:05, then 0 open / 4 scheduled at 15:35.
const VAIL_RECENT = [reading("2026-11-20T22:35:00Z", 0, 4, 34), reading("2026-11-20T22:05:00Z", 2, 0, 34), reading("2026-11-20T16:56:00Z", 2, 0, 34)];
const vailRow = () => row({ observed_at: "2026-11-20T22:35:00Z", lifts_open: 0, lifts_scheduled: 4, lifts_closed: 30, lifts_total: 34, recent: VAIL_RECENT });

test("evening after the last chair: the chip and the day's last open count stay", () => {
  const evening = new Date("2026-11-21T00:00:00Z"); // 17:00 Mountain
  const lifts = hubLiftsFromRow(vailRow(), evening, "America/Denver")!;
  assert.deepEqual(lifts, { state: "operated", open: 2, total: 34, scheduled: null, observedAt: "2026-11-20T22:05:00.000Z", current: false, carried: false });
  assert.equal(hasOpenLifts(lifts), true);
  assert.equal(liftsCellText(lifts), "2 of 34");
  assert.match(liftsCellLabel(lifts, "Vail"), /read at 3:05 p\.m\. MT Nov 20; the feed has shown none open since/);
});

test("before the first chair with lifts scheduled: 'Opens today', not 'Open'", () => {
  const morning = new Date("2026-11-20T13:30:00Z"); // 06:30 Mountain
  const lifts = hubLiftsFromRow(row({ observed_at: "2026-11-20T13:05:00Z", lifts_open: 0, lifts_scheduled: 5, lifts_total: 27 }), morning, "America/Denver")!;
  assert.equal(lifts.state, "scheduled");
  assert.equal(hasOpenLifts(lifts), false);
  assert.equal(opensToday(lifts), true);
  assert.equal(liftsCellText(lifts), "5 scheduled");
  assert.equal(liftsMobileText(lifts), "5 lifts scheduled");
  assert.match(liftsCellLabel(lifts, "Heavenly"), /no lift open yet today, 5 scheduled to open per the operator's feed/);
  assert.match(liftsFootnote([lifts])!, /"Opens today" means the feed lists lifts as scheduled and none open yet/);
});

test("before the first chair on a feed with no scheduled state: nothing, and never 'closed'", () => {
  const morning = new Date("2026-11-20T13:30:00Z");
  assert.equal(hubLiftsFromRow(row({ observed_at: "2026-11-20T13:05:00Z", lifts_open: 0, lifts_scheduled: 0, lifts_total: 21 }), morning, "America/Denver"), null);
});

test("between local midnight and the first reading the previous day's count is carried, dated by its own reading", () => {
  const night = new Date("2026-11-21T12:30:00Z"); // 05:30 Mountain, no reading yet on the 21st
  const lifts = hubLiftsFromRow(vailRow(), night, "America/Denver")!;
  assert.equal(lifts.carried, true);
  assert.equal(lifts.open, 2);
  assert.equal(hasOpenLifts(lifts), true);
  assert.match(liftsCellLabel(lifts, "Vail"), /read at 3:05 p\.m\. MT Nov 20, the last open reading before today's first/);
  assert.match(liftsFootnote([lifts])!, /the newest of them at 3:05 p\.m\. MT Nov 20/);
  // Once today has a reading, yesterday no longer counts.
  const withToday = row({ observed_at: "2026-11-21T13:05:00Z", lifts_open: 0, lifts_scheduled: 0, lifts_total: 34, recent: [reading("2026-11-21T13:05:00Z", 0, 0, 34), ...VAIL_RECENT] });
  assert.equal(hubLiftsFromRow(withToday, new Date("2026-11-21T13:30:00Z"), "America/Denver"), null);
});

test("the index uses each resort's own zone", () => {
  // 13:00Z on the 21st: 05:00 Pacific. A Pacific resort that ran on the 20th and has no reading yet today is carried.
  const pacific = row({ resort_id: "p1", observed_at: "2026-11-20T22:35:00Z", lifts_open: 6, lifts_total: 19 });
  const index = buildHubLiftsIndex({ p1: pacific }, new Date("2026-11-21T13:00:00Z"), [{ id: "p1", state: "CA", country: "US", lng: -120 }]);
  assert.equal(index.p1?.carried, true);
  assert.equal(index.p1?.open, 6);
});
