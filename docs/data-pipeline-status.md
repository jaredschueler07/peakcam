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

## Blocker Surfaced — snow_reports.source constraint

`lib/pipeline/orchestrator.ts:206` writes `source: 'pipeline'` to `snow_reports`, but migration 001 constrains that column to `('snotel','manual','resort')`. The initial constraint predates the multi-source pipeline.

**Fix:** migration `010_extend_snow_reports_source.sql` (this commit) extends the constraint. Pending human apply.

## Schedule — prepared, NOT yet active

Launchd plist written at `~/Library/LaunchAgents/com.peakcam.pipeline.plist` (Disabled=true). After migration 010 is applied:

1. Edit plist: remove `<key>Disabled</key><true/>` pair
2. `mkdir -p ~/peakcam/peakcam/logs`
3. `launchctl load ~/Library/LaunchAgents/com.peakcam.pipeline.plist`
4. Verify with `launchctl list | grep com.peakcam.pipeline`
5. Run `npx tsx scripts/pipeline-backfill.ts` once manually to seed

Schedule: daily 06:00 local. Logs: `logs/pipeline.log` and `logs/pipeline.err`.

## resort_metadata — POPULATE (keep table, run existing seed)

Grep of `app components lib scripts supabase` for `resort_metadata`:

- **Readers (load-bearing):**
  - `lib/pipeline/orchestrator.ts:112` — orchestrator fetches `resort_metadata` on every run to enrich each resort with `liftie_slug`, `weather_unlocked_id`, `openskistats_id`, `snodas_grid_x/y`, elevation + run/lift counts. Without this, the multi-source fetchers lose their per-resort config.
- **Readers (dead code, not called anywhere):**
  - `lib/supabase.ts:218` exports `getResortWithMetadata`, but grep shows no callers in `app/` or `components/`. Kept as-is (out of scope).
- **Writers:**
  - `scripts/seed-openskistats.ts` — downloads OpenSkiData GeoJSON, matches resorts, upserts into `resort_metadata`. Already implemented; has not been run yet (hence 0 rows).

**Decision:** KEEP the table and POPULATE it by running the existing `scripts/seed-openskistats.ts`. No new migration or seed script required.

**Human action after migration 010 lands:**

```bash
# Preview the match set
npx tsx scripts/seed-openskistats.ts --dry-run

# If the preview looks right, upsert for real
npx tsx scripts/seed-openskistats.ts
```

Then the orchestrator run (either manual `scripts/pipeline-backfill.ts` or the 06:00 launchd trigger) will pick up the enriched metadata and start writing `data_source_readings` + `resort_conditions_summary`.

## Additional Discovery Findings

A test backfill was attempted against prod before migration 010 lands; as expected the `snow_reports` inserts failed on the check constraint (log at `logs/pipeline-backfill.log`). The same run also surfaced three secondary issues not tied to migration 010:

1. **SNOTEL HTML error parsing** — when the NRCS SNOTEL server is unavailable, the fetcher parses the HTML error page (`<p class="note">The server is currently unavailable...</p>`) as a date column and throws PostgREST `22007` on every resort. Only affects outage windows; independent of migration 010. File a V0.5 bug: `lib/pipeline/fetchers/snotel.ts` needs content-type validation before passing the response to the parser.
2. **`user_conditions.submitted_at` schema mismatch** — the user-reports fetcher selects a column that doesn't exist in the `user_conditions` table. Will still fail after migration 010. File a V0.5 bug: either add the column via a new migration or update the fetcher's select list.
3. **SNODAS tar missing file `1036`** — every resort's SNODAS fetch fails to find the snow-depth product file. May be an upstream catalog change or a stale filename constant. File a V0.5 bug.

None of the three blocks launch: alerts (the user-visible V0 feature) runs off `snow_reports` which is populated by `npm run snotel-sync`. The pipeline's role is the *richer* conditions engine (`% of normal`, trend, outlook) which is nice-to-have for V0 launch but not critical.

