import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyResponse, cleanLifts, futureOpening, isSafeResortId, productToken, requestPlan, robotsAllows, robotsDecision } from "./core.mjs";
import { VENDOR, loadLiftie, parseOperatorBody } from "./parse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(HERE, "fixtures", name), "utf8");
const UA = "PeakCam/1.0 (+https://www.peakcam.io; hello@peakcam.io)";
const headers = (map = {}) => ({ get: (name) => map[name.toLowerCase()] ?? null });

// ── Request plan ─────────────────────────────────────────────

test("requestPlan: an api block wins, as a JSON GET with the page kept for attribution", () => {
  const plan = requestPlan({
    url: { host: "https://www.winterparkresort.com", pathname: "/the-mountain/weather-dashboard#mountain-status" },
    api: { host: "https://snowreporting.herokuapp.com", pathname: "/feed/5/lifts" },
  });
  assert.deepEqual(plan, {
    kind: "json",
    url: "https://snowreporting.herokuapp.com/feed/5/lifts",
    method: "GET",
    body: null,
    accept: "application/json",
    ignoreErrors: false,
    pageUrl: "https://www.winterparkresort.com/the-mountain/weather-dashboard#mountain-status",
  });
});

test("requestPlan: query strings, a POST body, api.html, dataUrl before url, and no URL at all", () => {
  assert.equal(requestPlan({ api: { host: "https://www.aspensnowmass.com", pathname: "/aspensnowmass/liftstatus/feed", query: { mountain: "Buttermilk" } } }).url, "https://www.aspensnowmass.com/aspensnowmass/liftstatus/feed?mountain=Buttermilk");
  const post = requestPlan({ api: { host: "https://api.example.com", pathname: "/graphql", body: { query: "{ lift_status { status } }" } } });
  assert.equal(post.method, "POST");
  assert.equal(post.body, '{"query":"{ lift_status { status } }"}');
  assert.equal(requestPlan({ api: { host: "https://x.example", pathname: "/feed", html: true } }).kind, "html");
  const data = requestPlan({ url: { host: "https://a.example", pathname: "/lifts" }, dataUrl: { host: "https://b.example", pathname: "/data", ignoreErrors: true } });
  assert.equal(data.url, "https://b.example/data");
  assert.equal(data.pageUrl, "https://a.example/lifts");
  assert.equal(data.ignoreErrors, true);
  assert.equal(data.accept, "*/*");
  assert.equal(requestPlan({ name: "No URL" }), null);
  assert.equal(requestPlan({ url: { host: "ftp://a.example", pathname: "/x" } }), null);
  assert.equal(requestPlan(null), null);
});

test("isSafeResortId: directory names only", () => {
  for (const id of ["breck", "winter-park", "49-degrees-north"]) assert.equal(isSafeResortId(id), true, id);
  for (const id of ["", "../breck", "breck/index", "Breck", "a b", ".hidden", null, 7]) assert.equal(isSafeResortId(id), false, String(id));
});

// ── robots.txt ───────────────────────────────────────────────

const ROBOTS = `
# comment
User-agent: *
Disallow: /admin/
Disallow: /the-mountain/private
Allow: /the-mountain/private/lift-status
Disallow: /*.pdf$

User-agent: PeakCam
Disallow: /feed/

User-agent: BadBot
User-agent: OtherBot
Disallow: /
`;

test("productToken: the name before the slash", () => {
  assert.equal(productToken(UA), "peakcam");
  assert.equal(productToken("Mozilla/5.0 (Macintosh)"), "mozilla");
  assert.equal(productToken(""), "");
});

test("robotsAllows: our own group replaces *, the longest rule decides, Allow wins a tie", () => {
  // Our group exists, so only its rules apply.
  assert.equal(robotsAllows(ROBOTS, UA, "/feed/5/lifts"), false);
  assert.equal(robotsAllows(ROBOTS, UA, "/admin/panel"), true);
  // A client with no group of its own falls under *.
  const other = "ResortReader/2.0";
  assert.equal(robotsAllows(ROBOTS, other, "/admin/panel"), false);
  assert.equal(robotsAllows(ROBOTS, other, "/the-mountain/private/notes"), false);
  assert.equal(robotsAllows(ROBOTS, other, "/the-mountain/private/lift-status"), true);
  assert.equal(robotsAllows(ROBOTS, other, "/maps/trail.pdf"), false);
  assert.equal(robotsAllows(ROBOTS, other, "/maps/trail.pdf?v=2"), true);
  assert.equal(robotsAllows(ROBOTS, other, "/lifts"), true);
  // Shared group lines and "Disallow: /".
  assert.equal(robotsAllows(ROBOTS, "OtherBot/1", "/lifts"), false);
  // An empty Disallow allows everything; an empty file allows everything.
  assert.equal(robotsAllows("User-agent: *\nDisallow:", other, "/x"), true);
  assert.equal(robotsAllows("", other, "/x"), true);
  assert.equal(robotsAllows("User-agent: *\nAllow: /x\nDisallow: /x", other, "/x"), true);
});

test("robotsDecision: 2xx is evaluated, 4xx means no rules, 5xx or no answer means do not fetch", () => {
  assert.deepEqual(robotsDecision(200, "User-agent: *\nDisallow: /lifts", UA, "/lifts"), { allowed: false, basis: "robots.txt disallows the path" });
  assert.equal(robotsDecision(200, "User-agent: *\nDisallow: /other", UA, "/lifts").allowed, true);
  assert.deepEqual(robotsDecision(404, "", UA, "/lifts"), { allowed: true, basis: "no robots.txt (HTTP 404)" });
  assert.equal(robotsDecision(503, "", UA, "/lifts").allowed, false);
  assert.equal(robotsDecision(null, "", UA, "/lifts").allowed, false);
});

