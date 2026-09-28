"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import type { Session } from "@supabase/supabase-js";
import { whenPostHogReady } from "./analytics-events";

/**
 * Keeps PostHog's person in step with the Supabase session so funnels can
 * stitch the anonymous browsing that preceded a sign-up to the account.
 *
 * - SIGNED_IN (and INITIAL_SESSION with a session, i.e. a returning user on a
 *   cold load) → identify(user.id). Only the email *domain* is set as a person
 *   property; the address itself never reaches analytics. This is what the
 *   /about privacy copy discloses ("linked to your account ID, never your
 *   email address") — keep the two in step.
 * - SIGNED_OUT → reset(), so the next visitor on this device is not attributed
 *   to the previous account.
 *
 * Mounted inside PostHogProvider, so it never renders without a key. The
 * auth callback can fire before posthog.init() on a cold load, hence
 * whenPostHogReady().
 *
 * The Supabase browser client is imported lazily, inside the effect: this
 * component sits in the root layout, and a static import would put
 * @supabase/ssr + supabase-js into the shared client bundle of every route —
 * including /map, /methodology and /alerts/manage, which render no auth UI at
 * all. The dynamic import keeps that code in its own chunk, fetched after
 * hydration instead of on the critical path, and shared with the routes that
 * already load it (Header, FavoriteButton).
 */
export function PostHogAuthSync() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    let cancelled = false;
    let cancelPending: (() => void) | null = null;
    let subscription: { unsubscribe(): void } | null = null;

    const identify = (session: Session) => {
      const email_domain = session.user.email?.split("@")[1]?.toLowerCase();
      cancelPending?.();
      cancelPending = whenPostHogReady(() => {
        posthog.identify(session.user.id, email_domain ? { email_domain } : undefined);
      });
    };

    import("./supabase-browser").then(({ createSupabaseBrowserClient }) => {
      if (cancelled) return;
      const supabase = createSupabaseBrowserClient();
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
          identify(session);
        } else if (event === "SIGNED_OUT") {
          cancelPending?.();
          cancelPending = whenPostHogReady(() => posthog.reset());
        }
      });
      subscription = data.subscription;
    });

    return () => {
      cancelled = true;
      cancelPending?.();
      subscription?.unsubscribe();
    };
  }, []);

  return null;
}
