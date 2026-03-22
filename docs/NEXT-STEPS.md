# PeakCam — Next Steps

> Post `feat/map-overhaul` branch. Covers activation of the snow conditions engine, UI integration, and future enhancements.

---

## 1. Activate Snow Conditions Engine

These steps must be done in order to bring the new conditions pipeline online.

### 1.1 Apply Database Migration

Run `supabase/migrations/005_snowpack_history.sql` in the Supabase SQL Editor (Dashboard → SQL Editor → paste contents → Run).

This creates:
- `snowpack_daily` table (daily SNOTEL time-series, multi-year archive)
- `snotel_normals` table (30-year median SWE/depth by day-of-water-year)
- Five new columns on `snow_reports`: `swe_in`, `pct_of_normal`, `trend_7d`, `outlook`, `auto_cond_rating`
- RLS policies (public read) on both new tables

**Verify:** In Supabase Table Editor, confirm `snowpack_daily` and `snotel_normals` tables exist, and `snow_reports` has the new columns.

### 1.2 Seed 30-Year Normals

```bash
npm run seed-normals
```

This fetches 1991–2020 period-of-record SWE and snow depth data from the NRCS AWDB REST API for each unique SNOTEL station across all resorts. It computes median, 10th percentile, and 90th percentile by day-of-water-year and inserts into `snotel_normals`.

- Takes ~2-5 minutes (30 unique stations, 1s delay between each)
- Idempotent — safe to re-run (deletes existing station rows before inserting)
- Re-run annually on October 1 (start of water year) to incorporate latest year

**Verify:** `SELECT count(*) FROM snotel_normals;` should return ~5,000-10,000 rows (30 stations × ~180-300 active days each).

### 1.3 Run First Sync

```bash
npm run snotel-sync
```

This runs the enhanced pipeline:
1. Fetches SNOTEL data (SNWD, WTEQ, PREC, TOBS, TMAX, TMIN)
2. Validates via data quality engine (range, spike, missing checks)
3. Writes to `snowpack_daily`
4. Looks up normals for today's water-year day
5. Computes 7-day SWE trend
6. Fetches NWS forecast (next-48h snow + max high temp)
7. Runs conditions engine → rating, % of normal, trend, outlook
8. Inserts into `snow_reports` with all new fields
9. Updates `resorts.cond_rating` with computed rating

**Verify:**
```sql
-- Check snowpack_daily has today's data
SELECT count(*) FROM snowpack_daily WHERE date = CURRENT_DATE;

-- Check snow_reports has conditions data
SELECT r.name, sr.base_depth, sr.swe_in, sr.pct_of_normal,
       sr.trend_7d, sr.outlook, sr.auto_cond_rating
FROM latest_snow_reports sr
JOIN resorts r ON r.id = sr.resort_id
ORDER BY r.name LIMIT 20;

-- Check resorts.cond_rating is now data-driven
SELECT name, cond_rating FROM resorts WHERE is_active = true ORDER BY name LIMIT 20;
```

### 1.4 Set Up Cron

Schedule `npm run snotel-sync` to run hourly. Options:

**Vercel Cron (if deployed on Vercel):**
Create `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/snotel-sync", "schedule": "0 * * * *" }
  ]
}
```
Then create an API route at `app/api/cron/snotel-sync/route.ts` that calls the sync logic.

**System cron (for self-hosted / dev):**
```bash
crontab -e
# Add:
0 * * * * cd /path/to/peakcam && npm run snotel-sync >> logs/snotel-sync.log 2>&1
```

