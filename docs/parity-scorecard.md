# Parity scorecard: PeakCam vs SnowSure, after the parity run

Date: 2026-10-20, refreshed at 15:45 UTC on `main` at `68f4342` (first version at 14:35 UTC on
`9af28b4`, before P7 and the P1 batches 2 and 3 landed). This re-states section 1 of the parity
plan (`2026-10-18-parity-plan.md`, kept outside the repo) with PeakCam's numbers after blocks P0
to P11, and marks each dimension **closed**, **partial** or **open** with the PR that moved it.
SnowSure's column is the 2026-10-18 catalogue scrape; PeakCam's column is production, read from
`/api/v1/status`, `/api/v1/snow-report`, `/sitemap.xml` and its children, `tools/list` on
`/api/mcp`, and SQL counts on the production database for what the API does not aggregate
(stations, forecast runs, history rows, clips, score rows). One caveat on the API reads: the
catalogue behind `/api/v1/resorts` is cached an hour plus 15 minutes at the CDN, so right after a
coverage deploy it can still answer with the previous count (it said 148 while `/api/v1/status`
and the database said 318); the status route and SQL are the authority for the counts below.
Re-run the same reads to refresh it; the commands are at the end.

## Scorecard

| Dimension | SnowSure | PeakCam, 2026-10-20 15:45 UTC | Status | PRs |
| --- | --- | --- | --- | --- |
| Americas resorts | 315 | 318 active in production (246 US, 49 CA, 13 CL, 10 AR) after the three P1 batches; 291 have a snow report (the 17 newest wait for the next `model-sync` / `snotel-sync` run), 294 have forecast runs, 299 have a Snow Score. | **closed** (≥ 315) | #109, #112, #115 |
| Cams on the shared resorts | 557 (399 with thumbnails) | 959 cam rows, 921 active, 766 live at the last probe (99.1 % of the 773 checked; 148 of the newest cams are not probed yet), 556 archive-allowed with stills every 15 min; 2 approach cams. Cams held on operator terms (Bridger Bowl 9, Jackson Hole 5, Loon 3) stay out. | **closed** on count; operator-held sets need the owner | #95, #98, #106, #112, #115 |
| Resort identity fields | runs, lifts, acres, piste km, vertical, annual snowfall, longest run, description, après, gallery, aliases, trail map | Profile columns on 262 of 318 resorts (runs, lifts, acres, vertical, snowfall, longest run, passes, trail-map link, aliases, elevations), 251 Wikidata ids with `sameAs`, 143 generated-and-validated descriptions with source labels (the batch-2 and batch-3 resorts have none yet: `npm run generate-descriptions` on the Mini is the follow-up). No après or gallery by design. | **closed** (descriptions for the new batches are a Mini run) | #93, #100, #105, #112, #115 |
| Per-resort pages | 6 | 5 in the page family (overview, snow report, forecast, webcams, history), each with a markdown alternate, breadcrumbs, `WebPage.dateModified`, Link headers and a sitemap entry. Trail-map and guide pages fold into the overview and history by design (plan §0). | **closed** | #100, #103, #104, #105 |
| JSON-LD per resort page | SkiResort, FAQPage, Event, Dataset, speakable, additionalProperty | SkiResort + TouristAttraction (additionalProperty, sameAs, hasMap), FAQPage, Event (season opening), WebPage with speakable, BreadcrumbList, VideoObject per live stream, Dataset on the forecast page. | **closed** | #100, #103 |
| Observation sources per resort | up to 3; 466 resorts with ≥ 1 | 699 stations (324 GHCN, 264 NWS, 101 SNOTEL, 6 ECCC, 4 BC ASWS), hourly. 249 of 318 resorts have ≥ 1 station, 217 have ≥ 2 sources; 213 of 246 US resorts (87 %) have ≥ 2 sources, just under the ≥ 90 % criterion now that batch 2 added Northeast and Midwest resorts with thinner station cover; Canada has 5 of 49 (ECCC and BC ASWS only). `measuredNow` on the API, the resort page and `get_stations`. | **closed** on the mechanism; 87 % vs the 90 % bar after the coverage growth | #93, #97 |
| Approach (road) cams | 686 at 210 resorts | 2. The fetchers exist for Caltrans, DriveBC, UDOT, WSDOT and COtrip; DriveBC's rebroadcast terms and the three agency keys are owner items, so `approach-cams-sync` has not been run for real. | **open** (owner) | #97 (code) |
| Forecast | 10 to 13 models blended, 7 days public | 9 models (ECMWF IFS, GFS, GEM, ICON, JMA, Météo-France, UKMO, NBM, HRRR) blended per day with a 25th/75th band and `modelCount`, 14 days, summit and base; 10,374 stored runs covering 294 of 318 resorts (the newest batch joins at the next 6-hourly sync), refreshed every 6 h. | **closed** (≥ 150 resorts) | #103 |
| Forecast verification | 114 resorts, 90 days, per-model MAE and bias | Scorer runs daily at 07:30 and grades day-1/3/7 against SNOTEL depth deltas; 0 score rows so far because the window has had no measured snow days yet (pre-season). The route, the tool and the page render the empty state honestly. Fills in as the season starts. | **partial** (mechanism shipped, data accrues) | #103 |
| History | 10 seasons, 30-winter normal band, monthly climatology, season-to-date, vs last year | 280,947 daily rows from 2017-10-01 on 87 resorts (9 to 10 past seasons), normal band for 70 stations, monthly climatology, season-to-date on two baselines with last year, four leaderboards, a history page and tab, three tools. The 128 SNOTEL-fed resorts now include 39 from the P1 batches whose ten-year backfill has not been run (`npm run snotel-backfill` on the Mini, idempotent). | **closed** for the original catalogue; backfill of the new SNOTEL resorts is a Mini run | #104 |
| Conditions contract | `{value, source, observedAt, confidence}` + freshness tier, derived status | Envelope at `/api/v1/resorts/{slug}/conditions` (schema 1.0.0 at `/.well-known/schemas/resort-conditions-v1.json`): every field `{value, source, observedAt, confidence, freshness: {tier, ageHours}}`, derived OPEN/CLOSED_TODAY/PRE_SEASON/OFF_SEASON/UNKNOWN that never defaults to open, `recommendableToday` with reasons, `depthDisagreement`; the same object on the page, the markdown and `get_resort_conditions`, on all 318 resorts. | **closed** | #107 |
| Lifts/runs open, operator report | 83 to 98 resorts from operator feeds | 0 rows: `operator-sync` is loaded on the Mini (06:00, 11:00) for 88 mapped resorts but Liftie serves a Cloudflare challenge to scripts, so the contract reports `liftsOpen.source: "none"`. Needs the owner's call: allow-listed UA from the Liftie maintainer, self-hosted Liftie, or per-operator feeds after a terms read. | **open** (owner) | #107 |
| Score | 0 to 100 with components, 30-day history, leaderboards | PeakCam Snow Score 0 to 100 from five weighted components (depth vs normal 30, 7-day snow 25, 7-day forecast 20, snow quality 15, operating status 10) with a dated tagline; 8,071 `resort_scores` rows for 299 resorts, 30 days of history from 2026-09-21, 308 resorts scored today. `score` on the resort document and list rows, `/api/v1/resorts/{slug}/score-components` (today + 30-day history), `/api/v1/snow-report?sort=score` (318 rows), `get_score`, the snow-report ranking. | **closed** | #93 (table), #114 |
| Timelapses / storm reels | 825 cams at 159 resorts, 24 h MP4; 15 resorts with reels | 331 cams with a rolling 24 h MP4 and poster (every 6 h, ffmpeg on the Mini), storm-reel rule in place; 0 reels because no storm has crossed 8 in yet this season. The 556 archive-allowed cams now include the P1 batches, whose clips appear after their first 6-hourly render. Served as links on the API, the webcams page strip and `get_timelapses`. | **closed** (reels wait for snow) | #95, #106 |
| MCP tools | 49 | 21 read-only tools, fewer and broader by design: every SnowSure tool group (conditions, cams, forecast and models, history and season stats, leaderboards, score, profile, regions, alerts, timelapses, stations, ask) has a PeakCam tool; the sign-in-gated alert-subscription tools stay as `/alerts/manage` recipes. The plan's "≥ 22" acceptance is one short. | **partial** on the count (21 of 22), closed on question coverage | #94, #97, #103, #104, #106, #107, #114 |
| Answer endpoint / batch / search index | `/api/v1/ask`, `/ask`, `/api/v1/batch`, `search-index` | `GET/POST /api/v1/ask` and NLWeb-shaped `/ask` (deterministic, no LLM, `answerable: false` instead of a guess, unmatched questions logged), `POST /api/v1/batch` (≤ 10 reads), `/api/v1/resorts/search-index`, `/api/v1/status`, `/api/v1/leaderboards/*`, `/api/v1/snow-report`. 38 route handlers under `app/api/`. | **closed** | #94, #104, #114 |
| Distribution | ChatGPT app listing, Smithery, npm stdio server, Custom GPT | MCP Registry: published (remote-only) 2026-10-18; `server.json` now also carries the npm package and the tool list and must be re-published. npm `peakcam-mcp`: built, tested against production, not published. Claude directory: submitted 2026-10-18, awaiting the scan. Custom GPT: instructions file and recipe on `/connect`, not created. Smithery and the ChatGPT Apps SDK listing: not started. Checklist in `docs/runbook.md` "Connect page and MCP listings". | **partial** (owner accounts) | #91, #94, #111 |
| Sitemaps | index + 7 continent files, 583 × 6 URLs | Index + 5 files (`pages.xml` 186 with the hubs, passes and boards; `resorts-us.xml` 1,230, `resorts-ca.xml` 245, `resorts-cl.xml` 65, `resorts-ar.xml` 50), 1,776 URLs, real `lastModified` from report and opening timestamps; `robots.txt` lists the index and the hub file. Search Console acceptance is an owner check. | **closed** (Search Console unverified) | #105, #111 |
| Discovery and ops (P10) | — | Per-state `/snow-report/{hub}`, `/passes/{pass}`, `/snow-report/leaderboards`; IndexNow pings the page family, hubs and boards per changed resort (`INDEXNOW_ENABLED=1` is set on the Mini); runbook job table rewritten from the Mini's loaded plists; `CLAUDE.md` counts and scheduling map current; OpenAPI deprecation policy (12 months, `Deprecation`/`Sunset`). Wikidata item for PeakCam itself: not created (owner). | **closed** except the Wikidata item | #105, #111 |

