// ─────────────────────────────────────────────────────────────
// Supabase Auth — Magic Link Callback
// Exchanges the auth code for a session and redirects back.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { safeNext } from "@/lib/safe-redirect";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // safeNext() already guarantees a same-origin relative path; re-check the
      // resolved target here so the invariant is enforced at the sink that
      // depends on it, not six lines away. The URL parser strips characters
      // (tab/LF/CR) that a purely lexical check can miss.
      const target = new URL(next, origin);
      return NextResponse.redirect(target.origin === origin ? target : new URL("/", origin));
    }
  }

  // Auth failed — redirect to auth page with error param
  return NextResponse.redirect(`${origin}/auth?error=auth_failed`);
}
