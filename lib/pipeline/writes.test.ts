import test from "node:test";
import assert from "node:assert/strict";

import type { SupabaseRestConfig } from "../supabase-rest";
import {
  encodeConditions,
  fetchUserReports,
  insertSnowReport,
  updateResortRating,
  upsertSnowpackDaily,
  type SnowReportWrite,
} from "./writes";

const CFG: SupabaseRestConfig = { url: "https://db.example", key: "svc-key" };

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

async function capture(
  fn: () => Promise<void>,
  responder: () => Response = () => new Response("[]", { status: 200 }),
): Promise<Call[]> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : {},
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    return responder();
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

const BASE: SnowReportWrite = {
  resortId: "r1",
  baseDepthIn: 41.6,
  newSnow24h: 3,
  newSnow48h: 5,
  sweIn: 12.4,
  pctOfNormal: 88,
  trend7d: "building",
  outlook: "improving",
  condRating: "good",
  tags: ["powder", "cold"],
  narrative: "Fresh snow overnight.",
  source: "snotel",
};

test("encodeConditions joins tags with commas and separates the narrative with ||", () => {
  assert.equal(encodeConditions(["a", "b"], "hello"), "a,b||hello");
});

test("encodeConditions handles no tags and an empty narrative", () => {
  assert.equal(encodeConditions([], ""), "||");
});

test("insertSnowReport rounds the depth fields and encodes the conditions string", async () => {
  const calls = await capture(() => insertSnowReport(CFG, BASE));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://db.example/rest/v1/snow_reports");
  assert.equal(calls[0].method, "POST");

  const body = calls[0].body;
  assert.equal(body.base_depth, 42);
  assert.equal(body.new_snow_24h, 3);
  assert.equal(body.new_snow_48h, 5);
  assert.equal(body.swe_in, 12.4, "swe_in is written unrounded");
  assert.equal(body.auto_cond_rating, "good");
  assert.equal(body.conditions, "powder,cold||Fresh snow overnight.");
  assert.equal(body.source, "snotel");
  assert.equal(typeof body.updated_at, "string");
});

test("insertSnowReport keeps nulls null rather than rounding them to 0", async () => {
  const calls = await capture(() =>
    insertSnowReport(CFG, {
      ...BASE,
      baseDepthIn: null,
      newSnow24h: null,
      newSnow48h: null,
      sweIn: null,
      pctOfNormal: null,
    }),
  );
  assert.equal(calls[0].body.base_depth, null);
  assert.equal(calls[0].body.new_snow_24h, null);
  assert.equal(calls[0].body.new_snow_48h, null);
  assert.equal(calls[0].body.pct_of_normal, null);
});

test("insertSnowReport omits snowing_now entirely when it is not supplied", async () => {
  const calls = await capture(() => insertSnowReport(CFG, BASE));
  assert.equal("snowing_now" in calls[0].body, false);

  const withFlag = await capture(() =>
    insertSnowReport(CFG, { ...BASE, snowingNow: false }),
  );
  assert.equal(withFlag[0].body.snowing_now, false);
});

test("insertSnowReport surfaces the PostgREST status and body on failure", async () => {
  await capture(
    async () => {
      await assert.rejects(
        () => insertSnowReport(CFG, BASE),
        /snow_reports insert failed \(400\): bad column/,
      );
    },
    () => new Response("bad column", { status: 400 }),
  );
});

test("updateResortRating patches only the matching resort", async () => {
  const calls = await capture(() => updateResortRating(CFG, "r9", "epic"));
  assert.equal(calls[0].url, "https://db.example/rest/v1/resorts?id=eq.r9");
  assert.equal(calls[0].method, "PATCH");
  assert.deepEqual(calls[0].body, { cond_rating: "epic" });
});

test("updateResortRating uses the resorts.cond_rating error label", async () => {
  await capture(
    async () => {
      await assert.rejects(
        () => updateResortRating(CFG, "r9", "epic"),
        /resorts\.cond_rating update failed \(500\): nope/,
      );
    },
    () => new Response("nope", { status: 500 }),
  );
});

test("upsertSnowpackDaily sends merge-duplicates and passes the row through", async () => {
  const calls = await capture(() =>
    upsertSnowpackDaily(CFG, {
      resort_id: "r1",
      station_id: "842:CO:SNTL",
      date: "2026-01-05",
      snow_depth_in: 40,
      swe_in: 11.2,
      qc_flag: "ok",
    }),
  );
  assert.equal(calls[0].url, "https://db.example/rest/v1/snowpack_daily");
  assert.equal(calls[0].headers.Prefer, "resolution=merge-duplicates");
  assert.equal(calls[0].body.station_id, "842:CO:SNTL");
  assert.equal(calls[0].body.qc_flag, "ok");
});

test("fetchUserReports filters to unflagged reports from the last 24h", async () => {
  const calls = await capture(async () => {
    await fetchUserReports(CFG, "r1");
  });
  const url = calls[0].url;
  assert.match(url, /\/user_conditions\?resort_id=eq\.r1/);
  assert.match(url, /is_flagged=eq\.false/);
  assert.match(url, /select=snow_quality,visibility,wind,trail_conditions/);

  const cutoff = decodeURIComponent(url.match(/submitted_at=gte\.([^&]+)/)![1]);
  const ageMs = Date.now() - Date.parse(cutoff);
  assert.ok(
    Math.abs(ageMs - 24 * 3600_000) < 5_000,
    `cutoff should be ~24h ago, got ${ageMs}ms`,
  );
});

test("fetchUserReports returns [] rather than throwing when the query fails", async () => {
  let result: unknown;
  await capture(
    async () => {
      result = await fetchUserReports(CFG, "r1");
    },
    () => new Response("boom", { status: 500 }),
  );
  assert.deepEqual(result, []);
});
