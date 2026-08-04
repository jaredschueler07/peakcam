/**
 * lib/game/server/supabase-admin.ts
 * ─────────────────────────────────
 * The fourth Supabase client, and the only one that may write `drop_in_runs`.
 *
 * CLAUDE.md documents three clients — anon (`lib/supabase.ts`), browser
 * (`lib/supabase-browser.ts`), and cookie-bound server
 * (`lib/supabase-server.ts`). None of them can insert a run: migration 015
 * deliberately defines no client INSERT policy, so the submission route needs
 * the service role, which bypasses RLS.
 *
 * ⚠️ SERVER ONLY. `SUPABASE_SERVICE_ROLE_KEY` is a full-database credential.
 * Import this from Route Handlers under `app/api/drop-in/` and nowhere else —
 * never from a Client Component, never from anything under `components/`.
 * Other route handlers in this repo build the same client inline
 * (`app/api/cam-reports/submit/route.ts`); this module exists so the Drop In
 * routes share one configured instance and one env-check error message.
 *
 * The env is read lazily inside the factory, not at module scope, so importing
 * a route for a unit test does not require production secrets.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * A service-role client with auth persistence off (there is no user session to
 * keep, and a serverless instance is shared across requests).
 *
 * @throws {Error} when the service-role env is not configured.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Drop In run submission requires NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY; see .env.local.example",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Drop the cached client. Tests only. */
export function resetSupabaseAdminClientForTests(): void {
  cached = null;
}

// ─── bytea ───────────────────────────────────────────────────
// PostgREST renders `bytea` as a `\x…` hex string and accepts the same form on
// insert. Ghost blobs are binary, so both directions go through these.

/** Bytes → the `\xdeadbeef` literal PostgREST wants for a `bytea` column. */
export function toByteaHex(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

/**
 * The inverse. Returns `null` for anything that is not a `\x`-prefixed hex
 * string of even length — a malformed blob is a corrupt row, not a crash.
 */
export function fromByteaHex(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith("\\x")) return null;
  const hex = value.slice(2);
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  return new Uint8Array(Buffer.from(hex, "hex"));
}
