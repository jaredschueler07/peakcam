import { test } from "node:test";
import assert from "node:assert";
import {
  getFavoriteIds,
  getFavoriteResortIds,
  isFavorited,
  toggleFavorite,
  SIGN_IN_REQUIRED,
  type FavoritesClient,
} from "./favorites";

// ─────────────────────────────────────────────────────────────
// Fake Supabase client
//
// `lib/favorites.ts` takes an optional client so these tests never touch the
// network (nor `@supabase/ssr`, which needs a browser). The fake records every
// filter and write so the tests can assert on the query that was built, the
// way lib/supabase.test.ts asserts on the request a query function issues.
// ─────────────────────────────────────────────────────────────

type Call = { method: string; args: unknown[] };

type FakeOptions = {
  /** null means "signed out". */
  user?: { id: string } | null;
  /** Row returned by the `.maybeSingle()` lookup — null means "not favorited". */
  existing?: { id: string } | null;
  /** Rows returned by an awaited select (the list query). */
  rows?: Array<{ item_id: string }>;
  selectError?: { message: string };
  insertError?: { message: string };
  deleteError?: { message: string };
};

function makeClient(options: FakeOptions = {}) {
  const {
    user = { id: "user-1" },
    existing = null,
    rows = [],
    selectError,
    insertError,
    deleteError,
  } = options;

  const calls: Call[] = [];
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });

  function builder(mode: "select" | "delete") {
    const self = {
      eq(column: string, value: unknown) {
        record(`${mode}.eq`, column, value);
        return self;
      },
      maybeSingle() {
        record("maybeSingle");
        return Promise.resolve({
          data: selectError ? null : existing,
          error: selectError ?? null,
        });
      },
      // Awaiting the builder resolves the query, like PostgREST's thenable.
      then(resolve: (value: unknown) => unknown) {
        if (mode === "delete") {
          return Promise.resolve({ data: null, error: deleteError ?? null }).then(resolve);
        }
        return Promise.resolve({
          data: selectError ? null : rows,
          error: selectError ?? null,
        }).then(resolve);
      },
    };
    return self;
  }

  const client = {
    auth: {
      getUser: async () => {
        record("getUser");
        return { data: { user } };
      },
    },
    from(table: string) {
      record("from", table);
      return {
        select(columns: string) {
          record("select", columns);
          return builder("select");
        },
        insert(row: Record<string, unknown>) {
          record("insert", row);
          return Promise.resolve({ error: insertError ?? null });
        },
        delete() {
          record("delete");
          return builder("delete");
        },
      };
    },
  } as unknown as FavoritesClient;

  return { client, calls };
}

const argsOf = (calls: Call[], method: string) =>
  calls.filter((c) => c.method === method).map((c) => c.args);

// ─────────────────────────────────────────────────────────────
// toggleFavorite
// ─────────────────────────────────────────────────────────────

test("toggleFavorite refuses when signed out and does not write", async () => {
  const { client, calls } = makeClient({ user: null });

  const result = await toggleFavorite("resort-1", "resort", client);

  assert.deepStrictEqual(result, { favorited: false, error: SIGN_IN_REQUIRED });
  assert.strictEqual(calls.some((c) => c.method === "insert"), false);
  assert.strictEqual(calls.some((c) => c.method === "delete"), false);
});

test("toggleFavorite inserts when the item is not yet favorited", async () => {
  const { client, calls } = makeClient({ existing: null });

  const result = await toggleFavorite("resort-1", "resort", client);

  assert.deepStrictEqual(result, { favorited: true });
  assert.deepStrictEqual(argsOf(calls, "insert"), [
    [{ user_id: "user-1", item_type: "resort", item_id: "resort-1" }],
  ]);
  assert.strictEqual(calls.some((c) => c.method === "delete"), false);
});

test("toggleFavorite deletes the existing row by id when already favorited", async () => {
  const { client, calls } = makeClient({ existing: { id: "fav-9" } });

  const result = await toggleFavorite("resort-1", "resort", client);

  assert.deepStrictEqual(result, { favorited: false });
  assert.deepStrictEqual(argsOf(calls, "delete.eq"), [["id", "fav-9"]]);
  assert.strictEqual(calls.some((c) => c.method === "insert"), false);
});

