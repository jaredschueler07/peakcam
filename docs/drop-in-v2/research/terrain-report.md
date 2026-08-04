# Drop In v2 — Real-Terrain Data Pipeline Research

> Produced by a research agent (Claude Opus), 2026-08-01. All endpoints, sizes, and
> measurements below were verified live: tiles curled, terrarium PNGs decoded in Node,
> Copernicus COGs range-read with geotiff.js, Overpass queried per-resort, and prototype
> heightmap/trail assets baked and measured. Prototype scripts + baked assets are in
> `./prototype/`.

## TL;DR RECOMMENDATION

| Layer | Pick | Why |
|---|---|---|
| DEM | **AWS Terrain Tiles (Mapzen terrarium)**, `z14`, with **Copernicus GLO-30 COG** as the Portillo upgrade path | Free, no key, no rate limit, covers Chile + US, 3DEP-backed in the US |
| Trails/lifts | **Overpass API** per-resort bbox, `piste:type=downhill` + `aerialway=*` | Tiny queries (34–336 KB), complete enough at all three resorts, no 234 MB download |
| Bake output | 1024×1024 16-bit heightmap + one packed trails JSON | **Measured 0.97 MB + 18 KB worst case** — comfortably inside a 2–3 MB budget |

Total measured per-resort asset cost: Portillo ~0.97 MB, Heavenly ~0.98 MB, Breckenridge ~0.99 MB.

## 1. DEM sources

### Verified endpoint behavior

`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` — z12–z15 return 200, z16 404s. **Max zoom is 15.** No API key, no auth, no requester-pays, no rate limiting encountered. EU mirror: `elevation-tiles-prod-eu` (eu-central-1). Also available: `/normal/`, `/geotiff/` (512×512), `/skadi/`.

Decode: `elevation = (R * 256 + G + B / 256) - 32768`.

Source-resolution fingerprint (decoded blue-channel cardinality):

| Site | z12 (~30 m/px) | z13 (~15 m/px) | Interpretation |
|---|---|---|---|
| Portillo | integer-only values | still integer-only | Source is SRTM: 30 m posting, 1 m integer vertical |
| Breckenridge | fractional | fractional | USGS 3DEP-backed, real detail finer than 30 m |
| Heavenly | fractional | fractional | Same, 3DEP-backed |

**Portillo's real information limit is 30 m; the US resorts genuinely carry ~10 m 3DEP detail.** Sampling Portillo finer than z13 buys smoothness, not information.

Sample decoded values sanity-checked: Portillo center 2867 m (hotel ~2880 m), Breckenridge Peak 8 area 3066 m, Heavenly mid-mountain 2570 m.

### Source comparison

- **AWS Terrain Tiles / Mapzen terrarium — RECOMMENDED.** Global; US = 3DEP, Chile = SRTM/GMTED2010 fill. Free, anonymous, AWS Open Data, **no SLA** (hence: bake offline, commit assets). Registry: https://registry.opendata.aws/terrain-tiles/ · Formats: https://github.com/tilezen/joerd/blob/master/docs/formats.md
- **Copernicus GLO-30 — RECOMMENDED as Portillo upgrade.** Verified direct COG read: `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S33_00_W071_00_DEM/Copernicus_DSM_COG_10_S33_00_W071_00_DEM.tif` — 3600×3600, 1 arcsec, Float32, 4 overviews; `geotiff.js` `fromUrl()` + `readRasters({window})` needs no auth. Tiles for our resorts: `S33_00_W071_00`, `N39_00_W107_00`, `N38_00_W120_00`. **It is a DSM (surface model)** — measured +3.5 m canopy bias at Breckenridge (treed corridors read as carved channels: arguably a feature). At Portillo vs terrarium: mean −9.6 m, sd 26.3 m, p5/p95 −53/+28 m (SRTM layover vs TanDEM-X in steep terrain — Copernicus favored for morphology).
- **NASADEM** — same 30 m posting as terrarium at Portillo, needs Earthdata login. Skip.
- **ALOS AW3D30** — marginal accuracy gain, registration-walled. Skip.
- **MapTiler Terrain-RGB** — max z14, costs money, runtime dependency. Reject.
- **USGS 3DEP direct** — 1 m lidar at Breck/Heavenly but no Chile; would make Portillo look conspicuously melted. Later per-resort enhancement only.
- **FABDEM** — **CC BY-NC-SA, non-commercial only. Do not use.**

### License / attribution text to ship

Terrarium (per Tilezen attribution doc):

> United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.

Copernicus GLO-30 (prescribed wording, modified-data form):

> produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

## 2. Ski-run and lift vector data

### Measured OSM coverage (live Overpass results, 2026-08-01)

