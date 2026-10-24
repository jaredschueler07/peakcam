"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { track, EVENTS } from "@/lib/analytics-events";
import { WELCOME_METHOD_GOOGLE, WELCOME_METHOD_PARAM, WELCOME_PARAM, WELCOME_SIGNUP } from "@/lib/auth-signup-welcome";
import { readLineupAttribution } from "@/lib/lineup";

/**
 * Consumes the `?welcome=signup` marker that /auth/callback appends when a
 * brand-new account confirms its email (or is created by Google sign-in),
 * fires AUTH_SIGNUP_COMPLETED exactly once, and strips the marker from the
 * URL so a reload or share cannot re-fire it. Must render under a Suspense
 * boundary (useSearchParams).
 */
export function SignupWelcomeTracker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (!searchParams || !pathname) return;
    if (searchParams.get(WELCOME_PARAM) !== WELCOME_SIGNUP) return;
    fired.current = true;

    const viaGoogle = searchParams.get(WELCOME_METHOD_PARAM) === WELCOME_METHOD_GOOGLE;
    // Read before LineupIntentBridge (a sibling mounted after this tracker)
    // consumes the pending intent. Only a bounded source/count rides along;
    // the event still fires solely for a freshly confirmed account.
    const lineup = readLineupAttribution();
    track(
      EVENTS.AUTH_SIGNUP_COMPLETED,
      viaGoogle ? { confirmation: "oauth", method: "google", ...(lineup ?? {}) } : { confirmation: "email", ...(lineup ?? {}) },
    );

    const rest = new URLSearchParams(searchParams.toString());
    rest.delete(WELCOME_PARAM);
    rest.delete(WELCOME_METHOD_PARAM);
    const query = rest.toString();
    const destination = query ? `${pathname}?${query}` : pathname;
    router.replace(`${destination}${window.location.hash}`, { scroll: false });
  }, [searchParams, pathname, router]);

  return null;
}
