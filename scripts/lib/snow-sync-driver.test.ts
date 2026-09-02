import test from "node:test";
import assert from "node:assert/strict";

import {
  runSnowSync,
  type ResortOutcome,
  type SyncResort,
} from "./snow-sync-driver";

interface Harness {
  lines: string[];
  errors: string[];
  sleeps: number[];
}

function harness(): Harness {
  return { lines: [], errors: [], sleeps: [] };
}

function opts(
  h: Harness,
  resorts: SyncResort[],
  syncResort: (r: SyncResort) => Promise<ResortOutcome>,
  extra: Partial<Parameters<typeof runSnowSync>[0]> = {},
) {
  return {
    label: "test-sync",
    startLine: "Starting test sync...",
    foundLine: (n: number) => `Found ${n} resorts`,
    fetchResorts: async () => resorts,
    syncResort,
    sleepFn: async (ms: number) => {
      h.sleeps.push(ms);
    },
    log: (m: string) => h.lines.push(m),
    errorLog: (m: string) => h.errors.push(m),
    ...extra,
  };
}

const R = (id: string, name: string): SyncResort => ({ id, name });

test("tallies ok, skip and thrown results independently", async () => {
  const h = harness();
  const result = await runSnowSync(
    opts(h, [R("1", "Alta"), R("2", "Vail"), R("3", "Taos")], async (r) => {
      if (r.name === "Vail") return { status: "skip", log: `  SKIP ${r.name} — no data` };
      if (r.name === "Taos") throw new Error("SNOTEL API error 500");
      return { status: "ok", log: `  OK   ${r.name}` };
    }),
  );

  assert.deepEqual(result, { total: 3, success: 1, noData: 1, failed: 1 });
});

test("prints the two header lines with the label and a trailing blank line", async () => {
  const h = harness();
  await runSnowSync(opts(h, [], async () => ({ status: "ok", log: "" })));

  assert.equal(h.lines[0], "[test-sync] Starting test sync...\n");
  assert.equal(h.lines[1], "[test-sync] Found 0 resorts\n");
});

test("prints the summary line in the exact launchd-log shape", async () => {
  const h = harness();
  await runSnowSync(
    opts(h, [R("1", "Alta"), R("2", "Vail")], async (r) =>
      r.name === "Alta"
        ? { status: "ok", log: "  OK   Alta" }
        : { status: "skip", log: "  SKIP Vail" },
    ),
  );

  assert.equal(
    h.lines.at(-1),
    "\n[test-sync] Done. 1 synced, 1 no data, 0 failed (of 2 total)",
  );
});

test("passes the per-resort log line through verbatim", async () => {
  const h = harness();
  await runSnowSync(
    opts(h, [R("1", "Alta")], async () => ({
      status: "ok",
      log: "  OK   Alta — base: 40in, SWE: 12in",
    })),
  );

  assert.ok(h.lines.includes("  OK   Alta — base: 40in, SWE: 12in"));
});

test("a thrown Error becomes a FAIL line on the error channel and does not stop the run", async () => {
  const h = harness();
  const seen: string[] = [];
  const result = await runSnowSync(
    opts(h, [R("1", "Alta"), R("2", "Vail")], async (r) => {
      seen.push(r.name);
      if (r.name === "Alta") throw new Error("boom");
      return { status: "ok", log: "  OK   Vail" };
    }),
  );

  assert.deepEqual(seen, ["Alta", "Vail"], "the loop continues past a failure");
  assert.deepEqual(h.errors, ["  FAIL Alta — boom"]);
  assert.equal(result.failed, 1);
  assert.equal(result.success, 1);
});

test("a non-Error throw is stringified into the FAIL line", async () => {
  const h = harness();
  await runSnowSync(
    opts(h, [R("1", "Alta")], async () => {
      throw "plain string";
    }),
  );
  assert.deepEqual(h.errors, ["  FAIL Alta — plain string"]);
});

test("sleeps 300ms after every resort, including skipped and failed ones", async () => {
  const h = harness();
  await runSnowSync(
    opts(h, [R("1", "A"), R("2", "B"), R("3", "C")], async (r) => {
      if (r.name === "B") return { status: "skip", log: "  SKIP B" };
      if (r.name === "C") throw new Error("x");
      return { status: "ok", log: "  OK   A" };
    }),
  );
  assert.deepEqual(h.sleeps, [300, 300, 300]);
});

test("delayMs overrides the default rate limit", async () => {
  const h = harness();
  await runSnowSync(
    opts(h, [R("1", "A")], async () => ({ status: "ok", log: "" }), {
      delayMs: 50,
    }),
  );
  assert.deepEqual(h.sleeps, [50]);
});

test("a fetchResorts rejection propagates instead of being swallowed", async () => {
  const h = harness();
  await assert.rejects(
    () =>
      runSnowSync({
        ...opts(h, [], async () => ({ status: "ok", log: "" })),
        fetchResorts: async () => {
          throw new Error("Supabase resorts fetch failed (401): bad key");
        },
      }),
    /Supabase resorts fetch failed \(401\)/,
  );
});
