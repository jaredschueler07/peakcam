"use client";

import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getFavoriteResortIds, toggleFavorite } from "@/lib/favorites";
import { subscribeFavoritesChanged } from "@/lib/favorites-events";
import type { User } from "@supabase/supabase-js";

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      queueMicrotask(() => {
        setFavorites(new Set());
        setLoaded(true);
      });
      return;
    }

    let cancelled = false;
    const load = () =>
      getFavoriteResortIds().then((ids) => {
        if (!cancelled) {
          setFavorites(ids);
          setLoaded(true);
        }
      });
    void load();

    // The lineup bridge can finish a save after this hook mounted (and another
    // tab can too), so reconcile from the table whenever favourites change.
    const unsubscribe = subscribeFavoritesChanged(() => {
      void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user]);

  const toggle = useCallback(
    async (resortId: string) => {
      if (!user) return { favorited: false, error: "Sign in to save favorites" as string | undefined };

      // Optimistic update
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(resortId)) {
          next.delete(resortId);
        } else {
          next.add(resortId);
        }
        return next;
      });

      const result = await toggleFavorite(resortId, "resort");

      if (result.error) {
        // Revert optimistic update
        setFavorites((prev) => {
          const next = new Set(prev);
          if (result.favorited) {
            next.add(resortId);
          } else {
            next.delete(resortId);
          }
          return next;
        });
      }

      return result;
    },
    [user]
  );

  const isFavorite = useCallback(
    (resortId: string) => favorites.has(resortId),
    [favorites]
  );

  return { favorites, user, loaded, toggle, isFavorite };
}
