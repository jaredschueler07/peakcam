import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_HOURS_END, CORE_HOURS_START, FIRST_CHAIR_HOUR, LIFT_DAY_END_HOUR, localClock, localHour, summarizeOperatorDay, type OperatorReading } from "./operator-day";

const MT = "America/Denver"; // UTC−7 on 2026-11-20 (standard time)
const PT = "America/Los_Angeles"; // UTC−8
const ET = "America/New_York"; // UTC−5

/** A reading at a resort-local Mountain clock time on a given day: "2026-11-20 15:35" → 22:35Z. */
function at(local: string, open: number | null, scheduled: number | null, total: number | null, offsetHours = 7): OperatorReading {
  const [day, clock] = local.split(" ");
  const ms = Date.parse(`${day}T${clock}:00Z`) + offsetHours * 3_600_000;
  return { observedAt: new Date(ms).toISOString(), liftsOpen: open, liftsScheduled: scheduled, liftsTotal: total };
}
const when = (local: string, offsetHours = 7) => new Date(at(local, 0, 0, 0, offsetHours).observedAt);

test("the constants are the owner's: core hours 10:00–15:00, lift day ends 16:00", () => {
  assert.deepEqual([CORE_HOURS_START, CORE_HOURS_END, LIFT_DAY_END_HOUR], [10, 15, 16]);
  assert.equal(FIRST_CHAIR_HOUR, 8);
  assert.equal(localHour(new Date("2026-11-20T22:35:00Z"), MT), 15);
  assert.equal(localHour(new Date("2026-11-20T07:30:00Z"), MT), 0);
  assert.equal(localClock(new Date("2026-11-20T22:05:00Z"), MT), "15:05");
});

// Vail on 2026-11-20: 2 open through 15:05, then 0 open / 4 scheduled at 15:35.
const VAIL: OperatorReading[] = [at("2026-11-20 09:56", 2, 0, 34), at("2026-11-20 12:05", 2, 0, 34), at("2026-11-20 15:05", 2, 0, 34), at("2026-11-20 15:35", 0, 4, 34)];
// Mount Snow (Eastern): 1 open until 12:35 ET, then 0 open / 0 scheduled.
const MOUNT_SNOW: OperatorReading[] = [at("2026-11-20 11:56", 1, 0, 17, 5), at("2026-11-20 12:35", 1, 0, 17, 5), at("2026-11-20 13:05", 0, 0, 17, 5), at("2026-11-20 17:35", 0, 0, 17, 5)];

interface Case {
  name: string;
  readings: OperatorReading[];
  zone: string;
  now: Date;
  expect: null | Partial<ReturnType<typeof summarizeOperatorDay> & object>;
}

