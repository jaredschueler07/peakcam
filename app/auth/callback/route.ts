// ─────────────────────────────────────────────────────────────
// Supabase Auth — Magic Link Callback
// Exchanges the auth code for a session and redirects back.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNext } from "@/lib/safe-redirect";
import { WELCOME_PARAM, WELCOME_SIGNUP, isFreshSignup } from "@/lib/auth-signup-welcome";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

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
      // its email, which is the real AUTH_SIGNUP_COMPLETED. Appended after
      // the origin check so it can never widen the redirect target.
      if (isFreshSignup(data.user?.created_at)) {
        target.searchParams.set(WELCOME_PARAM, WELCOME_SIGNUP);
      }
      return NextResponse.redirect(target);
    }
  }

  // Auth failed — redirect to auth page with error param
  return NextResponse.redirect(`${origin}/auth?error=auth_failed`);
}
