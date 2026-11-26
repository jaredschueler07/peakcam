import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cronOpeningsToMail,
  feedOpeningMailVerdict,
  feedOpeningQueryDays,
  feedOpeningsToMail,
  seasonLogStart,
  type FeedOpeningMailRow,
} from "./feed-opening-email";
import { planOpeningDayEmails } from "./opening-day";
import { detectFeedOpening } from "../feed-opening";
import type { OperatorReading } from "../operator-day";

/** A Mountain-time clock (UTC−7 in November) on `day` as a Date. */
const mt = (clock: string, day: string) => new Date(Date.parse(`${day}T${clock}:00Z`) + 7 * 3_600_000);
const NOV25 = "2026-11-25";
const NOV26 = "2026-11-26";

const BIG_SKY = { name: "Big Sky", slug: "big-sky", state: "MT", country: "US", lat: 45.28, lng: -111.4 };
const row = (over: Partial<FeedOpeningMailRow> = {}): FeedOpeningMailRow => ({
  resort_id: "r-big-sky",
  season: "2026-27",
  confirmed_open: null,
  feed_open: NOV26,
  resorts: BIG_SKY,
  ...over,
});

test("a feed opening is mailed on its own local day, during the lift day", () => {
  const v = feedOpeningMailVerdict(row(), mt("09:10", NOV26));
  assert.equal(v.mail, true);
  assert.equal(v.mail && v.timeZone, "America/Denver");
});

test("an opening carried over from yesterday is never mailed, whenever it was found", () => {
  // Found from the next morning's readings: feed_open is yesterday.
  for (const clock of ["07:05", "09:05", "12:00"]) {
    const v = feedOpeningMailVerdict(row({ feed_open: NOV25 }), mt(clock, NOV26));
    assert.equal(v.mail, false, clock);
    assert.match(!v.mail ? v.reason : "", /not today/);
  }
  // And a later run can never make an old day "today" again.
  assert.equal(feedOpeningMailVerdict(row({ feed_open: NOV25 }), mt("10:00", "2026-11-27")).mail, false);
});

test("the day is the resort's own local day, not UTC's", () => {
  // 18:30 MT on Nov 25 is already Nov 26 in UTC; a Nov 26 opening is not Big Sky's today yet.
  assert.equal(feedOpeningMailVerdict(row(), mt("18:30", NOV25)).mail, false);
  // 03:00 UTC on Nov 27 is still Nov 26 in Mountain time, but the lift day is over.
  const late = feedOpeningMailVerdict(row(), new Date("2026-11-27T03:00:00Z"));
  assert.equal(late.mail, false);
  assert.match(!late.mail ? late.reason : "", /after the lift day/);
});

test("nothing is mailed once the lifts close (16:00 local)", () => {
  assert.equal(feedOpeningMailVerdict(row(), mt("15:59", NOV26)).mail, true);
  assert.equal(feedOpeningMailVerdict(row(), mt("16:00", NOV26)).mail, false);
});

test("a confirmed date on or before the feed day owns the email; a later one does not", () => {
  assert.equal(feedOpeningMailVerdict(row({ confirmed_open: NOV26 }), mt("09:10", NOV26)).mail, false);
  assert.equal(feedOpeningMailVerdict(row({ confirmed_open: NOV25 }), mt("09:10", NOV26)).mail, false);
  // An early opening ahead of the announced date is news worth the email.
  assert.equal(feedOpeningMailVerdict(row({ confirmed_open: "2026-11-28" }), mt("09:10", NOV26)).mail, true);
});

test("other seasons, the South, missing rows and empty days mail nobody", () => {
  const now = mt("09:10", NOV26);
  assert.equal(feedOpeningMailVerdict(row({ season: "2025-26" }), now).mail, false);
  assert.equal(feedOpeningMailVerdict(row({ resorts: { ...BIG_SKY, lat: -33.3, country: "CL", state: null } }), now).mail, false);
  assert.equal(feedOpeningMailVerdict(row({ resorts: null }), now).mail, false);
  assert.equal(feedOpeningMailVerdict(row({ feed_open: null }), now).mail, false);
  assert.deepEqual(feedOpeningsToMail([row({ feed_open: NOV25 }), row({ resort_id: "r-2" })], now).map((r) => r.resort_id), ["r-2"]);
});

test("the Beaver Creek glitch never reaches the email: the detector stores nothing, so nothing is mailed", () => {
  const day = "2026-11-23";
  const readings: OperatorReading[] = ["14:05", "14:35", "15:05"].map((clock, i) => ({
    observedAt: mt(clock, day).toISOString(),
    liftsOpen: i === 0 ? 24 : 25,
    liftsScheduled: 0,
    liftsTotal: 25,
  }));
  const verdict = detectFeedOpening({
    readings,
    now: mt("15:10", day),
    opening: { season: "2026-27", projected_open: "2026-11-26", confirmed_open: null, closing_date: null, feed_open: null },
    timeZone: "America/Denver",
    hemisphere: "north",
  });
  assert.equal(verdict.ok, false);
  // feed_open stays null, and a null feed_open is never mailable.
  assert.equal(feedOpeningMailVerdict(row({ feed_open: null }), mt("15:10", day)).mail, false);
});

test("the cron skips a confirmed date when the feed already started the season on an earlier day", () => {
  const rows = [
    { resort_id: "feed-earlier", feed_open: NOV25 },
    { resort_id: "feed-same-day", feed_open: NOV26 },
    { resort_id: "no-feed", feed_open: null },
    { resort_id: "pre-037" },
  ];
  assert.deepEqual(cronOpeningsToMail(rows, NOV26).map((r) => r.resort_id), ["feed-same-day", "no-feed", "pre-037"]);
});

test("the dedupe window covers the whole season, so a subscriber hears once per resort per season", () => {
  assert.equal(seasonLogStart("2026-27"), "2026-07-01");
  assert.equal(seasonLogStart(), "2026-07-01");
  assert.throws(() => seasonLogStart("2026"));
  // An opening email logged on an earlier day of the season blocks a second one.
  const sub = { id: "s-ann", email: "ann@example.com", manage_token: "t" };
  const plans = planOpeningDayEmails(
    [{ resort_id: "r-big-sky", name: "Big Sky", slug: "big-sky", camCount: 2 }],
    [{ subscriber_id: "s-ann", resort_id: "r-big-sky", alert_subscribers: sub }],
    [{ subscriber_id: "s-ann", resort_id: "r-big-sky" }],
  );
  assert.deepEqual(plans, []);
});

test("the route's query window holds every resort's local today", () => {
  assert.deepEqual(feedOpeningQueryDays(new Date("2026-11-26T03:00:00Z")), { from: "2026-11-25", to: "2026-11-27" });
});
