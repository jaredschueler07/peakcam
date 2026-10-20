import { test } from "node:test";
import assert from "node:assert/strict";
import { OAUTH_PROVIDER, googleSignInOptions, isOAuthProviderEnabled, oauthRedirectTo } from "./auth-oauth";

test("oauthRedirectTo targets /auth/callback on the given origin with next encoded", () => {
  assert.equal(oauthRedirectTo("https://www.peakcam.io", "/favorites"), "https://www.peakcam.io/auth/callback?next=%2Ffavorites");
  assert.equal(oauthRedirectTo("http://localhost:3000", "/resorts/alta?tab=cams#top"), "http://localhost:3000/auth/callback?next=%2Fresorts%2Falta%3Ftab%3Dcams%23top");
});

test("oauthRedirectTo runs next through safeNext, so off-origin destinations collapse to /", () => {
  for (const bad of ["https://evil.tld", "//evil.tld", "/\\evil.tld", "/\t/evil.tld", null, undefined, ""]) {
    assert.equal(oauthRedirectTo("https://www.peakcam.io", bad), "https://www.peakcam.io/auth/callback?next=%2F", `rejected: ${String(bad)}`);
  }
});

test("oauthRedirectTo keeps the current origin, never a hard-coded host", () => {
  const preview = oauthRedirectTo("https://peakcam-git-feat-p11.vercel.app", "/account");
  assert.ok(preview.startsWith("https://peakcam-git-feat-p11.vercel.app/auth/callback?"));
  assert.throws(() => oauthRedirectTo("not an origin", "/"));
});

test("googleSignInOptions pins the provider and asks Google for the account chooser", () => {
  const options = googleSignInOptions("https://www.peakcam.io", "/dashboard");
  assert.equal(options.provider, "google");
  assert.equal(OAUTH_PROVIDER, "google");
  assert.deepEqual(options.options, {
    redirectTo: "https://www.peakcam.io/auth/callback?next=%2Fdashboard",
    queryParams: { prompt: "select_account" },
  });
});

function fakeFetch(status: number, body: unknown): typeof fetch {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers as Record<string, string>) ?? {} });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return Object.assign(impl, { calls });
}

test("isOAuthProviderEnabled reads external.google from the public settings document", async () => {
  const on = fakeFetch(200, { external: { email: true, google: true } });
  assert.equal(await isOAuthProviderEnabled("google", { supabaseUrl: "https://ref.supabase.co/", apiKey: "anon", fetch: on }), true);
  const calls = (on as unknown as { calls: Array<{ url: string; headers: Record<string, string> }> }).calls;
  assert.equal(calls[0].url, "https://ref.supabase.co/auth/v1/settings");
  assert.equal(calls[0].headers.apikey, "anon");

  const off = fakeFetch(200, { external: { email: true, google: false } });
  assert.equal(await isOAuthProviderEnabled("google", { supabaseUrl: "https://ref.supabase.co", apiKey: "anon", fetch: off }), false);
});

test("isOAuthProviderEnabled answers null (unknown) rather than blocking sign-in when the probe fails", async () => {
  assert.equal(await isOAuthProviderEnabled("google", { supabaseUrl: "https://ref.supabase.co", apiKey: "anon", fetch: fakeFetch(500, {}) }), null);
  assert.equal(await isOAuthProviderEnabled("google", { supabaseUrl: "https://ref.supabase.co", apiKey: "anon", fetch: fakeFetch(200, { nope: 1 }) }), null);
  assert.equal(await isOAuthProviderEnabled("google", { supabaseUrl: "https://ref.supabase.co", apiKey: "anon", fetch: fakeFetch(200, { external: { google: "yes" } }) }), null);
  const throwing = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  assert.equal(await isOAuthProviderEnabled("google", { supabaseUrl: "https://ref.supabase.co", apiKey: "anon", fetch: throwing }), null);
  assert.equal(await isOAuthProviderEnabled("google", { supabaseUrl: "", apiKey: "anon", fetch: fakeFetch(200, {}) }), null);
});
