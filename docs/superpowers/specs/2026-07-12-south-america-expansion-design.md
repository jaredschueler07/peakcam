# South America Expansion — Design

> **Status: APPROVED 2026-07-12.** Approach A, the resort list, and the ambiguous-case decisions in Section 5 are all confirmed. **Ownership split:** Section 6 (Featuring & copy) and the UI/image work were handed off to Grok Code via a separate prompt — this repo's Claude Code work covers everything else: migration 012, `lib/open-meteo.ts`, `scripts/model-sync.ts`, the conditions-engine trend-threshold change, the snotel-sync elevation-bug fix, and seed data (`data/resorts.csv`/`data/cams.csv`). The implementation plan for that backend scope is in `docs/superpowers/plans/` (see `writing-plans` output).

## Goal

Expand PeakCam to ~20–25 ski resorts in Chile and Argentina during the live Andes season (June–October), with webcams, model-based snow data, computed condition ratings, forecasts, and powder-alert eligibility. Feature the expansion on the homepage while North America is off-season.

## Requirements (confirmed)

- **Sequencing:** SA expansion ships first; cam-viewing improvements are a separate follow-up spec.
- **Parity at launch:** cams + snow depth + 24/48h new snow + forecast + condition rating + powder alerts. No % of normal, no 30-year climatology. 7-day trend included where derivable from accumulated depth history.
- **Scope:** comprehensive list, ~20–25 resorts across Chile and Argentina; resorts may ship cam-light where no working cam is found.
- **Positioning:** featured — homepage popular ranking, featured row, updated copy and SEO metadata.

## Non-goals

- Fixing or consolidating `lib/pipeline/` (the dormant multi-source pipeline). This design deliberately follows the proven `snotel-sync` pattern instead.
- Spanish/Portuguese i18n.
- Cam player UX changes (separate spec).
- Andes climatology / % of normal (future enhancement).

## Approach (selected: A — model-sync script following the snotel-sync pattern)

A new sync script fetches **Open-Meteo** (keyless, global) for every active resort **without a SNOTEL station** and writes the same tables the site already reads. SA resorts become indistinguishable from NA resorts to the UI.

**Verified 2026-07-12 with live API calls:** Open-Meteo serves Andes coordinates with hourly `snowfall` (cm), `snow_depth` (m), `temperature_2m`, `wind_gusts_10m`, `cloud_cover`, `freezing_level_height` (m), `past_days=2` for 24/48h accumulation sums, and an `elevation=` override that pins the model to resort elevation (Valle Nevado: model elev 2993m, 10.8cm/48h; Catedral @1900m: 51cm depth). Free tier limits (~10k req/day) are far above our need (~60 resorts × 4 runs/day).

**Deliberate scope choice:** the script targets *all* resorts with `snotel_station_id IS NULL` — not just SA. This also lights up the ~37 existing resorts (incl. BC/Whistler) that currently get no snow updates at all, using the identical code path. SNOTEL resorts stay on `snotel-sync`; the two sets are disjoint by construction, so the two scripts never fight over `cond_rating`.

### Rejected alternatives

- **B — resurrect `lib/pipeline/`:** architecturally attractive but requires repairing stubbed blender inputs, an upsert bug, and output tables nothing reads. A consolidation project, not an expansion project.
- **C — live fetch at page render:** browse cards, ticker, `/snow-report`, and alerts read the DB; SA resorts would look dead everywhere except their own page.

## Components

### 1. Migration 012 (`supabase/migrations/012_south_america.sql`)

- `resorts.country text not null default 'US'`; backfill `'CA'` where `state = 'BC'`.
- Extend `snow_reports_source_check` to admit `'open_meteo'` (same drop/recreate pattern as migration 010).
- Applied by hand (SQL Editor / MCP), consistent with existing practice. Update `lib/types.ts` `SnowReportSource` to `'snotel' | 'manual' | 'resort' | 'pipeline' | 'open_meteo'` (fixing the existing drift that omits `'pipeline'`).

### 2. `lib/open-meteo.ts` — typed fetcher + formatters

One module, pure I/O + conversion, mirroring `lib/weather.ts`'s role:

