import { test } from "node:test";
import assert from "node:assert/strict";
import { capturePostHogEvent, closeRun, openRun, runEventProperties, shapeRunRow } from "./run-log";

const FINISHED = new Date("2026-12-01T13:00:42.000Z");
const STARTED = new Date("2026-12-01T13:00:00.000Z");

test("shapeRunRow: flattens counts and prefixes side-branch errors", () => {
  const row = shapeRunRow({
    ok: false,
    attempted: 2,
    sent: 1,
    failed: 1,
    logFailures: 1,
    subscribers: 7,
    errors: ["log_insert_failed", "send_failed:validation_error"],
    openings: { failed: 1, errors: ["log_insert_failed"] },
    webhooks: { delivered: 3, failed: 1, errors: ["http_500"] },
    freshness: { stale: true },
  }, FINISHED, 500);
  assert.equal(row.finished_at, "2026-12-01T13:00:42.000Z");
  assert.equal(row.subscribers, 7);
  assert.equal(row.alerts_sent, 1);
  assert.equal(row.webhooks_sent, 3);
  assert.deepEqual(row.errors, [
    "log_insert_failed",
    "send_failed:validation_error",
    "openings:log_insert_failed",
    "webhook:http_500",
    "feed_stale",
  ]);
  assert.equal(row.summary.http_status, 500);
  assert.equal(row.summary.sent, 1);
});

test("shapeRunRow: a quiet run and an early-exit error body", () => {
  const quiet = shapeRunRow({ ok: true, attempted: 0, sent: 0, failed: 0, logFailures: 0, subscribers: 2, message: "No thresholds exceeded" } as never, FINISHED, 200);
  assert.deepEqual(quiet.errors, []);
  assert.equal(quiet.alerts_sent, 0);
  assert.equal(quiet.webhooks_sent, 0);
  assert.equal(quiet.subscribers, 2);

  const early = shapeRunRow({ error: "Failed to load preferences" }, FINISHED, 500);
  assert.deepEqual(early.errors, ["Failed to load preferences"]);
  assert.equal(early.subscribers, null);
});

test("runEventProperties: counts only, duration from the clocks", () => {
  const row = shapeRunRow({ sent: 2, subscribers: 3, webhooks: { delivered: 1 }, errors: ["x"] }, FINISHED, 200);
  assert.deepEqual(runEventProperties(row, STARTED, FINISHED, 200), {
    http_status: 200,
    ok: true,
    duration_ms: 42_000,
    subscribers: 3,
    alerts_sent: 2,
    webhooks_sent: 1,
    error_count: 1,
    errors: ["x"],
  });
});

test("openRun / closeRun talk to powder_alert_runs and fail soft", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  const calls: Array<{ url: string; method?: string; body?: string; prefer?: string }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method, body: init?.body ? String(init.body) : undefined, prefer: (init?.headers as Record<string, string>)?.Prefer });
      if (init?.method === "POST") return new Response(JSON.stringify([{ id: "run-9" }]), { status: 201 });
      return new Response(null, { status: 204 });
    };
    const id = await openRun(STARTED);
    assert.equal(id, "run-9");
    assert.equal(calls[0].url, "https://db.test/rest/v1/powder_alert_runs");
    assert.equal(calls[0].prefer, "return=representation");
    assert.deepEqual(JSON.parse(calls[0].body!), { started_at: "2026-12-01T13:00:00.000Z" });

    const row = shapeRunRow({ sent: 1, subscribers: 2 }, FINISHED, 200);
    assert.equal(await closeRun(id, row), true);
    assert.equal(calls[1].url, "https://db.test/rest/v1/powder_alert_runs?id=eq.run-9");
    assert.equal(calls[1].method, "PATCH");
    assert.equal(JSON.parse(calls[1].body!).alerts_sent, 1);

    assert.equal(await closeRun(null, row), false, "no row to close when open failed");

    // Missing table (migration not applied) → null, no throw.
    globalThis.fetch = async () => new Response("", { status: 404 });
    assert.equal(await openRun(STARTED), null);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal(await openRun(STARTED), null);
    assert.equal(await closeRun("run-9", row), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
  }
});

test("capturePostHogEvent: skipped without a key, plain POST to /capture/ with one", async () => {
  const savedEnv = { ...process.env };
  try {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    let calls = 0;
    assert.equal(await capturePostHogEvent("powder_alert_run", { ok: true }, { fetchImpl: async () => { calls++; return new Response("ok"); } }), false);
    assert.equal(calls, 0);

    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com/";
    let seen: { url: string; body: Record<string, unknown> } | null = null;
    const ok = await capturePostHogEvent("powder_alert_run", { alerts_sent: 2 }, {
      fetchImpl: async (url, init) => { seen = { url: String(url), body: JSON.parse(String(init!.body)) }; return new Response("ok"); },
    });
    assert.equal(ok, true);
    assert.equal(seen!.url, "https://eu.i.posthog.com/capture/");
    assert.equal(seen!.body.api_key, "phc_test");
    assert.equal(seen!.body.event, "powder_alert_run");
    assert.equal(seen!.body.distinct_id, "peakcam-alerts-cron");
    assert.equal((seen!.body.properties as Record<string, unknown>).alerts_sent, 2);
    assert.equal((seen!.body.properties as Record<string, unknown>).$process_person_profile, false);

    assert.equal(await capturePostHogEvent("x", {}, { fetchImpl: async () => { throw new Error("down"); } }), false);
    assert.equal(await capturePostHogEvent("x", {}, { fetchImpl: async () => new Response("", { status: 500 }) }), false);
  } finally {
    for (const key of ["NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST"]) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
  }
});
