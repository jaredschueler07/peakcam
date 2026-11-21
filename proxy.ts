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
  // Runs only where a server reads the Supabase session: the signed-in pages
  // and the route handlers that act for a user. Every public page (home,
  // resorts, hubs, snow reports, sitemaps, OG images) reads the session in the
  // browser only (FavoriteButton, UserConditionsForm, lib/favorites through
  // lib/supabase-browser, which refreshes its own token), so running this
  // proxy there cost one function invocation and one Supabase getUser()
  // round-trip per page hit, bots included, and refreshed nothing a server
  // used. tests/proxy-matcher.test.ts pins which paths it covers.
  //
  // `api/v1/` and `api/mcp` stay out: the anonymous public API and MCP
  // endpoint never read a session.
  matcher: [
    "/account/:path*",
    "/auth/:path*",
    "/dashboard/:path*",
    "/favorites/:path*",
    "/alerts/:path*",
    "/admin/:path*",
    "/api/((?!v1/|mcp(?:/|$)).*)",
  ],
};
