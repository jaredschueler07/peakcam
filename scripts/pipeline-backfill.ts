#!/usr/bin/env tsx

/**
 * pipeline-backfill.ts
 * ────────────────────
 * One-shot runner for the multi-source pipeline. Intended for the
 * initial backfill after migration 007 and as the ongoing daily sync
 * target for launchd (see ~/Library/LaunchAgents/com.peakcam.pipeline.plist,
 * which invokes this exact path — keep the filename).
 *
 * Identical to scripts/pipeline-sync.ts apart from the log label; both share
 * scripts/lib/pipeline-cli.ts.
 *
 * Usage:
 *   npx tsx scripts/pipeline-backfill.ts
 *   npx tsx scripts/pipeline-backfill.ts --dry-run
 */

import { mainPipelineCli } from "./lib/pipeline-cli.js";

mainPipelineCli("pipeline-backfill");
