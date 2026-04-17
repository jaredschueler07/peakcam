# Data Pipeline Status — 2026-04-17

## Row counts (from scripts/pipeline-inspect.mjs)
| Table | Rows | Latest row |
|---|---|---|
| data_source_readings | 0 | n/a |
| resort_conditions_summary | 0 | n/a |
| resort_metadata | 0 | n/a |

## Analysis

### Entry point
- Orchestrator: `lib/pipeline/orchestrator.ts` exports `runPipelineSync({ dryRun })`
- CLI wrapper: `scripts/pipeline-sync.ts` (loads `.env.local`, parses `--dry-run`, calls `runPipelineSync`)
- The orchestrator fans out per-resort (`fetchActiveResorts()` pulls all `is_active=true` rows) and runs SNOTEL, NWS, Liftie, SNODAS, Weather Unlocked, and user-reports fetchers, blends them, and writes to `data_source_readings`, `resort_conditions_summary`, `snow_reports`, and `resorts.cond_rating`.

### Scheduler status — NOT WIRED
- `vercel.json` only contains a cron for `/api/alerts/trigger` (daily 13:00 UTC). No pipeline cron.
- `~/Library/LaunchAgents/` has `com.peakcam.agents.plist`, `com.peakcam.cam-health-check.plist`, `com.peakcam.snotel-sync.plist` — no `com.peakcam.pipeline.plist`.
- No other caller of `runPipelineSync` / `pipeline/orchestrator` in `app/`, `lib/`, `scripts/` (grep confirms only `scripts/pipeline-sync.ts`).

**Conclusion:** the pipeline has never been scheduled in production. That is why all three tables are empty. The code is ready; it just needs to be run + scheduled. Tasks 3.4 and 3.5 below address this.

