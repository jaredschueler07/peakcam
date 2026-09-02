import { test } from "node:test";
import assert from "node:assert";
import { createSbFetch } from "./sb-fetch";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
};

function recorder() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("[]", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("requests are prefixed with /rest/v1 and carry the service-role headers", async () => {
  const { calls, fetchImpl } = recorder();
  const sbFetch = createSbFetch({ env: ENV, fetchImpl });

  await sbFetch("/resorts?select=id");

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0]!.url, "https://proj.supabase.co/rest/v1/resorts?select=id");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.strictEqual(headers.apikey, "service-key");
  assert.strictEqual(headers.Authorization, "Bearer service-key");
  assert.strictEqual(headers["Content-Type"], "application/json");
});

test("init is forwarded and its headers merge over the defaults", async () => {
  const { calls, fetchImpl } = recorder();
  const sbFetch = createSbFetch({ env: ENV, fetchImpl });

  await sbFetch("/alert_preferences", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify([{ a: 1 }]),
  });

  const { init } = calls[0]!;
  assert.strictEqual(init.method, "POST");
  assert.strictEqual(init.body, '[{"a":1}]');
  const headers = init.headers as Record<string, string>;
  assert.strictEqual(headers.Prefer, "resolution=ignore-duplicates");
  // The service-role auth survives a caller-supplied headers object.
  assert.strictEqual(headers.Authorization, "Bearer service-key");
});

test("no timeout signal unless one is configured", async () => {
  const { calls, fetchImpl } = recorder();
  await createSbFetch({ env: ENV, fetchImpl })("/x");
  assert.strictEqual(calls[0]!.init.signal, undefined);

  const timed = recorder();
  await createSbFetch({ env: ENV, fetchImpl: timed.fetchImpl, timeoutMs: 8_000 })("/x");
  assert.ok(timed.calls[0]!.init.signal instanceof AbortSignal);
});

test("env is read per call, so importing a route never throws on a missing var", async () => {
  const { fetchImpl } = recorder();
  const sbFetch = createSbFetch({ env: {}, fetchImpl });
  await assert.rejects(() => sbFetch("/x"), /Supabase service role env not configured/);
});
