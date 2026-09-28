import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampThreshold,
  DEFAULT_THRESHOLD_INCHES,
  isUuid,
  MAX_RESORTS_PER_REQUEST,
  parseManageUpdate,
} from "./validate";

const ALTA = "6f1d2c3b-4a5e-4f60-8b7c-9d0e1f2a3b4c";
const BRIGHTON = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

test("isUuid accepts canonical UUIDs in either case and nothing else", () => {
  assert.equal(isUuid(ALTA), true);
  assert.equal(isUuid(ALTA.toUpperCase()), true);
  assert.equal(isUuid("r-alta"), false);
  assert.equal(isUuid(ALTA.slice(1)), false);
  assert.equal(isUuid(`${ALTA})&select=*`), false);
  assert.equal(isUuid(42), false);
  assert.equal(isUuid(null), false);
});

test("clampThreshold rounds into 1–48 and defaults anything non-numeric", () => {
  assert.equal(clampThreshold(12), 12);
  assert.equal(clampThreshold(12.6), 13);
  assert.equal(clampThreshold(9999), 48);
  assert.equal(clampThreshold(-5), 1);
  assert.equal(clampThreshold(0), 1);
  assert.equal(clampThreshold(undefined), DEFAULT_THRESHOLD_INCHES);
  assert.equal(clampThreshold("12"), DEFAULT_THRESHOLD_INCHES);
  assert.equal(clampThreshold(NaN), DEFAULT_THRESHOLD_INCHES);
  assert.equal(clampThreshold(Infinity), DEFAULT_THRESHOLD_INCHES);
});

test("parseManageUpdate accepts the body AlertManagePage sends", () => {
  const parsed = parseManageUpdate({
    token: "tok",
    resort_ids: [ALTA, BRIGHTON],
    thresholds: { [ALTA]: 12, [BRIGHTON]: 6 },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.update, {
    token: "tok",
    resortIds: [ALTA, BRIGHTON],
    thresholds: { [ALTA]: 12, [BRIGHTON]: 6 },
  });
});

test("parseManageUpdate treats an empty resort list as 'follow nothing'", () => {
  const parsed = parseManageUpdate({ token: "tok", resort_ids: [] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.update.resortIds, []);
  assert.deepEqual(parsed.update.thresholds, {});
});

test("parseManageUpdate defaults and clamps thresholds per resort", () => {
  const parsed = parseManageUpdate({
    token: "tok",
    resort_ids: [ALTA, BRIGHTON],
    thresholds: { [ALTA]: 9999 },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.update.thresholds, { [ALTA]: 48, [BRIGHTON]: DEFAULT_THRESHOLD_INCHES });
});

test("parseManageUpdate de-duplicates resort ids and ignores thresholds for unlisted resorts", () => {
  const parsed = parseManageUpdate({
    token: "tok",
    resort_ids: [ALTA, ALTA],
    thresholds: { [ALTA]: 3, [BRIGHTON]: "not even checked" },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.update.resortIds, [ALTA]);
  assert.deepEqual(parsed.update.thresholds, { [ALTA]: 3 });
});

test("parseManageUpdate lower-cases resort ids and keeps their thresholds (PostgREST ids are lower-case)", () => {
  const parsed = parseManageUpdate({
    token: "tok",
    resort_ids: [ALTA.toUpperCase(), BRIGHTON, BRIGHTON.toUpperCase()],
    thresholds: { [ALTA.toUpperCase()]: 12, [BRIGHTON]: 3 },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  // Two spellings of Brighton collapse to one id; Alta's 12″ is found under
  // the lower-cased key manage.ts will look it up by, not defaulted to 6″.
  assert.deepEqual(parsed.update.resortIds, [ALTA, BRIGHTON]);
  assert.deepEqual(parsed.update.thresholds, { [ALTA]: 12, [BRIGHTON]: 3 });
  // Normalising the key must not let a bad value slip past the type check.
  const bad = parseManageUpdate({ token: "tok", resort_ids: [ALTA], thresholds: { [ALTA.toUpperCase()]: "12" } });
  assert.equal(bad.ok, false);
});

test("parseManageUpdate rejects a missing or non-string token", () => {
  for (const token of [undefined, "", 123, null]) {
    const parsed = parseManageUpdate({ token, resort_ids: [ALTA] });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.error, /token/);
  }
});

test("parseManageUpdate rejects resort_ids that are not an array of UUIDs", () => {
  for (const resort_ids of [undefined, "r-alta", { 0: ALTA }, ["r-alta"], [ALTA, 7], [`${ALTA})&x=1`]]) {
    const parsed = parseManageUpdate({ token: "tok", resort_ids });
    assert.equal(parsed.ok, false, JSON.stringify(resort_ids));
    if (parsed.ok) return;
    assert.match(parsed.error, /resort_ids/);
  }
});

test("parseManageUpdate rejects more resorts than a request may carry", () => {
  const ids = Array.from({ length: MAX_RESORTS_PER_REQUEST + 1 }, (_, i) =>
    `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`
  );
  const parsed = parseManageUpdate({ token: "tok", resort_ids: ids });
  assert.equal(parsed.ok, false);
});

test("parseManageUpdate rejects non-finite or non-numeric thresholds instead of defaulting them", () => {
  for (const value of ["abc", "12", NaN, Infinity, {}, true]) {
    const parsed = parseManageUpdate({ token: "tok", resort_ids: [ALTA], thresholds: { [ALTA]: value } });
    assert.equal(parsed.ok, false, String(value));
    if (parsed.ok) return;
    assert.match(parsed.error, /thresholds/);
  }
});

test("parseManageUpdate rejects a thresholds value that is not an object", () => {
  for (const thresholds of ["12", 12, [12]]) {
    const parsed = parseManageUpdate({ token: "tok", resort_ids: [ALTA], thresholds });
    assert.equal(parsed.ok, false, JSON.stringify(thresholds));
  }
  // null / undefined thresholds are fine — everything defaults.
  assert.equal(parseManageUpdate({ token: "tok", resort_ids: [ALTA], thresholds: null }).ok, true);
});

test("parseManageUpdate tolerates a body that is not an object", () => {
  for (const body of [null, undefined, "x", 42, []]) {
    assert.equal(parseManageUpdate(body).ok, false);
  }
});
