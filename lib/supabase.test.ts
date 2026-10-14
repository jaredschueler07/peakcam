import { test, before } from "node:test";
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  supabase as SupabaseClient,
  getAllResorts as GetAllResorts,
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
let getAllResorts: typeof GetAllResorts;
let getResortBySlug: typeof GetResortBySlug;
let withFetchTimeout: typeof WithFetchTimeout;

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
  // Next normally supplies this runtime global. Unit tests run outside the
  // Next server, so provide Node's equivalent before importing next/cache.
  (globalThis as typeof globalThis & { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage ??= AsyncLocalStorage;
  ({ supabase, getAllResorts, getResortBySlug, withFetchTimeout } = await import("./supabase"));
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
  // AbortSignal.timeout uses an unreferenced timer in Node. The mocked fetch
  // has no socket to keep the loop alive as a real request would.
  const keepAlive = setInterval(() => {}, 1000);
  try { await assert.rejects(() => wrapped("https://example.com")); }
  finally { clearInterval(keepAlive); }
});

type Result = { data: unknown; error: unknown };

/**
 * Minimal fake query builder: chainable methods return itself, and it is
 * thenable so `await` works whether or not the caller adds `.maybeSingle()`
 * (mirrors how `lib/supabase.ts` sometimes awaits the builder directly, e.g.
 * for the `cams` query, and sometimes calls `.maybeSingle()` first).
 */
class FakeQuery implements PromiseLike<Result> {
  constructor(private readonly result: Result, private readonly delayMs = 0) {}
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  in() { return this; }
  private async resolve() {
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return this.result;
  }
  maybeSingle() { return this.resolve(); }
  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    return this.resolve().then(onfulfilled, onrejected);
  }
}

type CatalogTable = "resorts" | "latest_snow_reports" | "cams";

/** Stub `supabase.from` for the duration of `fn`, then restore it. */
async function withFakeFrom(
  byTable: Partial<Record<CatalogTable, Result>>,
  fn: () => Promise<void>,
  options: { delayMs?: number; onQuery?: (table: CatalogTable) => void } = {},
) {
  const original = supabase.from;
  // @ts-expect-error — test seam: `supabase.from` is a mutable object
  // property (not the module `const` binding), so this monkey-patch is
  // safe to do per-test and restore afterward.
  supabase.from = (table: string) => {
    const result = byTable[table as keyof typeof byTable];
    if (!result) throw new Error(`unexpected table in test: ${table}`);
    options.onQuery?.(table as CatalogTable);
    return new FakeQuery(result, options.delayMs);
  };
  try {
    await fn();
  } finally {
    supabase.from = original;
  }
}

type CachedFetchValue = {
  kind: string;
  data: { body?: string; headers: Record<string, string>; status: number; url: string };
  revalidate: number;
};

/** Minimal Next incremental-cache seam for exercising `unstable_cache` in node:test. */
class FakeIncrementalCache {
  private entries = new Map<string, { value: CachedFetchValue; expiresAt: number }>();
  writes = 0;
  isOnDemandRevalidate = false;

  async generateCacheKey(key: string) { return key; }
  async get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return { value: entry.value, isStale: Date.now() >= entry.expiresAt };
  }
  async set(key: string, value: CachedFetchValue) {
    this.writes += 1;
    this.entries.set(key, { value, expiresAt: Date.now() + value.revalidate * 1000 });
  }
  expireAll() {
    for (const entry of this.entries.values()) entry.expiresAt = 0;
  }
  get onlyEntry() {
    return this.entries.values().next().value as { value: CachedFetchValue; expiresAt: number } | undefined;
  }
}

type GlobalWithIncrementalCache = typeof globalThis & { __incrementalCache?: unknown };
const globalWithIncrementalCache = globalThis as GlobalWithIncrementalCache;

async function withIncrementalCache(cache: FakeIncrementalCache, fn: () => Promise<void>) {
  const hadPrevious = Object.prototype.hasOwnProperty.call(globalWithIncrementalCache, "__incrementalCache");
  const previous = globalWithIncrementalCache.__incrementalCache;
  globalWithIncrementalCache.__incrementalCache = cache;
  try {
    await fn();
  } finally {
    if (hadPrevious) globalWithIncrementalCache.__incrementalCache = previous;
    else delete globalWithIncrementalCache.__incrementalCache;
  }
}