**GitHub Actions:**
```yaml
name: SNOTEL Sync
on:
  schedule:
    - cron: '0 * * * *'
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run snotel-sync
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

---

## 2. UI Integration (New Spec Needed)

The conditions engine computes data but the frontend doesn't display it yet. A separate UI spec should cover:

### 2.1 Resort Detail Page (`/resorts/[slug]`)
- **% of Normal badge** — Show "115% of Normal" or "Below Normal (72%)" next to the snow report
- **Trend indicator** — Arrow icon: ↑ rising (green), → stable (gray), ↓ falling (red)
- **Outlook label** — Display the `outlookLabel` string (e.g., "More snow expected — 6\" in the forecast")
- **SWE display** — Show Snow Water Equivalent alongside base depth
- **Season SWE chart** — Sparkline or area chart showing SWE over the water year vs. the 30-year median band (requires querying `snowpack_daily` and `snotel_normals`)

### 2.2 Browse Page Cards (`SummitResortCard`)
- Add trend arrow icon to each card
- Show % of normal as a small label (e.g., "115%▲" in green)
- Outlook indicator (snowflake icon for "more_snow", sun for "warming")

### 2.3 Snow Report Page (`/snow-report`)
- Add columns: SWE, % of Normal, Trend, Outlook
- Color-code % of normal: green (>110%), white (90-110%), yellow (70-90%), red (<70%)
- Sort by % of normal option

### 2.4 Map Integration
- Metric toggle on the map: add "% Normal" as a 4th metric option
- Color markers by % of normal instead of condition rating (optional mode)

---

## 3. MapTiler API Key

The map uses MapTiler for dark terrain tiles with hillshading.

- **Current key:** Set in `.env.local` as `NEXT_PUBLIC_MAPTILER_KEY`
- **Free tier:** 300,000 sessions/month — sufficient for V0
- **Production:** Monitor usage at [cloud.maptiler.com](https://cloud.maptiler.com). If approaching limit, upgrade or add domain restriction to prevent abuse
- **Fallback:** Without the key, map falls back to Carto Dark Matter (flat, no terrain)

---

## 4. Data Quality Monitoring

### 4.1 QC Flag Dashboard
Build a simple admin view or SQL query to monitor data quality:
```sql
SELECT qc_flag, count(*)
FROM snowpack_daily
WHERE date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY qc_flag;
```

Healthy state: >90% `valid`, <5% `suspect`, <5% `missing`, rare `corrected`.

### 4.2 Station Coverage Audit
Some resorts may lack SNOTEL stations or have poor coverage. Periodically check:
```sql
SELECT r.name, r.snotel_station_id,
       (SELECT max(date) FROM snowpack_daily sd WHERE sd.resort_id = r.id) as last_data
FROM resorts r
WHERE r.is_active = true AND r.snotel_station_id IS NOT NULL
ORDER BY last_data NULLS FIRST;
```

Resorts with `last_data` more than 3 days old may have station issues.

---

## 5. Future Enhancements

### 5.1 Improved NWS Snow Estimates
The current NWS snow forecast uses a keyword heuristic ("heavy snow" → 8", "snow" → 3"). For better accuracy:
- Use the NWS **hourly forecast** endpoint (`/gridpoints/{wfo}/{x},{y}/forecast/hourly`)
- Extract the `quantitativePrecipitation` field when available
- Apply a snow-to-liquid ratio (typically 10:1 to 15:1 depending on temperature)

### 5.2 Resort-Reported Data Integration
Add a scraper or API integration to pull official resort-reported data:
- Trails open / total
- Lifts open / total
- Official conditions description
- Update the `source` field to `'resort'` for these entries

### 5.3 SNODAS Gridded Data
NOAA's SNODAS provides 1km resolution gridded snow data. Could be used to:
- Interpolate conditions between SNOTEL stations
- Provide snowpack data for resorts without a nearby SNOTEL station
- Archive: `https://noaadata.apps.nsidc.org/NOAA/G02158/`

### 5.4 Historical Comparison UI
With multi-year data in `snowpack_daily`, build:
- "This year vs. last year" SWE comparison chart
- "Best/worst season" rankings
- Year-over-year snow depth animations

### 5.5 Powder Alert Enhancement
Integrate the conditions engine with the existing powder alert system:
- Trigger alerts based on `auto_cond_rating = 'great'` OR `outlook = 'more_snow'`
- Include % of normal in alert emails
- "Above Normal Powder Alert" for sustained high snowpack + fresh snow

### 5.6 Condition Rating Calibration
The rating thresholds in `lib/conditions-engine.ts` are initial values:
```typescript
const RATING_THRESHOLDS = {
  great: { newSnow24h: 6, newSnow48h: 12 },
  good:  { newSnow24h: 2, pctOfNormal: 100, minDepth: 24 },
  fair:  { pctOfNormal: 70, minDepth: 20 },
};
```
After a full season of data, analyze correlation between ratings and user engagement (PostHog events) to calibrate thresholds. Consider region-specific thresholds (Pacific Northwest gets more snow than Colorado, so "great" might need a higher bar).

---

## 6. Deployment Checklist

Before merging `feat/map-overhaul` to main:

- [ ] Apply migration `005_snowpack_history.sql` to production Supabase
- [ ] Run `npm run seed-normals` against production database
- [ ] Run `npm run snotel-sync` and verify output
- [ ] Set up hourly cron for `snotel-sync`
- [ ] Verify MapTiler key is set in Vercel environment variables
- [ ] Test `/map` route on production
- [ ] Test browse page sidebar map
- [ ] Monitor `snowpack_daily` growth for 24 hours
- [ ] Verify `resorts.cond_rating` is being updated automatically
- [ ] Remove old manually-set `cond_rating` values (they'll be overwritten on first sync)
