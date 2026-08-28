import { test } from "node:test";
import assert from "node:assert";
import {
  selectPowderAlerts,
  latestAlertByPair,
  cooldownLookbackDate,
  COOLDOWN_DAYS,
  RE_ALERT_INCREMENT_INCHES,
  MAX_REPORT_AGE_HOURS,
  type AlertPreference,
  type SnowSnapshot,
  type AlertLogRow,
} from "./powder-trigger";

const NOW = new Date("2026-02-10T13:00:00Z");

const SUB = { id: "sub-1", email: "rider@example.com", manage_token: "tok-1" };

function pref(over: Partial<AlertPreference> = {}): AlertPreference {
  return {
    subscriber_id: "sub-1",
    resort_id: "r-alta",
    threshold_inches: 6,
    alert_subscribers: SUB,
    resorts: { name: "Alta", slug: "alta" },
    ...over,
  };
}

function snapshot(over: Partial<SnowSnapshot> = {}): SnowSnapshot {
  return {
    resort_id: "r-alta",
    new_snow_24h: 12,
    updated_at: "2026-02-10T11:00:00Z",
    ...over,
  };
}

function logRow(over: Partial<AlertLogRow> = {}): AlertLogRow {
  return {
    subscriber_id: "sub-1",
    resort_id: "r-alta",
    new_snow_inches: 12,
    alert_date: "2026-02-09",
    ...over,
  };
}

test("sends when fresh snow reaches the threshold", () => {
  const { batches, skipped } = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot()],
    recentLog: [],
    now: NOW,
  });

  assert.equal(batches.length, 1);
  assert.equal(batches[0].subscriber.email, "rider@example.com");
  assert.deepEqual(batches[0].alerts, [
    { resortName: "Alta", slug: "alta", newSnow: 12, threshold: 6, resort_id: "r-alta" },
  ]);
  assert.equal(skipped.below_threshold, 0);
});

test("threshold is inclusive — exactly the threshold sends", () => {
  const { batches } = selectPowderAlerts({
    prefs: [pref({ threshold_inches: 12 })],
    snow: [snapshot({ new_snow_24h: 12 })],
    recentLog: [],
    now: NOW,
  });
  assert.equal(batches.length, 1);
});

test("skips snow below the threshold", () => {
  const { batches, skipped } = selectPowderAlerts({
    prefs: [pref({ threshold_inches: 12 })],
    snow: [snapshot({ new_snow_24h: 11 })],
    recentLog: [],
    now: NOW,
  });
  assert.equal(batches.length, 0);
  assert.equal(skipped.below_threshold, 1);
});

test("skips a resort with no snow row or a null total", () => {
  const missing = selectPowderAlerts({ prefs: [pref()], snow: [], recentLog: [], now: NOW });
  assert.equal(missing.batches.length, 0);
  assert.equal(missing.skipped.no_snow_data, 1);

  const nulled = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot({ new_snow_24h: null })],
    recentLog: [],
    now: NOW,
  });
  assert.equal(nulled.batches.length, 0);
  assert.equal(nulled.skipped.no_snow_data, 1);
});

// ── Report freshness ─────────────────────────────────────────────────────────

test("skips a report older than the freshness ceiling", () => {
  const stale = new Date(NOW.getTime() - (MAX_REPORT_AGE_HOURS + 1) * 3_600_000);
  const { batches, skipped } = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot({ updated_at: stale.toISOString() })],
    recentLog: [],
    now: NOW,
  });
  assert.equal(batches.length, 0);
  assert.equal(skipped.stale_report, 1);
});

test("a report just inside the freshness ceiling still sends", () => {
  const fresh = new Date(NOW.getTime() - (MAX_REPORT_AGE_HOURS - 1) * 3_600_000);
  const { batches } = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot({ updated_at: fresh.toISOString() })],
    recentLog: [],
    now: NOW,
  });
  assert.equal(batches.length, 1);
});

test("a snapshot with no or unparseable timestamp is treated as stale", () => {
  for (const updated_at of [null, "not-a-date"]) {
    const { batches, skipped } = selectPowderAlerts({
      prefs: [pref()],
      snow: [snapshot({ updated_at })],
      recentLog: [],
      now: NOW,
    });
    assert.equal(batches.length, 0, `updated_at=${updated_at}`);
    assert.equal(skipped.stale_report, 1);
  }
});

// ── Storm cooldown ───────────────────────────────────────────────────────────

