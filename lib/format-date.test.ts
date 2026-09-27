import { test } from "node:test";
import assert from "node:assert";
import { formatUtcDate, formatLocalDateTime, timeAgo } from "./format-date";

test("formatUtcDate is timezone-independent (safe for SSR + hydration)", () => {
  // 23:30 UTC on Sep 27 is already Sep 28 in UTC+2 — a local formatter would
  // disagree between a UTC server and a European browser. The UTC formatter
  // must not.
  assert.strictEqual(formatUtcDate("2026-09-27T23:30:00.000Z"), "Sep 27");
  assert.strictEqual(formatUtcDate("2026-01-05T00:00:00.000Z"), "Jan 5");
  assert.strictEqual(formatUtcDate("not a date"), "");
});

test("formatLocalDateTime includes the clock time and tolerates bad input", () => {
  const label = formatLocalDateTime("2026-09-27T14:52:00.000Z");
  assert.match(label, /Sep 2[678]/);
  assert.match(label, /\d{1,2}:\d{2}/);
  assert.strictEqual(formatLocalDateTime("garbage"), "");
});

test("timeAgo is a pure function of (iso, now)", () => {
  const now = Date.parse("2026-09-27T12:00:00.000Z");
  assert.strictEqual(timeAgo("2026-09-27T11:59:40.000Z", now), "just now");
  assert.strictEqual(timeAgo("2026-09-27T11:55:00.000Z", now), "5m ago");
  assert.strictEqual(timeAgo("2026-09-27T09:00:00.000Z", now), "3h ago");
  assert.strictEqual(timeAgo("2026-09-25T12:00:00.000Z", now), "2d ago");
  assert.strictEqual(timeAgo("nope", now), "");
});
