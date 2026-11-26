import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { setEmailClientForTests, type EmailClient } from "../email";

// app/api/alerts/feed-openings: the same-day opening email for a feed-detected
// opening. The route reads resort_openings itself; these tests drive it with a
// fake PostgREST and a fixed clock (09:10 Mountain time on 2026-11-26).

const ENV = ["CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RESEND_API_KEY"] as const;
const NOW = new Date("2026-11-26T16:10:00Z");
const TODAY = "2026-11-26";

function withEnv(): () => void {
  const saved = { ...process.env };
  process.env.CRON_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.RESEND_API_KEY = "re_test_key_1234567890";
  return () => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  };
}

type SentMail = { to: string; subject: string; html: string };

function captureMail(fail = false): SentMail[] {
  const sent: SentMail[] = [];
  setEmailClientForTests({ emails: { send: async (payload: SentMail) => {
    if (fail) return { data: null, error: { name: "application_error", message: "down" } };
    sent.push(payload);
    return { data: { id: "test" }, error: null };
  } } } as unknown as EmailClient);
  return sent;
}

const post = (secret = "test-secret") =>
  new NextRequest("https://peakcam.test/api/alerts/feed-openings", { method: "POST", headers: { authorization: `Bearer ${secret}` } });

const BIG_SKY = { name: "Big Sky", slug: "big-sky", state: "MT", country: "US", lat: 45.28, lng: -111.4 };
const ALTA = { name: "Alta", slug: "alta", state: "UT", country: "US", lat: 40.58, lng: -111.64 };
const ann = { id: "s-ann", email: "ann@example.com", manage_token: "tok-ann" };
const bob = { id: "s-bob", email: "bob@example.com", manage_token: "tok-bob" };

interface FakeDb {
  openings: unknown[];
  log: Array<Record<string, unknown>>;
  posts: number;
  deletes: number;
  /** Force the next claim insert for this pair to lose, as if a concurrent call won it. */
  raceFor?: string;
}

