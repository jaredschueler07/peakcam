"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./supabase-browser";

/**
 * The signed-in user (or null) plus whether the first auth read has settled.
 * Shared by the lineup chooser and the intent restorer so neither has to
 * duplicate Header's auth subscription. `loaded` exists because "no user yet"
 * and "not asked yet" must not both render as signed out.
 */
export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let active = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!active) return;
        setUser(data.user ?? null);
        setLoaded(true);
      })
      .catch(() => {
        // A rejected initial read is not proof of a session. Settle as signed
        // out so callers stop showing "Checking account…" and can act; a later
        // auth state change (sign-in, token refresh) still updates the user.
        if (!active) return;
        setUser(null);
        setLoaded(true);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoaded(true);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return { user, loaded };
}
