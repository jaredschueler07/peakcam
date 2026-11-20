#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Liftie worker — fetches each operator's own lift-status page or feed and
// runs Liftie's open-source parser for it (github.com/pirxpilot/liftie,
// BSD-3-Clause). The parser files are vendored unmodified under
// ./vendor/liftie at the version in ./vendor/liftie/VERSION.json; see
// ./NOTICE.md.
//
// scripts/operator-sync.ts starts this as a child process with an
// environment that holds no secrets, because some Liftie parsers evaluate a
// script block taken from the operator's page (node:vm, which is not a
// security boundary). The worker therefore never sees the Supabase keys and
// writes nothing except the robots.txt cache file it is told about.
//
// Protocol: one JSON job on stdin
//   { userAgent, pauseMs, timeoutMs, robotsCachePath, now, targets: [id, …] }
// and one JSON line per target on stdout
//   { id, ok: true,  name, href, requestUrl, lifts, opening, httpStatus }
//   { id, ok: false, reason, status, detail }
// reason ∈ no_parser | robots | blocked | http | network | invalid | parse_empty
// Exit 3 when the parsers' libraries are not installed here
// (npm ci --prefix scripts/liftie-worker).
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyResponse, cleanLifts, futureOpening, isSafeResortId, requestPlan, robotsDecision } from "./core.mjs";
import { loadLiftie, parseOperatorBody } from "./parse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function loadRobotsCache(file) {
  if (!file) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveRobotsCache(file, cache) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cache));
  } catch {
    // A cache that cannot be written only costs one robots.txt read per host next run.
  }
}

async function fetchText(url, init, timeoutMs) {
  const res = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

/** robots.txt for the origin, from the 24 h cache or one GET. */
async function robotsFor(origin, job, cache) {
  const hit = cache[origin];
  if (hit && typeof hit.at === "number" && job.nowMs - hit.at < ROBOTS_TTL_MS) return hit;
  let entry;
  try {
    const res = await fetchText(`${origin}/robots.txt`, { headers: { "User-Agent": job.userAgent, Accept: "text/plain,*/*" } }, job.timeoutMs);
    entry = { at: job.nowMs, status: res.status, body: res.status >= 200 && res.status < 300 ? res.text.slice(0, 200_000) : "" };
  } catch (err) {
    // An unreachable host is not cached: it may be back on the next run.
    const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
    return { at: job.nowMs, status: null, body: "", error: `${err instanceof Error ? err.message : String(err)}${cause}` };
  }
  cache[origin] = entry;
  return entry;
}

/** One GET/POST of the operator's page; a single retry on a network error or a 5xx. */
async function fetchOperator(plan, job) {
  const init = { method: plan.method, headers: { "User-Agent": job.userAgent, Accept: plan.accept } };
  if (plan.body) {
    init.body = plan.body;
    init.headers["Content-Type"] = "application/json";
  }
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(1_000);
    try {
      const res = await fetchText(plan.url, init, job.timeoutMs);
      if (res.status >= 500 && attempt === 0) {
        last = { res };
        continue;
      }
      return { res };
    } catch (err) {
      const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
      last = { error: `${err instanceof Error ? err.message : String(err)}${cause}` };
    }
  }
  return last;
}

async function handle(id, job, liftie, cache) {
  if (!isSafeResortId(id)) return { id, ok: false, reason: "no_parser", status: null, detail: "not a Liftie resort id" };
  const dir = path.join(liftie.root, "lib", "resorts", id);
  let def;
  try {
    def = JSON.parse(fs.readFileSync(path.join(dir, "resort.json"), "utf8"));
  } catch {
    return { id, ok: false, reason: "no_parser", status: null, detail: `no vendored Liftie ${liftie.version} parser for "${id}" (run scripts/liftie-worker/vendor.mjs after mapping it)` };
  }
  const plan = requestPlan(def);
  if (!plan) return { id, ok: false, reason: "no_parser", status: null, detail: "the resort definition names no URL" };

  const target = new URL(plan.url);
  const robots = await robotsFor(target.origin, job, cache);
  // No answer at all from the host is a network failure, not a robots ruling (nothing is fetched either way).
  if (robots.status == null) return { id, ok: false, reason: "network", status: null, detail: `${target.origin} unreachable (robots.txt): ${robots.error ?? "no response"}`.slice(0, 300) };
  const decision = robotsDecision(robots.status, robots.body, job.userAgent, `${target.pathname}${target.search}`);
  if (!decision.allowed) return { id, ok: false, reason: "robots", status: robots.status, detail: `${decision.basis} (${target.origin}${target.pathname})` };

  const fetched = await fetchOperator(plan, job);
  if (!fetched || fetched.error) return { id, ok: false, reason: "network", status: null, detail: fetched?.error ?? "no response" };
  const { res } = fetched;
  const refused = classifyResponse(res.status, res.headers, res.text.slice(0, 20_000), plan.ignoreErrors);
  if (refused) return { id, ok: false, reason: refused.reason, status: res.status, detail: refused.detail };
  if (!res.text.trim()) return { id, ok: false, reason: "parse_empty", status: res.status, detail: "empty response body" };

  let raw;
  try {
    raw = await parseOperatorBody(liftie, id, plan.kind, res.text, job.timeoutMs);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { id, ok: false, reason: err instanceof SyntaxError ? "invalid" : "parse_empty", status: res.status, detail: `parser failed: ${detail}`.slice(0, 300) };
  }
  const lifts = cleanLifts(raw);
  if (!Object.keys(lifts).length) return { id, ok: false, reason: "parse_empty", status: res.status, detail: "the parser found no lifts on the page" };

  return {
    id,
    ok: true,
    name: typeof def.name === "string" && def.name ? def.name : id,
    href: plan.pageUrl,
    requestUrl: plan.url,
    lifts,
    opening: futureOpening(def.opening, new Date(job.nowMs)),
    httpStatus: res.status,
  };
}

async function main() {
  // Parsers may log; stdout carries the protocol only.
  console.log = console.error;
  const liftie = await loadLiftie();
  if (!liftie) {
    process.stderr.write(`[liftie-worker] the parsers' libraries are not installed. Run: npm ci --prefix ${path.relative(process.cwd(), HERE) || "."}\n`);
    process.exit(3);
  }
  const version = liftie.version;

  const input = JSON.parse(await readStdin());
  const job = {
    userAgent: String(input.userAgent || "PeakCam/1.0 (+https://www.peakcam.io)"),
    pauseMs: Number.isFinite(input.pauseMs) ? Math.max(0, input.pauseMs) : 500,
    timeoutMs: Number.isFinite(input.timeoutMs) ? Math.max(1_000, input.timeoutMs) : 15_000,
    nowMs: Number.isFinite(input.now) ? input.now : Date.now(),
  };
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const cachePath = typeof input.robotsCachePath === "string" && input.robotsCachePath ? input.robotsCachePath : null;
  const cache = loadRobotsCache(cachePath);

  emit({ meta: true, liftieVersion: version, targets: targets.length });
  for (let i = 0; i < targets.length; i++) {
    if (i) await sleep(job.pauseMs);
    let line;
    try {
      line = await handle(targets[i], job, liftie, cache);
    } catch (err) {
      line = { id: targets[i], ok: false, reason: "invalid", status: null, detail: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
    }
    emit(line);
  }
  saveRobotsCache(cachePath, cache);
}

main().catch((err) => {
  process.stderr.write(`[liftie-worker] fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
