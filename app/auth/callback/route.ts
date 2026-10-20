// ─────────────────────────────────────────────────────────────
// Supabase Auth — email link and OAuth callback
// Establishes a session from either a `token_hash` + `type` pair (the links
// our own email templates point straight at this route) or a PKCE `code`
// (links Supabase's /auth/v1/verify redirects to, and the Google sign-in
// round trip), then redirects back. A Google attempt that failed arrives as
// `?error=…&error_code=…&error_description=…` and is sent to /auth with a
// readable reason.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNext } from "@/lib/safe-redirect";
import { WELCOME_METHOD_GOOGLE, WELCOME_METHOD_PARAM, WELCOME_PARAM, WELCOME_SIGNUP, isFreshSignup } from "@/lib/auth-signup-welcome";

/**
 * Why the callback failed, for the `auth_callback_failed` event fired on
 * /auth. `missing_code_verifier` is the "opened the link in a different
 * browser" case: the PKCE verifier lives in a cookie written by the browser
 * that requested the link, so a mail app's in-app webview (or a second
 * device) arrives without it and the exchange cannot succeed — even though
 * Supabase has already confirmed the email at /auth/v1/verify. The
 * `token_hash` path below exists for exactly that cohort (code review P1-6):
 * verification happens here, server-side, with nothing tied to the
 * originating browser. `verify_failed` is that path's own failure — an
 * expired or already-used hash.
 */
type CallbackFailure = "missing_code" | "missing_code_verifier" | "exchange_failed" | "verify_failed";

// Supabase's EmailOtpType. `type` is user-controlled query input, so it is
// checked against this list rather than cast.
const TOKEN_HASH_TYPES: readonly EmailOtpType[] = ["signup", "recovery", "invite", "magiclink", "email_change", "email"];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (TOKEN_HASH_TYPES as readonly string[]).includes(value);
}

/**
 * Supabase reports an OAuth failure by redirecting here with `error` (an
 * OAuth 2 error string such as access_denied / server_error) and usually a
 * more specific `error_code` from its own catalogue (provider_disabled,
 * email_exists, flow_state_expired …). The code is the better key for a
 * message, the generic string the fallback. Both are user-controlled query
 * input, so the result is reduced to a short identifier and only ever used as
 * a lookup key in lib/auth-errors.ts — `error_description` is never echoed.
 */
function oauthFailureReason(searchParams: URLSearchParams): string | null {
  const error = searchParams.get("error");
  if (!error) return null;
  const candidate = searchParams.get("error_code") || error;
  return /^[a-z0-9_]{1,64}$/i.test(candidate) ? candidate.toLowerCase() : "unknown";
}

function hasCodeVerifierCookie(request: NextRequest): boolean {
  // @supabase/ssr stores it as `sb-<ref>-auth-token-code-verifier`.
  return request.cookies.getAll().some((c) => c.name.includes("-code-verifier"));
}

/**
 * `next` arrives in two shapes. In-app flows pass a relative path
 * ("/favorites"). The token_hash email templates pass `{{ .RedirectTo }}`,
 * which Supabase fills with the absolute `emailRedirectTo` the form sent —
 * "https://www.peakcam.io/auth/callback?next=%2Ffavorites" — or with the bare
 * Site URL when that redirect was not on the allowlist. Unwrap a same-origin
 * absolute URL to the `next` it carries (or to its own path) and run every
 * shape through safeNext(); anything off-origin collapses to "/".
 */
function resolveNext(raw: string | null, origin: string): string {
  if (raw && /^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return "/";
    }
    if (url.origin !== origin) return "/";
    if (url.pathname === "/auth/callback") return safeNext(url.searchParams.get("next"));
    return safeNext(`${url.pathname}${url.search}`);
  }
  return safeNext(raw);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = resolveNext(searchParams.get("next"), origin);
  let failure: CallbackFailure = "missing_code";
  let signedIn = false;
  let confirmedAt: string | null | undefined;
  let provider: string | undefined;

  const oauthFailure = oauthFailureReason(searchParams);
  if (oauthFailure) {
    // Google round trip came back without a code: cancelled at the account
    // chooser, provider switched off, identity conflict, expired flow state.
    // Keep `next` so a retry from /auth still lands where the visitor meant to.
    const fallback = new URL("/auth", origin);
    fallback.searchParams.set("error", "oauth_failed");
    fallback.searchParams.set("reason", oauthFailure);
    if (next !== "/") fallback.searchParams.set("next", next);
    return NextResponse.redirect(fallback);
  }

  if (tokenHash && isEmailOtpType(type)) {
    // Token-hash link from supabase/email-templates/{confirmation,recovery}.html.
    // Verifies against Supabase directly and writes the session cookies from
    // this response — no PKCE verifier, so it works in whichever browser
    // opened the email.
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      signedIn = true;
      confirmedAt = data.user?.email_confirmed_at ?? data.user?.confirmed_at;
    } else {
      failure = "verify_failed";
    }
  } else if (code) {
    // PKCE link: `{{ .ConfirmationURL }}` templates (invite, email change),
    // any confirmation/recovery email sent before the templates switched, and
    // the Google sign-in round trip (AuthForm → Supabase → Google → Supabase →
    // here). The verifier cookie was written by the browser that clicked.
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      signedIn = true;
      confirmedAt = data.user?.email_confirmed_at ?? data.user?.confirmed_at;
      const appProvider = data.user?.app_metadata?.provider;
      provider = typeof appProvider === "string" ? appProvider : undefined;
    } else {
      failure = hasCodeVerifierCookie(request) ? "exchange_failed" : "missing_code_verifier";
    }
  }

  if (signedIn) {
    // resolveNext() already guarantees a same-origin relative path; re-check
    // the resolved target here so the invariant is enforced at the sink that
    // depends on it, not twenty lines away. The URL parser strips characters
    // (tab/LF/CR) that a purely lexical check can miss.
    const resolved = new URL(next, origin);
    const target = resolved.origin === origin ? resolved : new URL("/", origin);
    // Marker for SignupWelcomeTracker: a fresh account has just confirmed its
    // email, which is the real AUTH_SIGNUP_COMPLETED. Keyed on the
    // confirmation timestamp — stamped by verification seconds before this
    // redirect — not on created_at, which is as old as the sign-up form
    // submit. Appended after the origin check so it can never widen the
    // redirect target.
    if (isFreshSignup(confirmedAt)) {
      target.searchParams.set(WELCOME_PARAM, WELCOME_SIGNUP);
      // A brand-new Google account is confirmed at creation, seconds before
      // this redirect, so it passes the same freshness test; tag the method
      // so AUTH_SIGNUP_COMPLETED can be split by sign-up path.
      if (provider === WELCOME_METHOD_GOOGLE) target.searchParams.set(WELCOME_METHOD_PARAM, WELCOME_METHOD_GOOGLE);
    }
    return NextResponse.redirect(target);
  }

  // Auth failed — redirect to auth page with error param. `reason` is for
  // analytics only (app/auth/page.tsx); the user-facing message keys off
  // `error` alone.
  const fallback = new URL("/auth", origin);
  fallback.searchParams.set("error", "auth_failed");
  fallback.searchParams.set("reason", failure);
  return NextResponse.redirect(fallback);
}