- **Portillo** (bbox `-32.90,-70.22,-32.76,-70.04`): 29 downhill pistes, 15 lifts. Only 7 named but they are *the* names (Roca Jack, Super C, Garganta, Las Lomas, Plateau, Bajada Del Tren). Lifts correctly typed incl. the va-et-vient platters ×5. Sparse on names, structurally complete on iconic terrain.
- **Breckenridge** (bbox `39.42,-106.15,39.53,-106.01`): 278 pistes, 39 lifts, 392/425 ways named; difficulty spread incl. 29 `extreme`; rich tags (`gladed`, `grooming`, `snowmaking`, `oneway`, `incline`). Excellent.
- **Heavenly** (bbox `38.89,-120.02,38.97,-119.88`): 165 pistes, 35 aerialway ways, 133 named (Gunbarrel, Ridge Run, Olympic Downhill…). Excellent.

### Extraction — Overpass, not the bulk files

```bash
curl -s -G https://overpass-api.de/api/interpreter --data-urlencode '
[out:json][timeout:120];
(
  way["piste:type"="downhill"](-32.90,-70.22,-32.76,-70.04);
  way["aerialway"~"^(chair_lift|gondola|cable_car|t-bar|platter|rope_tow|mixed_lift|drag_lift|magic_carpet)$"](-32.90,-70.22,-32.76,-70.04);
);
out geom;'
```

- **Use GET (`-G`); POST was intermittently rejected** by overpass-api.de (HTML error page).
- `out geom` inlines coordinates — no second node lookup. Measured responses: Portillo 34 KB, Breck 336 KB, Heavenly 265 KB. Mirror: `https://overpass.kumi.systems/api/interpreter`; sleep 8s between resorts.

### OpenSkiMap — context source, not extraction path

- `https://tiles.openskimap.org/geojson/runs.geojson` = 234 MB; `lifts.geojson` = 24.9 MB; `ski_areas.geojson` = 4.7 MB (21.7 MB decompressed). Schema is richer than raw OSM: 3D coordinates, precomputed `elevationProfile`, `difficultyConvention`, `viewportHint` (bearing + rotated extent).
- **Do grab `ski_areas.geojson` once** for resort boundary polygons → bake extents:

| Resort | OpenSkiMap ID | Polygon extent | Downhill km | Elevation band |
|---|---|---|---|---|
| Portillo | `53a081a74035a3c500ea5fb7b4012a7a75926ef5` | 3.46 × 2.57 km | 14.8 | 2577–3349 m |
| Breckenridge | `c329b1fe669c197d615896dfd4e38d4bb039e30c` | 5.81 × 5.69 km | 111.2 | 2917–3910 m |
| Heavenly | `53dd0fd9ec1c2ed9709b27830f36dcb87a31f8c3` | 5.50 × 6.09 km | 85.0 | 2025–3052 m |

- **Gotcha: two Heavenly entries** — match on `geometry.type === "Polygon"`, not name.

### ODbL implications

