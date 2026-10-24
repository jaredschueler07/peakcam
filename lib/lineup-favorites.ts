// ─────────────────────────────────────────────────────────────
// Idempotent "add these favourites to my account" write.
//
// The guest lineup is saved after authentication, and the same helper serves
// signed-in visitors who press Save my mountains directly. It inserts only
// rows that are missing: an existing favourite is never toggled off, never
// deleted and never counted as new. A failure after some inserts keeps the
// rows that succeeded in `added`, so the UI can report a partial result
// truthfully and an idempotent retry finishes the rest.
//
// Two protections matter here:
// - the database's UNIQUE (user_id, item_type, item_id) makes a replay safe;
//   a 23505 race is treated as "already saved".
// - every store call has a timeout, so a hung auth/network request becomes a
//   retryable error instead of a spinner that never ends.
//
// The store interface is small enough to inject a fake in
// `lib/lineup-favorites.test.ts`.
// ─────────────────────────────────────────────────────────────

import {
  lineupItemKey,
  normalizeLineupItems,
  sanitizeLineupSource,
  type LineupItem,
  type LineupItemType,
} from "./lineup";
import { track, EVENTS } from "./analytics-events";
import { notifyFavoritesChanged } from "./favorites-events";

/** Per store call. A 200-item write is deliberately sequential, not one request. */
export const FAVORITE_STORE_TIMEOUT_MS = 15_000;

export interface FavoriteUser {
  id: string;
}

export interface FavoriteStoreError {
  code?: string;
  message?: string;
}

export interface FavoriteStore {
  getUser(): Promise<FavoriteUser | null>;
  /** Every favourite for the user, not only the requested subset — needed for first-save attribution. */
  listFavoriteItems(
    userId: string,
  ): Promise<{ items: Array<{ item_type: string; item_id: string }>; error?: FavoriteStoreError }>;
  insertFavorite(
    userId: string,
    itemType: LineupItemType,
    itemId: string,
  ): Promise<{ error?: FavoriteStoreError }>;
}

export type AddFavoritesReason = "signed_out" | "user_changed" | "invalid" | "read_failed" | "write_failed";

export interface AddFavoritesResult {
  ok: boolean;
  /** Item ids inserted by this call, in requested order. */
  added: string[];
  /** Requested ids that were already there (or raced to 23505). */
  already: string[];
  /** How many favourites the user had before this call. */
  existingCount: number;
  /** True only when this call created the user's first favourite. */
  firstSave: boolean;
  reason?: AddFavoritesReason;
  error?: string;
}

/**
 * Supabase-backed store. Imported lazily so the pure module and its tests can
 * run in Node without touching the browser client or environment variables.
 */
async function browserFavoriteStore(): Promise<FavoriteStore> {
  const { createSupabaseBrowserClient } = await import("./supabase-browser");
  const supabase = createSupabaseBrowserClient();
  return {
    async getUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user ? { id: user.id } : null;
    },
    async listFavoriteItems(userId) {
      const { data, error } = await supabase
        .from("user_favorites")
        .select("item_type,item_id")
        .eq("user_id", userId);
      if (error) return { items: [], error: { code: error.code, message: error.message } };
      return {
        items: (data ?? []).flatMap((row) =>
          typeof row.item_type === "string" && typeof row.item_id === "string"
            ? [{ item_type: row.item_type, item_id: row.item_id }]
            : [],
        ),
      };
    },
    async insertFavorite(userId, itemType, itemId) {
      const { error } = await supabase
        .from("user_favorites")
        .insert({ user_id: userId, item_type: itemType, item_id: itemId });
      return error ? { error: { code: error.code, message: error.message } } : {};
    },
  };
}

function failed(reason: AddFavoritesReason, result: Partial<AddFavoritesResult> = {}): AddFavoritesResult {
  return { ok: false, added: [], already: [], existingCount: 0, firstSave: false, reason, ...result };
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Could not save favourites";
}

/**
 * Resolve or reject within `ms`. A Supabase/network call that never settles
 * must surface as an error the visitor can retry, not an endless "Saving…".
 */
