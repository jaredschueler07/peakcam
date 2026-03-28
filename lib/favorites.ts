// ─────────────────────────────────────────────────────────────
// Favorites — client-side API for user_favorites table
// ─────────────────────────────────────────────────────────────

import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

/** Fetch all favorite resort IDs for the current user. */
export async function getFavoriteResortIds(): Promise<Set<string>> {
  const supabase = createSupabaseBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();

  const { data, error } = await supabase
    .from("user_favorites")
    .select("resort_id")
    .eq("user_id", user.id);

  if (error) {
    console.warn("[PeakCam] Could not fetch favorites:", error.message);
    return new Set();
  }
  return new Set(data.map((f) => f.resort_id));
}

/** Toggle a resort favorite. Returns the new favorited state. */
export async function toggleFavorite(resortId: string): Promise<{ favorited: boolean; error?: string }> {
  const supabase = createSupabaseBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { favorited: false, error: "Sign in to save favorites" };

  // Check if already favorited
  const { data: existing } = await supabase
    .from("user_favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("resort_id", resortId)
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
      .insert({ user_id: user.id, resort_id: resortId });
    if (error) return { favorited: false, error: error.message };
    return { favorited: true };
  }
}
