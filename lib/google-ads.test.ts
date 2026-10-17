import { test } from "node:test";
import assert from "node:assert/strict";
import { googleAdsId, initializeGoogleAds, trackGoogleConversion, trackGoogleSignup } from "./google-ads";

function withAds(run: () => void, browser: object | undefined = {}) {
  const global = globalThis as { window?: object };
  const previousWindow = global.window;
  const config = {
    NEXT_PUBLIC_GOOGLE_ADS_ID: "AW-123456",
    NEXT_PUBLIC_GOOGLE_ADS_ALERT_LABEL: "alerts_1",
    NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL: "accounts_2",
  };
  const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
  global.window = browser;
  Object.assign(process.env, config);
  try { run(); } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("early Google conversions queue after config; signup and alerts stay distinct", () => withAds(() => {
  trackGoogleSignup(); // Before the dynamically loaded tag mounts.
  initializeGoogleAds(); // Mount/StrictMode must not reset the queue or config.
  initializeGoogleAds();
  trackGoogleConversion();
  const calls = window.dataLayer!.map((call) => Array.from(call as IArguments));
  assert.equal(calls.length, 4);
  assert.equal(calls[0][0], "js");
  assert.ok(calls[0][1] instanceof Date);
  assert.deepEqual(calls.slice(1), [
    ["config", "AW-123456"],
    ["event", "conversion", { send_to: "AW-123456/accounts_2" }],
    ["event", "conversion", { send_to: "AW-123456/alerts_1" }],
  ]);
}));

test("an unset signup label never reports a powder-alert conversion", () => withAds(() => {
  delete process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL;
  trackGoogleSignup();
  assert.equal(window.dataLayer, undefined);
}));

test("invalid or missing configuration does not install a tag queue", () => withAds(() => {
  trackGoogleConversion("bad/label");
  assert.equal(window.dataLayer, undefined);
  process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "AW-123<script>";
  assert.equal(googleAdsId(), undefined);
  trackGoogleConversion("valid-label");
  initializeGoogleAds();
  delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  initializeGoogleAds();
  assert.equal(window.dataLayer, undefined);
}));

test("preserves an existing Google tag and data layer", () => {
  const calls: unknown[][] = [];
  const gtag = (...args: unknown[]) => { calls.push(args); };
  const dataLayer = [{ existing: true }];
  withAds(() => {
    trackGoogleConversion("accounts_2");
    assert.equal(window.gtag, gtag);
    assert.equal(window.dataLayer, dataLayer);
    assert.deepEqual(calls[2], ["event", "conversion", { send_to: "AW-123456/accounts_2" }]);
  }, { gtag, dataLayer });
});

test("Google Ads is safe on the server", () => withAds(() => {
  delete (globalThis as { window?: object }).window;
  initializeGoogleAds();
  trackGoogleConversion("accounts_2");
}));
