# Station-layer fixtures

Recorded 2026-10-18 from the live endpoints (trimmed to the rows the tests
need), except where noted. Re-record with the `curl` lines in
`docs/stations.md` when a provider changes shape.

| File | Endpoint |
| --- | --- |
| `awdb-station-alta.json`, `awdb-data-alta.json` | NRCS AWDB `/stations?stationTriplets=1308:UT:SNTL`, `/data?…&duration=DAILY` |
| `nws-stations-ut.json` | `api.weather.gov/stations?state=UT&limit=500`, kept to the 30 km around Alta plus three airports; `pagination.next` kept |
| `nws-observation-amb.json`, `nws-observation-ut224.json` | `api.weather.gov/stations/{AMB,UT224}/observations/latest` |
| `ghcn-daily-alta.json` | **Hand-written** from the NCEI Access Data Service documentation (the service returned 503 all evening); shape: JSON array, string values, `units=standard` |
| `bc-asws-stations.json` | BC WFS `WHSE_WATER_MANAGEMENT.SSL_SNOW_ASWS_STNS_SP`, five stations |
| `bc-asws-{SD,SW,TA}.csv` | `env.gov.bc.ca/wsd/data_searches/snow/asws/data/{SD,SW,TA}.csv`, header plus the last four hours, eleven station columns |
| `eccc-swob-whistler.json` | `api.weather.gc.ca/collections/swob-realtime/items?bbox=…&_is-minutely_obs-value=false`, three hourly features |
| `caltrans-d3.json` | `cwwp2.dot.ca.gov/data/d3/cctv/cctvStatusD03.json`, seven cams |
| `drivebc-webcams.json` | `www.drivebc.ca/api/webcams/`, six cams |
