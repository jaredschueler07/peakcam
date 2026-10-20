# Station layer: multi-source observations and approach cams

Parity plan block P3 (`docs/research/ai-assistant-first/2026-10-18-parity-plan.md`).
Every resort shows what the nearest instruments measured, by elevation band, with the
network named and the reading's age; resorts near a DOT camera get approach (road) cams.
Tables from migration 026 (`stations`, `resort_stations`, `station_observations`) and
the `cams.kind / credit / source_terms_url` columns from 025.

## How it fits

```
lib/stations/            pure fetchers + parsers, one StationObservation shape, fixtures + tests
scripts/stations-sync.ts hourly on the mini: candidates → assignStations → three tables
scripts/approach-cams-sync.ts  DOT feeds → cams rows (kind=approach), run by hand / daily
lib/supabase.ts          getResortStationsIndex(): resort_stations ⋈ stations ⋈ newest observation, 15 min cache
lib/public-api/          serializeStations(): Resort.stations[] and Resort.measuredNow[]
components/resort/MeasuredNow.tsx   "What the instruments say" on /resorts/{slug}
lib/mcp/tools.ts         get_stations
```

The snow report is untouched: `snotel-sync` remains the base-depth truth and the
station layer never writes `snow_reports`. Where a resort has a SNOTEL station it is
always one of the three chosen stations (`assignStations` ranks SNOTEL first and never
displaces it from its band).

## Role assignment

`lib/stations/assign.ts`. Candidates farther than 25 km are dropped. With the resort's
base and summit elevations (`resorts.elevation_base_ft/summit_ft`, migration 025), a
station in the top third of the vertical is `summit`, the bottom third `base`, between
them `mid`. Each band takes its best candidate by network priority (SNOTEL, BC ASWS,
GHCN, ECCC, NWS) then distance; leftover slots take the best remaining candidates, but a
band already held by the same network is not filled twice. Without resort elevations the
highest candidate is `summit` and the lowest `base`.

Verified 2026-10-18 (`npx tsx scripts/stations-sync.ts --dry-run --resort alta`):

```
summit ALTA - MT BALDY (NWS AMB, 11,066 ft, 2.3 km) — 28.8 °F, 0 mph — 5 d ago
mid    ALTA - COLLINS  (NWS CLN,  9,662 ft, 1.3 km) — 28 °F, 0 mph — 5 d ago
base   Atwater (SNOTEL 1308:UT:SNTL, 8,750 ft, 0.3 km) — depth 1 in, new 0 in, SWE 0 in, 40.3 °F — 24 h ago
```

(The Alta mesonet sensors last reported on 2026-10-13: pre-season. The age column is
the point.)

## Sources

| Source (`stations.source`) | Endpoint | Cadence | Fields | Terms | Attribution line |
| --- | --- | --- | --- | --- | --- |
| `snotel` (kinds `snotel`, `scan`) | NRCS AWDB REST `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/{stations,data}` — the resort's own triplet, DAILY `SNWD,WTEQ,PREC,TOBS,TMAX,TMIN`, QC via `lib/snow-quality.ts` | daily | depth, SWE, new snow (depth delta), temperature | US public domain; https://www.nrcs.usda.gov/wps/portal/wcc/home/dataAccessHelp/webService/ | "USDA NRCS SNOTEL" |
| `ghcn` | NCEI Access Data Service `https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&dataTypes=SNOW,SNWD,TMAX,TMIN&stations=…&startDate=…&endDate=…&format=json&units=standard&includeStationName=true&includeStationLocation=1` (no token). Discovery: `ghcnd-stations.txt` + `ghcnd-inventory.txt` from `https://www.ncei.noaa.gov/pub/data/ghcn/daily/`, cached in `data/cache/` (gitignored, 11 MB, refreshed weekly), filtered to stations whose SNWD/SNOW series reaches last year | daily (COOP observers, published a day late) | depth, new snow, max/min temperature (mean shown) | US public domain; NCEI asks for the GHCN-Daily citation: https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc:C00861 | "NOAA NCEI GHCN-Daily" |
| `nws` (kinds `metar`, `nws_obs`) | `https://api.weather.gov/stations?state=UT&limit=500` (paginated; one listing per state per run) → nearest by distance → `/stations/{id}/observations/latest`. `/points/{lat},{lon}` → `observationStations` is the fallback: for Alta that list is 27 airports and one UDOT sensor; the state listing carries the mesonet rows at 9,600–11,066 ft | hourly | temperature, wind (no snow depth in METAR) | US public domain; User-Agent required (`NWS_USER_AGENT`); https://www.weather.gov/disclaimer | "NOAA National Weather Service" |
| `bc_asws` | Hourly CSVs `https://www.env.gov.bc.ca/wsd/data_searches/snow/asws/data/{SD,SW,TA}.csv` (snow depth cm, SWE mm, air temp °C; one column per station `3A25P Squamish River Upper`; current water year). Station coordinates: BC WFS `https://openmaps.gov.bc.ca/geo/pub/wfs?…typeName=pub:WHSE_WATER_MANAGEMENT.SSL_SNOW_ASWS_STNS_SP&outputFormat=json`. Catalogue record: https://catalogue.data.gov.bc.ca/dataset/automated-snow-weather-station-data | hourly | depth, SWE, temperature | Open Government Licence – British Columbia: https://www2.gov.bc.ca/gov/content/data/policy-standards/open-data/open-government-licence-bc | "Contains information licensed under the Open Government Licence – British Columbia (BC River Forecast Centre ASWS)" |
| `eccc` (kinds `eccc`, `metar`) | MSC GeoMet OGC API `https://api.weather.gc.ca/collections/swob-realtime/items?bbox=w,s,e,n&limit=200&f=json&sortby=-date_tm-value&_is-minutely_obs-value=false`. Hourly rows carry `air_temp` (°C), `avg_wnd_spd_10m_pst1hr` (km/h), `avg_snw_dpth_pst5mts` (cm, negative = sensor missing); the minutely rows carry flags only, hence the filter. NAV CANADA aviation reports include `data_attrib_not`, kept in the payload | hourly | temperature, wind, depth where the station has a sensor | ECCC Data Servers End-use Licence: https://eccc-msc.github.io/open-data/licence/readme_en/ | "Data Source: Environment and Climate Change Canada" |

