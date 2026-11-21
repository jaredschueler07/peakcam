import test from "node:test";
import assert from "node:assert/strict";
import { pageParams, readAllPages, REST_PAGE_SIZE } from "./paged-read";

/** A stub REST endpoint that, like PostgREST, never returns more than `cap` rows. */
function cappedSource(total: number, cap = REST_PAGE_SIZE) {
  const calls: Array<[number, number]> = [];
  const rows = Array.from({ length: total }, (_, i) => i);
  return {
    calls,
    fetchPage: async (from: number, to: number) => {
      calls.push([from, to]);
      return rows.slice(from, Math.min(to + 1, from + cap));
    },
  };
}

test("readAllPages returns every row past the 1,000-row cap", async () => {
  // The latest-scores window on 2026-11-21: 318 resorts × 4 days.
  const src = cappedSource(1272);
  const rows = await readAllPages(src.fetchPage);
  assert.equal(rows.length, 1272);
  assert.deepEqual(rows.slice(0, 2), [0, 1]);
  assert.equal(rows[1271], 1271);
  assert.deepEqual(src.calls, [[0, 999], [1000, 1999]]);
});

test("readAllPages makes one request for a short table and one extra for an exact multiple", async () => {
  const short = cappedSource(44);
  assert.equal((await readAllPages(short.fetchPage)).length, 44);
  assert.equal(short.calls.length, 1);
  const exact = cappedSource(2000);
  assert.equal((await readAllPages(exact.fetchPage)).length, 2000);
  assert.deepEqual(exact.calls.map(([from]) => from), [0, 1000, 2000]);
});

test("readAllPages treats a null page as empty and refuses a runaway read", async () => {
  assert.deepEqual(await readAllPages(async () => null), []);
  await assert.rejects(readAllPages(async (from, to) => Array.from({ length: to - from + 1 }, () => 0), { pageSize: 10, maxPages: 3 }), /more than 3 pages/);
  await assert.rejects(readAllPages(async () => [], { pageSize: 0 }), /bad pageSize/);
});

test("a single unpaged request would have lost rows: the regression this guards", async () => {
  const src = cappedSource(1044); // cams on 2026-11-21
  const firstOnly = await src.fetchPage(0, 19_999);
  assert.equal(firstOnly.length, 1000);
  assert.equal((await readAllPages(src.fetchPage)).length, 1044);
});

test("pageParams builds limit and offset", () => {
  assert.equal(pageParams(0, 999), "limit=1000&offset=0");
  assert.equal(pageParams(1000, 1999), "limit=1000&offset=1000");
});
