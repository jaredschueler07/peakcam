# Drop In terrain assets — sources, licences, attribution

The files in this directory are **derived data**, baked offline by
[`scripts/bake-resort.ts`](../../../scripts/bake-resort.ts) from the public
sources below. Re-bake with `npx tsx scripts/bake-resort.ts all`; verify a
committed bake against upstream with `--verify`.

| File | Contents |
|---|---|
| `<slug>.height.u16` (+ `.br`) | 1024×1024 uint16 heightfield, little-endian, row-major (row 0 = north edge, col 0 = west edge); `elevation = minZ + code × quantum` |
| `<slug>.height.png` | The same codes as a 16-bit grayscale PNG — an inspection artifact, not loaded at runtime (browser canvas readback is 8-bit and would destroy the precision) |
| `<slug>.meta.json` | Georeference and decode constants |
| `<slug>.trails.json` (+ `.br`) | Delta-encoded ski-run and lift centrelines in local metres |

---

## Elevation — AWS Terrain Tiles (Mapzen / Tilezen "terrarium")

Source: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
(AWS Open Data, no key required). All three resorts are baked from this source
at zoom 14.

> United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data
> courtesy of the U.S. Geological Survey.

## Elevation — Copernicus GLO-30 (optional path, Portillo)

Available via `--source=copernicus`; not used for the committed assets. When a
bake does use it, `meta.json` records `"source": "copernicus"` and this
attribution becomes required:

> produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus
> Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European
> Union and ESA; all rights reserved

## Ski runs and lifts — OpenStreetMap

Extracted per-resort from the Overpass API (`piste:type=downhill` and
`aerialway=*` ways within each resort bbox), reprojected to local metres,
simplified, and delta-encoded.

> Trail and lift data © OpenStreetMap contributors, available under the Open
> Database License (ODbL). https://www.openstreetmap.org/copyright

**ODbL status.** The rendered game is a *Produced Work* — attribution alone
suffices for it. The `*.trails.json` files, however, are still machine-readable
OSM geometry, so they are treated as a **Derivative Database** and are
published under the ODbL, together with the extraction script that produced
them (`scripts/bake-resort.ts`). Anyone redistributing these JSON files must
keep them under the ODbL and carry the attribution above.

The heightfields contain no OSM data and are not affected by the ODbL.

## Explicitly not used

**FABDEM** is licensed CC BY-NC-SA (non-commercial only) and must not be used
in this project.
