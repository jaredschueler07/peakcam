#!/usr/bin/env tsx
/**
 * cam-check — collect facts about the camera-preview pipeline and apply
 * deterministic health rules. Prints JSON (facts + alerts) and, optionally,
 * a Markdown facts block for a model to triage.
 *
 * It is tier 0 of the ladder in scripts/cam-check.sh:
 *   tier 0  this script           facts + rules (always, no model)
 *   tier 1  Muse Glimmer (local)  cheap triage of the facts
 *   tier 2  Muse Code             investigates in the repo when 0/1 flag an issue
 *   tier 3  Muse Wonder           when tier 2 asks for it
 *
 * Facts come from three places:
 *   db    Supabase (anon key is enough): cams, stills, card coverage via
 *         lib/cam-preview.ts so the count matches what the site renders.
 *   mini  ssh to the Mac mini that runs the launchd jobs: job status, last
 *         exit reason, tail of the capture and health-check logs.
 *   site  www.peakcam.io: home page, one resort page fronted by a captured
 *         still, and HEAD on the newest stored stills.
 *
 * Usage: npx tsx scripts/cam-check.ts [--json out.json] [--md out.md]
 *          [--baseline N] [--no-mini] [--no-site]
 * Exit code is 0 even when alerts fire; the runner reads the JSON.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Cam } from "../lib/types.js";
import { cameraPreviews } from "../lib/cam-preview.js";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─── env ─────────────────────────────────────────────────────────────────
function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const key = t.slice(0, eq).trim(); const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(ROOT, ".env.local")); loadEnv(path.join(ROOT, ".env"));

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const JSON_OUT = opt("--json");
const MD_OUT = opt("--md");
const BASELINE = Number(opt("--baseline") ?? 0) || 0;
const NO_MINI = args.includes("--no-mini");
const NO_SITE = args.includes("--no-site");

const SITE = process.env.CAM_CHECK_SITE ?? "https://www.peakcam.io";
const MINI_HOST = process.env.CAM_CHECK_MINI_HOST ?? "mini";
const MINI_REPO = process.env.CAM_CHECK_MINI_REPO ?? "/Users/maestro_admin/peakcam/peakcam";
const CAPTURE_INTERVAL_H = 2;          // com.peakcam.cam-stills StartInterval
const HEALTH_INTERVAL_H = 24;          // com.peakcam.cam-health-check daily 06:00

// ─── types ───────────────────────────────────────────────────────────────
export type Severity = "critical" | "warn" | "info";
export interface Alert { severity: Severity; code: string; message: string }

export interface DbFacts {
  ok: boolean; error?: string;
  resorts: number; camsActive: number; autoDisabled: number; failing3plus: number;
  stills: number; newestStillAt: string | null; newestStillAgeH: number | null; stillsOlder48h: number;
  coverage: number; noPreview: string[]; capturedFronted: string[];
  sampleStillUrls: string[];
}
export interface MiniJob { label: string; pid: number | null; status: number | null; lastExitReason: string | null }
export interface MiniFacts {
  ok: boolean; error?: string; now: number | null; git: string | null;
  jobs: MiniJob[];
  stillsLogAgeH: number | null; stillsLastRunAt: string | null; stillsLastRun: { stored: number; blank: number; failed: number } | null;
  stillsFailed: string[]; stillsTail: string[];
  healthLogAgeH: number | null; healthLast: string[];
}
export interface SiteFacts {
  ok: boolean; error?: string;
  home: { status: number; ms: number } | null;
  resortPage: { slug: string; status: number; stillRefs: number } | null;
  stills: { url: string; status: number }[];
}
export interface Facts { ts: string; baseline: number; db: DbFacts; mini: MiniFacts; site: SiteFacts }

// ─── db ──────────────────────────────────────────────────────────────────
async function dbFacts(): Promise<DbFacts> {
  const empty: DbFacts = { ok: false, resorts: 0, camsActive: 0, autoDisabled: 0, failing3plus: 0, stills: 0, newestStillAt: null, newestStillAgeH: null, stillsOlder48h: 0, coverage: 0, noPreview: [], capturedFronted: [], sampleStillUrls: [] };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ...empty, error: "missing NEXT_PUBLIC_SUPABASE_URL / key in .env.local" };
  const H = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (q: string) => {
    const r = await fetch(`${url}/rest/v1/${q}`, { headers: H, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`${q.split("?")[0]} ${r.status}`);
    return r.json();
  };
  try {
    const resorts: { id: string; slug: string }[] = await get("resorts?select=id,slug&is_active=eq.true&order=slug");
    const cams: (Cam & { resort_id: string })[] = await get("cams?select=*&is_active=eq.true");
    const now = Date.now();
    const withStill = cams.filter((c) => c.still_url && c.still_captured_at);
    const newest = withStill.map((c) => Date.parse(c.still_captured_at!)).reduce((a, b) => Math.max(a, b), 0);
    const f: DbFacts = {
      ok: true,
      resorts: resorts.length,
      camsActive: cams.length,
      autoDisabled: cams.filter((c) => c.auto_disabled).length,
      failing3plus: cams.filter((c) => !c.auto_disabled && c.consecutive_failures >= 3).length,
      stills: withStill.length,
      newestStillAt: newest ? new Date(newest).toISOString() : null,
      newestStillAgeH: newest ? round((now - newest) / 3_600_000) : null,
      stillsOlder48h: withStill.filter((c) => now - Date.parse(c.still_captured_at!) > 48 * 3_600_000).length,
      coverage: 0, noPreview: [], capturedFronted: [],
      sampleStillUrls: withStill.sort((a, b) => Date.parse(b.still_captured_at!) - Date.parse(a.still_captured_at!)).slice(0, 3).map((c) => c.still_url!),
    };
    for (const r of resorts) {
      const p = cameraPreviews(cams.filter((c) => c.resort_id === r.id));
      if (p.length) { f.coverage++; if (p[0].capturedAt) f.capturedFronted.push(r.slug); } else f.noPreview.push(r.slug);
    }
    return f;
  } catch (e) {
    return { ...empty, error: String((e as Error).message ?? e) };
  }
}

// ─── mini ────────────────────────────────────────────────────────────────
const MINI_SCRIPT = `
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
echo "@@NOW $(date +%s)"
echo "@@GIT $(cd ${"MINI_REPO"} 2>/dev/null && git rev-parse --short HEAD)"
echo "@@LAUNCHCTL"; launchctl list 2>/dev/null | grep com.peakcam || true
for l in $(launchctl list 2>/dev/null | awk '/com.peakcam/{print $3}'); do
  echo "@@EXIT $l $(launchctl print gui/$(id -u)/$l 2>/dev/null | awk -F'= ' '/last exit reason/{print $2}')"
done
echo "@@STILLS_MTIME $(stat -f %m ${"MINI_REPO"}/scripts/cam-capture-stills.log 2>/dev/null)"
echo "@@STILLS_LAST"; awk '/^\\[cam-stills\\] [0-9][0-9][0-9][0-9]-/{start=NR} {lines[NR]=$0} END{if(start) for(i=start;i<=NR;i++) print lines[i]}' ${"MINI_REPO"}/scripts/cam-capture-stills.log 2>/dev/null | tail -80
echo "@@HEALTH_MTIME $(stat -f %m ${"MINI_REPO"}/scripts/cam-health-check.log 2>/dev/null)"
echo "@@HEALTH_LAST"; grep '^\\[cam-health\\]' ${"MINI_REPO"}/scripts/cam-health-check.log 2>/dev/null | tail -3
echo "@@END"
`;

export function parseMini(out: string, nowFallback = Date.now() / 1000): MiniFacts {
  const f: MiniFacts = { ok: true, now: null, git: null, jobs: [], stillsLogAgeH: null, stillsLastRunAt: null, stillsLastRun: null, stillsFailed: [], stillsTail: [], healthLogAgeH: null, healthLast: [] };
  let section = "";
  const sections: Record<string, string[]> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^@@(\w+)(?:\s(.*))?$/);
    if (m) {
      const [, tag, rest] = m;
      if (tag === "NOW") f.now = Number(rest) || null;
      else if (tag === "GIT") f.git = rest?.trim() || null;
      else if (tag === "EXIT") {
        const [label, ...reason] = (rest ?? "").split(" ");
        const job = f.jobs.find((j) => j.label === label);
        if (job) job.lastExitReason = reason.join(" ").trim() || null;
      } else if (tag === "STILLS_MTIME" || tag === "HEALTH_MTIME") {
        const mtime = Number(rest);
        const age = mtime ? round(((f.now ?? nowFallback) - mtime) / 3600) : null;
        if (tag === "STILLS_MTIME") f.stillsLogAgeH = age; else f.healthLogAgeH = age;
      } else { section = tag; sections[section] = []; }
      continue;
    }
    if (section === "LAUNCHCTL") {
      const parts = line.trim().split(/\s+/);
      if (parts.length === 3) f.jobs.push({ label: parts[2], pid: parts[0] === "-" ? null : Number(parts[0]), status: parts[1] === "-" ? null : Number(parts[1]), lastExitReason: null });
    } else if (section) sections[section].push(line);
  }
  const stills = (sections.STILLS_LAST ?? []).filter((l) => l.trim());
  f.stillsTail = stills.slice(-60);
  const head = stills.find((l) => l.startsWith("[cam-stills] "));
  const at = head?.match(/^\[cam-stills\] (\S+)/)?.[1];
  f.stillsLastRunAt = at && !Number.isNaN(Date.parse(at)) ? at : null;
  const done = [...stills].reverse().find((l) => l.includes("done:"))?.match(/(\d+) stored, (\d+) blank, (\d+) failed/);
  if (done) f.stillsLastRun = { stored: +done[1], blank: +done[2], failed: +done[3] };
  f.stillsFailed = stills.filter((l) => l.trim().startsWith("✗")).map((l) => l.trim().slice(1).trim());
  f.healthLast = (sections.HEALTH_LAST ?? []).filter((l) => l.trim());
  return f;
}

async function miniFacts(): Promise<MiniFacts> {
  const script = MINI_SCRIPT.replaceAll("MINI_REPO", MINI_REPO);
  try {
    const { stdout } = await exec("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", MINI_HOST, script], { timeout: 60_000, maxBuffer: 4 << 20 });
    const f = parseMini(stdout);
    if (!stdout.includes("@@END")) { f.ok = false; f.error = "mini script did not finish"; }
    return f;
  } catch (e) {
    return { ok: false, error: `ssh ${MINI_HOST}: ${String((e as Error).message ?? e).split("\n")[0]}`, now: null, git: null, jobs: [], stillsLogAgeH: null, stillsLastRunAt: null, stillsLastRun: null, stillsFailed: [], stillsTail: [], healthLogAgeH: null, healthLast: [] };
  }
}

// ─── site ────────────────────────────────────────────────────────────────
async function siteFacts(db: DbFacts): Promise<SiteFacts> {
  const f: SiteFacts = { ok: true, home: null, resortPage: null, stills: [] };
  const UA = "peakcam-cam-check/1.0";
  try {
    const t0 = Date.now();
    const home = await fetch(`${SITE}/`, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    await home.arrayBuffer();
    f.home = { status: home.status, ms: Date.now() - t0 };
  } catch (e) { f.ok = false; f.error = `home: ${String((e as Error).message ?? e)}`; }
  const slug = db.capturedFronted[0];
  if (slug) {
    try {
      const r = await fetch(`${SITE}/resorts/${slug}`, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      const html = await r.text();
      f.resortPage = { slug, status: r.status, stillRefs: (html.match(/cam-stills\//g) ?? []).length };
    } catch (e) { f.ok = false; f.error = `${f.error ? f.error + "; " : ""}resort page: ${String((e as Error).message ?? e)}`; }
  }
  for (const url of db.sampleStillUrls) {
    try {
      const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
      f.stills.push({ url, status: r.status });
    } catch { f.stills.push({ url, status: 0 }); }
  }
  return f;
}

// ─── rules ───────────────────────────────────────────────────────────────
export function evaluate(f: Facts): Alert[] {
  const a: Alert[] = [];
  const add = (severity: Severity, code: string, message: string) => a.push({ severity, code, message });

  if (!f.db.ok) add("critical", "db_unreachable", `Supabase query failed: ${f.db.error}`);
  else {
    if (f.db.newestStillAgeH === null) add("critical", "no_stills", "No captured stills in the cams table at all");
    else if (f.db.newestStillAgeH > CAPTURE_INTERVAL_H * 2.5) add("critical", "stills_stale", `Newest captured still is ${f.db.newestStillAgeH} h old (job runs every ${CAPTURE_INTERVAL_H} h)`);
    if (f.baseline && f.db.coverage < f.baseline) add("warn", "coverage_drop", `Cards with a preview fell to ${f.db.coverage} of ${f.db.resorts} (baseline ${f.baseline}); without: ${f.db.noPreview.join(", ")}`);
    if (f.db.stillsOlder48h > 0) add("info", "stills_old", `${f.db.stillsOlder48h} cam(s) still showing a frame older than 48 h`);
    if (f.db.failing3plus >= 10) add("warn", "many_failing", `${f.db.failing3plus} active cams have 3+ consecutive health-check failures`);
  }

  if (!f.mini.ok) add("warn", "mini_unreachable", `Could not read the Mac mini: ${f.mini.error}`);
  else {
    const want = ["com.peakcam.cam-stills", "com.peakcam.cam-health-check"];
    for (const label of want) {
      const j = f.mini.jobs.find((x) => x.label === label);
      if (!j) { add("critical", "job_missing", `${label} is not loaded in launchd on the mini`); continue; }
      if (j.pid === null && j.status !== null && j.status !== 0) add("warn", "job_exit", `${label} last exited with status ${j.status}${j.lastExitReason ? ` (${j.lastExitReason})` : ""}`);
    }
    if (f.mini.stillsLogAgeH !== null && f.mini.stillsLogAgeH > CAPTURE_INTERVAL_H * 2.5) add("critical", "capture_not_running", `cam-capture-stills.log last written ${f.mini.stillsLogAgeH} h ago`);
    if (f.mini.stillsLastRun) {
      const { stored, failed } = f.mini.stillsLastRun;
      const total = stored + failed + f.mini.stillsLastRun.blank;
      if (total && stored === 0) add("critical", "capture_all_failed", `Last capture run stored nothing (${failed} failed of ${total})`);
      else if (total && failed / total > 0.4) add("warn", "capture_many_failed", `Last capture run: ${failed} of ${total} targets failed`);
    } else if (f.mini.stillsTail.length === 0) add("warn", "capture_log_empty", "No capture run found in cam-capture-stills.log");
    if (f.mini.healthLogAgeH !== null && f.mini.healthLogAgeH > HEALTH_INTERVAL_H * 1.3) add("warn", "health_check_stale", `cam-health-check.log last written ${f.mini.healthLogAgeH} h ago (job is daily)`);
    if (f.mini.stillsFailed.length) add("info", "capture_failures", `Failed captures last run: ${f.mini.stillsFailed.map((s) => s.split(":")[0]).join("; ")}`);
  }

  if (f.site.home && f.site.home.status !== 200) add("critical", "site_down", `${SITE} returned ${f.site.home.status}`);
  else if (!f.site.home && f.site.error) add("critical", "site_down", f.site.error);
  if (f.site.resortPage) {
    if (f.site.resortPage.status !== 200) add("warn", "resort_page", `/resorts/${f.site.resortPage.slug} returned ${f.site.resortPage.status}`);
    else if (f.site.resortPage.stillRefs === 0) add("warn", "still_not_rendered", `/resorts/${f.site.resortPage.slug} renders no cam-stills image although its card is fronted by a captured still`);
  }
  for (const s of f.site.stills) if (s.status !== 200) add("warn", "still_url", `Stored still not served (${s.status}): ${s.url}`);
  return a;
}

export function overallStatus(alerts: Alert[]): "OK" | "WARN" | "CRITICAL" {
  if (alerts.some((x) => x.severity === "critical")) return "CRITICAL";
  if (alerts.some((x) => x.severity === "warn")) return "WARN";
  return "OK";
}

// ─── markdown ────────────────────────────────────────────────────────────
export function toMarkdown(f: Facts, alerts: Alert[]): string {
  const L: string[] = [];
  L.push(`# PeakCam camera-preview check — ${f.ts}`, "", `Status: ${overallStatus(alerts)}`, "");
  L.push("## Rule alerts");
  if (!alerts.length) L.push("- none");
  for (const x of alerts) L.push(`- [${x.severity}] ${x.code}: ${x.message}`);
  L.push("", "## Database");
  if (!f.db.ok) L.push(`- unreachable: ${f.db.error}`);
  else {
    L.push(`- active resorts ${f.db.resorts}, active cams ${f.db.camsActive}, auto-disabled ${f.db.autoDisabled}, failing 3+ ${f.db.failing3plus}`);
    L.push(`- cards with a preview: ${f.db.coverage} of ${f.db.resorts} (baseline ${f.baseline || "unset"}); without: ${f.db.noPreview.join(", ") || "none"}`);
    L.push(`- captured stills: ${f.db.stills}, newest ${f.db.newestStillAt ?? "none"} (${f.db.newestStillAgeH ?? "n/a"} h ago), older than 48 h: ${f.db.stillsOlder48h}`);
    L.push(`- cards fronted by a captured still: ${f.db.capturedFronted.join(", ") || "none"}`);
  }
  L.push("", "## Mac mini (launchd)");
  if (!f.mini.ok) L.push(`- unreachable: ${f.mini.error}`);
  else {
    L.push(`- repo at ${f.mini.git ?? "?"}`);
    for (const j of f.mini.jobs) L.push(`- ${j.label}: ${j.pid !== null ? `running pid ${j.pid}` : `idle, last status ${j.status ?? "?"}`}${j.lastExitReason ? `, last exit reason ${j.lastExitReason}` : ""}`);
    L.push(`- capture log written ${f.mini.stillsLogAgeH ?? "?"} h ago; last run ${f.mini.stillsLastRunAt ?? "?"}: ${f.mini.stillsLastRun ? `${f.mini.stillsLastRun.stored} stored, ${f.mini.stillsLastRun.blank} blank, ${f.mini.stillsLastRun.failed} failed` : "no summary line"}`);
    for (const s of f.mini.stillsFailed) L.push(`  - failed: ${s.slice(0, 200)}`);
    L.push(`- health-check log written ${f.mini.healthLogAgeH ?? "?"} h ago`);
    for (const s of f.mini.healthLast) L.push(`  - ${s}`);
  }
  L.push("", "## Live site");
  if (f.site.home) L.push(`- ${SITE}/ → ${f.site.home.status} in ${f.site.home.ms} ms`); else L.push(`- home: ${f.site.error ?? "not checked"}`);
  if (f.site.resortPage) L.push(`- /resorts/${f.site.resortPage.slug} → ${f.site.resortPage.status}, ${f.site.resortPage.stillRefs} cam-stills references`);
  for (const s of f.site.stills) L.push(`- still HEAD ${s.status}: ${s.url}`);
  return L.join("\n") + "\n";
}

function round(n: number) { return Math.round(n * 10) / 10; }

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  const db = await dbFacts();
  const [mini, site] = await Promise.all([
    NO_MINI ? Promise.resolve<MiniFacts>({ ok: false, error: "skipped (--no-mini)", now: null, git: null, jobs: [], stillsLogAgeH: null, stillsLastRunAt: null, stillsLastRun: null, stillsFailed: [], stillsTail: [], healthLogAgeH: null, healthLast: [] }) : miniFacts(),
    NO_SITE ? Promise.resolve<SiteFacts>({ ok: false, error: "skipped (--no-site)", home: null, resortPage: null, stills: [] }) : siteFacts(db),
  ]);
  const facts: Facts = { ts: new Date().toISOString(), baseline: BASELINE, db, mini, site };
  const alerts = evaluate(facts);
  const out = { status: overallStatus(alerts), alerts, facts };
  const md = toMarkdown(facts, alerts);
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
  if (MD_OUT) fs.writeFileSync(MD_OUT, md);
  if (!JSON_OUT && !MD_OUT) process.stdout.write(md);
  else console.log(`[cam-check] ${out.status}: ${alerts.length} alert(s); coverage ${db.coverage}/${db.resorts}; newest still ${db.newestStillAgeH ?? "n/a"} h`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error("[cam-check] fatal:", e); process.exit(1); });
