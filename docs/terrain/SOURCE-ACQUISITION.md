# Acquiring original terrain and evidence

This guide accompanies the [mountain methodology](README.md). The inventory and probes
below were actually retrieved on **2026-09-07 UTC**. They identify potential inputs;
**no production source was replaced and no mountain passed survey acceptance**.

## Discovery that can be repeated

The [official TNM API landing page](https://apps.nationalmap.gov/tnmaccess/) identifies
`https://tnmaccess.nationalmap.gov/api/v1/` as the current endpoint. Our offline CLI
queries its `products` resource for `Digital Elevation Model (DEM) 1 meter` using the
geographic envelope of the configured playable square. The envelope is computed by
sampling the projected square perimeter; it is not a statement of exact survey extent.

```sh
npx tsx scripts/discover-terrain-sources.ts all --output docs/terrain/source-candidates.json
npx tsx --test scripts/terrain-source-discovery.test.ts scripts/terrain-source-probe.test.ts
```

`all` means the two US resorts. Portillo is outside this USGS catalog search. The CLI
also accepts `breckenridge` or `heavenly`, and `--archive DIRECTORY`. Its default raw
archive is `.agent-team/terrain-source-probes/<slug>/<UTC timestamp>/`, which is ignored
by Git. Each page preserves request URL, actual fetch time, HTTP Date and a SHA-256 of
the raw response; the committed [inventory](source-candidates.json) preserves product
IDs, titles, bounds, download URLs, metadata URLs and publication/update dates.

Requests time out after 30 seconds. Defaults are 100 products/page and at most 50
pages; injectable test options are also bounded. The implementation follows numeric
`offset`, retains all pages, deduplicates identical IDs, and rejects conflicting IDs,
repeated pages, early empty pages, changing totals, malformed responses, HTTP/API errors
or an exhausted page budget. It emits no successful partial inventory. A live query is
expected to change over time; deterministic unit fixtures do not call the network.

A rectangle intersection is always marked `catalog-candidate-not-coverage`.
`validRasterCoverage` remains null. A positive result does not show where a tile has
finite, non-nodata pixels. This is particularly consequential where surveys end
inside nominal 10 km tiles. The search covers this one TNM dataset, not every regional,
original-resolution or classified point-cloud repository.

## Current acquisition findings

| Resort | Actual discovery/probe result | Next evidence needed |
|---|---|---|
| Breckenridge | 7 TNM candidates. Existing CO_Central_Western_2016 original 1 m raster is accessible; a native 1024 × 1024 sample is 100% valid. | Complete originals/metadata manifest, source-datum realization and epoch, complete nodata/seam audit, independent surveyed controls. |
| Heavenly | 12 TNM candidates, including NV_USFSR4_D23 published 2026-06-24. All 22 sampled center/trail positions are nodata in that new project. OpenTopography Tahoe 0.5 m bare-earth raster is accessible and valid at 21 of those 22 positions. | Resolve the **actual raster hole** near Dipper Bowl, establish full playable coverage, verify datum transformation, acquire independent controls. |
| Portillo | No suitable fine bare-earth raster was established by the bounded official-source investigation below. Current GLO-30 remains unchanged. | A licensed high-resolution DTM/point cloud covering the playable polygon, dataset-specific accuracy and datum reports, independent controls. |

TNM inventory fetches were 15:07:33.580Z (Breck) and 15:07:34.178Z (Heavenly).
Candidates include neighboring projects and duplicated UTM-zone deliveries; counts
must never be summed into coverage. No missing area was filled or synthesized.

### Native source-window probes

Install GDAL/PROJ with `gdalinfo` and `gdal_translate` on PATH. The recorded run used
GDAL 3.13.2. `probe-terrain-source.ts` reads a bounded source-pixel window directly using
GDAL `/vsicurl/`, with **no warp, resampling, vertical offset or nodata filling**. It
checks the pixel window lies inside the source and limits extraction to 4,194,304
pixels. Network calls have GDAL's 30-second HTTP timeout and each subprocess a
120-second limit. Output includes the GeoTIFF, full source/window GDAL metadata,
commands, UTC times, hashes and finite/non-nodata sample counts within the existing plausible elevation band. Geographic transform
and full data coverage are not implied by a valid window. This probe currently assesses
band-one nodata, not external mask quality or the correctness of source classifications.

```sh
npx tsx scripts/probe-terrain-source.ts https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CO_Central_Western_2016/TIFF/USGS_one_meter_x40y438_CO_Central_Western_2016.tif 5506 8006 1024 1024 .agent-team/terrain-source-probes/breckenridge-original

npx tsx scripts/probe-terrain-source.ts https://opentopography.s3.sdsc.edu/raster/TAHOE/TAHOE_be/he_38119H82.img 4358 12892 1024 1024 .agent-team/terrain-source-probes/heavenly-tahoe-original

npx tsx scripts/probe-terrain-source.ts https://opentopography.s3.sdsc.edu/raster/TAHOE/TAHOE_be/he_38119H84.img 6768 1101 64 64 .agent-team/terrain-source-probes/heavenly-tahoe-gap
```

The current helper names the extracted file `window-native.tif` regardless of spacing.
The original Breck run used the earlier filename `window-1m.tif`; the raster bytes and
window extent are identical. GDAL metadata hashes can change with paths/tool versions;
retain the original evidence alongside any rerun instead of silently replacing its
claims. A rerun to a new directory preserves both records.

| Probe | Native frame and outer pixel bounds (metres) | Observed pixels |
|---|---|---|
| Breck x40y438 | NAD83 / UTM 13N, EPSG:26913; west 405500, east 406524, south 4370976, north 4372000; 1 m | 1,048,576 / 1,048,576 valid; elevation 3277.948974609375–3571.1279296875 m |
| Tahoe he_38119H82, near Heavenly center | NAD83 / UTM 10N, EPSG:26910; west 767392, east 767904, south 4314442, north 4314954; 0.5 m | 1,048,576 / 1,048,576 valid; elevation 2672.85009765625–2877.739990234375 m |
| Tahoe he_38119H84, Dipper Bowl gap | NAD83 / UTM 10N, EPSG:26910; west 768830, east 768862, south 4313828.5, north 4313860.5; 0.5 m | **0 / 4,096 valid**, all nodata |

Breck source catalog ID: `5eaa4ba382cefae35a21f863`.
[Actual ScienceBase record](https://www.sciencebase.gov/catalog/item/5eaa4ba382cefae35a21f863?format=json)
is archived as `breckenridge-original/sciencebase.json`; it lists acquisition start
2016-05-28 and end 2016-10-07. The original full tile was range-read, not downloaded in
full: `sourceSha256` is deliberately null. A window SHA-256 is **not** the original
full-tile hash. Obtain complete original-file fingerprints before promotion.

The probes use the native NAD83 projected frames. Production uses translated WGS84 UTM;
these are not equivalent at our proposed tolerance. In the live Heavenly point search,
GDAL's default WGS84-to-NAD83 conversion moved the center approximately +0.83 m east
and -0.74 m north compared with the WGS84 UTM11 numbers. That is an observation of the
installed transformation, not a verified datum correction. The realization, coordinate
epoch, required transformation grids and their uncertainty remain unverified. No default
or ballpark operation is acceptable for the final survey comparison.

### Heavenly: accessible Tahoe source, with a confirmed gap

The [OpenTopography collection](https://portal.opentopography.org/datasetMetadata?otCollectionID=OT.032011.26910.1)
identifies Lake Tahoe Basin LiDAR, DOI [10.5069/G9PN93H2](https://doi.org/10.5069/G9PN93H2),
collected August 11–24, 2010. It lists 0.5 m rasters, NAD83 / UTM10 and NAVD88. The
[dataset's acquisition report](https://cloud.sdsc.edu/v1/AUTH_opentopography/www/metadata/Lake_Tahoe_LiDAR.pdf)
documents GEOID09 and historical accuracy assessment, including independently collected
checks. It expressly limits accuracy statements for dense vegetation and steep terrain.
Those historical dataset statistics do **not** establish current Heavenly terrain error,
and flight-control monuments are not replacement independent resort checkpoints.

The [actual tile metadata](https://opentopography.s3.sdsc.edu/raster/TAHOE/TAHOE_be/he_38119H82.img.xml)
is archived. It identifies NAD83/NAVD88, acquisition dates and a reported 0.036 m RMSE;
these are source-provider claims, not newly measured game-to-survey residuals. We have
not changed any production `verticalDatumVerified` flag.

The [official raster access page](https://portal.opentopography.org/raster?opentopoID=OTSDEM.032011.26910.1)
provides anonymous S3 access. Its description says the TRPA data is public domain,
although the structured Use License field says "Not Provided". Preserve both facts,
the dataset citation, and OpenTopography acknowledgment terms in the acquisition record.
Use the bare-earth `TAHOE_be` products; highest-hit surfaces include objects and are a
different physical surface. The [2011 revision notice](https://opentopography.org/news/updated-tahoe-data-products)
records hydro-enforcement changes, so retain product revision and water treatment.

For a bounded listing (follow continuation tokens before treating any listing as complete):

```sh
curl --fail --location --max-time 30 'https://opentopography.s3.sdsc.edu/raster?list-type=2&prefix=TAHOE/&max-keys=10'
```

The official `TAHOE/TAHOE_be.vrt` was fetched and its relative source paths were resolved
against that same public bucket. `gdallocationinfo -geoloc -valonly` read the center
and start/middle/end vertices of Milky Way Bowl, Ridge Run, Ellie's, Dipper Bowl, Comet,
Stagecoach and Gunbarrel. These 22 positions come from our existing OSM geometry and
are **coverage probes, never survey controls**. Every one returned -999999 from the
new USGS NV_USFSR4_D23 tile; 21 returned finite elevations from Tahoe.

The remaining Dipper Bowl position is lat 38.932356273915474, lon -119.89852972283315,
approximately NAD83 UTM10 (768846.016656059, 4313844.42249923) under the unverified
search transform. Directly reading `he_38119H84.img` returned nodata too, and the 32 m
square around it had no valid pixels. **This is an original raster gap, not merely a
VRT seam or catalog omission.** Inspect original classified point-cloud coverage and
nearby delivery boundaries before proposing a replacement. Do not interpolate the hole
and call it measured. The valid probe count is not a percentage of the mountain area.

### Portillo: official leads and concrete acquisition dependency

The bounded search consulted IDE Chile, IGM and official map records; it did not
establish a downloadable sub-meter bare-earth source over Portillo. This is an
investigation result, not proof that no such data exists anywhere.

- [IDE Chile's catalog](https://catalogo.ide.cl/) is an official discovery lead. Search
  the playable polygon and inspect each delivery's coverage, source type and rights.
- [IGM's digital cartography description](https://www.igm.cl/SCAR25000/visualizadores-web.php)
  describes its 1:25,000 product using a surface model with 8 m altimetric accuracy.
  That advertised product does not establish our 0.25 m target.
- The [National Library's IGM Portillo record](https://www.bibliotecanacionaldigital.gob.cl/pywb/all/20210707184959mp_/http%3A/www.bibliotecanacionaldigital.gob.cl/bnd/635/w3-article-347912.html)
  describes a historic map with 50 m contours and photographs from 1996. It is useful
  context, not sub-meter elevation or independent present-day control.
- [IGM's orthophoto service](https://www.igm.cl/?menu=4&page=ortofoto-igm) is a provider
  lead for a specified area, datum, scale and delivery. It does not prove existing
  Portillo coverage or authorize purchasing a survey.

A suitable next delivery must include licensed bare-earth DTM/point cloud, acquisition
season/date, survey extent, classifications, nodata masks, source accuracy report,
horizontal datum realization/epoch, vertical datum/geoid and independent controls.
A licensed regional or resort engineering survey may be needed. No purchase, provider
outreach, registration or control fabrication was performed in this task.

## Archived evidence fingerprints

Paths below are relative to the ignored `.agent-team/terrain-source-probes/` directory.
Hashes identify exactly the retrieved evidence, not an accuracy endorsement.

| Evidence | SHA-256 |
|---|---|
| Breck TNM raw response | `a6e117e6e39b612de8bb906004f653ad5ce641696dc7f2c99b6d3286b0543535` |
| Heavenly TNM raw response | `ba32379e1466c9c58b3cbd937b1e41c4a61db9e18287cd6a8c4f5f96f8652c34` |
| `breckenridge-original/window-1m.tif` | `5fcd76976a3e4c65b205d1b3864e356c281a59f73f95cf5b9677046d949eebe4` |
| `breckenridge-original/source-info.json` | `b32130f1664f6d1adaed44777802bdfe4ab1b1c366f1c342c46a27a6ed93daaa` |
| `breckenridge-original/sciencebase.json` | `478c916c8536adb36c176fb5c3dae6a9316ccfb28d60ffba6565ceaacd235502` |
| `heavenly-tahoe-original/window-native.tif` | `6823bc71024bdf97d31b221efc27cd4b942d13d302da37cc4360bd6a224653d0` |
| `heavenly-tahoe-original/source-metadata.xml` | `f2beb28a498595916099d32d964b756775a1cea6da11432c073ac3d99cdf3034` |
| `heavenly-tahoe-gap/window-native.tif` | `42b0f16622ae8ee0c90123035da00d17abbc9b158b1ae42592719cdfb84a5471` |
| `heavenly-new/Lake_Tahoe_LiDAR.pdf` | `d6fae98ceb8a6da8f8924925e4dcfd0661e4e75e96c9221ceb522c1cbe4d31a2` |
| `heavenly-new/TAHOE.geojson` | `b61be9207bf09d73ef80b535e59b42f1de1f9d511c11620ec20f8132c6ab5ab9` |
| `heavenly-new/TAHOE_be.vrt` | `d762344c2479800cf167ca589c6c542f1afe5e06535843aa407dd6f9c1069060` |
| `heavenly-new/point-probes.json` (new USGS project) | `15a327c2df95aa9b4d7eec4d263bd6419832fa58d5cd9498254bb06c83b78423` |
| `heavenly-new/tahoe-point-probes.json` | `195f06d4e906a1762cd6f313e5720b373e89b2c1b117270cfd33101a840b6713` |

For every next acquisition, keep originals immutable, archive full manifests and
failed requests as well as successes, and rerun the readiness/accuracy gates. Resolve
coverage and datum gaps with evidence before changing runtime assets or course version.
