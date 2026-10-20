# Parity scorecard: PeakCam vs SnowSure, after the parity run

Date: 2026-10-20 (numbers pulled 14:35 UTC). This re-states section 1 of the parity plan
(`2026-10-18-parity-plan.md`, kept outside the repo) with PeakCam's numbers after blocks P0 to
P11, and marks each dimension **closed**, **partial** or **open** with the PR that moved it.
SnowSure's column is the 2026-10-18 catalogue scrape; PeakCam's column is production, read from
`/api/v1/resorts`, `/api/v1/status`, `/sitemap.xml` and its children, `tools/list` on
`/api/mcp`, and SQL counts on the production database for what the API does not aggregate
(stations, forecast models, history rows, clips). Re-run the same reads to refresh it; the
commands are at the end.

## Scorecard

| Dimension | SnowSure | PeakCam, 2026-10-20 | Status | PRs |
| --- | --- | --- | --- | --- |
| Americas resorts | 315 | 148 active in production (125 US, 3 CA, 20 Andes). P1 batch 1 (36 western resorts with cams, stations, profiles, openings) is merged and goes live when the import runs on the Mini and the next deploy prerenders them; batches 2+ follow the same path. | **partial** | #109 (batch 1), later batches pending |
| Cams on the shared resorts | 557 (399 with thumbnails) | 640 cam rows, 603 active, 602 live at the last probe (99.8 %), 354 archive-allowed with stills every 15 min; 2 approach cams. The count criterion (≥ 560) is met across the catalogue; cams held on operator terms (Bridger Bowl 9, Jackson Hole 5, Loon 3) stay out. | **closed** on count; operator-held sets need the owner | #95, #98, #106 |
| Resort identity fields | runs, lifts, acres, piste km, vertical, annual snowfall, longest run, description, après, gallery, aliases, trail map | Profile columns on 131 of 148 resorts (runs, lifts, acres, vertical, snowfall, longest run, passes, trail-map link, aliases, elevations), 143 generated-and-validated descriptions with source labels, 114 Wikidata ids with `sameAs`. No après or gallery by design. | **closed** | #93, #100, #105 |
| Per-resort pages | 6 | 5 in the page family (overview, snow report, forecast, webcams, history), each with a markdown alternate, breadcrumbs, `WebPage.dateModified`, Link headers and a sitemap entry. Trail-map and guide pages fold into the overview and history by design (plan §0). | **closed** | #100, #103, #104, #105 |
| JSON-LD per resort page | SkiResort, FAQPage, Event, Dataset, speakable, additionalProperty | SkiResort + TouristAttraction (additionalProperty, sameAs, hasMap), FAQPage, Event (season opening), WebPage with speakable, BreadcrumbList, VideoObject per live stream, Dataset on the forecast page. | **closed** | #100, #103 |
| Observation sources per resort | up to 3; 466 resorts with ≥ 1 | 368 stations (150 GHCN, 142 NWS, 68 SNOTEL, 4 BC ASWS, 4 ECCC), hourly. 128 of 148 resorts have ≥ 1 station, 117 have ≥ 2 sources; 114 of 125 US resorts (91 %) have ≥ 2 sources, against the ≥ 90 % criterion. `measuredNow` on the API, the resort page and `get_stations`. | **closed** | #93, #97 |
| Approach (road) cams | 686 at 210 resorts | 2. The fetchers exist for Caltrans, DriveBC, UDOT, WSDOT and COtrip; DriveBC's rebroadcast terms and the three agency keys are owner items, so `approach-cams-sync` has not been run for real. | **open** (owner) | #97 (code) |
| Forecast | 10 to 13 models blended, 7 days public | 9 models (ECMWF IFS, GFS, GEM, ICON, JMA, Météo-France, UKMO, NBM, HRRR) blended per day with a 25th/75th band and `modelCount`, 14 days, summit and base, on all 148 resorts, refreshed every 6 h; 2,094 runs on the first sync. | **closed** | #103 |
| Forecast verification | 114 resorts, 90 days, per-model MAE and bias | Scorer runs daily at 07:30 and grades day-1/3/7 against SNOTEL depth deltas; 0 score rows so far because the window has had no measured snow days yet (pre-season). The route, the tool and the page render the empty state honestly. Fills in as the season starts. | **partial** (mechanism shipped, data accrues) | #103 |
| History | 10 seasons, 30-winter normal band, monthly climatology, season-to-date, vs last year | 280,803 daily rows from 2017-10-01 on 87 resorts (9 to 10 past seasons), normal band for 70 stations, monthly climatology, season-to-date on two baselines with last year, four leaderboards, a history page and tab, three tools. | **closed** | #104 |
| Conditions contract | `{value, source, observedAt, confidence}` + freshness tier, derived status | Envelope at `/api/v1/resorts/{slug}/conditions` (schema 1.0.0 at `/.well-known/schemas/resort-conditions-v1.json`): every field `{value, source, observedAt, confidence, freshness: {tier, ageHours}}`, derived OPEN/CLOSED_TODAY/PRE_SEASON/OFF_SEASON/UNKNOWN that never defaults to open, `recommendableToday` with reasons, `depthDisagreement`; the same object on the page, the markdown and `get_resort_conditions`. | **closed** | #107 |
| Lifts/runs open, operator report | 83 to 98 resorts from operator feeds | 0 rows: `operator-sync` is loaded on the Mini (06:00, 11:00) for 88 mapped resorts but Liftie serves a Cloudflare challenge to scripts, so the contract reports `liftsOpen.source: "none"`. Needs the owner's call: allow-listed UA from the Liftie maintainer, self-hosted Liftie, or per-operator feeds after a terms read. | **open** (owner) | #107 |
| Score | 0 to 100 with components, 30-day history, leaderboards | `resort_scores` table exists and is empty; P7 (get_score, score components route, daily scoring job) is in a parallel worktree and not merged as of this scorecard. | **open** (P7 pending) | #93 (table); P7 PR |
| Timelapses / storm reels | 825 cams at 159 resorts, 24 h MP4; 15 resorts with reels | 331 cams with a rolling 24 h MP4 and poster (every 6 h, ffmpeg on the Mini), storm-reel rule in place; 0 reels because no storm has crossed 8 in yet this season. Served as links on the API, the webcams page strip and `get_timelapses`. | **closed** (reels wait for snow) | #95, #106 |
| MCP tools | 49 | 20 read-only tools (21 when P7's `get_score` lands), fewer and broader by design: every SnowSure tool group (conditions, cams, forecast and models, history and season stats, leaderboards, profile, regions, alerts, timelapses, stations, ask) has a PeakCam tool; the sign-in-gated alert-subscription tools stay as `/alerts/manage` recipes. The plan's "≥ 22" acceptance is one short after P7. | **partial** on the count, closed on question coverage | #94, #97, #103, #104, #106, #107 |
| Answer endpoint / batch / search index | `/api/v1/ask`, `/ask`, `/api/v1/batch`, `search-index` | `GET/POST /api/v1/ask` and NLWeb-shaped `/ask` (deterministic, no LLM, `answerable: false` instead of a guess, unmatched questions logged), `POST /api/v1/batch` (≤ 10 reads), `/api/v1/resorts/search-index`, `/api/v1/status`, `/api/v1/leaderboards/*`. | **closed** | #94, #104 |
| Distribution | ChatGPT app listing, Smithery, npm stdio server, Custom GPT | MCP Registry: published (remote-only) 2026-10-18; `server.json` now also carries the npm package and the tool list and must be re-published. npm `peakcam-mcp`: built, tested against production, not published. Claude directory: submitted 2026-10-18, awaiting the scan. Custom GPT: instructions file and recipe on `/connect`, not created. Smithery and the ChatGPT Apps SDK listing: not started. Checklist in `docs/runbook.md` "Connect page and MCP listings". | **partial** (owner accounts) | #91, #94, #111 |
| Sitemaps | index + 7 continent files, 583 × 6 URLs | Index + 5 files (`pages.xml` with the hubs, passes and boards; `resorts-{ar,ca,cl,us}.xml`), 844 URLs (104 + 45 + 15 + 55 + 625), real `lastModified` from report and opening timestamps; `robots.txt` lists the index and the hub file. Search Console acceptance is an owner check. | **closed** (Search Console unverified) | #105, #111 |
| Discovery and ops (P10) | — | Per-state `/snow-report/{hub}`, `/passes/{pass}`, `/snow-report/leaderboards`; IndexNow pings the page family, hubs and boards per changed resort (`INDEXNOW_ENABLED=1` is set on the Mini); runbook job table rewritten from the Mini's loaded plists; `CLAUDE.md` counts and scheduling map current; OpenAPI deprecation policy (12 months, `Deprecation`/`Sunset`). Wikidata item for PeakCam itself: not created (owner). | **closed** except the Wikidata item | #105, #111 |

## Pass criteria from plan section 5

| Criterion | Value on 2026-10-20 | Met |
| --- | --- | --- |
| Americas coverage ≥ 315 minus resorts with no public cam and no station | 148 live, 184 once batch 1 is imported; remaining batches in progress | no, in progress (P1) |
| Shared-resort cams ≥ 560 with 100 % stills | 603 active cams; stills every 15 min for the 354 archive-allowed cams, latest-only stills for the rest | count yes; "100 % stills" holds only for archive-allowed cams |
| ≥ 2 observation sources on ≥ 90 % of US resorts | 114 of 125 (91 %) | yes |
| 14-day blended forecast with verification on ≥ 150 resorts | blend on 148 (every resort); verification scorer live, no scored days yet | blend yes at the current catalogue size; verification accrues with the season |
| 10-season history on every SNOTEL resort | 87 of 89 SNOTEL resorts backfilled to 2017-10-01; band on 70 of 72 stations | yes (two stations lack enough AWDB history) |
| Conditions envelope on every resort | 148 of 148 | yes |
| ≥ 22 MCP tools | 20 (21 after P7) | no, by one or two; coverage of question types is complete |
| Sitemap index indexed | served and listed in robots.txt; Search Console not checked | owner check |

Lighthouse and request counts (`baseline/count-requests.mjs`) were not re-captured in this
block; the site-lane blocks that changed page weight (P2, P5) each carried their own numbers.

## Where the numbers came from

```bash
curl -s https://www.peakcam.io/api/v1/resorts | jq '{count: (.resorts|length), cams: ([.resorts[].camCount]|add), live: ([.resorts[].liveCamCount]|add)}'
curl -s https://www.peakcam.io/api/v1/status | jq '.checks'
curl -s https://www.peakcam.io/sitemap.xml | grep -o '<loc>[^<]*'; for f in pages resorts-ar resorts-ca resorts-cl resorts-us; do echo "$f $(curl -s https://www.peakcam.io/sitemaps/$f.xml | grep -o '<url>' | wc -l)"; done
curl -s https://www.peakcam.io/api/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | grep '^data:' | sed 's/^data: //' | jq '.result.tools | length'
curl -s https://www.peakcam.io/robots.txt | grep -E '^(Content-Signal|Sitemap)'
```

SQL (Supabase SQL Editor or MCP `execute_sql`): `select count(*) from resorts where is_active`;
`select count(*), count(*) filter (where is_active) from cams`; `select source, count(*) from stations
group by 1`; `select count(distinct resort_id) from resort_stations`; resorts with ≥ 2 sources:
`select count(*) from (select rs.resort_id from resort_stations rs join stations s on s.id =
rs.station_id group by 1 having count(distinct s.source) >= 2) x`; `select count(distinct model) from
forecast_runs`; `select count(*) from forecast_scores`; `select count(*), min(date) from
snowpack_daily`; `select count(distinct cam_id), count(*) filter (where "window" = 'storm') from
cam_timelapses`; `select count(*) from operator_status`; `select count(*) from resort_scores`.
