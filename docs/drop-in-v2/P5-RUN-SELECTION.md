# Phase 5.3 real-run and landmark selections

Phase 5.3 keeps the six slots and ordering from lib/game/config/profiles.ts, but each
slot now resolves to a named polyline committed in the resort trails JSON. OSM ways
are oriented downhill at load time. Closed piste-area ways are reduced to the shorter
real boundary path between their highest and lowest vertices, so spawn and finish are
not the same point. Gates and ramps use seeded distances along that polyline, not game-z.

## Curated run mapping

| Resort | Profile slot | Baked OSM run | Selection note |
|---|---|---|---|
| Portillo | Roca Jack | Roca Jack | exact |
| Portillo | Juncalillo | Bajada Del Tren | named easy fall-line substitute; Juncalillo is only present as a lift |
| Portillo | El Plateau | Plateau | OSM drops the article |
| Portillo | La Garganta | Garganta | OSM drops the article |
| Portillo | Kilómetro Lanzado | Super C | named expert speed/fall-line substitute |
| Portillo | Las Vizcachas | Las Lomas | named intermediate substitute; Las Vizcachas is only present as a lift |
| Breckenridge | Horseshoe Bowl | Horseshoe Bowl | exact |
| Breckenridge | Imperial Bowl | Imperial Bowl | exact; first unique way when OSM has duplicates |
| Breckenridge | Devil's Crotch | Devils Crotch | punctuation normalization |
| Breckenridge | Four O'Clock | 4 O'Clock | spelling normalization |
| Breckenridge | Whale's Tail | Whale's Tail | exact |
| Breckenridge | Psychopath | Psychopath | exact |
| Heavenly | Gunbarrel | Gunbarrel | exact |
| Heavenly | Ridge Run | Ridge Run | exact |
| Heavenly | Milky Way Bowl | Milky Way Bowl | exact |
| Heavenly | Mott Canyon | Mott Canyon Trail | OSM suffix |
| Heavenly | Olympic Downhill | Olympic Downhill | exact |
| Heavenly | Killebrew Canyon | Canyonland | nearest named canyon substitute in the committed inventory |

The resolver requires six unique named ways. If a future bake loses one of the explicit
names, it takes the first still-unused named way as a deterministic last-resort fallback.

## Main lifts

The longest eligible decoded polyline is used: **Los Canarios** platter at Portillo
(379 m), **Beaver Run SuperChair** at Breckenridge (2,694 m), and **Heavenly Gondola**
at Heavenly (3,711 m). Portillo deliberately filters to platter; the renderer keeps
the inexpensive v1 tower/chair vocabulary but places it along the real line.

## Brotli serving decision

next.config.ts assigns Content-Encoding: br, application/octet-stream, and an immutable
cache policy to /game/terrain/:slug.height.u16.br. Browser fetch then returns the
decompressed u16 response body. We do not use DecompressionStream: Brotli is not
supported there across the browser matrix, while the HTTP content encoding path is
standardized and handled below JavaScript. The loader fetches the uncompressed meta and
trails JSON plus the precompressed heightfield, supports abort, and reports byte-weighted
progress using the decoded grid byte count.

## Landmark local coordinates

Coordinates follow the terrain contract (x east, z south, metres from the baked center;
asset north is therefore gameZ=-assetY). They are constants in LandmarkRenderer.ts and
all landmark meshes remain below 200 triangles per resort.

| Resort | Landmark | Game coordinate / elevation | Derivation |
|---|---|---|---|
| Portillo | Laguna del Inca | x=-351, z=-2172, y=2849 m | OSM lake centroid [-32.82245,-70.13276] converted from the [-32.842,-70.129] bake center; the centroid sits 124 m beyond the north bbox edge |
| Portillo | Hotel Portillo | x=-41, z=-689, terrain-draped | mapped hotel vicinity near [-32.83580,-70.12944], converted into local ENU then north to negative-z |
| Heavenly | Lake Tahoe | x=-1450, z=-2920, y=1897 m | real Tahoe water elevation, placed against the north edge of the 6,144 m bbox |
| Breckenridge | Town glow | x=2820, z=-420, terrain + 75 m | Breckenridge town is east/down-valley; the billboard sits just inside the east bbox edge |

Portillo coordinate references: the OpenStreetMap lake feature and elevation exposed at
https://mapcarta.com/20120270, and the mapped hotel vicinity/camera coordinate at
https://commons.wikimedia.org/wiki/File:Portillo_Hotel,_Chile.jpg.
