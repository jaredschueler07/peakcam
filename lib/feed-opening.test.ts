import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EARLY_OPEN_MAX_SHARE,
  detectFeedOpening,
  feedOpeningEvidence,
  type FeedOpeningInput,
  type FeedOpeningOpening,
} from "./feed-opening";
import { PRE_SEASON_IMPLAUSIBLE_OPEN_SHARE } from "./conditions-contract";
import type { OperatorReading } from "./operator-day";

const ZONE = "America/Denver"; // UTC−7 in November
/** A Mountain-time clock on `day` as a Date. */
const mt = (clock: string, day: string) => new Date(Date.parse(`${day}T${clock}:00Z`) + 7 * 3_600_000);
const rd = (clock: string, open: number, scheduled: number, total: number, day: string): OperatorReading => ({
  observedAt: mt(clock, day).toISOString(),
  liftsOpen: open,
  liftsScheduled: scheduled,
  liftsTotal: total,
});
const row = (over: Partial<FeedOpeningOpening> = {}): FeedOpeningOpening => ({
  season: "2026-27",
  projected_open: null,
  confirmed_open: null,
  closing_date: null,
  feed_open: null,
  ...over,
});
const detect = (readings: OperatorReading[], now: Date, opening: FeedOpeningOpening | null, over: Partial<FeedOpeningInput> = {}) =>
  detectFeedOpening({ readings, now, opening, timeZone: ZONE, hemisphere: "north", ...over });

const NOV25 = "2026-11-25";
const NOV26 = "2026-11-26";

// Production readings from operator_status, 2026-11-25 (Mountain time).
const BIG_SKY = [
  rd("06:05", 0, 8, 40, NOV25), rd("08:05", 0, 9, 40, NOV25), rd("08:35", 0, 9, 40, NOV25),
  rd("09:05", 8, 1, 40, NOV25), rd("09:35", 8, 1, 40, NOV25), rd("10:05", 8, 1, 40, NOV25), rd("15:35", 8, 0, 40, NOV25),
];
const ALTA = [rd("09:05", 0, 0, 5, NOV25), rd("09:35", 4, 0, 5, NOV25), rd("10:05", 4, 0, 5, NOV25), rd("15:35", 4, 0, 5, NOV25)];
// Park City flags 7 lifts "open" at 06:05, before anything turns: not evidence.
const PARK_CITY = [rd("06:05", 7, 0, 44, NOV25), rd("06:35", 7, 0, 44, NOV25), rd("07:05", 1, 6, 44, NOV25), rd("09:05", 7, 0, 44, NOV25), rd("09:35", 7, 0, 44, NOV25)];
// Beaver Creek, 2026-11-23, two days before its Nov 25 opening: the page flipped every lift open for an hour.
const BEAVER_CREEK = [rd("14:05", 24, 0, 25, "2026-11-23"), rd("14:35", 25, 0, 25, "2026-11-23"), rd("15:05", 25, 0, 25, "2026-11-23")];

test("detects the opening day from a sustained lift day on or after the projection (Big Sky, Alta, 2026-11-25)", () => {
  const projected = row({ projected_open: NOV25 });
  for (const [name, readings, open] of [["big-sky", BIG_SKY, 8], ["alta", ALTA, 4]] as const) {
    const v = detect(readings, mt("16:00", NOV25), projected);
    assert.ok(v.ok, `${name}: ${!v.ok ? v.reason : ""}`);
    assert.equal(v.opening.day, NOV25);
    assert.equal(v.opening.maxOpen, open);
    assert.equal(v.opening.early, false);
  }
});

test("the next morning still finds yesterday's lift day (the sync reads the last 30 h)", () => {
  const v = detect([...BIG_SKY, rd("06:05", 0, 8, 40, NOV26)], mt("06:10", NOV26), row({ projected_open: NOV25 }));
  assert.ok(v.ok);
  assert.equal(v.opening.day, NOV25);
});

test("pre-first-chair 'open' flags are not evidence (Park City at 06:05 MT)", () => {
  const early = detect(PARK_CITY.slice(0, 3), mt("07:10", NOV25), row({ projected_open: NOV25 }));
  assert.equal(early.ok, false);
  const later = detect(PARK_CITY, mt("09:40", NOV25), row({ projected_open: NOV25 }));
  assert.ok(later.ok);
  assert.equal(later.opening.firstAt, mt("09:05", NOV25).toISOString());
});

test("one open reading is not sustained; two consecutive syncs are", () => {
  assert.equal(detect([rd("09:35", 4, 0, 5, NOV25)], mt("09:40", NOV25), row({ projected_open: NOV25 })).ok, false);
  assert.equal(detect([rd("09:35", 4, 0, 5, NOV25), rd("10:05", 4, 0, 5, NOV25)], mt("10:10", NOV25), row({ projected_open: NOV25 })).ok, true);
});

