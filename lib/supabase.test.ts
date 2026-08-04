import { test, before } from "node:test";
import assert from "node:assert";
import type {
  supabase as SupabaseClient,
  getResortBySlug as GetResortBySlug,
  withFetchTimeout as WithFetchTimeout,
} from "./supabase";

// `lib/supabase.ts` throws at import time if these are unset (see the file's
// top-of-module guard, which matters for real builds/deploys). The values
// here are never used for a real network call: every test below replaces
// `supabase.from` before invoking a query function. Static `import` would be
// hoisted above these assignments (and top-level `await import(...)` isn't
// supported by this project's CJS test transform), so the module is loaded
// dynamically in a `before` hook, after the env vars are set.
let supabase: typeof SupabaseClient;
let getResortBySlug: typeof GetResortBySlug;
let withFetchTimeout: typeof WithFetchTimeout;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
  ({ supabase, getResortBySlug, withFetchTimeout } = await import("./supabase"));
});

// ─────────────────────────────────────────────────────────────
// withFetchTimeout
// ─────────────────────────────────────────────────────────────

test("withFetchTimeout injects an AbortSignal when the caller supplies none", async () => {
  let seenInit: RequestInit | undefined;
  const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenInit = init;
    return new Response("ok");
  }) as typeof fetch;

  const wrapped = withFetchTimeout(fakeFetch, 8_000);
  await wrapped("https://example.com");

  assert.ok(seenInit?.signal instanceof AbortSignal);
});

test("withFetchTimeout preserves caller-supplied options (headers, method, body)", async () => {
  let seenInit: RequestInit | undefined;
  const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenInit = init;
    return new Response("ok");
  }) as typeof fetch;

  const wrapped = withFetchTimeout(fakeFetch, 8_000);
  await wrapped("https://example.com", {
    method: "POST",
    headers: { "X-Test": "1" },
    body: "payload",
  });

  assert.strictEqual(seenInit?.method, "POST");
  assert.strictEqual((seenInit?.headers as Record<string, string>)["X-Test"], "1");
  assert.strictEqual(seenInit?.body, "payload");
  assert.ok(seenInit?.signal instanceof AbortSignal);
});

test("withFetchTimeout does not clobber a caller-supplied signal", async () => {
  let seenInit: RequestInit | undefined;
  const fakeFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenInit = init;
    return new Response("ok");
  }) as typeof fetch;

  const callerController = new AbortController();
  const wrapped = withFetchTimeout(fakeFetch, 8_000);
  await wrapped("https://example.com", { signal: callerController.signal });

  assert.strictEqual(seenInit?.signal, callerController.signal);
});

test("withFetchTimeout causes the fetch to reject once the timeout elapses", async () => {
  const neverSettles = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }) as typeof fetch;

  const wrapped = withFetchTimeout(neverSettles, 10); // 10ms — fast for the test
  await assert.rejects(() => wrapped("https://example.com"));
});

type Result = { data: unknown; error: unknown };

/**
 * Minimal fake query builder: chainable methods return itself, and it is
 * thenable so `await` works whether or not the caller adds `.maybeSingle()`
 * (mirrors how `lib/supabase.ts` sometimes awaits the builder directly, e.g.
 * for the `cams` query, and sometimes calls `.maybeSingle()` first).
 */
class FakeQuery implements PromiseLike<Result> {
  constructor(private readonly result: Result) {}
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/** Stub `supabase.from` for the duration of `fn`, then restore it. */
async function withFakeFrom(
  byTable: Partial<Record<"resorts" | "latest_snow_reports" | "cams", Result>>,
  fn: () => Promise<void>
) {
  const original = supabase.from;
  // @ts-expect-error — test seam: `supabase.from` is a mutable object
  // property (not the module `const` binding), so this monkey-patch is
  // safe to do per-test and restore afterward.
  supabase.from = (table: string) => {
    const result = byTable[table as keyof typeof byTable];
    if (!result) throw new Error(`unexpected table in test: ${table}`);
    return new FakeQuery(result);
  };
  try {
    await fn();
  } finally {
    supabase.from = original;
  }
}

test("getResortBySlug throws when the resort query fails (does not treat a DB error as not-found)", async () => {
  await withFakeFrom(
    { resorts: { data: null, error: { message: "connection refused" } } },
    async () => {
      await assert.rejects(
        () => getResortBySlug("breckenridge"),
        (err: Error) => err.message === "connection refused"
      );
    }
  );
});

test("getResortBySlug returns null when the query succeeds with zero rows (genuine not-found)", async () => {
  await withFakeFrom(
    { resorts: { data: null, error: null } },
    async () => {
      const result = await getResortBySlug("no-such-resort");
      assert.strictEqual(result, null);
    }
  );
});

test("getResortBySlug throws when the snow report query fails, even though the resort was found", async () => {
  await withFakeFrom(
    {
      resorts: { data: { id: "r1", slug: "breckenridge" }, error: null },
      latest_snow_reports: { data: null, error: { message: "view unavailable" } },
      cams: { data: [], error: null },
    },
    async () => {
      await assert.rejects(
        () => getResortBySlug("breckenridge"),
        (err: Error) => err.message === "view unavailable"
      );
    }
  );
});

test("getResortBySlug throws when the cams query fails, even though the resort was found", async () => {
  await withFakeFrom(
    {
      resorts: { data: { id: "r1", slug: "breckenridge" }, error: null },
      latest_snow_reports: { data: null, error: null },
      cams: { data: null, error: { message: "cams table unavailable" } },
    },
    async () => {
      await assert.rejects(
        () => getResortBySlug("breckenridge"),
        (err: Error) => err.message === "cams table unavailable"
      );
    }
  );
});

test("getResortBySlug returns the stitched resort when every query succeeds", async () => {
  await withFakeFrom(
    {
      resorts: { data: { id: "r1", slug: "breckenridge", name: "Breckenridge" }, error: null },
      latest_snow_reports: { data: { resort_id: "r1", base_depth: 40 }, error: null },
      cams: { data: [{ id: "c1", resort_id: "r1", name: "Peak 8" }], error: null },
    },
    async () => {
      const result = await getResortBySlug("breckenridge");
      assert.ok(result);
      assert.strictEqual(result?.name, "Breckenridge");
      assert.strictEqual(result?.snow_report?.base_depth, 40);
      assert.strictEqual(result?.cams.length, 1);
    }
  );
});