const CASES: Case[] = [
  { name: "before the first lift, feed lists scheduled lifts → scheduled", readings: [at("2026-11-20 06:05", 0, 5, 27)], zone: MT, now: when("2026-11-20 06:30"), expect: { state: "scheduled", liftsScheduled: 5, liftsOpen: 0, carried: false } },
  { name: "before the first lift, feed has no scheduled state → does not decide", readings: [at("2026-11-20 06:05", 0, 0, 21), at("2026-11-20 06:35", 0, 0, 21)], zone: MT, now: when("2026-11-20 06:40"), expect: null },
  { name: "mid-day with lifts open → operated, current", readings: [at("2026-11-20 06:05", 0, 0, 35), at("2026-11-20 09:05", 2, 0, 35), at("2026-11-20 10:35", 8, 0, 35)], zone: MT, now: when("2026-11-20 10:40"), expect: { state: "operated", liftsOpen: 8, liftsTotal: 35, current: true, carried: false } },
  { name: "mid-day 0 open / 0 scheduled and nothing earlier → closed", readings: [at("2026-11-20 06:05", 0, 0, 9), at("2026-11-20 10:35", 0, 0, 9)], zone: MT, now: when("2026-11-20 10:40"), expect: { state: "closed", liftsOpen: 0, liftsTotal: 9 } },
  { name: "a 0/0 reading at 09:35 is outside core hours → does not decide", readings: [at("2026-11-20 09:35", 0, 0, 9)], zone: MT, now: when("2026-11-20 09:40"), expect: null },
  { name: "a 0/0 reading at 15:05 is outside core hours → does not decide", readings: [at("2026-11-20 15:05", 0, 0, 9)], zone: MT, now: when("2026-11-20 15:10"), expect: null },
  { name: "evening after operating → still operated, count from the day's last open reading", readings: VAIL, zone: MT, now: when("2026-11-20 17:00"), expect: { state: "operated", liftsOpen: 2, liftsTotal: 34, current: false, observedAt: at("2026-11-20 15:05", 0, 0, 0).observedAt, newestAt: at("2026-11-20 15:35", 0, 0, 0).observedAt } },
  { name: "Mount Snow: 1 open until 12:35, then 0/0 → operated, not closed", readings: MOUNT_SNOW, zone: ET, now: when("2026-11-20 18:00", 5), expect: { state: "operated", liftsOpen: 1, liftsTotal: 17, current: false } },
  { name: "scheduled lifts that never opened: after the lift day ends it is not 'scheduled'", readings: [at("2026-11-20 08:05", 0, 4, 34), at("2026-11-20 15:35", 0, 4, 34)], zone: MT, now: when("2026-11-20 16:30"), expect: null },
  { name: "…and with a core-hours 0-open reading that still listed scheduled lifts it is not 'closed' either", readings: [at("2026-11-20 12:05", 0, 4, 34)], zone: MT, now: when("2026-11-20 17:00"), expect: null },
  { name: "delayed opening: 0/0 at 10:05, scheduled at 10:35 → scheduled", readings: [at("2026-11-20 10:05", 0, 0, 10), at("2026-11-20 10:35", 0, 3, 10)], zone: MT, now: when("2026-11-20 10:40"), expect: { state: "scheduled", liftsScheduled: 3 } },
  { name: "next morning, once today has a reading yesterday is ignored", readings: [...VAIL, at("2026-11-21 06:05", 0, 0, 34)], zone: MT, now: when("2026-11-21 06:30"), expect: null },
  { name: "carry-over 00:30 after an operated day: yesterday's last open count, dated yesterday", readings: VAIL, zone: MT, now: when("2026-11-21 00:30"), expect: { state: "operated", carried: true, current: false, localDate: "2026-11-20", liftsOpen: 2, observedAt: at("2026-11-20 15:05", 0, 0, 0).observedAt } },
  { name: "carry-over 05:30 after an operated day", readings: VAIL, zone: MT, now: when("2026-11-21 05:30"), expect: { state: "operated", carried: true, localDate: "2026-11-20", liftsOpen: 2 } },
  { name: "00:30 after a day with no open lift → nothing carried", readings: [at("2026-11-20 08:05", 0, 4, 34), at("2026-11-20 12:05", 0, 0, 34)], zone: MT, now: when("2026-11-21 00:30"), expect: null },
  { name: "two days without readings → nothing", readings: VAIL, zone: MT, now: when("2026-11-22 05:30"), expect: null },
  { name: "readings without lift counts → nothing", readings: [at("2026-11-20 11:05", null, null, null)], zone: MT, now: when("2026-11-20 11:10"), expect: null },
  { name: "no readings → nothing", readings: [], zone: MT, now: when("2026-11-20 11:10"), expect: null },
  // 07:00 Central = 05:00 Pacific = 13:00Z. A Pacific resort that ran yesterday has no reading yet today.
  { name: "Pacific resort at 07:00 Central, before its first reading → carried from its own yesterday", readings: [at("2026-11-20 14:35", 6, 0, 19, 8)], zone: PT, now: new Date("2026-11-21T13:00:00Z"), expect: { state: "operated", carried: true, localDate: "2026-11-20", liftsOpen: 6 } },
  // 23:30 Pacific on the 20th is 07:30Z on the 21st: still the 20th at the resort.
  { name: "Pacific resort late evening (UTC already tomorrow) → still today, operated", readings: [at("2026-11-20 14:35", 6, 0, 19, 8), at("2026-11-20 15:35", 0, 0, 19, 8)], zone: PT, now: new Date("2026-11-21T07:30:00Z"), expect: { state: "operated", carried: false, localDate: "2026-11-20", liftsOpen: 6 } },
  // First-chair rule (2026-11-21): A-Basin, Copper, Loveland and Winter Park flag the day's plan as "open" from 06:05.
  { name: "07:05 reading says 2 open → not believed before first chair: scheduled(2)", readings: [at("2026-11-21 07:05", 2, 0, 9)], zone: MT, now: when("2026-11-21 07:10"), expect: { state: "scheduled", liftsScheduled: 2, liftsOpen: 0, liftsTotal: 9, current: false, carried: false } },
  { name: "06:05, 06:35, 07:05, 07:35 all say 2 open → still scheduled(2) at 07:40", readings: [at("2026-11-21 06:05", 2, 0, 9), at("2026-11-21 06:35", 2, 0, 9), at("2026-11-21 07:05", 2, 0, 9), at("2026-11-21 07:35", 2, 0, 9)], zone: MT, now: when("2026-11-21 07:40"), expect: { state: "scheduled", liftsScheduled: 2, observedAt: at("2026-11-21 07:35", 0, 0, 0).observedAt } },
  { name: "08:05 reading says 2 open → operated", readings: [at("2026-11-21 07:35", 2, 0, 9), at("2026-11-21 08:05", 2, 0, 9)], zone: MT, now: when("2026-11-21 08:10"), expect: { state: "operated", liftsOpen: 2, liftsTotal: 9, current: true, observedAt: at("2026-11-21 08:05", 0, 0, 0).observedAt } },
  { name: "Vail shape, 0 open / 4 scheduled at 07:05 → scheduled(4), unchanged", readings: [at("2026-11-21 07:05", 0, 4, 34)], zone: MT, now: when("2026-11-21 07:10"), expect: { state: "scheduled", liftsScheduled: 4, liftsOpen: 0 } },
  { name: "2 flagged open + 3 scheduled at 07:05 → scheduled(5)", readings: [at("2026-11-21 07:05", 2, 3, 23)], zone: MT, now: when("2026-11-21 07:10"), expect: { state: "scheduled", liftsScheduled: 5 } },
  { name: "the planned count never exceeds the total", readings: [at("2026-11-21 07:05", 6, 5, 9)], zone: MT, now: when("2026-11-21 07:10"), expect: { state: "scheduled", liftsScheduled: 9 } },
  { name: "early flag, then 0/0 at 09:05 → the feed does not decide", readings: [at("2026-11-21 07:05", 2, 0, 9), at("2026-11-21 09:05", 0, 0, 9)], zone: MT, now: when("2026-11-21 09:10"), expect: null },
  { name: "early flag, then operating, then evening → operated from the last open reading", readings: [at("2026-11-21 07:05", 2, 0, 9), at("2026-11-21 10:05", 3, 0, 9), at("2026-11-21 15:35", 0, 0, 9)], zone: MT, now: when("2026-11-21 17:00"), expect: { state: "operated", liftsOpen: 3, current: false, observedAt: at("2026-11-21 10:05", 0, 0, 0).observedAt } },
  { name: "carry-over ignores a day whose only open readings were before first chair", readings: [at("2026-11-20 06:05", 2, 0, 9), at("2026-11-20 07:35", 2, 0, 9), at("2026-11-20 12:05", 0, 0, 9)], zone: MT, now: when("2026-11-21 00:30"), expect: null },
  { name: "carry-over takes the last open reading at or after first chair, not a later-dated early flag", readings: [at("2026-11-20 07:35", 5, 0, 9), at("2026-11-20 14:05", 2, 0, 9), at("2026-11-20 15:35", 0, 0, 9)], zone: MT, now: when("2026-11-21 05:30"), expect: { state: "operated", carried: true, liftsOpen: 2, observedAt: at("2026-11-20 14:05", 0, 0, 0).observedAt } },
  // 07:05 Pacific is 09:05 Central: the hour is the resort's, not the server's.
  { name: "Pacific resort at 07:05 its own time (15:05Z) says 5 open → scheduled(5)", readings: [at("2026-11-21 07:05", 5, 0, 25, 8)], zone: PT, now: new Date("2026-11-21T15:10:00Z"), expect: { state: "scheduled", liftsScheduled: 5 } },
  { name: "Eastern resort at 08:05 its own time (13:05Z, 06:05 Mountain) says 1 open → operated", readings: [at("2026-11-21 08:05", 1, 0, 17, 5)], zone: ET, now: new Date("2026-11-21T13:10:00Z"), expect: { state: "operated", liftsOpen: 1, current: true } },
  { name: "a reading stamped in the future is ignored", readings: [at("2026-11-20 14:00", 5, 0, 9)], zone: MT, now: when("2026-11-20 11:00"), expect: null },
];

for (const c of CASES) {
  test(`operator day: ${c.name}`, () => {
    const got = summarizeOperatorDay(c.readings, c.zone, c.now);
    if (c.expect === null) return assert.equal(got, null);
    assert.ok(got, "expected a verdict");
    for (const [k, v] of Object.entries(c.expect)) assert.deepEqual((got as unknown as Record<string, unknown>)[k], v, k);
  });
}

test("readings may arrive newest first (the read orders them that way)", () => {
  const got = summarizeOperatorDay([...VAIL].reverse(), MT, when("2026-11-20 17:00"));
  assert.equal(got?.state, "operated");
  assert.equal(got?.liftsOpen, 2);
});
