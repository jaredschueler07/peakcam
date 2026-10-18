// ─────────────────────────────────────────────────────────────
// Supabase Auth Proxy (Next.js 16 convention)
// Refreshes the user's session on every request so Server
// Components always have a valid session from cookies.
// ─────────────────────────────────────────────────────────────

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — do not remove this line
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    // `drop-in` is excluded because the game's static assets (a ~100KB HTML file
    // and the three.js bundle) otherwise get a full Supabase getUser() round-trip
    // ahead of the filesystem check on every single game load.
    // `api/v1/` and `api/mcp` are the anonymous public API and MCP endpoint:
    // they never read a session, and the getUser() round-trip would otherwise
    // sit in front of every cached JSON response (and every agent tool call).
    // `ask` is the NLWeb answer endpoint: anonymous like /api/v1/ask.
    "/((?!_next/static|_next/image|favicon.ico|drop-in/|api/v1/|api/mcp(?:/|$)|ask(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
