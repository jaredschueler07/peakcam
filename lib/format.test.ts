import { test } from "node:test";
import assert from "node:assert";
import { formatInches, formatRatio, timeAgo, parseConditions } from "./format";

// ── formatInches ─────────────────────────────────────────────

test("formatInches renders the double-prime glyph, not a straight quote", () => {
  assert.strictEqual(formatInches(12), "12″");
  assert.ok(!formatInches(12).includes('"'));
});

test("formatInches renders an em dash for missing values", () => {
  assert.strictEqual(formatInches(null), "—");
  assert.strictEqual(formatInches(undefined), "—");
});

test("formatInches keeps zero, which is a real reading", () => {
  assert.strictEqual(formatInches(0), "0″");
});

// ── formatRatio ──────────────────────────────────────────────

test("formatRatio joins open and total with a slash", () => {
  assert.strictEqual(formatRatio(12, 40), "12/40");
});

test("formatRatio falls back to an em dash when the open count is missing", () => {
  assert.strictEqual(formatRatio(null, 40), "—");
  assert.strictEqual(formatRatio(undefined, undefined), "—");
});

test("formatRatio shows the bare open count when the total is unknown", () => {
  // Never "12/?" — a question mark reads as a broken template, not as data.
  assert.strictEqual(formatRatio(12, null), "12");
  assert.ok(!formatRatio(12, null).includes("?"));
});

test("formatRatio keeps a zero open count", () => {
  assert.strictEqual(formatRatio(0, 40), "0/40");
});

// ── timeAgo ──────────────────────────────────────────────────

test("timeAgo returns null for absent or unparseable input", () => {
  assert.strictEqual(timeAgo(null), null);
  assert.strictEqual(timeAgo(undefined), null);
  assert.strictEqual(timeAgo("not a date"), null);
});

test("timeAgo climbs the minute/hour/day ladder", () => {
  const now = Date.now();
  const at = (ms: number) => new Date(now - ms).toISOString();
  assert.strictEqual(timeAgo(at(10_000)), "just now");
  assert.strictEqual(timeAgo(at(5 * 60_000)), "5m ago");
  assert.strictEqual(timeAgo(at(3 * 3_600_000)), "3h ago");
  assert.strictEqual(timeAgo(at(2 * 86_400_000)), "2d ago");
});

test("timeAgo accepts an epoch millisecond number", () => {
  assert.strictEqual(timeAgo(Date.now() - 5 * 60_000), "5m ago");
});

test("timeAgo resolves seconds when asked, for fast-refreshing feeds", () => {
  assert.strictEqual(timeAgo(Date.now() - 12_000, { seconds: true }), "12s ago");
  assert.strictEqual(timeAgo(Date.now() - 5 * 60_000, { seconds: true }), "5m ago");
});

test("timeAgo never reports a negative age from a clock skew", () => {
  assert.strictEqual(timeAgo(Date.now() + 30_000, { seconds: true }), "0s ago");
  assert.strictEqual(timeAgo(Date.now() + 30_000), "just now");
});

// ── parseConditions ──────────────────────────────────────────

test("parseConditions splits the overloaded tags||narrative string", () => {
  assert.deepStrictEqual(parseConditions("powder,fresh||Deep and light up top."), {
    tags: ["powder", "fresh"],
    narrative: "Deep and light up top.",
  });
});

test("parseConditions reports no narrative when the separator is absent", () => {
  // A bare tag list is not a sentence and must never be published as one.
  assert.deepStrictEqual(parseConditions("powder,fresh"), {
    tags: [],
    narrative: null,
  });
});

test("parseConditions reports no narrative when the tail is empty", () => {
  assert.strictEqual(parseConditions("powder,fresh||").narrative, null);
  assert.strictEqual(parseConditions("powder,fresh||   ").narrative, null);
  assert.deepStrictEqual(parseConditions("powder,fresh||").tags, ["powder", "fresh"]);
});

test("parseConditions handles a missing or empty string", () => {
  assert.deepStrictEqual(parseConditions(null), { tags: [], narrative: null });
  assert.deepStrictEqual(parseConditions(undefined), { tags: [], narrative: null });
  assert.deepStrictEqual(parseConditions(""), { tags: [], narrative: null });
});

test("parseConditions keeps a narrative that itself contains the separator", () => {
  assert.strictEqual(
    parseConditions("powder||Deep || light").narrative,
    "Deep || light",
  );
});

test("parseConditions drops empty tags and trims each one", () => {
  assert.deepStrictEqual(parseConditions("powder, fresh,,||x").tags, ["powder", "fresh"]);
  assert.deepStrictEqual(parseConditions("||x").tags, []);
});
