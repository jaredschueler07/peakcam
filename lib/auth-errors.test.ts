import { test } from "node:test";
import assert from "node:assert/strict";
import { authErrorMessage } from "./auth-errors";

test("authentication errors never reflect backend messages or account details", () => {
  assert.equal(authErrorMessage({ message: "sensitive@example.com database details" }), "We couldn’t complete that request. Please try again in a moment.");
  assert.equal(authErrorMessage(new Error("private transport error")), authErrorMessage(null));
});
test("expired credentials and rate limits have distinct recovery instructions", () => {
  assert.match(authErrorMessage({ code: "otp_expired" }), /Request a new one/);
  assert.match(authErrorMessage({ code: "over_email_send_rate_limit" }), /wait a few minutes/);
  assert.match(authErrorMessage({ code: "email_not_confirmed" }), /resend/);
});
test("Google sign-in failures are readable and name the way out", () => {
  const notEnabled = authErrorMessage({ code: "google_not_enabled" });
  assert.match(notEnabled, /Google sign-in is not enabled yet/);
  assert.equal(authErrorMessage({ code: "provider_disabled" }), notEnabled);
  assert.equal(authErrorMessage({ code: "oauth_provider_not_supported" }), notEnabled);
  assert.match(authErrorMessage({ code: "access_denied" }), /cancelled/);
  const exists = authErrorMessage({ code: "email_exists" });
  assert.match(exists, /already exists/);
  assert.equal(authErrorMessage({ code: "identity_already_exists" }), exists);
  assert.equal(authErrorMessage({ code: "user_already_exists" }), exists);
  assert.match(authErrorMessage({ code: "flow_state_expired" }), /different browser/);
  assert.match(authErrorMessage({ code: "signup_disabled" }), /paused/);
  // Supabase's generic OAuth strings and anything unknown fall back to the default.
  assert.equal(authErrorMessage({ code: "server_error" }), authErrorMessage(null));
  assert.equal(authErrorMessage({ code: "unknown" }), authErrorMessage(null));
});
