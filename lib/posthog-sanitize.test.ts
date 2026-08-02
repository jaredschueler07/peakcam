import { test } from "node:test";
import assert from "node:assert";
import { redactSensitiveUrl, sanitizeAnalyticsProperties } from "./posthog-sanitize";

const TOKEN = "a".repeat(64);

test("redacts the alert manage_token from a query string", () => {
  assert.strictEqual(
    redactSensitiveUrl(`https://www.peakcam.io/alerts/manage?token=${TOKEN}`),
    "https://www.peakcam.io/alerts/manage?token=[redacted]"
  );
});

test("redacts the Supabase auth code and implicit-flow tokens", () => {
  assert.strictEqual(
    redactSensitiveUrl("https://www.peakcam.io/auth/callback?code=abc123&next=/dashboard"),
    "https://www.peakcam.io/auth/callback?code=[redacted]&next=/dashboard"
  );
  assert.strictEqual(
    redactSensitiveUrl("https://www.peakcam.io/#access_token=xyz&refresh_token=pdq&type=magiclink"),
    "https://www.peakcam.io/#access_token=[redacted]&refresh_token=[redacted]&type=magiclink"
  );
});

test("leaves the path and non-sensitive parameters intact", () => {
  const url = "https://www.peakcam.io/resorts/breckenridge?utm_source=email&q=powder";
  assert.strictEqual(redactSensitiveUrl(url), url);
});

test("leaves plain anchors and bare URLs alone", () => {
  assert.strictEqual(
    redactSensitiveUrl("https://www.peakcam.io/map#main-content"),
    "https://www.peakcam.io/map#main-content"
  );
  assert.strictEqual(redactSensitiveUrl("/dashboard"), "/dashboard");
  assert.strictEqual(redactSensitiveUrl(""), "");
});

test("works on relative URLs and is case-insensitive on the parameter name", () => {
  assert.strictEqual(
    redactSensitiveUrl(`/alerts/manage?TOKEN=${TOKEN}#top`),
    "/alerts/manage?TOKEN=[redacted]#top"
  );
});

test("does not confuse a parameter that merely ends in 'token'", () => {
  assert.strictEqual(
    redactSensitiveUrl("/x?csrf_token_present=1"),
    "/x?csrf_token_present=1"
  );
});

test("sanitizes every string property, not just $current_url", () => {
  const sanitized = sanitizeAnalyticsProperties({
    $current_url: `https://www.peakcam.io/alerts/manage?token=${TOKEN}`,
    $referrer: `https://www.peakcam.io/alerts/manage?token=${TOKEN}`,
    $pathname: "/alerts/manage",
    resort_count: 3,
    nested: { untouched: true },
  });

  assert.strictEqual(sanitized.$current_url, "https://www.peakcam.io/alerts/manage?token=[redacted]");
  assert.strictEqual(sanitized.$referrer, "https://www.peakcam.io/alerts/manage?token=[redacted]");
  assert.strictEqual(sanitized.$pathname, "/alerts/manage");
  assert.strictEqual(sanitized.resort_count, 3);
  assert.deepStrictEqual(sanitized.nested, { untouched: true });
});

test("does not mutate the properties object it is given", () => {
  const original: Record<string, unknown> = { $current_url: `/m?token=${TOKEN}` };
  sanitizeAnalyticsProperties(original);
  assert.strictEqual(original.$current_url, `/m?token=${TOKEN}`);
});