test("the Beaver Creek glitch (25 of 25 for an hour before its opening date) is never stored", () => {
  const confirmedAhead = detect(BEAVER_CREEK, mt("15:10", "2026-11-23"), row({ confirmed_open: NOV25 }));
  assert.equal(confirmedAhead.ok, false);
  const projectedAhead = detect(BEAVER_CREEK, mt("15:10", "2026-11-23"), row({ projected_open: NOV25 }));
  assert.equal(projectedAhead.ok, false);
  // Even held all afternoon, a near-full count before the date on file is refused.
  const allAfternoon = [10, 11, 12, 13, 14, 15].map((h) => rd(`${h}:05`, 25, 0, 25, "2026-11-23"));
  const v = detect(allAfternoon, mt("15:10", "2026-11-23"), row({ projected_open: NOV25 }));
  assert.equal(v.ok, false);
  assert.match(!v.ok ? v.reason : "", /near-full count before opening day/);
});

test("an early opening with a few lifts is stored only when it holds for 90 minutes", () => {
  const D = "2026-11-20";
  const ahead = row({ confirmed_open: "2026-11-27" });
  const brief = [rd("09:05", 5, 0, 34, D), rd("09:35", 5, 0, 34, D)];
  assert.equal(detect(brief, mt("09:40", D), ahead).ok, false);
  const held = [rd("09:05", 5, 0, 34, D), rd("09:35", 5, 0, 34, D), rd("10:05", 5, 0, 34, D), rd("10:35", 5, 0, 34, D)];
  const v = detect(held, mt("10:40", D), ahead);
  assert.ok(v.ok);
  assert.equal(v.opening.early, true);
});

test("nothing is stored when the season is already on file, for the south, or without a row", () => {
  const now = mt("16:00", NOV25);
  assert.equal(detect(BIG_SKY, now, row({ projected_open: NOV25, confirmed_open: NOV25 })).ok, false);
  assert.equal(detect(BIG_SKY, now, row({ projected_open: NOV25, feed_open: "2026-11-24" })).ok, false);
  assert.equal(detect(BIG_SKY, now, row({ projected_open: NOV25 }), { hemisphere: "south" }).ok, false);
  assert.equal(detect(BIG_SKY, now, null).ok, false);
  assert.equal(detect(BIG_SKY, now, row({ season: "2025-26", projected_open: NOV25 })).ok, false);
});

test("a single lift running ahead of the date on file is not an opening (Telluride, 1 of 17 on 2026-11-26, projected 2026-12-05)", () => {
  const telluride = ["08:05", "08:35", "09:05", "09:35"].map((c) => rd(c, 1, 0, 17, NOV26));
  const v = detect(telluride, mt("09:40", NOV26), row({ projected_open: "2026-12-05" }));
  assert.equal(v.ok, false);
  assert.match(!v.ok ? v.reason : "", /only 1 of 17 lifts open before the date on file/);
  // On or after the date on file one lift is enough (Loveland and A-Basin open with one chair).
  assert.ok(detect(telluride, mt("09:40", NOV26), row({ projected_open: NOV26 })).ok);
});

test("a confirmed date later than the feed day does not block an early opening", () => {
  const D = "2026-11-20";
  const held = [rd("09:05", 3, 0, 20, D), rd("09:35", 3, 0, 20, D), rd("10:05", 3, 0, 20, D), rd("10:35", 3, 0, 20, D)];
  assert.ok(detect(held, mt("10:40", D), row({ confirmed_open: "2026-11-27" })).ok);
});

test("readings older than yesterday are ignored, so a backlog never stores a past day", () => {
  assert.equal(detect(BIG_SKY, mt("10:00", "2026-11-28"), row({ projected_open: NOV25 })).ok, false);
});

test("the early-opening share matches the status rule from PR #168", () => {
  assert.equal(EARLY_OPEN_MAX_SHARE, PRE_SEASON_IMPLAUSIBLE_OPEN_SHARE);
});

test("evidence text names the day, the counts and the resort-time window", () => {
  const v = detect(BIG_SKY, mt("16:00", NOV25), row({ projected_open: NOV25 }));
  assert.ok(v.ok);
  const text = feedOpeningEvidence(v.opening, ZONE, "https://example.test/lifts");
  assert.match(text, /lifts open on 2026-11-25: up to 8 of 40 in 4 readings from 09:05 to 15:35 resort time/);
  assert.match(text, /Detected by operator-sync\. Source: https:\/\/example\.test\/lifts$/);
});
