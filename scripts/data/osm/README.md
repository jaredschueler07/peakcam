# Offline OpenStreetMap source cache

Retrieved 2026-09-05 from https://overpass.kumi.systems/api/interpreter using GET.
JSON responses are brotli-compressed without modification and contain upstream
`osm3s.timestamp_osm_base`. OpenStreetMap contributors, ODbL 1.0:
https://www.openstreetmap.org/copyright. No paid or unlicensed assets.

Query: `[out:json][timeout:90];(way["piste:type"="downhill"](bbox);way["aerialway"](bbox);node["aerialway"="pylon"](bbox);node["aerialway"="station"](bbox);way["natural"="wood"](bbox);way["landuse"="forest"](bbox););out geom;`

Bboxes follow `RESORT_BAKE_CONFIGS`. Breckenridge's successful retry used timeout
180, omitted the station node query, and limited forest ways to
`39.447,-106.117,39.502,-106.045` after the broad query timed out. Stations in the
runtime are derived from lift endpoints in every resort. Source line nodes tagged
pylon provide towers; an empty list means absent source coverage.

`npx tsx scripts/bake-mountain-network.ts all --verify` verifies deterministic
outputs without network or GDAL. Refresh these sources deliberately, review the
resulting names/IDs and bump COURSE_VERSION for geometry changes.
