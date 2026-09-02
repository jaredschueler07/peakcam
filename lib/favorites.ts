// ─────────────────────────────────────────────────────────────
// Favorites — client-side API for user_favorites table
// Supports polymorphic favorites: resort, cam, region
//
// Every function takes an optional Supabase client so tests can inject a fake
// (see lib/favorites.test.ts). Production callers omit it and get the browser
// client from lib/supabase-browser.
// ─────────────────────────────────────────────────────────────

import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { FavoriteType } from "@/lib/types";
import { track, EVENTS } from "@/lib/analytics-events";

/**
 * The error message `toggleFavorite` returns when nobody is signed in.
 * Callers compare against this to decide whether to prompt for auth, so it
 * must not be re-spelled as a literal at the call sites.
 */
export const SIGN_IN_REQUIRED = "Sign in to save favorites";

type FavoriteRow = { id?: string; item_id?: string };
type QueryError = { message: string } | null;

/** The chainable slice of a PostgREST builder this module uses. */
type Builder = PromiseLike<{ data: FavoriteRow[] | null; error: QueryError }> & {
  eq(column: string, value: unknown): Builder;
  maybeSingle(): PromiseLike<{ data: FavoriteRow | null; error: QueryError }>;
};

/**
 * The slice of the Supabase client this module actually needs. Structural, so
 * a test fake only has to implement what is exercised below — and so nothing
 * here has to be typed `any`.
 */
export type FavoritesClient = {
  auth: {
    getUser(): Promise<{ data: { user: { id: string } | null } }>;
  };
  from(table: string): {
    select(columns: string): Builder;
    insert(row: Record<string, unknown>): PromiseLike<{ error: QueryError }>;
    delete(): Builder;
  };
};

function client(injected?: FavoritesClient): FavoritesClient {
  return injected ?? (createSupabaseBrowserClient() as unknown as FavoritesClient);
}

/** Fetch all favorite item IDs for the current user, optionally filtered by type. */
export async function getFavoriteIds(
  type?: FavoriteType,
  injected?: FavoritesClient
): Promise<Set<string>> {
  const supabase = client(injected);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();

  let query = supabase
    .from("user_favorites")
    .select("item_id")
    .eq("user_id", user.id);

  if (type) {
    query = query.eq("item_type", type);
  }

  const { data, error } = await query;

  if (error) {
    console.warn("[PeakCam] Could not fetch favorites:", error.message);
    return new Set();
  }
  return new Set((data ?? []).flatMap((f) => (f.item_id ? [f.item_id] : [])));
}

/** Convenience: fetch favorite resort IDs. */
export async function getFavoriteResortIds(
  injected?: FavoritesClient
): Promise<Set<string>> {
  return getFavoriteIds("resort", injected);
}

/**
 * Is one item favorited by the current user? A signed-out user gets `false`
 * rather than an error — the UI treats "not signed in" as "not favorited".
 */
export async function isFavorited(
  itemId: string,
  itemType: FavoriteType = "resort",
  injected?: FavoritesClient
): Promise<boolean> {
  const supabase = client(injected);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from("user_favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("item_type", itemType)
    .eq("item_id", itemId)
    .maybeSingle();

  if (error) {
    console.warn("[PeakCam] Could not check favorite:", error.message);
    return false;
  }
  return Boolean(data);
}

/**
 * Toggle a favorite. The returned `favorited` is the state the row is in after
 * the call, so a failed toggle reports the state the caller should keep showing.
 */
export async function toggleFavorite(
  itemId: string,
  itemType: FavoriteType = "resort",
  injected?: FavoritesClient
): Promise<{ favorited: boolean; error?: string }> {
  const supabase = client(injected);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { favorited: false, error: SIGN_IN_REQUIRED };

  // Check if already favorited
  const { data: existing } = await supabase
    .from("user_favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("item_type", itemType)
    .eq("item_id", itemId)
    .maybeSingle();

  if (existing) {
    // Remove favorite
    const { error } = await supabase
      .from("user_favorites")
      .delete()
      .eq("id", existing.id);
    if (error) return { favorited: true, error: error.message };
    track(EVENTS.FAVORITE_REMOVED, { item_id: itemId, item_type: itemType });
    return { favorited: false };
  } else {
    // Add favorite
    const { error } = await supabase
      .from("user_favorites")
      .insert({ user_id: user.id, item_type: itemType, item_id: itemId });
    if (error) return { favorited: false, error: error.message };
    track(EVENTS.FAVORITE_ADDED, { item_id: itemId, item_type: itemType });
    return { favorited: true };
  }
}
