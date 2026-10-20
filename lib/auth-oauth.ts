// ─────────────────────────────────────────────────────────────
// Google sign-in helpers (parity plan P11).
// Pure builders for the `signInWithOAuth` call plus a side-effect-free probe
// of the Supabase Auth settings endpoint. The browser client never contacts
// Supabase before it navigates: with the provider switched off, the
// /auth/v1/authorize URL answers a raw JSON 400 ("Unsupported provider") as a
// top-level page, so the form asks /auth/v1/settings first and shows a
// readable error instead of that page.
// ─────────────────────────────────────────────────────────────

import { safeNext } from "./safe-redirect";

export const OAUTH_PROVIDER = "google" as const;
export type OAuthProvider = typeof OAUTH_PROVIDER;

/**
 * `redirectTo` for the OAuth round trip: `${origin}/auth/callback?next=…`.
 * `next` goes through safeNext() here (and again in the callback), so an
 * off-origin destination collapses to "/" before it is ever sent to Supabase.
 * `origin` is the current page's origin; Supabase only honours it when it is
 * on the project's redirect allowlist, otherwise the Site URL is used.
 */
export function oauthRedirectTo(origin: string, next: string | null | undefined): string {
  const url = new URL("/auth/callback", origin);
  url.searchParams.set("next", safeNext(next));
  return url.href;
}

/** The exact argument for `supabase.auth.signInWithOAuth` for Google. */
export function googleSignInOptions(origin: string, next: string | null | undefined) {
  return {
    provider: OAUTH_PROVIDER,
    options: {
      redirectTo: oauthRedirectTo(origin, next),
      // Always show the account chooser: a visitor with several Google
      // accounts should pick, not be signed in with whichever was last used.
      queryParams: { prompt: "select_account" },
    },
  } as const;
}

export type ProviderProbe = {
  supabaseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
};

/**
 * Whether Supabase Auth has `provider` switched on, from the public
 * `/auth/v1/settings` document (`external.<provider>`). Returns `null` when
 * the probe cannot be read (network error, non-JSON reply), so the caller can
 * fall through to the redirect rather than block sign-in on a flaky check.
 */
export async function isOAuthProviderEnabled(provider: OAuthProvider, probe: ProviderProbe): Promise<boolean | null> {
  const doFetch = probe.fetch ?? (typeof fetch === "function" ? fetch : undefined);
  if (!doFetch || !probe.supabaseUrl || !probe.apiKey) return null;
  try {
    const response = await doFetch(`${probe.supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: probe.apiKey },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const external = typeof body === "object" && body !== null && "external" in body ? (body as { external?: unknown }).external : undefined;
    if (typeof external !== "object" || external === null) return null;
    const flag = (external as Record<string, unknown>)[provider];
    return typeof flag === "boolean" ? flag : null;
  } catch {
    return null;
  }
}
