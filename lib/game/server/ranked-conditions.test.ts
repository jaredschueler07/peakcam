import assert from "node:assert/strict";
import { test } from "node:test";
import { fixedTrialConditions, lockMorningConditions, resortMorning, type RankedConditions, type MorningStore } from "./ranked-conditions";

function memoryStore(): MorningStore {
  const rows = new Map<string, RankedConditions>();
  return {
    async read(slug, date) { return rows.get(`${slug}/${date}`) ?? null; },
    async insertOnce(slug, date, snapshot) { const key = `${slug}/${date}`; if (!rows.has(key)) rows.set(key, structuredClone(snapshot)); },
  };
}

test("daily dates use resort local calendars across UTC midnight and DST", () => {
  assert.deepEqual(resortMorning(Date.parse("2026-09-06T01:00:00Z"), "breckenridge"), { date: "2026-09-05", hour: 19 });
  assert.equal(resortMorning(Date.parse("2026-01-01T14:00:00Z"), "breckenridge").hour, 7);
  assert.equal(resortMorning(Date.parse("2026-07-01T13:00:00Z"), "breckenridge").hour, 7);
});
test("concurrent morning capture cannot overwrite a frozen daily challenge", async () => {
  const store = memoryStore();
  const now = Date.parse("2026-09-05T13:00:00Z");
  const a = { ...fixedTrialConditions(), conditionsDate: "2026-09-05" };
  const b = { ...a, surface: "powder" as const, environment: { ...a.environment, powderDepthCm: 40 } };
  const [first, second] = await Promise.all([
    lockMorningConditions("breckenridge", now, store, async () => a),
    lockMorningConditions("breckenridge", now, store, async () => b),
  ]);
  assert.deepEqual(first, second);
  const evening = await lockMorningConditions("breckenridge", now + 12 * 3600000, store, async () => { throw new Error("must not recapture"); });
  assert.deepEqual(evening, first);
});
test("missing morning capture fails closed outside the morning hour", async () => {
  await assert.rejects(lockMorningConditions("heavenly", Date.parse("2026-09-05T22:00:00Z"), memoryStore(), async () => fixedTrialConditions()), /not been captured/);
});
test("Time Trial conditions never depend on live readings", () => {
  assert.deepEqual(fixedTrialConditions(), { surface: "packed", conditionsDate: "fixed-v2", environment: {
    powderDepthCm: 0, windSpeedMps: 0, morningIce: false, visibilityM: 20000, northSign: -1,
  } });
});
