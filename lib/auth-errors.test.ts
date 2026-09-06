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
