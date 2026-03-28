"use client";

import { useState, useEffect, useCallback } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getFavoriteResortIds, toggleFavorite } from "@/lib/favorites";
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
      // No user — reset outside the effect via microtask to avoid
      // synchronous setState-in-effect lint warning.
      queueMicrotask(() => {
        setFavorites(new Set());
        setLoaded(true);
      });
      return;
    }

    let cancelled = false;
    getFavoriteResortIds().then((ids) => {
      if (!cancelled) {
        setFavorites(ids);
        setLoaded(true);
      }
    });
    return () => { cancelled = true; };
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

      const result = await toggleFavorite(resortId);

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
