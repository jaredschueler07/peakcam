// ─────────────────────────────────────────────────────────────
// Supabase Auth — Magic Link Callback
// Exchanges the auth code for a session and redirects back.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth failed — redirect to auth page with error param
  return NextResponse.redirect(`${origin}/auth?error=auth_failed`);
}
