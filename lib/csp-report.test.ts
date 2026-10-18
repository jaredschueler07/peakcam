import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CSP_REPORT_MAX_VIOLATIONS,
  blockedHostOf,
  buildPostHogCapturePayload,
  documentPathOf,
  forwardCspViolations,
  isCspReportContentType,
  parseCspReports,
  postHogTargetFromEnv,
  shouldSampleCspReport,
} from "./csp-report";

test("accepts the two browser report media types, with or without parameters", () => {
  assert.equal(isCspReportContentType("application/csp-report"), true);
  assert.equal(isCspReportContentType("application/csp-report; charset=utf-8"), true);
  assert.equal(isCspReportContentType("Application/Reports+JSON"), true);
  assert.equal(isCspReportContentType("application/json"), false);
  assert.equal(isCspReportContentType("text/plain"), false);
  assert.equal(isCspReportContentType(null), false);
  assert.equal(isCspReportContentType(undefined), false);
});

test("samples exactly 1 in 20 over a uniform sweep and is deterministic at the edges", () => {
  assert.equal(shouldSampleCspReport(0), true);
  assert.equal(shouldSampleCspReport(0.049), true);
  assert.equal(shouldSampleCspReport(0.05), false);
  assert.equal(shouldSampleCspReport(0.999), false);
  let kept = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) if (shouldSampleCspReport(i / n)) kept += 1;
  assert.equal(kept, n / 20);
  assert.equal(shouldSampleCspReport(0.5, 1), true);
  assert.equal(shouldSampleCspReport(0.5, 0), false);
});

test("parses a legacy report-uri body and strips the query string", () => {
  const violations = parseCspReports({
    "csp-report": {
      "document-uri": "https://www.peakcam.io/alerts/manage?token=secret-value#frag",
      "referrer": "",
      "violated-directive": "script-src-elem 'self' https://us.i.posthog.com",
      "effective-directive": "script-src-elem",
      "original-policy": "default-src 'self'; script-src-elem 'self'",
      "disposition": "report",
      "blocked-uri": "https://evil.example.com/x.js?cb=123",
      "status-code": 200,
    },
  });
  assert.deepEqual(violations, [{
    directive: "script-src-elem",
    blockedHost: "evil.example.com",
    documentPath: "/alerts/manage",
    disposition: "report",
  }]);
  assert.equal(JSON.stringify(violations).includes("secret-value"), false);
});

test("parses a Reporting API array and ignores non-CSP entries", () => {
  const violations = parseCspReports([
    { type: "deprecation", url: "https://www.peakcam.io/", body: { id: "x" } },
    {
      type: "csp-violation",
      age: 10,
      url: "https://www.peakcam.io/resorts/breckenridge?utm_source=mail",
      body: {
        documentURL: "https://www.peakcam.io/resorts/breckenridge?utm_source=mail",
        effectiveDirective: "form-action",
        blockedURL: "https://phish.example.net/login",
        disposition: "enforce",
        statusCode: 200,
      },
    },
    {
      type: "csp-violation",
      url: "https://www.peakcam.io/map",
      body: { effectiveDirective: "script-src", blockedURL: "inline", disposition: "report" },
    },
  ]);
  assert.deepEqual(violations, [
    { directive: "form-action", blockedHost: "phish.example.net", documentPath: "/resorts/breckenridge", disposition: "enforce" },
    { directive: "script-src", blockedHost: "inline", documentPath: "/map", disposition: "report" },
  ]);
});

test("malformed input yields no violations instead of throwing", () => {
  for (const body of [null, undefined, 42, "string", [], {}, { "csp-report": null }, { "csp-report": "x" }, [1, "a", null], { type: "csp-violation" }]) {
    assert.deepEqual(parseCspReports(body), []);
  }
});

