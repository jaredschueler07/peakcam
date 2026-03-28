#!/usr/bin/env tsx

/**
 * pipeline-sync.ts
 * ────────────────
 * CLI wrapper for the multi-source pipeline orchestrator.
 * Fetches data from all sources, blends per resort, and writes
 * blended conditions to Supabase.
 *
 * Usage:
 *   npx tsx scripts/pipeline-sync.ts
 *   npx tsx scripts/pipeline-sync.ts --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPipelineSync } from "../lib/pipeline/orchestrator";

// ─── Load .env.local manually ────────────────────────────────

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

// ─── Parse args ──────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

// ─── Run ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[pipeline-sync] PeakCam Multi-Source Pipeline");
  console.log(`[pipeline-sync] Mode: ${dryRun ? "DRY RUN" : "LIVE"}\n`);

  await runPipelineSync({ dryRun });

  console.log("\n[pipeline-sync] Complete.");
}

main().catch((err) => {
  console.error(
    "[pipeline-sync] Fatal:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
