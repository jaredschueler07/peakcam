// ─────────────────────────────────────────────────────────────
// Supabase Auth Proxy (Next.js 16 convention)
// Refreshes the user's session on every request and redirects
// unauthenticated users away from protected routes.
// ─────────────────────────────────────────────────────────────

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes that require authentication — redirect to /auth if not signed in
const PROTECTED_PATHS = ["/favorites", "/profile"];

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
  const { data: { user } } = await supabase.auth.getUser();

  // Redirect unauthenticated users away from protected routes
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p));
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
