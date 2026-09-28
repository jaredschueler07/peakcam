// ─────────────────────────────────────────────────────────────
// Supabase Auth — Magic Link Callback
// Exchanges the auth code for a session and redirects back.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNext } from "@/lib/safe-redirect";
import { WELCOME_PARAM, WELCOME_SIGNUP, isFreshSignup } from "@/lib/auth-signup-welcome";

/**
 * Why a code exchange failed, for the `auth_callback_failed` event fired on
 * /auth. `missing_code_verifier` is the "opened the link in a different
 * browser" case: the PKCE verifier lives in a cookie written by the browser
 * that requested the link, so a mail app's in-app webview (or a second
 * device) arrives without it and the exchange cannot succeed — even though
 * Supabase has already confirmed the email at /auth/v1/verify. That cohort
 * therefore never reaches the `?welcome=signup` landing below.
 */
type CallbackFailure = "missing_code" | "missing_code_verifier" | "exchange_failed";

function hasCodeVerifierCookie(request: NextRequest): boolean {
  // @supabase/ssr stores it as `sb-<ref>-auth-token-code-verifier`.
  return request.cookies.getAll().some((c) => c.name.includes("-code-verifier"));
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  let failure: CallbackFailure = "missing_code";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // safeNext() already guarantees a same-origin relative path; re-check the
      // resolved target here so the invariant is enforced at the sink that
      // depends on it, not six lines away. The URL parser strips characters
      // (tab/LF/CR) that a purely lexical check can miss.
      const resolved = new URL(next, origin);
      const target = resolved.origin === origin ? resolved : new URL("/", origin);
      // Marker for SignupWelcomeTracker: a fresh account has just confirmed
      // its email, which is the real AUTH_SIGNUP_COMPLETED. Keyed on the
      // confirmation timestamp — stamped by the /verify hop seconds before
      // this request — not on created_at, which is as old as the sign-up form
      // submit. Appended after the origin check so it can never widen the
      // redirect target.
      if (isFreshSignup(data.user?.email_confirmed_at ?? data.user?.confirmed_at)) {
        target.searchParams.set(WELCOME_PARAM, WELCOME_SIGNUP);
      }
      return NextResponse.redirect(target);
    }
    failure = hasCodeVerifierCookie(request) ? "exchange_failed" : "missing_code_verifier";
  }

  // Auth failed — redirect to auth page with error param. `reason` is for
  // analytics only (app/auth/page.tsx); the user-facing message keys off
  // `error` alone.
  const fallback = new URL("/auth", origin);
  fallback.searchParams.set("error", "auth_failed");
  fallback.searchParams.set("reason", failure);
  return NextResponse.redirect(fallback);
}
