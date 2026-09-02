/**
 * scripts/lib/pipeline-cli.ts
 * ───────────────────────────
 * The single CLI body behind scripts/pipeline-sync.ts and
 * scripts/pipeline-backfill.ts, which were byte-for-byte the same script
 * apart from their log labels.
 *
 * The dynamic `import()` below is load-bearing, not stylistic:
 * lib/pipeline/orchestrator.ts → fetchers/user-reports.ts → lib/supabase.ts,
 * and lib/supabase.ts throws at module-evaluation time when
 * NEXT_PUBLIC_SUPABASE_* is unset. A static import is hoisted above
 * `loadEnv()`, so pipeline-sync.ts used to blow up before it had a chance to
 * read .env.local. Keep the import inside the function.
 *
 * (The orchestrator's own `getEnv()` is lazy, but that is not enough — the
 * throw comes from lib/supabase.ts, one module further down.)
 */

import { loadEnv } from "./env.mjs";
import { runScript } from "./snow-sync-driver.js";

export interface PipelineCliOptions {
  /** Bracketed log prefix, e.g. `pipeline-sync`. */
  label: string;
  /** Defaults to process.argv. */
  argv?: string[];
}

export async function runPipelineCli(opts: PipelineCliOptions): Promise<void> {
  const { label, argv = process.argv.slice(2) } = opts;

  loadEnv();

  const dryRun = argv.includes("--dry-run");
  const started = new Date().toISOString();
  console.log(`[${label}] start=${started} dryRun=${dryRun}`);

  const { runPipelineSync } = await import("../../lib/pipeline/orchestrator.js");
  await runPipelineSync({ dryRun });

  console.log(`[${label}] done=${new Date().toISOString()}`);
}

/** Run `runPipelineCli` as a process, exiting 1 with a stack on failure. */
export function mainPipelineCli(label: string): void {
  runScript(label, () => runPipelineCli({ label }), { includeStack: true });
}
