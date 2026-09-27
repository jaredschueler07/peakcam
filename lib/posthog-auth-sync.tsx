"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./supabase-browser";
import { whenPostHogReady } from "./analytics-events";

/**
 * Keeps PostHog's person in step with the Supabase session so funnels can
 * stitch the anonymous browsing that preceded a sign-up to the account.
 *
 * - SIGNED_IN (and INITIAL_SESSION with a session, i.e. a returning user on a
 *   cold load) → identify(user.id). Only the email *domain* is set as a person
 *   property; the address itself never reaches analytics, matching the
 *   privacy copy on /about.
 * - SIGNED_OUT → reset(), so the next visitor on this device is not attributed
 *   to the previous account.
 *
 * Mounted inside PostHogProvider, so it never renders without a key. The
 * auth callback can fire before posthog.init() on a cold load, hence
 * whenPostHogReady().
 */
export function PostHogAuthSync() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    const supabase = createSupabaseBrowserClient();
    let cancelPending: (() => void) | null = null;

    const identify = (session: Session) => {
      const email_domain = session.user.email?.split("@")[1]?.toLowerCase();
      cancelPending?.();
      cancelPending = whenPostHogReady(() => {
        posthog.identify(session.user.id, email_domain ? { email_domain } : undefined);
      });
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        identify(session);
      } else if (event === "SIGNED_OUT") {
        cancelPending?.();
        cancelPending = whenPostHogReady(() => posthog.reset());
      }
    });

    return () => {
      cancelPending?.();
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
