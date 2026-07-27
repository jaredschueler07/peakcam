#!/usr/bin/env node
/**
 * Refresh the vendored three.js that Drop In's engine imports.
 *
 * The engine (public/drop-in/engine.html) is a bundler-free static asset, so it
 * cannot import from node_modules — it loads ./three.module.js beside itself.
 * It used to pull that module from unpkg at runtime, which put third-party code
 * on peakcam.io's own origin with no integrity check and no build-time signal if
 * the CDN was down. The copy is vendored instead; `three` stays in
 * devDependencies purely so the version is pinned in the lockfile and this
 * script has an audited source to copy from.
 *
 *   npm run drop-in:sync-three
 *
 * Bump the version in package.json first, `npm install`, then run this.
 */
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "node_modules/three/build/three.module.js");
const dest = path.join(root, "public/drop-in/three.module.js");

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const pinned = pkg.devDependencies?.three;
if (!pinned) {
  console.error("three is not in devDependencies — add it before syncing.");
  process.exit(1);
}

let source;
try {
  source = await readFile(src, "utf8");
} catch {
  console.error(`Cannot read ${src}. Run \`npm install\` first.`);
  process.exit(1);
}

const revision = source.match(/REVISION = '([^']+)'/)?.[1];
if (!revision) {
  console.error("Could not find a REVISION marker in the installed three.js.");
  process.exit(1);
}
if (!pinned.includes(revision)) {
  console.error(`Installed three.js is r${revision} but package.json pins ${pinned}.`);
  process.exit(1);
}

await copyFile(src, dest);
console.log(`Vendored three.js r${revision} → public/drop-in/three.module.js`);
console.log("Now run: npx tsx --test scripts/drop-in-engine.test.ts");
