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
 *
 * The body lives in scripts/lib/pipeline-cli.ts, shared with
 * scripts/pipeline-backfill.ts (the launchd entry point).
 */

import { mainPipelineCli } from "./lib/pipeline-cli.js";

mainPipelineCli("pipeline-sync");
