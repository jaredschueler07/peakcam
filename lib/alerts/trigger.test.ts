import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { setEmailClientForTests, type EmailClient } from "../email";

test("trigger evaluates subscribers separately and preserves live alerts during forecast failures", async (t) => {
  const savedEnv = { ...process.env };
  process.env.CRON_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.RESEND_API_KEY = "re_test_key_1234567890";
  const { GET } = await import("../../app/api/alerts/trigger/route");
  const originalFetch = globalThis.fetch;
  try {
    for (const scenario of ["thresholds", "tomorrow", "http failure", "network failure", "malformed forecast", "location failure", "legacy schema"] as const) {
      await t.test(scenario, async () => {
        const sent: string[] = [];
        let forecastFetches = 0;
        const logs: unknown[] = [];
        setEmailClientForTests({ emails: { send: async (payload: { to: string }) => {
          sent.push(payload.to);
          return { data: { id: "test" }, error: null };
        } } } as unknown as EmailClient);
        globalThis.fetch = async (input, init) => {
          const url = String(input);
          const json = (data: unknown) => new Response(JSON.stringify(data));
          if (url.includes("api.open-meteo.com")) {
            forecastFetches++;
            assert.equal(new URL(url).searchParams.get("forecast_days"), "7");
            if (scenario === "http failure") return new Response("", { status: 503 });
            if (scenario === "network failure") throw new Error("offline");
            if (scenario === "malformed forecast") return json({});
            const snow = scenario === "tomorrow" ? [0, 1, 1, 1, 0, 0, 0] : [0, 0, 1, 1, 1, 0, 0];
            const values = [0, 0, ...snow];
            return json({ daily: {
              time: values.map((_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`),
              weathercode: values.map(() => 71), temperature_2m_max: values.map(() => -1),
              temperature_2m_min: values.map(() => -5), snowfall_sum: values.map(n => n * 2.54),
              precipitation_probability_max: values.map(() => 80), wind_gusts_10m_max: values.map(() => 10),
              wind_direction_10m_dominant: values.map(() => 0),
            } });
          }
          if (url.includes("/snow_reports?")) return json([{ updated_at: new Date().toISOString() }]);
          if (url.includes("/alert_preferences?")) return json([2, 12].map(threshold => ({
            subscriber_id: String(threshold), resort_id: "x", threshold_inches: threshold,
            alert_subscribers: { id: String(threshold), email: `${threshold}@example.com`, manage_token: "t" },
            resorts: { name: "X", slug: "x" },
          })));
          if (url.includes("/latest_snow_reports?")) return json([{ resort_id: "x", new_snow_24h: scenario.includes("failure") || scenario === "malformed forecast" ? 3 : 0 }]);
          if (url.includes("/resorts?")) {
            if (scenario === "location failure") throw new Error("locations offline");
            return json([{ id: "x", lat: 39, lng: -120 }]);
          }
          if (url.includes("/powder_alert_log")) {
            if (scenario === "legacy schema" && init?.method === "POST" && String(init.body).includes('"kind"')) {
              return new Response("", { status: 400 });
            }
            if (init?.method === "POST") logs.push(JSON.parse(String(init.body)));
            if (scenario === "legacy schema" && url.includes("kind")) {
              return new Response("", { status: 400 });
            }
            if (scenario === "legacy schema") {
              // Legacy schema: prior-day row, no `kind` column. Must suppress
              // the re-alert via the cooldown fallback (Astra re-review #3).
              const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
              return json([{ subscriber_id: "2", resort_id: "x", new_snow_inches: 3, alert_date: yesterday }]);
            }
            return json([]);
          }
          throw new Error(`Unexpected fetch: ${url}`);
        };
        const response = await GET(new NextRequest("https://peakcam.test/api/alerts/trigger", { headers: { authorization: "Bearer test-secret" } }));
        assert.equal(response.status, 200);
        if (scenario === "legacy schema") {
          // Prior-day legacy row must suppress the re-alert (Astra re-review #3).
          assert.deepEqual(sent, []);
          assert.equal((await response.json()).sent, 0);
          assert.equal(logs.length, 0);
        } else {
          assert.deepEqual(sent, ["2@example.com"]);
          assert.equal((await response.json()).sent, 1);
          assert.equal(logs.length, 1);
        }
        assert.equal(forecastFetches, scenario === "location failure" ? 0 : 1);
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
    setEmailClientForTests(null);
    for (const key of ["CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"]) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
  }
});

test("does not re-alert the same forecast storm on the following day", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalDate = globalThis.Date;
  process.env.CRON_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.RESEND_API_KEY = "re_test_key_1234567890";
  const { GET } = await import("../../app/api/alerts/trigger/route");
  const sent: string[] = [];
  const posts: Array<Record<string, unknown>[]> = [];
  const logRows: Array<Record<string, unknown>> = [];
  let currentDay = "2026-09-10T12:00:00.000Z";
  class TestDate extends originalDate {
    constructor(value?: string | number | Date) {
      super(value === undefined ? currentDay : value);
    }
    static now() { return originalDate.parse(currentDay); }
  }
  try {
    globalThis.Date = TestDate as DateConstructor;
    setEmailClientForTests({ emails: { send: async (payload: { to: string }) => {
      sent.push(payload.to);
      return { data: { id: "test" }, error: null };
    } } } as unknown as EmailClient);
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (url.includes("api.open-meteo.com")) {
        const snowfall = [0, 0, 0, 0, 0, 1.5, 1.5, 1.5, 0, 0];
        return json({ daily: {
          time: Array.from({ length: snowfall.length }, (_, i) => `2026-09-${String(8 + i).padStart(2, "0")}`),
          weathercode: snowfall.map(() => 71), temperature_2m_max: snowfall.map(() => -1),
          temperature_2m_min: snowfall.map(() => -5), snowfall_sum: snowfall.map(n => n * 2.54),
          precipitation_probability_max: snowfall.map(() => 80), wind_gusts_10m_max: snowfall.map(() => 10),
          wind_direction_10m_dominant: snowfall.map(() => 0),
        } });
      }
      if (url.includes("/snow_reports?")) return json([{ updated_at: currentDay }]);
      if (url.includes("/alert_preferences?")) return json([{
        subscriber_id: "sub", resort_id: "resort", threshold_inches: 2,
        alert_subscribers: { id: "sub", email: "ski@example.com", manage_token: "token" },
        resorts: { name: "X", slug: "x" },
      }]);
      if (url.includes("/latest_snow_reports?")) return json([{ resort_id: "resort", new_snow_24h: 0 }]);
      if (url.includes("/resorts?")) return json([{ id: "resort", lat: 39, lng: -120 }]);
      if (url.includes("/powder_alert_log")) {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
          posts.push(body);
          logRows.push(...body.map(row => ({ ...row, alert_date: currentDay.slice(0, 10) })));
          return json([]);
        }
        const query = new URL(url).searchParams;
        const filter = query.get("alert_date");
        const exactDay = filter?.startsWith("eq.") ? filter.slice(3) : undefined;
        const since = filter?.startsWith("gte.") ? filter.slice(4) : undefined;
        const rows = logRows.filter(row => !exactDay || row.alert_date === exactDay)
          .filter(row => !since || String(row.alert_date) >= since);
        return json(rows);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const request = () => GET(new NextRequest("https://peakcam.test/api/alerts/trigger", {
      headers: { authorization: "Bearer test-secret" },
    }));
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal((await first.json()).sent, 1);
    currentDay = "2026-09-11T12:00:00.000Z";
    const second = await request();
    assert.equal(second.status, 200);
    assert.equal((await second.json()).sent, 0);
    assert.deepEqual(sent, ["ski@example.com"]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0][0].kind, "forecast");
    assert.equal(posts[0][0].storm_start_date, "2026-09-13");
  } finally {
    globalThis.Date = originalDate;
    globalThis.fetch = originalFetch;
    setEmailClientForTests(null);
    for (const key of ["CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"]) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
  }
});

test("rounds fractional forecast totals and reports a failed log insert", async () => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.CRON_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.RESEND_API_KEY = "re_test_key_1234567890";
  const { GET } = await import("../../app/api/alerts/trigger/route");
  const sent: string[] = [];
  let posted: Array<Record<string, unknown>> = [];
  try {
    setEmailClientForTests({ emails: { send: async (payload: { to: string }) => {
      sent.push(payload.to);
      return { data: { id: "test" }, error: null };
    } } } as unknown as EmailClient);
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (url.includes("api.open-meteo.com")) {
        const snowfall = [0, 0, 0, 1.2, 1.2, 1.3, 0];
        return json({ daily: {
          time: Array.from({ length: snowfall.length }, (_, i) => `2026-09-${String(8 + i).padStart(2, "0")}`),
          weathercode: snowfall.map(() => 71), temperature_2m_max: snowfall.map(() => -1),
          temperature_2m_min: snowfall.map(() => -5), snowfall_sum: snowfall.map(n => n * 2.54),
          precipitation_probability_max: snowfall.map(() => 80), wind_gusts_10m_max: snowfall.map(() => 10),
          wind_direction_10m_dominant: snowfall.map(() => 0),
        } });
      }
      if (url.includes("/snow_reports?")) return json([{ updated_at: new Date().toISOString() }]);
      if (url.includes("/alert_preferences?")) return json([{
        subscriber_id: "sub", resort_id: "resort", threshold_inches: 2,
        alert_subscribers: { id: "sub", email: "ski@example.com", manage_token: "token" },
        resorts: { name: "X", slug: "x" },
      }]);
      if (url.includes("/latest_snow_reports?")) return json([{ resort_id: "resort", new_snow_24h: 0 }]);
      if (url.includes("/resorts?")) return json([{ id: "resort", lat: 39, lng: -120 }]);
      if (url.includes("/powder_alert_log")) {
        if (init?.method === "POST") {
          posted = JSON.parse(String(init.body));
          return json({ error: "database unavailable" }, 503);
        }
        return json([]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const response = await GET(new NextRequest("https://peakcam.test/api/alerts/trigger", {
      headers: { authorization: "Bearer test-secret" },
    }));
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.deepEqual(sent, ["ski@example.com"]);
    assert.equal(posted[0].new_snow_inches, 4);
    assert.equal(Number.isInteger(posted[0].new_snow_inches), true);
    assert.equal(payload.logFailures, 1);
    assert.equal(payload.failed, 1);
    assert.equal(payload.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    setEmailClientForTests(null);
    for (const key of ["CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"]) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
  }
});
