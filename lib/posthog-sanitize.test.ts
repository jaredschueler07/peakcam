import { test } from "node:test";
import assert from "node:assert";
import {
  redactSensitiveUrl,
  sanitizeAnalyticsProperties,
  sanitizeCaptureEvent,
} from "./posthog-sanitize";

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

test("redacts the Supabase OTP token_hash", () => {
  assert.strictEqual(
    redactSensitiveUrl("https://www.peakcam.io/auth/confirm?token_hash=pkce_abc&type=email"),
    "https://www.peakcam.io/auth/confirm?token_hash=[redacted]&type=email"
  );
});

test("the before_send hook redacts an event's properties and never drops it", () => {
  const event = {
    event: "$pageview",
    properties: {
      $current_url: `https://www.peakcam.io/alerts/manage?token=${TOKEN}`,
      $lib: "web",
    },
  };
  const out = sanitizeCaptureEvent(event);

  assert.ok(out, "the event must be returned, not dropped");
  assert.strictEqual(out.event, "$pageview");
  assert.strictEqual(
    out.properties.$current_url,
    "https://www.peakcam.io/alerts/manage?token=[redacted]"
  );
  assert.strictEqual(out.properties.$lib, "web");
  // the caller's object is left alone
  assert.strictEqual(event.properties.$current_url, `https://www.peakcam.io/alerts/manage?token=${TOKEN}`);
});

test("the before_send hook tolerates a null event and a propertyless event", () => {
  assert.strictEqual(sanitizeCaptureEvent(null), null);
  const bare: { event: string; properties?: Record<string, unknown> } = {
    event: "$pageleave",
  };
  assert.strictEqual(sanitizeCaptureEvent(bare), bare);
});

test("does not mutate the properties object it is given", () => {
  const original: Record<string, unknown> = { $current_url: `/m?token=${TOKEN}` };
  sanitizeAnalyticsProperties(original);
  assert.strictEqual(original.$current_url, `/m?token=${TOKEN}`);
});
