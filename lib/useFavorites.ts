"use client";

import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

interface UseFavoritesReturn {
  favoriteIds: Set<string>;
  userId: string | null;
  loading: boolean;
  toggleFavorite: (resortId: string) => Promise<{ needsAuth: boolean }>;
}

export function useFavorites(): UseFavoritesReturn {
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function loadFavorites(uid: string) {
      const { data } = await supabase
        .from("user_favorites")
        .select("resort_id")
        .eq("user_id", uid);
      setFavoriteIds(new Set(data?.map((f) => f.resort_id) ?? []));
      setLoading(false);
    }

    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        loadFavorites(uid);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      const uid = session?.user?.id ?? null;
      setUserId(uid);
      if (uid) {
        loadFavorites(uid);
      } else {
        setFavoriteIds(new Set());
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const toggleFavorite = useCallback(async (resortId: string): Promise<{ needsAuth: boolean }> => {
    if (!userId) return { needsAuth: true };

    const isFav = favoriteIds.has(resortId);

    // Optimistic update
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(resortId);
      else next.add(resortId);
      return next;
    });

    const supabase = createSupabaseBrowserClient();

    if (isFav) {
      const { error } = await supabase
        .from("user_favorites")
        .delete()
        .eq("user_id", userId)
        .eq("resort_id", resortId);

      if (error) {
        // Revert on error
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.add(resortId);
          return next;
        });
      }
    } else {
      const { error } = await supabase
        .from("user_favorites")
        .insert({ user_id: userId, resort_id: resortId });

      if (error) {
        // Revert on error
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          next.delete(resortId);
          return next;
        });
      }
    }

    return { needsAuth: false };
  }, [userId, favoriteIds]);

  return { favoriteIds, userId, loading, toggleFavorite };
}
