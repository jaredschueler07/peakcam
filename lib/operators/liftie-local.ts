// ─────────────────────────────────────────────────────────────
// Liftie parsers, run locally — operator lift status without liftie.info.
//
// liftie.info's API has refused scripts since 2026-10-20 (Cloudflare managed
// challenge), so `operator_status` never received a row from it. Liftie's
// parsers are open source (github.com/pirxpilot/liftie, BSD-3-Clause), so the
// sync runs them itself against each operator's own lift-status page or feed:
// scripts/liftie-worker/worker.mjs does the fetching and parsing in a child
// process that holds no secrets, and this module starts it, reads its JSON
// lines and turns each into the same `LiftieReport` the API path produced.
// Everything downstream (`operatorStatusRow`, `latest_operator_status`, the
// conditions contract) is unchanged.
//
// Pure: `localResultToReport`, `parseWorkerLine`, `workerEnv`. One side
// effect: `runLiftieWorker` (a child process). Scripts only: the web app must
// not import this file.
// ─────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

import { LIFT_STATES, parseLiftieResort, type LiftieReport, type LiftState } from "./liftie";

export const OPERATOR_USER_AGENT = "PeakCam/1.0 (+https://www.peakcam.io; hello@peakcam.io)";
export const LIFTIE_PARSER_ATTRIBUTION = "Lift status read from the operator's own status page with Liftie's open-source parsers (github.com/pirxpilot/liftie)";

/**
 * Why a resort produced no lift status this run.
 * - `no_parser`   Liftie has no definition for the id
 * - `robots`      the operator's robots.txt disallows the path (or could not be read)
 * - `blocked`     the site turned the client away: 401/403/429, a bot challenge or a waiting room
 * - `http`        any other non-2xx answer
 * - `network`     no answer (DNS, TLS, timeout), after one retry
 * - `invalid`     the answer was not what the parser reads (for example a feed that is not JSON)
 * - `parse_empty` the page loaded but the parser found no lifts (the operator changed the page, or lists none)
 */
export type LocalFailure = "no_parser" | "robots" | "blocked" | "http" | "network" | "invalid" | "parse_empty";
export const LOCAL_FAILURES: readonly LocalFailure[] = ["no_parser", "robots", "blocked", "http", "network", "invalid", "parse_empty"];

export interface LocalSuccess {
  id: string;
  ok: true;
  name: string;
  /** The operator's public lift-status page. */
  href: string | null;
  /** The URL actually requested (the page itself, or the feed behind it). */
  requestUrl: string | null;
  lifts: Record<string, LiftState>;
  /** An opening day still ahead, from Liftie's definition; else null. */
  opening: string | null;
  httpStatus: number | null;
}

export interface LocalFailureResult {
  id: string;
  ok: false;
  reason: LocalFailure;
  status: number | null;
  detail: string;
}

export type LocalResult = LocalSuccess | LocalFailureResult;

export interface WorkerMeta {
  liftieVersion: string;
  targets: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const httpUrl = (v: unknown): string | null => (typeof v === "string" && /^https?:\/\//.test(v) ? v : null);

/**
 * One stdout line from the worker → a result, the run's meta line, or null for
 * anything else. Never trusts the line: states outside the four are dropped
 * and an "ok" line with no usable lift becomes `parse_empty`.
 */
export function parseWorkerLine(line: string): LocalResult | { meta: WorkerMeta } | null {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(doc)) return null;
  if (doc.meta === true) {
    return { meta: { liftieVersion: typeof doc.liftieVersion === "string" ? doc.liftieVersion : "unknown", targets: typeof doc.targets === "number" ? doc.targets : 0 } };
  }
  const id = typeof doc.id === "string" ? doc.id : null;
  if (!id) return null;
  if (doc.ok !== true) {
    const reason = (LOCAL_FAILURES as readonly string[]).includes(String(doc.reason)) ? (doc.reason as LocalFailure) : "invalid";
    return { id, ok: false, reason, status: typeof doc.status === "number" ? doc.status : null, detail: typeof doc.detail === "string" ? doc.detail : "" };
  }
  const lifts: Record<string, LiftState> = {};
  if (isRecord(doc.lifts)) {
    for (const [name, state] of Object.entries(doc.lifts)) {
      const key = name.trim();
      if (key && typeof state === "string" && (LIFT_STATES as readonly string[]).includes(state)) lifts[key] = state as LiftState;
    }
  }
  const httpStatus = typeof doc.httpStatus === "number" ? doc.httpStatus : null;
  if (!Object.keys(lifts).length) return { id, ok: false, reason: "parse_empty", status: httpStatus, detail: "the parser found no lifts on the page" };
  return {
    id,
    ok: true,
    name: typeof doc.name === "string" && doc.name ? doc.name : id,
    href: httpUrl(doc.href),
    requestUrl: httpUrl(doc.requestUrl),
    lifts,
    opening: typeof doc.opening === "string" && /^\d{4}-\d{2}-\d{2}$/.test(doc.opening) ? doc.opening : null,
    httpStatus,
  };
}

/**
 * A worker success → the report shape of the API path, by building the
 * document liftie.info would have served and reading it with the same
 * `parseLiftieResort`. An operator page carries no timestamp of its own, so
 * `observedAt` is the fetch instant and `timestamped` is false.
 */
export function localResultToReport(result: LocalSuccess, fetchedAt: Date): LiftieReport {
  const report = parseLiftieResort(
    { id: result.id, name: result.name, href: result.href ?? undefined, lifts: { status: result.lifts }, opening: result.opening ?? undefined },
    fetchedAt,
  );
  // parseLiftieResort only returns null without an id or a lifts block; both are present here.
  if (!report) throw new Error(`liftie-local: could not normalise the result for "${result.id}"`);
  return report;
}

/**
 * The child's environment: a search path and a temp dir, nothing else. Some
 * Liftie parsers evaluate script text from the operator's page, so the
 * Supabase keys and every other variable stay in the parent.
 */
export function workerEnv(parent: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "TMPDIR", "TZ", "DEBUG"]) {
    const value = parent[key];
    if (value) env[key] = value;
  }
  return env;
}