function fakeDb(db: FakeDb): typeof fetch {
  let nextId = 1;
  return async (input, init) => {
    const url = decodeURIComponent(String(input));
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (url.includes("/resort_openings?")) {
      assert.ok(url.includes("feed_open=gte.2026-11-25") && url.includes("feed_open=lte.2026-11-27"), url);
      return json(db.openings);
    }
    if (url.includes("/alert_preferences?")) {
      assert.ok(url.includes("opening_day=is.true"));
      return json([
        { subscriber_id: "s-ann", resort_id: "r-big-sky", alert_subscribers: ann },
        { subscriber_id: "s-ann", resort_id: "r-alta", alert_subscribers: ann },
        { subscriber_id: "s-bob", resort_id: "r-big-sky", alert_subscribers: bob },
      ]);
    }
    if (url.includes("/cams?")) return json([{ resort_id: "r-big-sky" }]);
    if (url.includes("/powder_alert_log")) {
      if (init?.method === "POST") {
        db.posts++;
        const row = JSON.parse(String(init.body)) as Record<string, unknown>;
        const key = `${row.subscriber_id}:${row.resort_id}:${row.alert_date}`;
        if (key === db.raceFor || db.log.some((r) => `${r.subscriber_id}:${r.resort_id}:${r.alert_date}` === key)) {
          db.raceFor = undefined;
          return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
        }
        const stored = { ...row, id: `log-${nextId++}` };
        db.log.push(stored);
        return json([stored], 201);
      }
      if (init?.method === "DELETE") {
        db.deletes++;
        const ids = /id=in\.\(([^)]*)\)/.exec(url)![1].split(",").map((s) => s.replace(/"/g, ""));
        db.log = db.log.filter((r) => !ids.includes(String(r.id)));
        return new Response(null, { status: 204 });
      }
      // The dedupe read covers the whole season.
      assert.ok(url.includes("kind=eq.opening") && url.includes("alert_date=gte.2026-07-01"), url);
      return json(db.log.map(({ subscriber_id, resort_id }) => ({ subscriber_id, resort_id })));
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

async function setup(t: TestContext) {
  const restore = withEnv();
  const originalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  const { POST } = await import("../../app/api/alerts/feed-openings/route");
  t.after(() => {
    globalThis.fetch = originalFetch;
    setEmailClientForTests(null);
    restore();
  });
  return POST;
}

test("feed openings: refuses a call without the cron secret", async (t) => {
  const POST = await setup(t);
  globalThis.fetch = async () => { throw new Error("no database call before auth"); };
  const res = await POST(post("wrong"));
  assert.equal(res.status, 401);
});

test("feed openings: today's opening mails each opted-in subscriber once, and never again that season", async (t) => {
  const POST = await setup(t);
  const sent = captureMail();
  const db: FakeDb = {
    openings: [
      { resort_id: "r-big-sky", season: "2026-27", confirmed_open: null, feed_open: TODAY, resorts: BIG_SKY },
      // Found from this morning's readings of yesterday's lift day: never mailed.
      { resort_id: "r-alta", season: "2026-27", confirmed_open: null, feed_open: "2026-11-25", resorts: ALTA },
    ],
    log: [],
    posts: 0,
    deletes: 0,
  };
  globalThis.fetch = fakeDb(db);

  const first = await POST(post());
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.resortsOpening, 1);
  assert.equal(body.sent, 2);
  assert.match(body.skipped.alta, /not today/);
  assert.deepEqual(sent.map((m) => m.to).sort(), ["ann@example.com", "bob@example.com"]);
  for (const mail of sent) {
    assert.equal(mail.subject, "Big Sky opens today — PeakCam");
    assert.doesNotMatch(mail.html, /Alta/);
  }
  assert.deepEqual(db.log.map((r) => [r.subscriber_id, r.resort_id, r.alert_date, r.kind, r.new_snow_inches]).sort(), [
    ["s-ann", "r-big-sky", TODAY, "opening", 0],
    ["s-bob", "r-big-sky", TODAY, "opening", 0],
  ]);

  // Every later sync that day calls again: nothing more goes out.
  for (let i = 0; i < 3; i++) {
    const again = await (await POST(post())).json();
    assert.equal(again.sent, 0);
  }
  assert.equal(sent.length, 2);

  // An earlier-this-season email (here, logged on Nov 20) blocks it too.
  const sent2 = captureMail();
  db.log = db.log.map((r) => ({ ...r, alert_date: "2026-11-20" }));
  assert.equal((await (await POST(post())).json()).sent, 0);
  assert.deepEqual(sent2, []);
});

test("feed openings: a call that loses the claim to a concurrent one sends nothing for that resort", async (t) => {
  const POST = await setup(t);
  const sent = captureMail();
  const db: FakeDb = {
    openings: [{ resort_id: "r-big-sky", season: "2026-27", confirmed_open: null, feed_open: TODAY, resorts: BIG_SKY }],
    log: [],
    posts: 0,
    deletes: 0,
    raceFor: `s-ann:r-big-sky:${TODAY}`,
  };
  globalThis.fetch = fakeDb(db);
  const body = await (await POST(post())).json();
  assert.deepEqual(sent.map((m) => m.to), ["bob@example.com"]);
  assert.equal(body.sent, 1);
});

test("feed openings: a failed send releases its claim so a later call that day can retry", async (t) => {
  const POST = await setup(t);
  captureMail(true);
  const db: FakeDb = {
    openings: [{ resort_id: "r-big-sky", season: "2026-27", confirmed_open: null, feed_open: TODAY, resorts: BIG_SKY }],
    log: [],
    posts: 0,
    deletes: 0,
  };
  globalThis.fetch = fakeDb(db);
  const res = await POST(post());
  assert.equal(res.status, 500);
  assert.equal((await res.json()).failed, 2);
  assert.equal(db.log.length, 0, "no claim is left behind for an email that did not go");

  const sent = captureMail();
  assert.equal((await (await POST(post())).json()).sent, 2);
  assert.equal(sent.length, 2);
});

test("feed openings: a confirmed date that owns the opening, or a call after the lifts close, mails nobody", async (t) => {
  const POST = await setup(t);
  const sent = captureMail();
  const db: FakeDb = {
    openings: [{ resort_id: "r-big-sky", season: "2026-27", confirmed_open: TODAY, feed_open: TODAY, resorts: BIG_SKY }],
    log: [],
    posts: 0,
    deletes: 0,
  };
  globalThis.fetch = fakeDb(db);
  const body = await (await POST(post())).json();
  assert.equal(body.resortsOpening, 0);
  assert.match(body.skipped["big-sky"], /confirmed date/);

  db.openings = [{ resort_id: "r-big-sky", season: "2026-27", confirmed_open: null, feed_open: TODAY, resorts: BIG_SKY }];
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-26T23:30:00Z") }); // 16:30 MT
  const late = await (await POST(post())).json();
  assert.match(late.skipped["big-sky"], /after the lift day/);
  assert.deepEqual(sent, []);
  assert.equal(db.posts, 0);
});

test("feed openings: a failed dedupe read sends nothing", async (t) => {
  const POST = await setup(t);
  const sent = captureMail();
  const db: FakeDb = {
    openings: [{ resort_id: "r-big-sky", season: "2026-27", confirmed_open: null, feed_open: TODAY, resorts: BIG_SKY }],
    log: [],
    posts: 0,
    deletes: 0,
  };
  const inner = fakeDb(db);
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/powder_alert_log") && !init?.method) return new Response("{}", { status: 503 });
    return inner(input, init);
  };
  const res = await POST(post());
  assert.equal(res.status, 500);
  assert.deepEqual((await res.json()).errors, ["openings_log_query_failed"]);
  assert.deepEqual(sent, []);
  assert.equal(db.posts, 0);
});