- Rendered terrain/game = **Produced Work** → attribution only.
- Baked `*_trails.json` = still machine-readable OSM geometry → **treat as Derivative Database**: publish the extraction script + derived JSON under ODbL (LICENSE note in assets dir + link) and attribute in-game.
- Required credit (Credits panel; display full URL as text where links aren't clickable):

> Trail and lift data © OpenStreetMap contributors, available under the Open Database License (ODbL). https://www.openstreetmap.org/copyright

## 3. Recommended offline bake pipeline

**Standalone Node/TS script run manually; output committed.** Not a Vercel build step — no SLA on either upstream; terrain doesn't change.

```
scripts/bake-resort.ts        # npx tsx scripts/bake-resort.ts portillo
public/game/terrain/
  portillo.height.png         # 1024×1024 16-bit grayscale (inspectable artifact)
  portillo.trails.json
  portillo.meta.json          # georeference + decode constants
```

### Heightmap format measurements (real Portillo data, 4 m/px, 1024²)

| Vertical quantum | PNG16 | raw+brotli | raw+gzip |
|---|---|---|---|
| full (2.8 cm) | 1283 KB | 1483 KB | 1891 KB |
| 0.1 m | **969 KB** | 1151 KB | 1616 KB |
| 0.25 m | 753 KB | 891 KB | 1273 KB |
| 0.5 m | 597 KB | 631 KB | 951 KB |
| 1.0 m | 455 KB | 413 KB | 640 KB |

- PNG16 beats brotli-over-raw at every precision except 1 m (Paeth filter delta-codes the 2-byte stride).
- **Pick 0.1 m quantum.** Terracing appears in normals as `quantum / cellSize` slope steps: 1.4° at 0.1 m/4 m (invisible), 3.6° at 0.25 m (bands on groomers). **Do not dither** — noise goes straight into normals.
- **Pre-smoothing does not save bytes**: box blurs at 12/20/28 m changed PNG size <0.3% while destroying detail. Quantization is the only lever.
- Resolution sweep: 512² @ 8 m/px = 288 KB (the "honest" resolution vs a 10–30 m source); 1024² @ 4 m/px = 969 KB (smoother mesh, no more information, better descent feel). Go 1024².

### Sampling geometry

- Sample terrarium at **z14** (7.4–8.0 m/px here), bilinear onto a local metric grid.
- Extents: Portillo 4096 m box (4.0 m/px); **Breckenridge and Heavenly need 6144 m** (6.0 m/px) — a 4 km box silently drops 40% of Breck's runs. Alternative: per-descent 4 km corridor rotated along `viewportHint.bearing`.
- Local ENU frame: `mPerDegLat = 111132`, `mPerDegLon = 111320 * cos(centerLat)`.

### Decode gotchas

1. **Bilinear across tile seams** clamps at x=255 → visible ridge every 256 px. Sample the neighbor tile or fetch the 260×260 variant.
2. **Prefetch tiles before the inner sample loop** (a 6144 m box at z14 ≈ 36 tiles); naive per-sample fetch takes minutes.
3. Copernicus path: one `readRasters({window})` per resort — dramatically faster than per-sample reads.

### Trails format (measured)

| Resort | Runs | Lifts | Nodes after RDP | JSON | gzip | brotli |
|---|---|---|---|---|---|---|
| Portillo | 29 | 15 | 196 | 3.5 KB | 1.4 KB | 1.2 KB |
| Heavenly | 72 | 14 | 485 | 9.3 KB | 3.2 KB | 2.7 KB |
| Breckenridge | 163 | 33 | 1029 | 17.8 KB | 6.7 KB | 5.5 KB |

Pipeline: reproject to local meters → clip to box → **RDP at 6 m** → quantize to decimeters → delta-encode → flat integer array.

```jsonc
{
  "v": 1,
  "center": [-32.8420, -70.1290],
  "sizeM": 4096,
  "unit": 0.1,
  "runs": [
    { "n": "Roca Jack", "d": "expert", "g": "backcountry", "o": 1,
      "p": [-3210, 8840, 41, -95, 38, -102] }
  ],
  "lifts": [ { "n": "Roca Jack", "t": "platter", "p": [] } ]
}
```

Keys: `n` name, `d` difficulty, `g` grooming, `gl` gladed, `o` oneway, `t` aerialway type, `p` flat `[x0,y0,dx,dy,...]`.

- **Drape trails at load time** by sampling the heightmap (guarantees trails sit on the mesh; no z-fighting).
- Ship brotli-precompressed; Vercel serves `.br` from `public/` with correct `Content-Encoding`.
- Carry `difficultyConvention` (europe/north_america) — a Chilean "advanced" isn't a Colorado "advanced".

## 4. Prior art

- **three-geo** (w3reality) — RGB-DEM → THREE.Mesh; study geometry/normal code, don't adopt its Mapbox data path (token + ToS restricts caching/derivative storage).
- **procedural-gl-js** (Felix Palmer) — GPU-driven LOD, relevant only if we later want full-mountain views; a 1024² baked corridor needs no LOD.
- **deck.gl TerrainLayer** / **MapLibre `raster-dem` `encoding:"terrarium"`** — reference GPU decode shaders.
- **Re:Earth Terrain** — geoid-vs-ellipsoid blending; irrelevant at arcade scale.

## Gotchas for the implementer

1. Overpass: `out geom` + GET, not POST.
2. Two Heavenly ski areas in OpenSkiMap — filter `geometry.type === "Polygon"`.
3. Copernicus is a DSM (+3.5 m canopy at Breck) — decide deliberately.
4. Terrarium bilinear needs neighbor tiles or 260×260 variant.
5. Breck/Heavenly need 6 km boxes.
6. Don't pre-smooth to save bytes; quantize.
7. Bake offline, commit output — no upstream in the deploy path.

## Prototype artifacts (in `./prototype/`)

`bake.mjs` (terrarium → PNG16 bake, all three resorts), `sweep.mjs` (resolution × quantization sweep), `pack.mjs` (Overpass → RDP → delta JSON), `port_cmp.mjs`/`cmp.mjs` (Copernicus vs terrarium stats), `terr.mjs` (source fingerprint probe), `cop.mjs` (geotiff.js COG range-read), `portillo_h16.png` / `breck_h16.png` / `heavenly_h16.png` (baked 1024² heightmaps), `portillo_trails.json` / `heavenly_trails.json` / `breck_trails.json`. Deps: `pngjs`, `geotiff` (pure JS).

Sources: AWS Terrain Tiles registry · Tilezen formats/attribution docs · Copernicus DEM on AWS + licence PDF · OSM copyright + OSMF Produced Work guideline · openskidata-processor · three-geo · procedural-gl-js · Re:Earth Terrain · GLO-30 vs AW3D30 alpine morphology study (Springer 2023) · Global radar DEM evaluation (JGR 2024)
