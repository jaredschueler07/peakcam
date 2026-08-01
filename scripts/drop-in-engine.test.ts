import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DROP_IN_RESORT_SLUGS } from "../lib/drop-in";
import { DROP_IN_GAME_PROFILES } from "../lib/game/config/profiles";
import { readV1ResortProfiles } from "./capture-v1-fixtures.mjs";

// Sync reads: tsx transpiles this to CJS (the package is not type:module), so
// top-level await is unavailable here.
const root = path.join(__dirname, "..");
const engine = readFileSync(path.join(root, "public/drop-in/engine.html"), "utf8");

/**
 * The engine is a static asset with no bundler, so it carries its own copy of
 * every resort profile. Both files say in prose that the two tables MUST be kept
 * in sync by hand — this is the check that makes that promise mean something.
 * The previous version of this file only grepped for `data-key="a"`, which would
 * have passed against any drift at all.
 */
test("every config profile is mirrored field-for-field in the v1 engine", () => {
  const engineProfiles = readV1ResortProfiles();

  for (const slug of DROP_IN_RESORT_SLUGS) {
    const {
      slug: _slug,
      siteTagline: _siteTagline,
      summitElevationFt: _summitElevationFt,
      verticalDropFt: _verticalDropFt,
      terrainSeed: _terrainSeed,
      trailNames: _trailNames,
      ...configProfile
    } = DROP_IN_GAME_PROFILES[slug as keyof typeof DROP_IN_GAME_PROFILES];
    void _slug;
    void _siteTagline;
    void _summitElevationFt;
    void _verticalDropFt;
    void _terrainSeed;
    void _trailNames;
    assert.deepStrictEqual(
      configProfile,
      engineProfiles[slug],
      `engine profile drifted for ${slug}`,
    );
  }
});

test("three.js is vendored, not pulled from a third-party CDN at runtime", () => {
  assert.ok(
    engine.includes("await import('./three.module.js')"),
    "engine should import the self-hosted three.module.js",
  );
  assert.doesNotMatch(
    engine,
    /import\(['"]https?:\/\//,
    "engine must not import modules over the network — that runs third-party code same-origin with the app",
  );
});

test("the vendored three.js is present and is the pinned revision", () => {
  const three = readFileSync(path.join(root, "public/drop-in/three.module.js"), "utf8");
  assert.ok(three.includes("REVISION = '169'"), "vendored three.js is not r169");
  assert.ok(three.includes("SPDX-License-Identifier: MIT"), "vendored three.js lost its license header");
});

test("touch users get the discrete actions, not just the held keys", () => {
  // Held controls, polled by the physics loop.
  for (const key of ["a", "d", "w", "s", " "]) {
    assert.match(engine, new RegExp(`data-key="${key === " " ? " " : key}"`), `missing touch key ${key}`);
  }
  // One-shot actions, dispatched to the same functions the keyboard calls.
  for (const action of ["trail", "lift", "restart"]) {
    assert.match(engine, new RegExp(`data-action="${action}"`), `missing touch action ${action}`);
  }
  assert.match(engine, /pointerdown/);
  assert.match(engine, /pointerup/);
});

test("the game can be started without a pointer", () => {
  assert.match(engine, /id="start"[^>]*tabindex="0"/, "start overlay must be focusable");
  assert.match(engine, /id="start"[^>]*role="button"/, "start overlay must expose a button role");
  assert.ok(
    engine.includes("requestStart()"),
    "keyboard path into requestStart() is missing",
  );
});

/**
 * These two settings are load-bearing for each other and live in different
 * files, which is exactly how this broke once already: sandboxing the frame
 * without allow-same-origin gives the engine an opaque origin, and module
 * scripts are always fetched in CORS mode — so the engine's own relative
 * `import('./three.module.js')` arrives as `Origin: null` and is blocked
 * unless next.config.ts says otherwise. Deploying the sandbox without the
 * header produced "Could not load the 3D engine" for every player.
 */
test("if the engine frame is ever sandboxed, the CORS header comes with it", () => {
  const frame = readFileSync(path.join(root, "components/drop-in/DropInFrame.tsx"), "utf8");
  const config = readFileSync(path.join(root, "next.config.ts"), "utf8");

  // Read the attribute itself — the surrounding comment discusses
  // allow-same-origin, so a whole-file match would be meaningless.
  const attr = frame.match(/sandbox="([^"]*)"/);
  if (!attr) return; // not sandboxed: the module import is a plain same-origin fetch.

  const tokens = attr[1].split(/\s+/).filter(Boolean);
  if (tokens.includes("allow-same-origin")) return; // no opaque origin, no CORS problem.

  // Opaque origin: the engine's own relative import becomes a credential-less
  // cross-origin request. It needs CORS to load at all — and note it will still
  // fail behind any auth wall (Vercel deployment protection), because
  // credentials:"same-origin" sends nothing from a null origin.
  assert.ok(
    /source:\s*["']\/drop-in\/:path\*["']/.test(config) &&
      /Access-Control-Allow-Origin/.test(config),
    "a sandboxed engine needs Access-Control-Allow-Origin on /drop-in/* or it " +
      "cannot import its own three.module.js",
  );
});

/**
 * The compensating control now that the frame is not sandboxed. The engine
 * takes exactly one input — the ?resort= slug — and it must never reach a sink
 * that can execute. Keep it that way.
 */
test("the engine has no script-injection sinks", () => {
  const body = engine.slice(engine.indexOf("<script type=\"module\">"));
  for (const sink of ["innerHTML", "outerHTML", "eval(", "document.write", "insertAdjacentHTML"]) {
    assert.ok(!body.includes(sink), `engine should not use ${sink} — it renders untrusted slug text`);
  }
  assert.ok(!/new Function\s*\(/.test(body), "engine should not construct functions from strings");
});

test("the engine reports why it gave up, so failures are countable", () => {
  for (const code of ["unsupported-resort", "engine-load-failed", "webgl-unavailable"]) {
    assert.ok(engine.includes(`'${code}'`), `engine should emit the ${code} failure code`);
  }
  assert.ok(engine.includes("peakcam:drop-in-error"), "engine should post a failure message to the host");
});

test("the engine keeps itself out of the search index", () => {
  assert.match(engine, /<meta name="robots" content="noindex/, "engine.html must be noindex");
});