// ── Failure taxonomy ─────────────────────────────────────────

test("classifyResponse: blocked for 401/403/429, challenges and waiting rooms; http for the rest; null when worth parsing", () => {
  assert.equal(classifyResponse(403, headers({ "content-type": "text/html" }), "<title>Access Denied</title>").reason, "blocked");
  assert.equal(classifyResponse(403, headers({ "cf-mitigated": "challenge" }), "Just a moment...").detail, "HTTP 403 with a bot challenge page");
  assert.equal(classifyResponse(429, headers(), "").reason, "blocked");
  assert.equal(classifyResponse(401, headers(), "").reason, "blocked");
  assert.equal(classifyResponse(200, headers(), fixture("vail-waiting-room.html")).reason, "blocked");
  assert.equal(classifyResponse(503, headers(), "<html>Just a moment...</html>").reason, "blocked");
  assert.deepEqual(classifyResponse(404, headers(), "Not found"), { reason: "http", detail: "HTTP 404" });
  assert.equal(classifyResponse(500, headers(), "oops").reason, "http");
  assert.equal(classifyResponse(500, headers(), "oops", true), null);
  assert.equal(classifyResponse(200, headers(), fixture("vail-keystone.html")), null);
  // The words "access denied" inside a page that loaded are not a refusal.
  assert.equal(classifyResponse(200, headers(), "<p>Access denied to closed terrain.</p>"), null);
});

test("cleanLifts and futureOpening", () => {
  assert.deepEqual(cleanLifts({ " Peru Express ": "open", Bogus: "maybe", "": "open", Outpost: "hold" }), { "Peru Express": "open", Outpost: "hold" });
  assert.deepEqual(cleanLifts(null), {});
  const now = new Date("2026-11-20T16:00:00Z");
  assert.equal(futureOpening("2026-11-27", now), "2026-11-27");
  assert.equal(futureOpening("2026-11-20", now), null);
  assert.equal(futureOpening("2017-11-10", now), null);
  assert.equal(futureOpening("soon", now), null);
});

// ── Liftie's parsers over saved pages ────────────────────────
// These need the worker's libraries (npm ci --prefix scripts/liftie-worker);
// they skip, like the GDAL tests, on a machine that has not installed them.

const liftie = await loadLiftie();
const skip = liftie ? false : "worker libraries not installed (npm ci --prefix scripts/liftie-worker)";

test("vendored files carry their version, commit and licence", () => {
  const version = JSON.parse(fs.readFileSync(path.join(VENDOR, "VERSION.json"), "utf8"));
  assert.match(version.version, /^\d+\.\d+\.\d+$/);
  assert.match(version.gitHead, /^[0-9a-f]{40}$/);
  assert.match(version.integrity, /^sha512-/);
  assert.equal(version.license, "BSD-3-Clause");
  assert.match(fs.readFileSync(path.join(VENDOR, "License.md"), "utf8"), /Damian Krzeminski/);
  assert.match(fs.readFileSync(path.join(VENDOR, "lib", "tools", "vail.js"), "utf8").split("\n")[0], new RegExp(`^// Vendored from liftie@${version.version.replace(/\./g, "\\.")} `));
});

test("every mapped Liftie id has a vendored parser", () => {
  const sources = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "data", "operator-sources.json"), "utf8"));
  const ids = Object.values(sources).map((v) => (v && typeof v === "object" ? v.liftie : null)).filter(Boolean);
  assert.ok(ids.length >= 92);
  for (const id of ids) {
    assert.ok(fs.existsSync(path.join(VENDOR, "lib", "resorts", id, "index.js")), `${id}: run scripts/liftie-worker/vendor.mjs`);
    const def = JSON.parse(fs.readFileSync(path.join(VENDOR, "lib", "resorts", id, "resort.json"), "utf8"));
    assert.ok(requestPlan(def), `${id}: the definition names no URL`);
  }
});

test("Vail Resorts family: the TerrainStatusFeed script block → four states by lift", { skip }, async () => {
  const lifts = cleanLifts(await parseOperatorBody(liftie, "keystone", "html", fixture("vail-keystone.html")));
  assert.deepEqual(lifts, { "Montezuma Express": "open", "Peru Express": "open", "River Run Gondola": "closed", "Outpost Gondola": "hold", "Ruby Express": "scheduled" });
});

test("Alterra/Intrawest family: the JSON lift feed → states through Liftie's coercion", { skip }, async () => {
  const lifts = cleanLifts(await parseOperatorBody(liftie, "winter-park", "json", fixture("intrawest-winter-park.json")));
  assert.deepEqual(lifts, { Arrow: "open", "Gemini Express": "open", "Super Gauge Express": "closed", "Panoramic Express": "hold", "Eagle Wind": "scheduled" });
});

test("independent (Loveland): table headings \"Name - STATUS\" → states", { skip }, async () => {
  const lifts = cleanLifts(await parseOperatorBody(liftie, "loveland", "html", fixture("independent-loveland.html")));
  assert.deepEqual(lifts, { "Chet's Dream": "open", "Lift 2": "closed", "Rainbow Magic Carpet": "open", "Lift 9": "hold" });
});

test("a page with no lifts parses to an empty map; a feed that is not JSON rejects with a SyntaxError", { skip }, async () => {
  assert.deepEqual(cleanLifts(await parseOperatorBody(liftie, "loveland", "html", "<html><body><p>Closed for the season</p></body></html>")), {});
  await assert.rejects(() => parseOperatorBody(liftie, "winter-park", "json", "<html>maintenance</html>"), SyntaxError);
});
