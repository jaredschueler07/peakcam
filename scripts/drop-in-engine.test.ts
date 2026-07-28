import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DROP_IN_RESORT_SLUGS, getDropInProfile } from "../lib/drop-in";

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
test("every lib profile is mirrored field-for-field in the engine", () => {
  for (const slug of DROP_IN_RESORT_SLUGS) {
    const profile = getDropInProfile(slug);
    assert.ok(profile, `no lib profile for ${slug}`);

    assert.match(engine, new RegExp(`['"]?${slug}['"]?\\s*:\\s*\\{`), `engine is missing the ${slug} profile block`);
    assert.ok(engine.includes(`name: '${profile.name}'`), `engine name drifted for ${slug}`);
    assert.ok(engine.includes(`summitFt: ${profile.summitElevationFt}`), `summitFt drifted for ${slug}`);
    assert.ok(engine.includes(`verticalFt: ${profile.verticalDropFt}`), `verticalFt drifted for ${slug}`);
    assert.ok(engine.includes(`seed: ${profile.terrainSeed}`), `terrain seed drifted for ${slug}`);
    assert.ok(
      engine.toLowerCase().includes(profile.accent.toLowerCase()),
      `accent ${profile.accent} missing from the engine for ${slug}`,
    );
    for (const trail of profile.trailNames) {
      assert.ok(engine.includes(trail), `engine is missing trail "${trail}" for ${slug}`);
    }
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
test("the iframe sandbox and the /drop-in CORS header stay in step", () => {
  const frame = readFileSync(path.join(root, "components/drop-in/DropInFrame.tsx"), "utf8");
  const config = readFileSync(path.join(root, "next.config.ts"), "utf8");

  // Read the attribute itself — the surrounding comment mentions
  // allow-same-origin, so a whole-file match would be meaningless.
  const attr = frame.match(/sandbox="([^"]*)"/);
  assert.ok(attr, "DropInFrame should set a sandbox attribute on the iframe");
  const tokens = attr[1].split(/\s+/).filter(Boolean);
  assert.ok(tokens.includes("allow-scripts"), "the engine needs allow-scripts");
  assert.ok(
    !tokens.includes("allow-same-origin"),
    "allow-same-origin alongside allow-scripts is not a sandbox at all",
  );

  const allowsCors =
    /source:\s*["']\/drop-in\/:path\*["']/.test(config) &&
    /Access-Control-Allow-Origin/.test(config);
  assert.ok(
    allowsCors,
    "next.config.ts must send Access-Control-Allow-Origin for /drop-in/* — " +
      "without it the sandboxed engine cannot import its own three.module.js",
  );
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
