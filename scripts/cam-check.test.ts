import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, overallStatus, parseMini, toMarkdown, type Facts } from "./cam-check";

const MINI_OUT = `@@NOW 1760565000
@@GIT 0837a84
@@LAUNCHCTL
-\t0\tcom.peakcam.cam-stills
2503\t0\tcom.peakcam.agents
-\t-9\tcom.peakcam.cam-health-check
@@EXIT com.peakcam.cam-stills
@@EXIT com.peakcam.cam-health-check OS_REASON_CODESIGNING
@@STILLS_MTIME ${1760565000 - 3600}
@@STILLS_LAST
[cam-stills] 2026-10-15T21:09:46.240Z 28 click-to-play cams without a provider still
  ✗ wachusett/Summit: [in#0] Error opening input: Server returned 404 Not Found
  ✓ wachusett/NASTAR: 1280x720 via hls
  ✗ big-sky/Ramcharger: camstreamer not fronted by youtube (200)
[cam-stills] done: 25 stored, 0 blank, 3 failed
@@HEALTH_MTIME ${1760565000 - 40 * 3600}
@@HEALTH_LAST
[cam-health] Done. 345/374 cams healthy.
[cam-health] 0 disabled this run, 1 recovered, 1 failing TLS
@@END
`;

function facts(over: Partial<Facts> = {}): Facts {
  return {
    ts: "2026-10-15T22:00:00.000Z",
    baseline: 140,
    db: { ok: true, resorts: 148, camsActive: 413, autoDisabled: 60, failing3plus: 2, stills: 25, newestStillAt: "2026-10-15T21:09:00Z", newestStillAgeH: 0.9, stillsOlder48h: 0, coverage: 140, noPreview: ["loon"], capturedFronted: ["las-lenas"], sampleStillUrls: ["https://x/cam-stills/a.jpg"] },
    mini: parseMini(MINI_OUT),
    site: { ok: true, home: { status: 200, ms: 190 }, resortPage: { slug: "las-lenas", status: 200, stillRefs: 3 }, stills: [{ url: "https://x/cam-stills/a.jpg", status: 200 }] },
    ...over,
  };
}

test("parseMini reads launchd rows, exit reasons, log ages and the last capture run", () => {
  const m = parseMini(MINI_OUT);
  assert.equal(m.ok, true);
  assert.equal(m.git, "0837a84");
  assert.equal(m.jobs.length, 3);
  const health = m.jobs.find((j) => j.label === "com.peakcam.cam-health-check")!;
  assert.equal(health.status, -9);
  assert.equal(health.lastExitReason, "OS_REASON_CODESIGNING");
  const agents = m.jobs.find((j) => j.label === "com.peakcam.agents")!;
  assert.equal(agents.pid, 2503);
  assert.equal(m.stillsLogAgeH, 1);
  assert.equal(m.healthLogAgeH, 40);
  assert.equal(m.stillsLastRunAt, "2026-10-15T21:09:46.240Z");
  assert.deepEqual(m.stillsLastRun, { stored: 25, blank: 0, failed: 3 });
  assert.equal(m.stillsFailed.length, 2);
  assert.ok(m.stillsFailed[0].startsWith("wachusett/Summit"));
  assert.equal(m.healthLast.length, 2);
});

test("a healthy pipeline with a stale daily health check is WARN, not CRITICAL", () => {
  const alerts = evaluate(facts());
  const codes = alerts.map((a) => a.code);
  assert.ok(codes.includes("health_check_stale"), codes.join(","));
  assert.ok(codes.includes("job_exit"));
  assert.ok(codes.includes("capture_failures"));
  assert.equal(overallStatus(alerts), "WARN");
});

test("stale stills, a missing job or a dead site are CRITICAL", () => {
  const stale = facts({ db: { ...facts().db, newestStillAgeH: 7 } });
  assert.equal(overallStatus(evaluate(stale)), "CRITICAL");
  const missing = facts({ mini: { ...facts().mini, jobs: facts().mini.jobs.filter((j) => j.label !== "com.peakcam.cam-stills") } });
  assert.ok(evaluate(missing).some((a) => a.code === "job_missing" && a.severity === "critical"));
  const down = facts({ site: { ...facts().site, home: { status: 503, ms: 10 } } });
  assert.ok(evaluate(down).some((a) => a.code === "site_down"));
});

test("coverage below the baseline warns and names the resorts without a preview", () => {
  const f = facts({ db: { ...facts().db, coverage: 137, noPreview: ["loon", "mt-baldy", "ski-bowl"] } });
  const drop = evaluate(f).find((a) => a.code === "coverage_drop")!;
  assert.equal(drop.severity, "warn");
  assert.match(drop.message, /137 of 148/);
  assert.match(drop.message, /mt-baldy/);
});

test("a clean run has only info alerts and renders OK markdown", () => {
  const m = parseMini(MINI_OUT.replace("-\t-9\tcom.peakcam.cam-health-check", "-\t0\tcom.peakcam.cam-health-check").replace(`@@HEALTH_MTIME ${1760565000 - 40 * 3600}`, `@@HEALTH_MTIME ${1760565000 - 3600}`));
  const f = facts({ mini: m });
  const alerts = evaluate(f);
  assert.equal(overallStatus(alerts), "OK");
  const md = toMarkdown(f, alerts);
  assert.match(md, /^# PeakCam camera-preview check/);
  assert.match(md, /Status: OK/);
  assert.match(md, /cards with a preview: 140 of 148/);
});

test("an unreachable mini is a warning and an unreachable database is critical", () => {
  const noMini = facts({ mini: { ...facts().mini, ok: false, error: "ssh mini: timeout" } });
  assert.equal(overallStatus(evaluate(noMini)), "WARN");
  const noDb = facts({ db: { ...facts().db, ok: false, error: "cams 500" } });
  assert.equal(overallStatus(evaluate(noDb)), "CRITICAL");
});