test("does not re-alert the same storm on the following day", () => {
  const { batches, skipped } = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot({ new_snow_24h: 14 })],
    recentLog: [logRow({ new_snow_inches: 12, alert_date: "2026-02-09" })],
    now: NOW,
  });
  assert.equal(batches.length, 0);
  assert.equal(skipped.storm_cooldown, 1);
});

test("re-alerts inside the window when the storm grows by the increment", () => {
  const { batches } = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot({ new_snow_24h: 12 + RE_ALERT_INCREMENT_INCHES })],
    recentLog: [logRow({ new_snow_inches: 12, alert_date: "2026-02-09" })],
    now: NOW,
  });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].alerts[0].newSnow, 18);
});

test("re-alerts once the cooldown window has passed", () => {
  const outside = new Date(NOW.getTime() - COOLDOWN_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { batches } = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot({ new_snow_24h: 8 })],
    recentLog: [logRow({ new_snow_inches: 12, alert_date: outside })],
    now: NOW,
  });
  assert.equal(batches.length, 1);
});

test("cooldown uses the most recent prior alert, not the first", () => {
  // An older, smaller alert must not become the bar a new send has to clear.
  const { batches, skipped } = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot({ new_snow_24h: 13 })],
    recentLog: [
      logRow({ new_snow_inches: 6, alert_date: "2026-02-08" }),
      logRow({ new_snow_inches: 12, alert_date: "2026-02-09" }),
    ],
    now: NOW,
  });
  assert.equal(batches.length, 0);
  assert.equal(skipped.storm_cooldown, 1);
});

test("a prior alert for a different resort does not suppress this one", () => {
  const { batches } = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot()],
    recentLog: [logRow({ resort_id: "r-brighton" })],
    now: NOW,
  });
  assert.equal(batches.length, 1);
});

test("a prior alert for a different subscriber does not suppress this one", () => {
  const { batches } = selectPowderAlerts({
    prefs: [pref()],
    snow: [snapshot()],
    recentLog: [logRow({ subscriber_id: "sub-2" })],
    now: NOW,
  });
  assert.equal(batches.length, 1);
});

// ── Batching ─────────────────────────────────────────────────────────────────

test("groups a subscriber's resorts into one batch, deepest snow first", () => {
  const { batches } = selectPowderAlerts({
    prefs: [
      pref({ resort_id: "r-alta", resorts: { name: "Alta", slug: "alta" } }),
      pref({ resort_id: "r-brighton", resorts: { name: "Brighton", slug: "brighton" } }),
    ],
    snow: [
      snapshot({ resort_id: "r-alta", new_snow_24h: 8 }),
      snapshot({ resort_id: "r-brighton", new_snow_24h: 20 }),
    ],
    recentLog: [],
    now: NOW,
  });

  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0].alerts.map((a) => a.resortName),
    ["Brighton", "Alta"]
  );
});

test("separate subscribers get separate batches", () => {
  const other = { id: "sub-2", email: "other@example.com", manage_token: "tok-2" };
  const { batches } = selectPowderAlerts({
    prefs: [pref(), pref({ subscriber_id: "sub-2", alert_subscribers: other })],
    snow: [snapshot()],
    recentLog: [],
    now: NOW,
  });
  assert.equal(batches.length, 2);
  assert.deepEqual(
    batches.map((b) => b.subscriber.email).sort(),
    ["other@example.com", "rider@example.com"]
  );
});

test("skips a preference whose embedded subscriber or resort is missing", () => {
  const { batches, skipped } = selectPowderAlerts({
    prefs: [pref({ alert_subscribers: null }), pref({ resorts: null })],
    snow: [snapshot()],
    recentLog: [],
    now: NOW,
  });
  assert.equal(batches.length, 0);
  assert.equal(skipped.incomplete_row, 2);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

test("latestAlertByPair keeps the newest row per pair", () => {
  const map = latestAlertByPair([
    logRow({ alert_date: "2026-02-07", new_snow_inches: 4 }),
    logRow({ alert_date: "2026-02-09", new_snow_inches: 12 }),
    logRow({ alert_date: "2026-02-08", new_snow_inches: 9 }),
  ]);
  assert.equal(map.size, 1);
  assert.equal(map.get("sub-1:r-alta")?.new_snow_inches, 12);
});

test("cooldownLookbackDate returns the window's first day", () => {
  assert.equal(cooldownLookbackDate(NOW), "2026-02-07");
});