## Pass criteria from plan section 5

| Criterion | Value on 2026-10-20 15:45 UTC | Met |
| --- | --- | --- |
| Americas coverage ≥ 315 minus resorts with no public cam and no station | 318 active | yes |
| Shared-resort cams ≥ 560 with 100 % stills | 921 active cams; stills every 15 min for the 556 archive-allowed cams, latest-only stills for the rest | count yes; "100 % stills" holds only for archive-allowed cams |
| ≥ 2 observation sources on ≥ 90 % of US resorts | 213 of 246 (87 %); it was 114 of 125 (91 %) before batch 2 added the Northeast and Midwest | no, by 3 points after the coverage growth (more GHCN/NWS assignments in the East would close it) |
| 14-day blended forecast with verification on ≥ 150 resorts | blend on 294 of 318; verification scorer live, no scored days yet | blend yes; verification accrues with the season |
| 10-season history on every SNOTEL resort | 87 of the original 89 SNOTEL resorts backfilled to 2017-10-01; band on 70 of 72 stations; 39 SNOTEL resorts from the P1 batches not yet backfilled | partial until `snotel-backfill` runs again on the Mini |
| Conditions envelope on every resort | 318 of 318 | yes |
| ≥ 22 MCP tools | 21 | no, by one; coverage of question types is complete |
| Sitemap index indexed | served (1,776 URLs) and listed in robots.txt; Search Console not checked | owner check |

