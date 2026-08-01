import assert from "node:assert/strict";
import { test } from "node:test";

import { COURSE_VERSION } from "../config/versions";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { RESORT_BAKE_CONFIGS } from "../terrain/resorts";
import { courseSeed, resolveCourse, trailIdFromName, trailIdsForResort, utcDateStamp } from "./courses";

test("trail ids fold diacritics and collapse punctuation", () => {
  assert.equal(trailIdFromName("Kilómetro Lanzado"), "kilometro-lanzado");
  assert.equal(trailIdFromName("El Plateau"), "el-plateau");
  assert.equal(trailIdFromName("  Roca  Jack!  "), "roca-jack");
});

test("every resort profile yields six distinct trail ids", () => {
  for (const slug of Object.keys(DROP_IN_GAME_PROFILES)) {
    const ids = trailIdsForResort(slug);
    assert.equal(ids.length, 6, `${slug} should expose six trails`);
    assert.equal(new Set(ids).size, 6, `${slug} has colliding trail ids: ${ids.join(", ")}`);
    for (const id of ids) {
      assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, `${slug}/${id} is not a clean id`);
    }
  }
});

test("an unknown resort or trail resolves to null rather than a default course", () => {
  assert.equal(resolveCourse("not-a-resort", "roca-jack"), null);
  assert.equal(resolveCourse("breckenridge", "not-a-trail"), null);
  assert.equal(trailIdsForResort("not-a-resort").length, 0);
});

test("a resolved course carries the resort's baked half-extent", () => {
  for (const slug of Object.keys(DROP_IN_GAME_PROFILES)) {
    const trailId = trailIdsForResort(slug)[0];
    const course = resolveCourse(slug, trailId);
    assert.ok(course, `${slug}/${trailId} should resolve`);
    assert.equal(course.halfSizeM, RESORT_BAKE_CONFIGS[slug].sizeM / 2);
  }
});

test("a time_trial seed is fixed for the life of the course version", () => {
  const monday = courseSeed("time_trial", "breckenridge", "peak-8", COURSE_VERSION, "2026-07-13");
  const friday = courseSeed("time_trial", "breckenridge", "peak-8", COURSE_VERSION, "2026-07-17");
  assert.equal(monday, friday, "a time trial must not reseed daily — times would be incomparable");

  const nextVersion = courseSeed("time_trial", "breckenridge", "peak-8", COURSE_VERSION + 1, "2026-07-13");
  assert.notEqual(monday, nextVersion);
});

test("a score_attack seed rotates once per UTC day", () => {
  const monday = courseSeed("score_attack", "breckenridge", "peak-8", COURSE_VERSION, "2026-07-13");
  const tuesday = courseSeed("score_attack", "breckenridge", "peak-8", COURSE_VERSION, "2026-07-14");
  assert.notEqual(monday, tuesday);
  assert.equal(
    monday,
    courseSeed("score_attack", "breckenridge", "peak-8", COURSE_VERSION, "2026-07-13"),
  );
});

test("seeds differ across resorts and trails on the same day", () => {
  const a = courseSeed("score_attack", "breckenridge", "peak-8", COURSE_VERSION, "2026-07-13");
  const b = courseSeed("score_attack", "heavenly", "peak-8", COURSE_VERSION, "2026-07-13");
  const c = courseSeed("score_attack", "breckenridge", "gold-king", COURSE_VERSION, "2026-07-13");
  assert.equal(new Set([a, b, c]).size, 3);
});

test("seeds are unsigned 32-bit — the ghost header stores them as u32", () => {
  for (const slug of Object.keys(DROP_IN_GAME_PROFILES)) {
    for (const trailId of trailIdsForResort(slug)) {
      const seed = courseSeed("score_attack", slug, trailId, COURSE_VERSION, "2026-07-13");
      assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, `${slug}/${trailId}: ${seed}`);
    }
  }
});

test("the date stamp is UTC, not local", () => {
  // 23:30 US Mountain on the 14th is already the 15th in UTC.
  assert.equal(utcDateStamp(Date.UTC(2026, 6, 15, 5, 30, 0)), "2026-07-15");
  assert.equal(utcDateStamp(Date.UTC(2026, 6, 15, 23, 59, 59)), "2026-07-15");
});
