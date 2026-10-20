import { test } from "node:test";
import assert from "node:assert/strict";
import { accountProfile, isAllowedAvatarUrl, signedInWithGoogle } from "./auth-profile";

test("a Google user yields the display name, avatar and provider list", () => {
  const profile = accountProfile({
    user_metadata: { full_name: "Jane Skier", name: "Jane", avatar_url: "https://lh3.googleusercontent.com/a/abc=s96-c", picture: "https://lh3.googleusercontent.com/a/abc=s96-c", email_verified: true },
    app_metadata: { provider: "google", providers: ["google"] },
  });
  assert.deepEqual(profile, { displayName: "Jane Skier", avatarUrl: "https://lh3.googleusercontent.com/a/abc=s96-c", providers: ["google"] });
  assert.equal(signedInWithGoogle(profile), true);
});

test("an email account renders nothing extra", () => {
  const profile = accountProfile({ user_metadata: { email_verified: true }, app_metadata: { provider: "email", providers: ["email"] } });
  assert.deepEqual(profile, { displayName: null, avatarUrl: null, providers: ["email"] });
  assert.equal(signedInWithGoogle(profile), false);
  assert.deepEqual(accountProfile({}), { displayName: null, avatarUrl: null, providers: [] });
});

test("an email account that linked Google lists both providers", () => {
  const profile = accountProfile({ user_metadata: { name: "  Pat  " }, app_metadata: { provider: "email", providers: ["email", "google"] } });
  assert.equal(profile.displayName, "Pat");
  assert.equal(signedInWithGoogle(profile), true);
});

test("avatars are only accepted from googleusercontent over https (matches next.config remotePatterns)", () => {
  assert.equal(isAllowedAvatarUrl("https://lh3.googleusercontent.com/a/x"), true);
  assert.equal(isAllowedAvatarUrl("https://lh5.googleusercontent.com/a/x"), true);
  assert.equal(isAllowedAvatarUrl("http://lh3.googleusercontent.com/a/x"), false);
  assert.equal(isAllowedAvatarUrl("https://evil.googleusercontent.com.attacker.tld/a"), false);
  assert.equal(isAllowedAvatarUrl("https://attacker.tld/lh3.googleusercontent.com"), false);
  assert.equal(isAllowedAvatarUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedAvatarUrl(42), false);
  assert.equal(accountProfile({ user_metadata: { avatar_url: "https://attacker.tld/a.png" } }).avatarUrl, null);
  // Falls back to `picture` when `avatar_url` is unusable.
  assert.equal(accountProfile({ user_metadata: { avatar_url: "http://x", picture: "https://lh3.googleusercontent.com/p" } }).avatarUrl, "https://lh3.googleusercontent.com/p");
});

test("display names are trimmed and capped", () => {
  assert.equal(accountProfile({ user_metadata: { full_name: "   " } }).displayName, null);
  assert.equal(accountProfile({ user_metadata: { full_name: "x".repeat(300) } }).displayName?.length, 120);
  assert.equal(accountProfile({ user_metadata: { full_name: 7 } }).displayName, null);
});