function successfulCatalog(): Record<CatalogTable, Result> {
  return {
    resorts: {
      data: [{ id: "r1", name: "Breckenridge", slug: "breckenridge", state: "CO", country: "US", region: "Colorado Rockies", lat: 39.48, lng: -106.07, cond_rating: "good", is_active: true }],
      error: null,
    },
    latest_snow_reports: {
      data: [{ resort_id: "r1", base_depth: 40, updated_at: "2026-10-02T12:00:00Z" }],
      error: null,
    },
    cams: {
      data: [{ id: "c1", resort_id: "r1", name: "Peak 8", embed_type: "youtube", youtube_id: "abcdefghijk", is_active: true }],
      error: null,
    },
  };
}

test("getAllResorts coalesces concurrent cold loads and reuses the one-hour catalog cache", async () => {
  const incrementalCache = new FakeIncrementalCache();
  const rows = successfulCatalog();
  const queryCounts: Record<CatalogTable, number> = { resorts: 0, latest_snow_reports: 0, cams: 0 };

  await withIncrementalCache(incrementalCache, async () => {
    await withFakeFrom(rows, async () => {
      const [first, second, third] = await Promise.all([
        getAllResorts(),
        getAllResorts(),
        getAllResorts(),
      ]);
      assert.deepStrictEqual(first, second);
      assert.deepStrictEqual(second, third);
      assert.strictEqual(first[0]?.snow_report?.base_depth, 40);
      assert.strictEqual(first[0]?.cams.length, 1);

      // A later route request reads the shared result without hitting PostgREST.
      const cached = await getAllResorts();
      assert.deepStrictEqual(cached, first);
      assert.strictEqual(incrementalCache.onlyEntry?.value.revalidate, 3600);
    }, {
      delayMs: 10,
      onQuery: (table) => { queryCounts[table] += 1; },
    });
  });

  assert.deepStrictEqual(queryCounts, { resorts: 1, latest_snow_reports: 1, cams: 1 });
});

test("getAllResorts refreshes a successful expired entry", async () => {
  const incrementalCache = new FakeIncrementalCache();
  const rows = successfulCatalog();
  const queryCounts: Record<CatalogTable, number> = { resorts: 0, latest_snow_reports: 0, cams: 0 };

  await withIncrementalCache(incrementalCache, async () => {
    await withFakeFrom(rows, async () => {
      const first = await getAllResorts();
      assert.strictEqual(first[0]?.name, "Breckenridge");

      incrementalCache.expireAll();
      (rows.resorts.data as Array<{ name: string }>)[0].name = "Updated Breckenridge";
      const refreshed = await getAllResorts();
      assert.strictEqual(refreshed[0]?.name, "Updated Breckenridge");
      assert.strictEqual(queryCounts.resorts, 2);
    }, {
      onQuery: (table) => { queryCounts[table] += 1; },
    });
  });
});

test("getAllResorts does not cache a failed cold catalog read and retries it later", async () => {
  const incrementalCache = new FakeIncrementalCache();
  const rows = successfulCatalog();
  rows.latest_snow_reports = { data: null, error: { message: "view unavailable" } };
  const queryCounts: Record<CatalogTable, number> = { resorts: 0, latest_snow_reports: 0, cams: 0 };

  await withIncrementalCache(incrementalCache, async () => {
    await withFakeFrom(rows, async () => {
      await assert.rejects(
        () => getAllResorts(),
        (error: Error) => error.message === "view unavailable",
      );
      assert.strictEqual(incrementalCache.writes, 0, "a failed cold load must not write an error/partial result");
    }, {
      onQuery: (table) => { queryCounts[table] += 1; },
    });

    rows.latest_snow_reports = { data: [{ resort_id: "r1", base_depth: 44 }], error: null };
    await withFakeFrom(rows, async () => {
      const retried = await getAllResorts();
      assert.strictEqual(retried[0]?.snow_report?.base_depth, 44);
      assert.strictEqual(queryCounts.resorts, 2, "a failed cold load is not memoized; a later request retries");
      assert.strictEqual(incrementalCache.writes, 1);
    }, {
      onQuery: (table) => { queryCounts[table] += 1; },
    });
  });
});

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