- `getOpenMeteoSnapshot(lat, lng, elevationFt?)` → `{ snowDepthIn, newSnow24hIn, newSnow48hIn, forecastSnow48hIn, maxHighTemp48hF, skyCoverAvg, windGustMaxMph, freezingLevelFt, tempF }`. Conversions: cm→in, m→ft, °C→°F, km/h→mph. 24/48h new snow = sums of hourly `snowfall` over `past_days` — *measured model accumulation, better than the NWS keyword heuristic used for NA*.
- `getOpenMeteoForecast(lat, lng, elevationFt?)` → `WeatherPeriod[]` (5-day) and `getOpenMeteoHourly(...)` → `HourlyWeather[]`, shaped exactly like `lib/weather.ts` outputs so `WeatherStrip`/`ForecastTable`/`HourlyTimeline` render unchanged. Weather-code → condition-slug mapping reuses the existing 12 icon slugs.
- Elevation passed to the model: midpoint of `elevation_base_ft` and `elevation_summit_ft` when both exist in `resort_metadata`; else `elevation_base_ft`; else omit the param and accept Open-Meteo's grid elevation.

### 3. `scripts/model-sync.ts` — the sync script

Pattern-clone of `snotel-sync.ts` (same hand-rolled env loader, Supabase REST via service role, per-resort loop with throttle):

1. Fetch active resorts where `snotel_station_id is null`, joined with `resort_metadata` for elevation.
2. Per resort: `getOpenMeteoSnapshot` → build `ConditionsInput` (normals null; `history7d` from the last 7 `snowpack_daily` depth rows; `nwsGrid` populated from Open-Meteo fields — `snowLevelAvg` = freezing level, `resortElevBase` = actual metadata elevation) → `computeConditions()`.
3. Write: upsert `snowpack_daily` (depth only, `swe_in` null, qc `valid`); append `snow_reports` (`source='open_meteo'`, `conditions='tags||narrative'` per existing convention); patch `resorts.cond_rating`.
4. `--dry-run` flag (pattern from `pipeline-sync.ts`). npm script `model-sync`.
5. Schedule: launchd `com.peakcam.model-sync`, every 6h offset from snotel-sync — **plist must copy the `EnvironmentVariables` PATH block from the working snotel-sync plist** (the missing block is why `com.peakcam.pipeline` has failed every day since April).

**Engine change (small, safe):** `computeTrend(sweValues)` gains an optional `thresholdIn` parameter (default 0.5, unchanged for NA). Model-sync calls it with the depth series and a 2.0in threshold, so SA resorts grow a real trend arrow after a week of accumulated history. SWE-based logic elsewhere is untouched.

**Targeted fix riding along:** `scripts/snotel-sync.ts:581` currently passes `resort.lat` (a latitude) as `resortElevBase` feet — the audit-confirmed bug that makes "Rain at Base" misfire. Fixed to use `resort_metadata` elevation with a safe fallback (skip the rain-at-base tag when elevation unknown), since this design touches the same input contract.

### 4. Resort detail forecast source selection

`app/resorts/[slug]/page.tsx`: if `resort.country === 'US'` use NWS (unchanged); otherwise use the Open-Meteo formatters. Same types, same components. The SNOTEL station deep-link section already renders conditionally and stays hidden. (This also gives BC resorts a working forecast for the first time.)

### 5. Seed data

**Researched and verified 2026-07-12** by a 20-agent research fleet (per-resort web research → cam-URL verification → completeness critic). Full sourcing, evidence, and notes per resort: `docs/superpowers/specs/research/2026-07-12-sa-resort-research.md` (raw data: the `.json` beside it). All 20 were confirmed operating for the 2026 season against current press/official sources — not just "the website exists."

**Final list — 20 resorts, all shipping in v1:**