Andes resorts (Chile, Argentina): no open station network with an API; Open-Meteo via
`model-sync` stays their source. The `freezing level` the plan mentions is not published
by any of these networks, so `measuredNow` carries no such field rather than a null one.

## Approach cams

`lib/stations/road-cams.ts`, `scripts/approach-cams-sync.ts`. Rows are `cams` with
`embed_type='image'`, `kind='approach'`, `credit` = agency, `source_terms_url`,
`card_preview=false`, matched within 25 km, access-road cams first (`ACCESS_ROUTES`,
editorial), four per resort. Dry run 2026-10-18: 19 of 148 resorts matched, 71 cams
(Tahoe, Mammoth/June, Shasta, Ashland from Caltrans; Whistler, Sun Peaks, Big White from
DriveBC).

| Agency | Feed | Key | Terms | Archive frames? |
| --- | --- | --- | --- | --- |
| Caltrans | `https://cwwp2.dot.ca.gov/data/d{N}/cctv/cctvStatusD{NN}.json` for districts 2, 3, 9, 10; `imageData.static.currentImageURL` | none | https://dot.ca.gov/conditions-of-use | yes (`archive_allowed=true`) |
| DriveBC | `https://www.drivebc.ca/api/webcams/` (1,067 cams); image `https://www.drivebc.ca/images/{id}.jpg` | none | Metadata and image links are the BC Data Catalogue record **BC Highway Cams** under the Open Government Licence – BC (https://catalogue.data.gov.bc.ca/dataset/bc-highway-cams). DriveBC's own "About BC Highway Webcams" page says images "may not be rebroadcast or republished without express authorization" and points to a licence agreement via the Intellectual Property Program. **Conflict for the user to settle**: rows are hot-linked (the browser loads the ministry's image) and never archived (`archive_allowed=false`). | no |
| UDOT | `https://www.udottraffic.utah.gov/api/v2/get/cameras?key=…&format=json` (511-vendor shape: `Id, Roadway, Latitude, Longitude, Location, Views[{Url, Status}]`) | `UDOT_API_KEY` (free developer registration, 10 calls/min) | https://www.udottraffic.utah.gov/developers/doc | no |
| WSDOT | `https://wsdot.wa.gov/Traffic/api/HighwayCameras/HighwayCamerasREST.svc/GetCamerasAsJson?AccessCode=…` (`Camera` class: `CameraID, Title, ImageURL, IsActive, CameraLocation{Latitude, Longitude, RoadName}`) | `WSDOT_ACCESS_CODE` (free) | https://wsdot.wa.gov/traffic/api/ | no |
| COtrip (CDOT) | `https://data.cotrip.org/api/v1/cameras?apiKey=…` (GeoJSON; parser reads `properties.views[].url` and tolerates `imageUrl`; **shape unverified until a key is available**) | `COTRIP_API_KEY` (free) | https://www.cotrip.org/about-cotrip/ | no |

The keyed clients skip cleanly when their env var is absent and print the variable name.

## Running it

```bash
npx tsx scripts/stations-sync.ts --dry-run --resort alta   # reads public APIs only; anon key or data/resorts.csv for the catalogue
npx tsx scripts/stations-sync.ts --dry-run --no-ghcn       # skip NCEI when it is slow (503s all evening on 2026-10-18)
npm run stations-sync                                      # production: service role from .env.local, writes the three tables
npm run approach-cams-sync -- --dry-run                    # list the matches; drop --dry-run to write cams rows
```

Hourly on the mini: `com.peakcam.stations-sync` (StartInterval 3600), reload recipe in
`docs/runbook.md`. Candidate fetch volume per run: one NWS state listing per state
(≤ 3 pages), ≈ 10 `observations/latest` calls per US resort with 150 ms spacing, one BC
ASWS download set, one ECCC bbox query per Canadian resort, ≈ 3 NCEI calls per resort.

## Re-recording fixtures

`lib/stations/fixtures/README.md` lists each file's endpoint. Trim to a handful of
rows; the tests assert on named stations (Alta Mt Baldy `AMB`, Atwater `1308:UT:SNTL`,
Callaghan Creek `3A20P`, Tenquille Lake `1D06P`, Caltrans "Hwy 50 at Meyers", DriveBC
"Whistler Village Gate").
