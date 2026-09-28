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
          // Nobody opens today; the opening-day branch is covered by its own tests below.
          if (url.includes("/resort_openings?")) return json([]);
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
      if (url.includes("/resort_openings?")) return json([]);
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
      if (url.includes("/resort_openings?")) return json([]);
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

// ── Opening-day branch ────────────────────────────────────────
// Resorts whose confirmed_open is today → one email per opted-in subscriber,
// logged as kind='opening'. Isolated from the powder branch in both
// directions, and never a second email for the same resort/day.

const TRIGGER_ENV = ["CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"] as const;

function withTriggerEnv(): () => void {
  const savedEnv = { ...process.env };
  process.env.CRON_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.RESEND_API_KEY = "re_test_key_1234567890";
  return () => {
    for (const key of TRIGGER_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
    }
  };
}

type SentMail = { to: string; subject: string; html: string };

function captureMail(): SentMail[] {
  const sent: SentMail[] = [];
  setEmailClientForTests({ emails: { send: async (payload: SentMail) => {
    sent.push(payload);
    return { data: { id: "test" }, error: null };
  } } } as unknown as EmailClient);
  return sent;
}

const authed = () => new NextRequest("https://peakcam.test/api/alerts/trigger", { headers: { authorization: "Bearer test-secret" } });

test("opening day: one email per opted-in subscriber, logged as kind=opening, never twice for the same resort/day", async () => {
  const restoreEnv = withTriggerEnv();
  const originalFetch = globalThis.fetch;
  const { GET } = await import("../../app/api/alerts/trigger/route");
  const today = new Date().toISOString().slice(0, 10);
  const logRows: Array<Record<string, unknown>> = [];
  const posts: Array<Array<Record<string, unknown>>> = [];
  try {
    const sent = captureMail();
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (url.includes("/snow_reports?")) return json([{ updated_at: new Date().toISOString() }]);
      if (url.includes("/resort_openings?")) {
        assert.ok(url.includes(`confirmed_open=eq.${today}`), "probes today's confirmed openings only");
        return json([
          { resort_id: "r-mammoth", resorts: { name: "Mammoth Mountain", slug: "mammoth" } },
          { resort_id: "r-vail", resorts: { name: "Vail Mountain", slug: "vail" } },
        ]);
      }
      if (url.includes("/alert_preferences?") && url.includes("opening_day=is.true")) {
        const ann = { id: "s-ann", email: "ann@example.com", manage_token: "tok-ann" };
        const bob = { id: "s-bob", email: "bob@example.com", manage_token: "tok-bob" };
        return json([
          { subscriber_id: "s-ann", resort_id: "r-vail", alert_subscribers: ann },
          { subscriber_id: "s-ann", resort_id: "r-mammoth", alert_subscribers: ann },
          { subscriber_id: "s-bob", resort_id: "r-mammoth", alert_subscribers: bob },
        ]);
      }
      // No powder subscriptions in this test: the powder branch returns early.
      if (url.includes("/alert_preferences?")) return json([]);
      if (url.includes("/cams?")) return json([{ resort_id: "r-mammoth" }, { resort_id: "r-mammoth" }, { resort_id: "r-mammoth" }]);
      if (url.includes("/powder_alert_log")) {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
          posts.push(body);
          logRows.push(...body);
          return json([]);
        }
        assert.ok(url.includes("kind=eq.opening") && url.includes(`alert_date=eq.${today}`), "dedupe read is scoped to today's opening rows");
        return json(logRows.map(({ subscriber_id, resort_id }) => ({ subscriber_id, resort_id })));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const first = await GET(authed());
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.openings, { resortsOpening: 2, attempted: 2, sent: 2, failed: 0, logFailures: 0 });
    assert.deepEqual(sent.map((m) => m.to).sort(), ["ann@example.com", "bob@example.com"]);

    const ann = sent.find((m) => m.to === "ann@example.com")!;
    assert.equal(ann.subject, "2 of your resorts open today — PeakCam");
    assert.match(ann.html, /Watch 3 live cams →/);
    assert.match(ann.html, /Watch the cams →/, "Vail has no active cam");
    assert.ok(ann.html.includes("/alerts/manage?token=tok-ann"));
    const bob = sent.find((m) => m.to === "bob@example.com")!;
    assert.equal(bob.subject, "Mammoth Mountain opens today — PeakCam");

    // Every log row is an opening row with no snow — never a default 'live'
    // row, which would swallow that subscriber's powder alert for the day.
    assert.equal(logRows.length, 3);
    for (const row of logRows) {
      assert.equal(row.kind, "opening");
      assert.equal(row.new_snow_inches, 0);
      assert.equal(row.alert_date, today);
      assert.equal(row.storm_start_date, null);
    }
    assert.deepEqual(
      logRows.map((r) => `${r.subscriber_id}:${r.resort_id}`).sort(),
      ["s-ann:r-mammoth", "s-ann:r-vail", "s-bob:r-mammoth"]
    );

    // A second run the same day (a manual re-trigger, a Vercel retry) sends nothing.
    const second = await GET(authed());
    assert.equal(second.status, 200);
    assert.deepEqual((await second.json()).openings, { resortsOpening: 2, attempted: 0, sent: 0, failed: 0, logFailures: 0 });
    assert.equal(sent.length, 2);
    assert.equal(posts.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    setEmailClientForTests(null);
    restoreEnv();
  }
});