function withTimeout<T>(promise: Promise<T>, label: string, ms = FAVORITE_STORE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    // Node's unit test runner must not be kept alive by a resolved call's timer.
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Add the requested items, skipping any the user already has. The write is
 * sequential and treats a unique-constraint race (23505) as "already saved"
 * rather than an error or a duplicate `favorite_added` event.
 *
 * A returned failure can still carry inserted ids (`added`): the caller must
 * say those rows were saved and offer a retry for the rest.
 */
export async function addFavoriteItems(
  value: unknown,
  options: { store?: FavoriteStore; source?: string; timeoutMs?: number; expectedUserId?: string } = {},
): Promise<AddFavoritesResult> {
  const requested = normalizeLineupItems(value);
  if (requested.length === 0) return failed("invalid");

  const added: LineupItem[] = [];
  let existingCount = 0;
  const source = sanitizeLineupSource(options.source);
  const timeout = options.timeoutMs ?? FAVORITE_STORE_TIMEOUT_MS;
  const expectedUserId =
    typeof options.expectedUserId === "string" && options.expectedUserId.trim()
      ? options.expectedUserId.trim().toLowerCase()
      : null;

  const finishFailure = (reason: AddFavoritesReason, result: Partial<AddFavoritesResult> = {}) => {
    if (added.length > 0) notifyFavoritesChanged();
    return failed(reason, {
      added: added.map((item) => item.item_id),
      existingCount,
      ...result,
    });
  };

  try {
    const store = options.store ?? (await withTimeout(browserFavoriteStore(), "Opening the favourites store", timeout));
    const user = await withTimeout(store.getUser(), "Checking your session", timeout);
    if (!user) return failed("signed_out");
    // The account can change between the click and this call (sign-out in
    // another tab, a retry after someone else signed in). Never write a
    // previous user's pending selection into the new account — and reject
    // before reading that account's favourites or attempting any insert.
    if (expectedUserId && user.id.trim().toLowerCase() !== expectedUserId) {
      return failed("user_changed");
    }

    const listed = await withTimeout(store.listFavoriteItems(user.id), "Reading your favourites", timeout);
    if (listed.error) {
      return failed("read_failed", { error: listed.error.message ?? "Could not read favourites" });
    }

    const existing = new Set<string>();
    for (const item of listed.items) {
      const [normalized] = normalizeLineupItems([{ item_type: item.item_type, item_id: item.item_id }]);
      if (normalized) existing.add(lineupItemKey(normalized));
    }
    // First-save attribution needs the pre-write count, not just the requested slice.
    existingCount = existing.size;

    for (const item of requested) {
      const key = lineupItemKey(item);
      if (existing.has(key)) continue;

      const result = await withTimeout(
        store.insertFavorite(user.id, item.item_type, item.item_id),
        "Saving a favourite",
        timeout,
      );
      if (!result.error) {
        added.push(item);
        existing.add(key);
        track(EVENTS.FAVORITE_ADDED, { item_id: item.item_id, item_type: item.item_type, source });
        continue;
      }
      // 23505 = another tab/request inserted it between our read and write.
      // That is success from this call's point of view, with no new event.
      if (result.error.code === "23505") {
        existing.add(key);
        continue;
      }
      return finishFailure("write_failed", {
        already: requested.filter((requestedItem) => existing.has(lineupItemKey(requestedItem))).map((item) => item.item_id),
        error: result.error.message ?? "Could not save favourites",
      });
    }

    if (added.length > 0) notifyFavoritesChanged();
    return {
      ok: true,
      added: added.map((item) => item.item_id),
      already: requested
        .filter((item) => !added.some((addedItem) => lineupItemKey(addedItem) === lineupItemKey(item)))
        .map((item) => item.item_id),
      existingCount,
      firstSave: existingCount === 0 && added.length > 0,
    };
  } catch (error) {
    // Reads, auth and inserts all funnel here: a thrown provider error, a
    // timeout, or the lazy store import failing. Partial inserts are kept.
    return finishFailure("write_failed", { error: messageOf(error) });
  }
}

/** Resort-id convenience wrapper for the many call sites that save mountains. */
export async function addFavoriteResorts(
  resortIds: unknown,
  options: { store?: FavoriteStore; source?: string } = {},
): Promise<AddFavoritesResult> {
  return addFavoriteItems(resortIds, options);
}