Lighthouse and request counts (`baseline/count-requests.mjs`) were not re-captured in this
block; the site-lane blocks that changed page weight (P2, P5) each carried their own numbers.

## Follow-ups the numbers point at (all Mini runs or owner items)

- `npm run snotel-backfill` and `npm run seed-normals` on the Mini for the 39 new SNOTEL resorts
  (history page, season stats, normal band).
- `npm run generate-descriptions` on the Mini for the batch-2 and batch-3 resorts (175 without a
  description).
- `cam-health-check` will probe the 148 unchecked new cams at its next 06:00 run; `cam-timelapse`
  renders their clips at its next 6-hourly run.
- Eastern station cover: the 90 % criterion needs about 8 more US resorts with a second source.
- Owner items unchanged: approach-cam terms and keys, operator lift-status source, npm publish and
  registry re-publish, Smithery, Custom GPT, Search Console, the PeakCam Wikidata item.

## Where the numbers came from

```bash
curl -s https://www.peakcam.io/api/v1/status | jq '.checks'                                  # resorts, reporting, cams, live, unchecked
curl -s 'https://www.peakcam.io/api/v1/snow-report?sort=score&limit=3' | jq '{count: (.results|length), first: .results[0].slug}'
curl -s https://www.peakcam.io/api/v1/resorts/alta/score-components | jq '{date: .today.date, history: (.history|length)}'
curl -s https://www.peakcam.io/sitemap.xml | grep -o '<loc>[^<]*'; for f in pages resorts-ar resorts-ca resorts-cl resorts-us; do echo "$f $(curl -s https://www.peakcam.io/sitemaps/$f.xml | grep -o '<url>' | wc -l)"; done
curl -s https://www.peakcam.io/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | grep '^data:' | sed 's/^data: //' | jq '.result.tools | length'
curl -s https://www.peakcam.io/robots.txt | grep -E '^(Content-Signal|Sitemap)'
find app/api -name route.ts | wc -l
```

SQL (Supabase SQL Editor or MCP `execute_sql`): `select country, count(*) from resorts where
is_active group by 1`; `select count(*), count(*) filter (where is_active) from cams`; `select
source, count(*) from stations group by 1`; `select count(distinct resort_id) from resort_stations`;
resorts with ≥ 2 sources: `select count(*) from (select rs.resort_id from resort_stations rs join
stations s on s.id = rs.station_id group by 1 having count(distinct s.source) >= 2) x`; `select
count(distinct model), count(distinct resort_id), count(*) from forecast_runs`; `select count(*) from
forecast_scores`; `select count(*), min(date) from snowpack_daily`; `select count(distinct cam_id),
count(*) filter (where "window" = 'storm') from cam_timelapses`; `select count(*) from
operator_status`; `select count(*), count(distinct resort_id), min(date), max(date) from
resort_scores`.
