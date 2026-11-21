#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Re-vendors the Liftie parser files the worker needs.
//
//   node scripts/liftie-worker/vendor.mjs            # the version in vendor/liftie/VERSION.json
//   node scripts/liftie-worker/vendor.mjs 4.4.3      # move to another published version
//
// Downloads the exact npm tarball (`npm pack liftie@<version>`), checks it
// against the registry's integrity hash, and copies only: the parse helpers
// (lib/lifts/{parse,parser,request}.js, lib/select.js, lib/env.js), the shared
// parser families (lib/tools/*.js), the resort definitions that
// data/operator-sources.json maps, and the licence. Each copied .js gets a
// one-line provenance header; nothing else is changed. Liftie's web server,
// client and build dependencies are not copied, which is the point: the whole
// package installs 28 MB, these files plus their five small libraries about 3.
// ─────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const DEST = path.join(HERE, "vendor", "liftie");
const VERSION_FILE = path.join(DEST, "VERSION.json");

const previous = fs.existsSync(VERSION_FILE) ? JSON.parse(fs.readFileSync(VERSION_FILE, "utf8")) : null;
const version = process.argv[2] ?? previous?.version;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("usage: node scripts/liftie-worker/vendor.mjs <exact version, e.g. 4.4.2>");
  process.exit(1);
}

const sources = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "operator-sources.json"), "utf8"));
const ids = [...new Set(Object.values(sources).map((v) => (v && typeof v === "object" ? v.liftie : null)).filter((v) => typeof v === "string" && /^[a-z0-9][a-z0-9-]*$/.test(v)))].sort();

// npm prints one object, or an array holding it, depending on its version.
const viewed = JSON.parse(execFileSync("npm", ["view", `liftie@${version}`, "gitHead", "dist.integrity", "dist.tarball", "license", "--json"], { encoding: "utf8" }));
const meta = Array.isArray(viewed) ? viewed[0] : viewed;
if (!meta || typeof meta["dist.integrity"] !== "string" || typeof meta.gitHead !== "string") {
  console.error(`npm has no usable metadata for liftie@${version}`);
  process.exit(1);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), "liftie-vendor-"));
execFileSync("npm", ["pack", `liftie@${version}`, "--silent"], { cwd: work, stdio: ["ignore", "ignore", "inherit"] });
const tarball = path.join(work, `liftie-${version}.tgz`);
const digest = `sha512-${crypto.createHash("sha512").update(fs.readFileSync(tarball)).digest("base64")}`;
if (digest !== meta["dist.integrity"]) {
  console.error(`integrity mismatch for liftie@${version}: got ${digest}, registry says ${meta["dist.integrity"]}`);
  process.exit(1);
}
execFileSync("tar", ["xzf", tarball], { cwd: work });
const pkg = path.join(work, "package");

const header = `// Vendored from liftie@${version} (github.com/pirxpilot/liftie, commit ${String(meta.gitHead).slice(0, 12)}), BSD-3-Clause, Copyright (c) 2012 Damian Krzeminski. See ../License.md. Unmodified below this line. Do not edit: re-run scripts/liftie-worker/vendor.mjs.\n`;

function copy(rel, { withHeader = true } = {}) {
  const from = path.join(pkg, rel);
  const to = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const body = fs.readFileSync(from, "utf8");
  fs.writeFileSync(to, withHeader && rel.endsWith(".js") ? header.replace("../License.md", `${"../".repeat(rel.split("/").length - 1)}License.md`) + body : body);
}

// Start from an empty lib/ so a resort dropped from the mapping does not linger.
const libDir = path.join(DEST, "lib");
if (fs.existsSync(libDir)) fs.rmSync(libDir, { recursive: true });

const files = ["lib/lifts/parse.js", "lib/lifts/parser.js", "lib/lifts/request.js", "lib/select.js", "lib/env.js"];
for (const name of fs.readdirSync(path.join(pkg, "lib", "tools")).sort()) if (name.endsWith(".js")) files.push(`lib/tools/${name}`);
const missing = [];
for (const id of ids) {
  const dir = path.join(pkg, "lib", "resorts", id);
  if (!fs.existsSync(path.join(dir, "index.js")) || !fs.existsSync(path.join(dir, "resort.json"))) {
    missing.push(id);
    continue;
  }
  files.push(`lib/resorts/${id}/index.js`, `lib/resorts/${id}/resort.json`);
}
for (const rel of files) copy(rel);
copy("License.md", { withHeader: false });

fs.writeFileSync(
  VERSION_FILE,
  `${JSON.stringify(
    {
      package: "liftie",
      version,
      license: meta.license,
      repository: "https://github.com/pirxpilot/liftie",
      gitHead: meta.gitHead,
      tarball: meta["dist.tarball"],
      integrity: meta["dist.integrity"],
      resorts: ids.filter((id) => !missing.includes(id)),
      missing,
    },
    null,
    2,
  )}\n`,
);
fs.rmSync(work, { recursive: true });

console.log(`vendored liftie@${version} (${String(meta.gitHead).slice(0, 12)}): ${files.length} files, ${ids.length - missing.length} resorts`);
if (missing.length) console.log(`no Liftie definition for: ${missing.join(", ")}`);
console.log("Check that the libraries the parsers import still match scripts/liftie-worker/package.json, then run the tests.");
