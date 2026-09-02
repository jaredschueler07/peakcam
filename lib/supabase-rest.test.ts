import test from "node:test";
import assert from "node:assert/strict";

import {
  sbDelete,
  sbFetch,
  sbInsert,
  sbPatch,
  sbSelect,
  sbSelectOrEmpty,
  sbUpsert,
  supaHeaders,
  type SupabaseRestConfig,
} from "./supabase-rest";

const CFG: SupabaseRestConfig = { url: "https://db.example", key: "svc-key" };

interface Call {
  url: string;
  init: RequestInit;
}

/** Swap in a fake `fetch`, run `fn`, restore. Returns the calls made. */
async function withFetch(
  responder: (url: string, init: RequestInit) => Response,
  fn: () => Promise<void>,
): Promise<Call[]> {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, text: string) => new Response(text, { status });

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

test("supaHeaders carries apikey, bearer token and JSON content type", () => {
  assert.deepEqual(supaHeaders("k"), {
    apikey: "k",
    Authorization: "Bearer k",
    "Content-Type": "application/json",
  });
});

test("sbFetch prefixes /rest/v1 and merges caller headers over the defaults", async () => {
  const calls = await withFetch(
    () => ok([]),
    async () => {
      await sbFetch(CFG, "/resorts?select=id", {
        headers: { Prefer: "count=exact", "Content-Type": "text/plain" },
      });
    },
  );

  assert.equal(calls[0].url, "https://db.example/rest/v1/resorts?select=id");
  const h = headersOf(calls[0].init);
  assert.equal(h.apikey, "svc-key");
  assert.equal(h.Authorization, "Bearer svc-key");
  assert.equal(h.Prefer, "count=exact");
  assert.equal(h["Content-Type"], "text/plain");
});

test("sbSelect returns the parsed rows", async () => {
  let rows: unknown;
  await withFetch(
    () => ok([{ id: "a" }, { id: "b" }]),
    async () => {
      rows = await sbSelect<{ id: string }>(CFG, "/resorts?select=id");
    },
  );
  assert.deepEqual(rows, [{ id: "a" }, { id: "b" }]);
});

test("sbSelect throws with the supplied label, status and body", async () => {
  await withFetch(
    () => fail(503, "upstream down"),
    async () => {
      await assert.rejects(
        () => sbSelect(CFG, "/resorts", { errorLabel: "Supabase resorts fetch failed" }),
        /Supabase resorts fetch failed \(503\): upstream down/,
      );
    },
  );
});

test("sbSelectOrEmpty returns [] on a non-2xx response instead of throwing", async () => {
  let rows: unknown;
  await withFetch(
    () => fail(500, "boom"),
    async () => {
      rows = await sbSelectOrEmpty(CFG, "/snotel_normals?limit=1");
    },
  );
  assert.deepEqual(rows, []);
});

test("sbSelectOrEmpty returns [] when fetch itself rejects", async () => {
  let rows: unknown;
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("network"))) as typeof fetch;
  try {
    rows = await sbSelectOrEmpty(CFG, "/anything");
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(rows, []);
});

test("sbInsert POSTs the JSON body without a merge-duplicates Prefer header", async () => {
  const calls = await withFetch(
    () => ok(null),
    async () => {
      await sbInsert(CFG, "snow_reports", { resort_id: "r1" });
    },
  );
  assert.equal(calls[0].url, "https://db.example/rest/v1/snow_reports");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, '{"resort_id":"r1"}');
  assert.equal(headersOf(calls[0].init).Prefer, undefined);
});

test("sbUpsert sets Prefer: resolution=merge-duplicates and an on_conflict query", async () => {
  const calls = await withFetch(
    () => ok(null),
    async () => {
      await sbUpsert(CFG, "resort_metadata", [{ resort_id: "r1" }], {
        onConflict: "resort_id",
      });
    },
  );
  assert.equal(
    calls[0].url,
    "https://db.example/rest/v1/resort_metadata?on_conflict=resort_id",
  );
  assert.equal(headersOf(calls[0].init).Prefer, "resolution=merge-duplicates");
});

test("sbPatch builds a PATCH against the filtered rows", async () => {
  const calls = await withFetch(
    () => ok(null),
    async () => {
      await sbPatch(CFG, "resorts", "id=eq.r1", { cond_rating: "good" });
    },
  );
  assert.equal(calls[0].url, "https://db.example/rest/v1/resorts?id=eq.r1");
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(calls[0].init.body, '{"cond_rating":"good"}');
});

test("sbDelete builds a DELETE against the filtered rows", async () => {
  const calls = await withFetch(
    () => ok(null),
    async () => {
      await sbDelete(CFG, "snotel_normals", "station_id=eq.842:CO:SNTL");
    },
  );
  assert.equal(
    calls[0].url,
    "https://db.example/rest/v1/snotel_normals?station_id=eq.842:CO:SNTL",
  );
  assert.equal(calls[0].init.method, "DELETE");
});

test("write helpers default their error label to <table> <op> failed", async () => {
  await withFetch(
    () => fail(409, "conflict"),
    async () => {
      await assert.rejects(
        () => sbUpsert(CFG, "snowpack_daily", {}),
        /snowpack_daily upsert failed \(409\): conflict/,
      );
      await assert.rejects(
        () => sbPatch(CFG, "resorts", "id=eq.1", {}),
        /resorts update failed \(409\): conflict/,
      );
    },
  );
});
