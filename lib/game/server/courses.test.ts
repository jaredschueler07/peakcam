import assert from "node:assert/strict";
import { brotliDecompressSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { COURSE_VERSION } from "../config/versions";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import type { DropInResortSlug } from "../config/schema";
import type { TerrainMeta, TrailsFile } from "../terrain/formats";
import { buildRealCourse } from "../terrain/real-course";
import { RESORT_BAKE_CONFIGS } from "../terrain/resorts";
import { createTerrainSource } from "../terrain/terrain-source";
import {
  COURSE_GATES,
  courseSeed,
  resolveCourse,
  trailIdFromName,
  trailIdsForResort,
  utcDateStamp,
} from "./courses";

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

test("every resolved course carries real startZ/finishZ gates", () => {
  for (const slug of Object.keys(DROP_IN_GAME_PROFILES)) {
    for (const trailId of trailIdsForResort(slug)) {
      const course = resolveCourse(slug, trailId);
      assert.ok(course, `${slug}/${trailId} should resolve`);
      assert.equal(typeof course.startZ, "number", `${slug}/${trailId} missing startZ`);
      assert.equal(typeof course.finishZ, "number", `${slug}/${trailId} missing finishZ`);
      assert.notEqual(course.startZ, course.finishZ, `${slug}/${trailId} start equals finish`);
    }
  }
});

test("COURSE_GATES match buildRealCourse polylines for all 18 pilot trails", () => {
  // Positional binding: call buildRealCourse explicitly (selectRuns + makeRun),
  // not sampler.realRuns which is an opaque re-export of the same object.
  const dir = path.join(process.cwd(), "public/game/terrain");
  const slugs = Object.keys(DROP_IN_GAME_PROFILES) as DropInResortSlug[];

  for (const slug of slugs) {
    const profile = DROP_IN_GAME_PROFILES[slug];
    const packed = brotliDecompressSync(readFileSync(path.join(dir, `${slug}.height.u16.br`)));
    const source = createTerrainSource({
      profile,
      mode: "real",
      assets: {
        heightfield: packed.buffer.slice(
          packed.byteOffset,
          packed.byteOffset + packed.byteLength,
        ) as ArrayBuffer,
        meta: JSON.parse(readFileSync(path.join(dir, `${slug}.meta.json`), "utf8")) as TerrainMeta,
        trails: JSON.parse(readFileSync(path.join(dir, `${slug}.trails.json`), "utf8")) as TrailsFile,
      },
    });
    assert.ok(source.real, `${slug}: expected real terrain source`);
    // Draped inventory → buildRealCourse (selectRuns + downhill/trim).
    const built = buildRealCourse(
      profile,
      source.real.runs,
      source.real.lifts,
      profile.terrainSeed,
    );
    for (const run of built.runs) {
      const canonical = resolveCourse(slug, run.id!);
      assert.ok(canonical, `${slug}/${run.id} must resolve`);
      assert.equal(canonical.startZ, run.points[0].z);
      assert.equal(canonical.finishZ, run.points.at(-1)!.z);
    }
    const trailIds = trailIdsForResort(slug);
    assert.ok(built.runs.length >= 6, `${slug}: expected curated runs plus full inventory`);
    assert.equal(trailIds.length, 6, `${slug}: expected 6 trail ids`);

    for (let i = 0; i < 6; i++) {
      const run = built.runs[i];
      const trailId = trailIds[i];
      const measured = {
        startZ: Math.round(run.points[0].z * 100) / 100,
        finishZ: Math.round(run.points.at(-1)!.z * 100) / 100,
      };
      // Legacy aliases retain historical v1 gates. New boards use canonical OSM IDs,
      // whose current geometry is checked above without rewriting old rows.
      const table = COURSE_GATES[slug][trailId];
      const course = resolveCourse(slug, trailId);
      assert.ok(table && course);
      assert.equal(course.startZ, table.startZ);
      assert.equal(course.finishZ, table.finishZ);
      assert.ok(Number.isFinite(measured.startZ));
    }
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
