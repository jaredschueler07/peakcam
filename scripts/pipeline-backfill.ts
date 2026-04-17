#!/usr/bin/env tsx

/**
 * pipeline-backfill.ts
 * ────────────────────
 * One-shot runner for the multi-source pipeline. Intended for the
 * initial backfill after migration 007 and as the ongoing daily sync
 * target for launchd (see ~/Library/LaunchAgents/com.peakcam.pipeline.plist).
 *
 * The orchestrator (lib/pipeline/orchestrator.ts → runPipelineSync)
 * fans out across all active resorts and handles rate limiting, so
 * this script just loads env and invokes it once.
 *
 * Usage:
 *   npx tsx scripts/pipeline-backfill.ts
 *   npx tsx scripts/pipeline-backfill.ts --dry-run
 *
 * Note: env MUST be loaded before importing the orchestrator, because
 * the orchestrator transitively imports lib/supabase.ts which validates
 * NEXT_PUBLIC_SUPABASE_* at module evaluation time.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Load .env.local manually — must run before importing orchestrator ──

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

loadEnv(path.join(ROOT, ".env.local"));
loadEnv(path.join(ROOT, ".env"));

// ── Parse args ──────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// ── Run (dynamic import so env is set before orchestrator load) ──

async function main(): Promise<void> {
  const started = new Date().toISOString();
  console.log(`[pipeline-backfill] start=${started} dryRun=${dryRun}`);

  const { runPipelineSync } = await import("../lib/pipeline/orchestrator");
  await runPipelineSync({ dryRun });

  const finished = new Date().toISOString();
  console.log(`[pipeline-backfill] done=${finished}`);
}

main().catch((err) => {
  console.error(
    "[pipeline-backfill] Fatal:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
});