export interface RunWorkerOptions {
  /** Repo root; the worker lives at scripts/liftie-worker/worker.mjs under it. */
  root: string;
  userAgent?: string;
  pauseMs?: number;
  timeoutMs?: number;
  robotsCachePath?: string;
  now?: Date;
  /** Called for each result as it arrives, in target order. */
  onResult?: (result: LocalResult) => void | Promise<void>;
  onMeta?: (meta: WorkerMeta) => void;
}

export interface RunWorkerOutcome {
  results: LocalResult[];
  meta: WorkerMeta | null;
  /** Worker exit code; 3 means the pinned `liftie` package is not installed. */
  exitCode: number | null;
  stderrTail: string;
}

export const WORKER_NOT_INSTALLED = 3;

export function defaultRobotsCachePath(): string {
  return path.join(os.tmpdir(), "peakcam-operator-robots.json");
}

/** Start the worker for these Liftie ids and collect one result per id. */
export async function runLiftieWorker(ids: readonly string[], options: RunWorkerOptions): Promise<RunWorkerOutcome> {
  const workerPath = path.join(options.root, "scripts", "liftie-worker", "worker.mjs");
  // Next's typings make NODE_ENV a required key of ProcessEnv; the child gets none on purpose.
  const env = workerEnv(process.env) as unknown as NodeJS.ProcessEnv;
  const child = spawn(process.execPath, [workerPath], { cwd: options.root, env, stdio: ["pipe", "pipe", "pipe"] });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4_000);
  });

  const job = {
    userAgent: options.userAgent ?? OPERATOR_USER_AGENT,
    pauseMs: options.pauseMs ?? 500,
    timeoutMs: options.timeoutMs ?? 15_000,
    robotsCachePath: options.robotsCachePath ?? defaultRobotsCachePath(),
    now: (options.now ?? new Date()).getTime(),
    targets: [...ids],
  };
  child.stdin.on("error", () => undefined); // the worker may exit before reading (not installed)
  child.stdin.end(JSON.stringify(job));

  const exit = new Promise<number | null>((resolve) => {
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });

  const results: LocalResult[] = [];
  let meta: WorkerMeta | null = null;
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of lines) {
    const parsed = parseWorkerLine(line);
    if (!parsed) continue;
    if ("meta" in parsed) {
      meta = parsed.meta;
      options.onMeta?.(parsed.meta);
      continue;
    }
    results.push(parsed);
    await options.onResult?.(parsed);
  }
  const exitCode = await exit;

  // A worker that died part-way leaves ids unanswered; name them rather than dropping them.
  const answered = new Set(results.map((r) => r.id));
  for (const id of ids) {
    if (answered.has(id)) continue;
    const missing: LocalFailureResult = { id, ok: false, reason: "invalid", status: null, detail: `the worker exited (code ${exitCode ?? "none"}) before answering` };
    results.push(missing);
    await options.onResult?.(missing);
  }
  return { results, meta, exitCode, stderrTail: stderr.trim().split("\n").slice(-6).join("\n") };
}
