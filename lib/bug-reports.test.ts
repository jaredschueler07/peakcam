import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { BugHistory } from "./bug-reports/history";
import { browserDetails, bugReportSchema, errorLocation, HISTORY_MS, MAX_BREADCRUMBS, MAX_REPORT_BYTES, reportPath } from "./bug-reports/schema";
import { handleBugReport, type ReportDependencies, type ReportStoreInput } from "./bug-reports/server";

const payload = () => ({ id: randomUUID(), sessionId: randomUUID(), description: "The camera stayed blank after opening it.", pagePath: "/resorts/breckenridge", diagnostics: null });
const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://peakcam.io/api/bug-reports", { method: "POST", headers: { origin: "https://peakcam.io", "content-type": "application/json", "x-forwarded-for": "192.0.2.123", ...headers }, body: JSON.stringify(body) });
const deps = (overrides: Partial<ReportDependencies> = {}): ReportDependencies => ({ secret: "unit-test-secret", release: "local", now: () => new Date("2026-09-07T23:59:00Z"), store: async input => ({ id: input.report.id }), ...overrides });

test("report context excludes query tokens, fragments and unknown private routes", () => {
  assert.equal(reportPath("/auth/callback?code=private#token"), "/auth/callback");
  assert.equal(reportPath("/resorts/breckenridge/drop-in?seed=secret"), "/resorts/breckenridge/drop-in");
  for (const path of ["https://evil.test/map", "/people/person@example.org", "/account/private-id"]) assert.equal(reportPath(path), "/other");
  assert.equal(errorLocation("https://peakcam.io/_next/static/chunks/app-abc.js?secret=123", "https://peakcam.io"), "/_next/static/chunks/app-abc.js");
  assert.equal(errorLocation("https://other.test/_next/static/a.js", "https://peakcam.io"), undefined);
  assert.equal(errorLocation("https://peakcam.io/uploads/private.js", "https://peakcam.io"), undefined);
});

test("diagnostics allowlist strips unknown data at every nested boundary", () => {
  const result = bugReportSchema.parse({ ...payload(), cookies: "private", diagnostics: {
    version: 1, release: "local", browser: "Chrome", browserMajor: 130, platform: "macOS", online: true,
    viewport: { width: 390, height: 844, dpr: 3, secret: "private" }, rawUA: "private",
    breadcrumbs: [{ ageMs: 0, action: "javascript-error", path: "/map?token=private", errorName: "TypeError", message: "private", input: "private", stack: "private" }],
  } });
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.equal(result.diagnostics?.breadcrumbs[0].path, "/map");
  assert.equal(bugReportSchema.safeParse({ ...payload(), diagnostics: { ...result.diagnostics, breadcrumbs: [{ ageMs: 0, action: "typed-secret", path: "/" }] } }).success, false);
});

test("history stays bounded, chronological, deduplicated, and expires old entries", () => {
  const history = new BugHistory();
  history.record("button", "/", 0); history.record("button", "/", 100);
  assert.equal(history.snapshot(200).length, 1);
  for (let i = 1; i <= 100; i++) history.record("button", "/map?token=private", i * 1000);
  const entries = history.snapshot(100_000);
  assert.equal(entries.length, MAX_BREADCRUMBS);
  assert.equal(entries[0].ageMs, 59_000); assert.equal(entries.at(-1)?.ageMs, 0);
  assert.ok(!JSON.stringify(entries).includes("private"));
  assert.equal(history.snapshot(100_000 + HISTORY_MS + 1).length, 0);
});

test("device summary contains family and major version only", () => {
  assert.deepEqual(browserDetails("Mozilla/5.0 (iPhone) AppleWebKit/605.1 Version/18.1 Mobile/secret Safari/604.1"), { browser: "Safari", browserMajor: 18, platform: "iOS" });
});

test("API stores opt-out reports without diagnostics or raw IP; session retry hash survives midnight", async () => {
  const saved: ReportStoreInput[] = []; const report = payload();
  const store: ReportDependencies["store"] = async input => { saved.push(input); return { id: input.report.id }; };
  const response = await handleBugReport(request(report), deps({ store }));
  assert.equal(response.status, 201); assert.deepEqual(await response.json(), { id: report.id });
  assert.equal(saved[0].report.diagnostics, null); assert.match(saved[0].ipHash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(saved).includes("192.0.2.123"));
  await handleBugReport(request(report), deps({ store, now: () => new Date("2026-09-08T00:01:00Z") }));
  assert.equal(saved[0].sessionHash, saved[1].sessionHash); assert.notEqual(saved[0].ipHash, saved[1].ipHash);
});

test("API rejects cross-origin, malformed, oversized and invalid reports before storage", async () => {
  let calls = 0; const settings = deps({ store: async input => { calls++; return { id: input.report.id }; } });
  assert.equal((await handleBugReport(request(payload(), { origin: "https://evil.test" }), settings)).status, 403);
  assert.equal((await handleBugReport(request(payload(), { "sec-fetch-site": "cross-site" }), settings)).status, 403);
  assert.equal((await handleBugReport(request(payload(), { "content-type": "text/plain" }), settings)).status, 415);
  assert.equal((await handleBugReport(request({ ...payload(), description: "short" }), settings)).status, 400);
  assert.equal((await handleBugReport(request(payload(), { "content-length": String(MAX_REPORT_BYTES + 1) }), settings)).status, 413);
  assert.equal((await handleBugReport(request({ ...payload(), unknown: "x".repeat(MAX_REPORT_BYTES) }), settings)).status, 413);
  const malformed = new Request("https://peakcam.io/api/bug-reports", { method: "POST", headers: { origin: "https://peakcam.io", "content-type": "application/json" }, body: "{" });
  assert.equal((await handleBugReport(malformed, settings)).status, 400);
  assert.equal(calls, 0);
});

test("API communicates throttling and storage failure without leaking internal errors", async () => {
  const limited = await handleBugReport(request(payload()), deps({ store: async () => ({ error: "rate_limited" }) }));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "3600");
  const unavailable = await handleBugReport(request(payload()), deps({ store: async () => { throw new Error("private database details"); } }));
  assert.equal(unavailable.status, 503); assert.ok(!(await unavailable.text()).includes("private"));
  assert.equal((await handleBugReport(request(payload()), deps({ secret: "" }))).status, 503);
});