test("toggleFavorite reports the unchanged state when the insert fails", async () => {
  const { client } = makeClient({ existing: null, insertError: { message: "rls denied" } });

  const result = await toggleFavorite("resort-1", "resort", client);

  assert.deepStrictEqual(result, { favorited: false, error: "rls denied" });
});

test("toggleFavorite reports the unchanged state when the delete fails", async () => {
  const { client } = makeClient({
    existing: { id: "fav-9" },
    deleteError: { message: "rls denied" },
  });

  const result = await toggleFavorite("resort-1", "resort", client);

  assert.deepStrictEqual(result, { favorited: true, error: "rls denied" });
});

test("toggleFavorite defaults to the resort item type", async () => {
  const { client, calls } = makeClient({ existing: null });

  await toggleFavorite("resort-1", undefined, client);

  assert.deepStrictEqual(argsOf(calls, "insert"), [
    [{ user_id: "user-1", item_type: "resort", item_id: "resort-1" }],
  ]);
});

test("toggleFavorite scopes the lookup and the write to a cam favorite", async () => {
  const { client, calls } = makeClient({ existing: null });

  await toggleFavorite("cam-7", "cam", client);

  assert.deepStrictEqual(argsOf(calls, "select.eq"), [
    ["user_id", "user-1"],
    ["item_type", "cam"],
    ["item_id", "cam-7"],
  ]);
  assert.deepStrictEqual(argsOf(calls, "insert"), [
    [{ user_id: "user-1", item_type: "cam", item_id: "cam-7" }],
  ]);
});

// ─────────────────────────────────────────────────────────────
// isFavorited
// ─────────────────────────────────────────────────────────────

test("isFavorited is true when a row exists for the item", async () => {
  const { client } = makeClient({ existing: { id: "fav-9" } });
  assert.strictEqual(await isFavorited("resort-1", "resort", client), true);
});

test("isFavorited is false when no row exists", async () => {
  const { client } = makeClient({ existing: null });
  assert.strictEqual(await isFavorited("resort-1", "resort", client), false);
});

test("isFavorited is false when signed out, without querying", async () => {
  const { client, calls } = makeClient({ user: null });

  assert.strictEqual(await isFavorited("resort-1", "resort", client), false);
  assert.strictEqual(calls.some((c) => c.method === "from"), false);
});

test("isFavorited is false when the lookup errors", async () => {
  const { client } = makeClient({ selectError: { message: "boom" } });
  assert.strictEqual(await isFavorited("resort-1", "resort", client), false);
});

// ─────────────────────────────────────────────────────────────
// getFavoriteIds
// ─────────────────────────────────────────────────────────────

test("getFavoriteIds returns the item ids as a set", async () => {
  const { client } = makeClient({ rows: [{ item_id: "a" }, { item_id: "b" }] });

  const ids = await getFavoriteIds(undefined, client);

  assert.deepStrictEqual([...ids].sort(), ["a", "b"]);
});

test("getFavoriteIds filters by item type only when one is given", async () => {
  const withType = makeClient({ rows: [] });
  await getFavoriteIds("cam", withType.client);
  assert.deepStrictEqual(argsOf(withType.calls, "select.eq"), [
    ["user_id", "user-1"],
    ["item_type", "cam"],
  ]);

  const withoutType = makeClient({ rows: [] });
  await getFavoriteIds(undefined, withoutType.client);
  assert.deepStrictEqual(argsOf(withoutType.calls, "select.eq"), [["user_id", "user-1"]]);
});

test("getFavoriteIds is empty when signed out or when the query errors", async () => {
  const signedOut = makeClient({ user: null });
  assert.strictEqual((await getFavoriteIds(undefined, signedOut.client)).size, 0);

  const failing = makeClient({ selectError: { message: "boom" } });
  assert.strictEqual((await getFavoriteIds(undefined, failing.client)).size, 0);
});

test("getFavoriteResortIds filters to resort favorites", async () => {
  const { client, calls } = makeClient({ rows: [{ item_id: "a" }] });

  const ids = await getFavoriteResortIds(client);

  assert.deepStrictEqual([...ids], ["a"]);
  assert.deepStrictEqual(argsOf(calls, "select.eq"), [
    ["user_id", "user-1"],
    ["item_type", "resort"],
  ]);
});
