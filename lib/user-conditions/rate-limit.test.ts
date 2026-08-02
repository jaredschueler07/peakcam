import { test } from "node:test";
import assert from "node:assert";
import { hasRecentReport, recentReportPath, RATE_LIMIT_WINDOW_MS } from "./rate-limit";

const RESORT = "11111111-2222-3333-4444-555555555555";
const USER = "99999999-8888-7777-6666-555555555555";

test("the query filters on resort, user and the one-hour window", () => {
  const path = recentReportPath(RESORT, USER, "2026-08-01T12:00:00.000Z");
  const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));

  assert.ok(path.startsWith("/user_conditions?"));
  assert.strictEqual(params.get("resort_id"), `eq.${RESORT}`);
  assert.strictEqual(params.get("user_id"), `eq.${USER}`);
  assert.strictEqual(params.get("submitted_at"), "gte.2026-08-01T12:00:00.000Z");
  assert.strictEqual(params.get("limit"), "1");
  // Deliberately no is_flagged filter: flagged rows must count against the
  // limit, which is the whole point of reading past RLS here.
  assert.strictEqual(params.get("is_flagged"), null);
});

test("caller-supplied values cannot inject extra PostgREST parameters", () => {
  const path = recentReportPath("x&select=*&user_id=neq.null", USER, "2026-08-01T12:00:00.000Z");
  const params = new URLSearchParams(path.slice(path.indexOf("?") + 1));

  assert.strictEqual(params.get("select"), "id");
  assert.strictEqual(params.get("user_id"), `eq.${USER}`);
  assert.strictEqual(params.get("resort_id"), "eq.x&select=*&user_id=neq.null");
});

test("a returned row means rate-limited, and the request uses the service key", async () => {
  let seenUrl = "";
  let seenAuth = "";
  const limited = await hasRecentReport({
    supabaseUrl: "https://proj.supabase.co",
    serviceKey: "service-key",
    resortId: RESORT,
    userId: USER,
    now: Date.parse("2026-08-01T13:00:00.000Z"),
    fetchImpl: (async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenAuth = (init.headers as Record<string, string>).Authorization;
      return { ok: true, json: async () => [{ id: "row" }] };
    }) as unknown as typeof fetch,
  });

  assert.strictEqual(limited, true);
  assert.strictEqual(seenAuth, "Bearer service-key");
  assert.ok(seenUrl.startsWith("https://proj.supabase.co/rest/v1/user_conditions?"));
  assert.ok(
    seenUrl.includes(
      encodeURIComponent(
        `gte.${new Date(Date.parse("2026-08-01T13:00:00.000Z") - RATE_LIMIT_WINDOW_MS).toISOString()}`
      )
    )
  );
});

test("an empty result is not rate-limited", async () => {
  const limited = await hasRecentReport({
    supabaseUrl: "https://proj.supabase.co",
    serviceKey: "k",
    resortId: RESORT,
    userId: USER,
    fetchImpl: (async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch,
  });
  assert.strictEqual(limited, false);
});

test("fails open rather than blocking honest reports", async () => {
  const onError = async (impl: typeof fetch) =>
    hasRecentReport({
      supabaseUrl: "https://proj.supabase.co",
      serviceKey: "k",
      resortId: RESORT,
      userId: USER,
      fetchImpl: impl,
    });

  assert.strictEqual(
    await onError((async () => ({ ok: false, text: async () => "boom" })) as unknown as typeof fetch),
    false
  );
  assert.strictEqual(
    await onError((async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch),
    false
  );
  assert.strictEqual(
    await hasRecentReport({
      supabaseUrl: undefined,
      serviceKey: undefined,
      resortId: RESORT,
      userId: USER,
    }),
    false
  );
});
