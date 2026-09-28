import { test } from "node:test";
import assert from "node:assert";
import { isFreshSignup, SIGNUP_WINDOW_MS } from "./auth-signup-welcome";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

test("isFreshSignup: email confirmed seconds ago is a sign-up", () => {
  assert.equal(isFreshSignup(new Date(NOW - 30_000).toISOString(), NOW), true);
});

test("isFreshSignup: boundary of the window is inclusive", () => {
  assert.equal(isFreshSignup(new Date(NOW - SIGNUP_WINDOW_MS).toISOString(), NOW), true);
  assert.equal(isFreshSignup(new Date(NOW - SIGNUP_WINDOW_MS - 1).toISOString(), NOW), false);
});

test("isFreshSignup: a slow confirmer still counts — the account's age is irrelevant", () => {
  // Signed up at 09:00, opened the email at 09:20: the callback sees
  // email_confirmed_at from seconds ago, not created_at from 20 minutes ago.
  assert.equal(isFreshSignup(new Date(NOW - 5_000).toISOString(), NOW), true);
  assert.equal(isFreshSignup(new Date(NOW - 20 * 60 * 1000).toISOString(), NOW), false);
});

test("isFreshSignup: an old confirmation re-following a link is a sign-in", () => {
  assert.equal(isFreshSignup("2026-01-01T00:00:00.000Z", NOW), false);
});

test("isFreshSignup: rejects missing, malformed and future timestamps", () => {
  assert.equal(isFreshSignup(undefined, NOW), false);
  assert.equal(isFreshSignup(null, NOW), false);
  assert.equal(isFreshSignup("", NOW), false);
  assert.equal(isFreshSignup("not a date", NOW), false);
  assert.equal(isFreshSignup(new Date(NOW + 60_000).toISOString(), NOW), false);
});
