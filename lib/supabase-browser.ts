// ─────────────────────────────────────────────────────────────
// Supabase browser client — with cookie-based auth (SSR-safe)
// Use this in Client Components for auth state and user data.
// ─────────────────────────────────────────────────────────────

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
