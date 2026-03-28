// ─────────────────────────────────────────────────────────────
// Favorites — client-side API for user_favorites table
// Supports polymorphic favorites: resort, cam, region
// ─────────────────────────────────────────────────────────────

import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { FavoriteType } from "@/lib/types";

/** Fetch all favorite item IDs for the current user, optionally filtered by type. */
export async function getFavoriteIds(type?: FavoriteType): Promise<Set<string>> {
  const supabase = createSupabaseBrowserClient();
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
  return new Set(data.map((f) => f.item_id));
}

/** Convenience: fetch favorite resort IDs. */
export async function getFavoriteResortIds(): Promise<Set<string>> {
  return getFavoriteIds("resort");
}

/** Toggle a favorite. Returns the new favorited state. */
export async function toggleFavorite(
  itemId: string,
  itemType: FavoriteType = "resort"
): Promise<{ favorited: boolean; error?: string }> {
  const supabase = createSupabaseBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { favorited: false, error: "Sign in to save favorites" };

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
    return { favorited: false };
  } else {
    // Add favorite
    const { error } = await supabase
      .from("user_favorites")
      .insert({ user_id: user.id, item_type: itemType, item_id: itemId });
    if (error) return { favorited: false, error: error.message };
    return { favorited: true };
  }
}
