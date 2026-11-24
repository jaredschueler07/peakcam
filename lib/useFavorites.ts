"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getFavoriteResortIds, toggleFavorite } from "@/lib/favorites";
import { subscribeFavoritesChanged } from "@/lib/favorites-events";
import type { User } from "@supabase/supabase-js";

/** Pure helper shared by `useFavorites` and unit tests to deduplicate auth-event identity checks. */
export function resolveFavoritesUserId(user: { id?: string | null } | null | undefined): string | null {
  return user?.id ?? null;
}

/**
 * Pure toggle executor with per-resort concurrency lock + rollback to the
 * pre-click state so rapid taps cannot interleave stale reversions.
 */
export async function runLockedFavoriteToggle(params: {
  resortId: string;
  userId: string | null;
  inFlight: Set<string>;
  currentFavorites: Set<string>;
  applyFavorites: (updater: (prev: Set<string>) => Set<string>) => void;
  toggleRemote: (resortId: string) => Promise<{ favorited: boolean; error?: string }>;
}): Promise<{ favorited: boolean; error?: string }> {
  const { resortId, userId, inFlight, currentFavorites, applyFavorites, toggleRemote } = params;
  if (!userId) return { favorited: false, error: "Sign in to save favorites" };
  if (inFlight.has(resortId)) {
    return { favorited: currentFavorites.has(resortId) };
  }

  const wasFavorited = currentFavorites.has(resortId);
  inFlight.add(resortId);

  applyFavorites((prev) => {
    const next = new Set(prev);
    if (wasFavorited) next.delete(resortId);
    else next.add(resortId);
    return next;
  });

  try {
    const result = await toggleRemote(resortId);
    if (result.error) {
      applyFavorites((prev) => {
        const next = new Set(prev);
        if (wasFavorited) next.add(resortId);
        else next.delete(resortId);
        return next;
      });
    } else {
      applyFavorites((prev) => {
        const next = new Set(prev);
        if (result.favorited) next.add(resortId);
        else next.delete(resortId);
        return next;
      });
    }
    return result;
  } catch {
    applyFavorites((prev) => {
      const next = new Set(prev);
      if (wasFavorited) next.add(resortId);
      else next.delete(resortId);
      return next;
    });
    return { favorited: wasFavorited, error: "Could not update favorite" };
  } finally {
    inFlight.delete(resortId);
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [user, setUser] = useState<User | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const userId = resolveFavoritesUserId(user);
  const favoritesRef = useRef(favorites);
  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!active) return;
        setUser(data.user ?? null);
        setAuthResolved(true);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setAuthResolved(true);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "TOKEN_REFRESHED") return;
      const nextUser = session?.user ?? null;
      setUser((prev) => {
        // Preserve identical user id across refocus SIGNED_IN to avoid refetching favorites.
        if (prev?.id && prev.id === nextUser?.id) return prev;
        return nextUser;
      });
      setAuthResolved(true);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authResolved) return;

    if (!userId) {
      queueMicrotask(() => {
        setFavorites(new Set());
        setLoaded(true);
      });
      return;
    }

    let cancelled = false;
    const load = () =>
      getFavoriteResortIds()
        .then((ids) => {
          if (!cancelled) {
            setFavorites(ids);
            setLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled) setLoaded(true);
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
  }, [authResolved, userId]);

  const toggle = useCallback(
    (resortId: string) =>
      runLockedFavoriteToggle({
        resortId,
        userId,
        inFlight: inFlightRef.current,
        currentFavorites: favoritesRef.current,
        applyFavorites: setFavorites,
        toggleRemote: (id) => toggleFavorite(id, "resort"),
      }),
    [userId],
  );

  const isFavorite = useCallback(
    (resortId: string) => favorites.has(resortId),
    [favorites],
  );

  return { favorites, user, loaded, toggle, isFavorite };
}