| Slug | Resort | Country | Lat, Lng | Base/Summit ft | Cams found (verified working) |
|---|---|---|---|---|---|
| `ski-portillo` | Ski Portillo | Chile | -32.8367, -70.1289 | 8360 / 10860 | 4 (4/4) |
| `valle-nevado` | Valle Nevado | Chile | -33.3567, -70.2495 | 9843 / 12041 | 4 (0/4 — see caveat) |
| `la-parva` | La Parva | Chile | -33.3356, -70.2905 | 8760 / 11910 | 2 (0/2 — see caveat) |
| `el-colorado` | El Colorado | Chile | -33.3493, -70.2923 | 7972 / 10935 | 3 (0/3 — see caveat) |
| `lagunillas` | Lagunillas | Chile | -33.6071, -70.2888 | 7218 / 8366 | 0 |
| `nevados-de-chillan` | Nevados de Chillán | Chile | -36.9065, -71.4142 | 5020 / 7874 | 2 (2/2) |
| `corralco` | Corralco | Chile | -38.4108, -71.5453 | 5085 / 7874 | 4 (0/4 — see caveat) |
| `antillanca` | Antillanca | Chile | -40.7756, -72.2046 | 3410 / 5050 | 2 (2/2) |
| `volcan-osorno` | Volcán Osorno | Chile | -41.1278, -72.5300 | 4035 / 5774 | 2 (0/2 — see caveat) |
| `cerro-mirador` | Cerro Mirador (Punta Arenas) | Chile | -53.1612, -71.0259 | 1247 / 1870 | 0 |
| `pillan-pucon` | Pillán / Volcán Villarrica (Pucón) | Chile | *TBD — added by critic pass, coords/elevation not yet fetched* | — | leads found, not yet verified |
| `cerro-catedral` | Cerro Catedral (Bariloche) | Argentina | -41.1652, -71.4395 | 3379 / 7152 | 7 (6/7) |
| `chapelco` | Chapelco | Argentina | -40.1979, -71.3193 | 4101 / 6496 | 3 (3/3) |
| `las-lenas` | Las Leñas | Argentina | -35.1476, -70.0828 | 7349 / 11253 | 3 (2/3) |
| `cerro-castor` | Cerro Castor (Ushuaia) | Argentina | -54.7239, -68.0170 | 640 / 3143 | 1 (0/1 — see caveat) |
| `caviahue` | Caviahue | Argentina | -37.8670, -71.0830 | 5413 / 6785 | 4 (4/4) |
| `cerro-bayo` | Cerro Bayo | Argentina | -40.7508, -71.6025 | 3445 / 5906 | 6 (6/6) |
| `la-hoya` | La Hoya (Esquel) | Argentina | -42.8331, -71.2574 | 4692 / 6808 | 1 (1/1) |
| `batea-mahuida` | Batea Mahuida | Argentina | -38.8325, -71.2228 | 5413 / 5709 | 0 |
| `cerro-perito-moreno` | Cerro Perito Moreno (El Bolsón) | Argentina | -41.7902, -71.5640 | 2953 / 5577 | 0 |

`snotel_station_id` is null for all 20 (no NRCS network coverage in the Andes) — this is exactly the `model-sync` target set. `state` column holds `'Chile'` / `'Argentina'`.

**Decisions on the ambiguous cases the research surfaced:**