test("caps the number of violations taken from one request", () => {
  const entry = { type: "csp-violation", url: "https://www.peakcam.io/", body: { effectiveDirective: "img-src", blockedURL: "https://cdn.example.com/a.png" } };
  const violations = parseCspReports(Array.from({ length: CSP_REPORT_MAX_VIOLATIONS + 15 }, () => entry));
  assert.equal(violations.length, CSP_REPORT_MAX_VIOLATIONS);
});

test("blocked URIs reduce to a host, a scheme, or a keyword — never a payload", () => {
  assert.equal(blockedHostOf("https://Connect.Facebook.net/en_US/fbevents.js?x=1"), "connect.facebook.net");
  assert.equal(blockedHostOf("https://www.peakcam.io"), "www.peakcam.io");
  assert.equal(blockedHostOf("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="), "data");
  assert.equal(blockedHostOf("blob:https://www.peakcam.io/0b4f"), "blob");
  assert.equal(blockedHostOf("inline"), "inline");
  assert.equal(blockedHostOf("eval"), "eval");
  assert.equal(blockedHostOf(""), "none");
  assert.equal(blockedHostOf(undefined), "none");
  assert.equal(blockedHostOf("x".repeat(500)).length <= 200, true);
});

test("document paths drop query strings and fragments", () => {
  assert.equal(documentPathOf("https://www.peakcam.io/auth?next=%2Ffavorites"), "/auth");
  assert.equal(documentPathOf("https://www.peakcam.io/"), "/");
  assert.equal(documentPathOf("/relative?x=1#y"), "/relative");
  assert.equal(documentPathOf(""), "unknown");
  assert.equal(documentPathOf(123), "unknown");
});

test("PostHog target comes from the same public env the browser SDK uses", () => {
  assert.equal(postHogTargetFromEnv({}), null);
  assert.equal(postHogTargetFromEnv({ NEXT_PUBLIC_POSTHOG_KEY: "  " }), null);
  assert.deepEqual(postHogTargetFromEnv({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test" }), { apiKey: "phc_test", host: "https://us.i.posthog.com" });
  assert.deepEqual(
    postHogTargetFromEnv({ NEXT_PUBLIC_POSTHOG_KEY: "phc_test", NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com/" }),
    { apiKey: "phc_test", host: "https://eu.i.posthog.com" },
  );
});

test("capture payload carries only the four reduced fields and no person profile", () => {
  const payload = buildPostHogCapturePayload("phc_test", {
    directive: "object-src", blockedHost: "none", documentPath: "/", disposition: "enforce",
  }, new Date("2026-10-18T12:00:00.000Z"));
  assert.deepEqual(payload, {
    api_key: "phc_test",
    event: "csp_violation",
    distinct_id: "csp-report",
    timestamp: "2026-10-18T12:00:00.000Z",
    properties: { directive: "object-src", blockedHost: "none", documentPath: "/", disposition: "enforce", $process_person_profile: false },
  });
});

test("forwarding posts one capture per violation to the PostHog host and never throws", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const okFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const violations = [
    { directive: "script-src", blockedHost: "inline", documentPath: "/", disposition: "report" as const },
    { directive: "form-action", blockedHost: "phish.example.net", documentPath: "/auth", disposition: "enforce" as const },
  ];
  const target = { apiKey: "phc_test", host: "https://us.i.posthog.com" };
  assert.equal(await forwardCspViolations(violations, target, okFetch), 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://us.i.posthog.com/i/v0/e/");
  assert.equal(calls[0].init.method, "POST");
  const sent = JSON.parse(String(calls[1].init.body));
  assert.equal(sent.event, "csp_violation");
  assert.deepEqual(sent.properties.blockedHost, "phish.example.net");

  assert.equal(await forwardCspViolations(violations, null, okFetch), 0);
  assert.equal(await forwardCspViolations([], target, okFetch), 0);
  const failingFetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  assert.equal(await forwardCspViolations(violations, target, failingFetch), 0);
  const rejectedFetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
  assert.equal(await forwardCspViolations(violations, target, rejectedFetch), 0);
});