test("an opening-day log row never suppresses that subscriber's powder alert", async () => {
  const restoreEnv = withTriggerEnv();
  const originalFetch = globalThis.fetch;
  const { GET } = await import("../../app/api/alerts/trigger/route");
  const today = new Date().toISOString().slice(0, 10);
  let posted: Array<Record<string, unknown>> = [];
  try {
    const sent = captureMail();
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (url.includes("/resort_openings?")) return json([]);
      if (url.includes("api.open-meteo.com")) return json({});
      if (url.includes("/snow_reports?")) return json([{ updated_at: new Date().toISOString() }]);
      if (url.includes("/alert_preferences?")) return json([{
        subscriber_id: "sub", resort_id: "x", threshold_inches: 2,
        alert_subscribers: { id: "sub", email: "ski@example.com", manage_token: "token" },
        resorts: { name: "X", slug: "x" },
      }]);
      if (url.includes("/latest_snow_reports?")) return json([{ resort_id: "x", new_snow_24h: 5 }]);
      if (url.includes("/resorts?")) return json([{ id: "x", lat: 39, lng: -120 }]);
      if (url.includes("/powder_alert_log")) {
        if (init?.method === "POST") {
          posted = JSON.parse(String(init.body));
          return json([]);
        }
        // This morning's opening-day email to the same subscriber for the same resort.
        return json([{ subscriber_id: "sub", resort_id: "x", new_snow_inches: 0, alert_date: today, kind: "opening", storm_start_date: null }]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const response = await GET(authed());
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.sent, 1, "5″ over a 2″ threshold still alerts on opening day");
    assert.deepEqual(sent.map((m) => m.to), ["ski@example.com"]);
    assert.match(sent[0].subject, /5" of new snow at X/);
    assert.equal(posted[0].kind, "live");
    assert.deepEqual(body.openings, { resortsOpening: 0, attempted: 0, sent: 0, failed: 0, logFailures: 0 });
  } finally {
    globalThis.fetch = originalFetch;
    setEmailClientForTests(null);
    restoreEnv();
  }
});

test("a failed openings query fails the run loudly but never blocks powder alerts", async () => {
  const restoreEnv = withTriggerEnv();
  const originalFetch = globalThis.fetch;
  const { GET } = await import("../../app/api/alerts/trigger/route");
  try {
    const sent = captureMail();
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      // Migration 020 not applied, or the table is unreachable.
      if (url.includes("/resort_openings?")) return json({ message: "relation does not exist" }, 404);
      if (url.includes("api.open-meteo.com")) return json({});
      if (url.includes("/snow_reports?")) return json([{ updated_at: new Date().toISOString() }]);
      if (url.includes("/alert_preferences?")) return json([{
        subscriber_id: "sub", resort_id: "x", threshold_inches: 2,
        alert_subscribers: { id: "sub", email: "ski@example.com", manage_token: "token" },
        resorts: { name: "X", slug: "x" },
      }]);
      if (url.includes("/latest_snow_reports?")) return json([{ resort_id: "x", new_snow_24h: 5 }]);
      if (url.includes("/resorts?")) return json([{ id: "x", lat: 39, lng: -120 }]);
      if (url.includes("/powder_alert_log")) return json([]);
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const response = await GET(authed());
    const body = await response.json();
    assert.equal(response.status, 500, "a broken opening-day branch is a failed cron run");
    assert.equal(body.ok, false);
    assert.equal(body.sent, 1, "the powder alert still went out");
    assert.deepEqual(sent.map((m) => m.to), ["ski@example.com"]);
    assert.equal(body.openings.failed, 1);
    assert.deepEqual(body.openings.errors, ["openings_query_failed"]);
    assert.equal(body.openings.sent, 0);
  } finally {
    globalThis.fetch = originalFetch;
    setEmailClientForTests(null);
    restoreEnv();
  }
});

test("opening day: a failed dedupe read sends nothing rather than risk a second email", async () => {
  const restoreEnv = withTriggerEnv();
  const originalFetch = globalThis.fetch;
  const { GET } = await import("../../app/api/alerts/trigger/route");
  try {
    const sent = captureMail();
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (url.includes("/snow_reports?")) return json([{ updated_at: new Date().toISOString() }]);
      if (url.includes("/resort_openings?")) return json([{ resort_id: "r-mammoth", resorts: { name: "Mammoth Mountain", slug: "mammoth" } }]);
      if (url.includes("/alert_preferences?") && url.includes("opening_day=is.true")) {
        return json([{ subscriber_id: "s-ann", resort_id: "r-mammoth", alert_subscribers: { id: "s-ann", email: "ann@example.com", manage_token: "tok-ann" } }]);
      }
      if (url.includes("/alert_preferences?")) return json([]);
      if (url.includes("/cams?")) return json([]);
      if (url.includes("/powder_alert_log")) {
        assert.notEqual(init?.method, "POST", "nothing may be logged when nothing was sent");
        return json({ message: "timeout" }, 503);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const response = await GET(authed());
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.deepEqual(sent, []);
    assert.equal(body.openings.resortsOpening, 1);
    assert.equal(body.openings.attempted, 0);
    assert.deepEqual(body.openings.errors, ["openings_log_query_failed"]);
  } finally {
    globalThis.fetch = originalFetch;
    setEmailClientForTests(null);
    restoreEnv();
  }
});