- **Penitentes excluded from v1.** Research found it "operating" only as a year-round mountain park/restaurant — lift-served skiing for 2026 is unconfirmed and it has zero cam leads. Revisit if status clarifies; not worth a resort card that might mislead on ski conditions.
- **Pillán / Volcán Villarrica (Pucón) added as a 21st resort**, per the critic's finding of an operating resort with multiple public webcams (via snow2day.com/OnTheSnow) that the main research pass missed entirely. Needs one follow-up research pass for coordinates/elevation/cam URLs before it can be seeded — not blocking the other 20.
- **Four zero-cam resorts ship anyway** (Lagunillas, Cerro Mirador, Batea Mahuida, Cerro Perito Moreno) — consistent with the "cam-light OK" requirement. The critic found snow-forecast.com webcam-archive pages for 3 of the 4 (Cerro Mirador, Batea Mahuida, Cerro Perito Moreno) that may be periodic-upload feeds rather than live streams; worth a manual check during implementation but not required to ship.
- **Five resorts have cams found but "unverifiable" status** (Valle Nevado, La Parva, El Colorado, Corralco, Volcán Osorno) — the verify pass hit JS/CORS blocking on a headless fetch, not necessarily dead links (Valle Nevado's, for example, are YouTube embeds confirmed live via the oEmbed API in the research notes). Import as-is; spot-check manually before the first cam-health run so `cam-health-check.mjs` doesn't immediately flag them.
- **Not included in v1** (real, operating, but no cam leads found — logged for a future pass): Chapa Verde (CODELCO club resort, confirmed no public webcam exists), Ski Antuco. El Azufre (cat-skiing/backcountry, not lift-served) is out of scope — not a "resort" in PeakCam's sense.
- **Confirmed NOT to add:** Vallecitos (Mendoza) — multiple sources describe it as currently lift-less/informal, not a commercial resort.

**Cam import:** cam embed URLs, types (mostly `iframe` for ipcamlive/official players, `youtube` for confirmed YouTube lives), and per-cam evidence are in the research `.md`/`.json` — pull directly from there rather than re-researching. Cam names (e.g. Portillo's "Laguna", "Tío Bob's", "Plateau", "Escuela") map to `cams.name`.

- `data/resorts.csv`: add the `country` column (importer passes it through) plus the 20–21 rows above.
- `data/cams.csv`: SA cam rows transcribed from the research artifact, following the existing `embed_type` taxonomy. Cam-light resorts ship anyway per requirements.
- **Importer caveat:** `cams` has no unique constraint, so re-running the importer duplicates cam rows. Implementation must either add new rows via a one-off targeted import or add the missing unique constraint in migration 012 (preferred: `unique (resort_id, embed_url)` after deduping prod).

### 6. Featuring & copy

- Add `valle-nevado`, `ski-portillo`, `cerro-catedral`, `las-lenas` to `POPULAR_SLUGS` — the four resorts with the strongest cam coverage (7-8 verified/found cams combined) and name recognition.
- FeaturedRow, powder ticker, and Snowing Now light up automatically once SA ratings/new-snow are in the DB.
- Replace hardcoded "128" copy: use `resorts.length` in client components that receive data (PeakHero eyebrow/subtitle, BrowsePage search placeholder, LiveWebcams subtitle); static metadata strings become "147+ resorts across North & South America" (127 existing + 20 SA; adjust if Pillán or others land) (layout, home, about, map, snow-report).
- `/map`: keep the NA default view; when a state filter (incl. Chile/Argentina) is active, fly to `resortBounds` of the filtered set — small addition to existing map-sync logic.
- Sitemap/SEO: new slugs flow automatically via `getAllResortSlugs()`; resort-page metadata already interpolates state, so "Chile"/"Argentina" appear without changes.

## Error handling

- Open-Meteo fetch failure → log, skip resort, keep previous `snow_reports` row visible (append-only + view semantics = graceful staleness).
- Missing elevation metadata → fall back to grid elevation; suppress the rain-at-base tag rather than compute it from bad inputs.
- Null snow depth from the model → engine already null-safe (`fair`/`poor` paths handle null depth).
- Unit conversions covered by unit tests (the highest-risk pure logic).

## Testing

- `lib/open-meteo.test.ts` (node:test, run via `npx tsx --test`): unit conversions, 24/48h accumulation windowing, weather-code→slug mapping, WeatherPeriod shaping against a recorded API fixture.
- `npm run model-sync -- --dry-run` against prod data as the integration smoke.
- Manual E2E before enabling launchd: run one live sync for 2–3 resorts, verify `snow_reports`/`snowpack_daily` rows and `/resorts/valle-nevado` rendering (forecast, rating, tags), confirm the resort appears in browse/ticker.
- Verify alerts eligibility: temporary test subscription on an SA resort, trigger via `CRON_SECRET` (existing `alert-e2e-test.mjs` pattern).

## Success criteria

- 20 SA resorts live with `country`, coordinates, and cams where found (list finalized 2026-07-12 by research pass; Pillán/Pucón addable as a 21st once its follow-up research completes).
- Ratings + forecasts refresh 4×/day for every non-SNOTEL resort (SA + BC + cam-only US resorts).
- At least one SA resort visible in the featured row or powder ticker during a storm cycle.
- Powder alert subscribable and triggerable for SA resorts.
- No regression to SNOTEL-resort behavior (disjoint target sets).
