import { test } from "node:test";
import assert from "node:assert/strict";
// Next compiles `config.matcher` with its bundled path-to-regexp; use the same
// one so this test reads the matcher the way the build does.
// @ts-expect-error Next ships this compiled module without type declarations.
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { config } from "../proxy";

const matchers: RegExp[] = config.matcher.map((source) => pathToRegexp(source));
const runsOn = (path: string) => matchers.some((re) => re.test(path));

test("proxy refreshes the session where a server reads it", () => {
  for (const path of [
    "/account",
    "/auth",
    "/auth/callback",
    "/auth/update-password",
    "/dashboard",
    "/favorites",
    "/alerts",
    "/alerts/manage",
    "/admin/bug-reports",
    "/api/user-conditions/submit",
    "/api/drop-in/runs",
    "/api/admin/bug-reports",
    "/api/bug-reports",
  ]) {
    assert.ok(runsOn(path), `proxy should run on ${path}`);
  }
});

test("proxy stays off public pages and the anonymous API", () => {
  for (const path of [
    "/",
    "/resorts/alta",
    "/resorts/ski-cooper/snow-forecast",
    "/ski-cams",
    "/ski-cams/colorado",
    "/snow-report/best-powder-this-week",
    "/passes/epic",
    "/compare",
    "/map",
    "/sitemap.xml",
    "/llms.txt",
    "/opengraph-image",
    "/accounting",
    "/api/v1/resorts",
    "/api/v1/resorts/alta/conditions",
    "/api/mcp",
  ]) {
    assert.ok(!runsOn(path), `proxy should not run on ${path}`);
  }
});
