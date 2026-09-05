# Landmark source cache

Retrieved 2026-09-05 via read-only GET from
https://overpass.private.coffee/api/interpreter. Responses are preserved verbatim
under brotli; their `osm3s.timestamp_osm_base` records the source snapshot.

OpenStreetMap contributors, ODbL 1.0:
https://www.openstreetmap.org/copyright. OSM source attribution tags are retained;
no aerial photographs are redistributed as game assets.

Portillo query:
`[out:json][timeout:45];(way["natural"="water"](-32.85,-70.16,-32.80,-70.10);way["building"](-32.839,-70.134,-32.832,-70.125););out geom;`

Tahoe query, after broader name/bbox queries timed out:
`[out:json][timeout:45];relation(1823287);out geom;`
The relation identity was independently resolved from Wikidata Q169962, then
verified against the returned OSM name/wikidata tags.

Selected features: Laguna del Inca way 25749554; hotel footprint way 272711273
(`building=hotel`); Lake Tahoe relation 1823287 including inner island rings.

Official hotel architectural/color reference, inspected 2026-09-05:
https://skiportillo.com/en/ski-lodging/skiing-hotel-portillo/
https://skiportillo.com/wp-content/uploads/2023/12/All-Inclusive-Resort-Hotel-Ski-Portillo.jpg

The official text specifies yellow/blue architecture and guestroom levels two
through six. The photograph establishes the long folded main body, blue end
service tower, low front annex and snow-covered roof. Only generated geometry
and procedural facade/normal textures ship. Heights and the main/annex height
split are illustrative proportions, explicitly not a building survey.

Offline reproduction:
`npx tsx scripts/bake-landmarks.ts --verify`

Output `public/game/terrain/landmarks.json` uses exactly the geographic ENU
projection of the existing resort trail assets (`gameZ=-assetY`). Lake outlines
are clipped to a conservative 29.5 km convex extent inside the existing 30 km
far-field mesh, retaining their real location; no synthetic near-DEM rectangle.
Water elevations align to lake-interior samples from the committed DEMs (near
DEM preferred where it covers water, otherwise far mesh). The 30th-percentile
interior level plus 0.45 m resolves dataset datum/sampling and z-fighting. This
is a rendering alignment, not a replacement surveyed lake-level claim; Tahoe's
OSM `ele=1897` remains separately recorded.
