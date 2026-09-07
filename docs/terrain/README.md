# Mountain accuracy and onboarding

This is the current methodology for Drop In real terrain, starting at course version 4.
It supersedes the physical micro-detail and approximate geographic projection policy
in the older v2 design documents. Read [the current measured report](accuracy-report.json)
before making accuracy claims.

**Current status: none of the three resorts is survey-certified.** The runtime now
preserves every elevation in the committed source grid, but those grids were already
resampled and quantized. Source fidelity proves we did not invent ground; it does not
prove that the source matches an independent survey. Public source resolution, file
precision, visual realism, and measured positional accuracy are different properties.

## Current sources and limitations

| Resort | Source | Native nominal spacing | Runtime spacing | Footprint |
|---|---|---|---|---|
| Breckenridge | USGS 3DEP, CO_Central_Western_2016 | 1 m | 6.0059 m | 6.144 km square |
| Heavenly | USGS 3DEP seamless 1/3 arc-second | ~10 m | 6.0059 m | 6.144 km square |
| Portillo | Copernicus GLO-30, S33_00_W071_00 | ~30 m | 4.0039 m | 4.096 km square |

The runtime grid is 1024 × 1024; elevation encoding is 0.1 m per code. Rounding adds
up to 0.05 m before Float32 representation, but total source/resampling error is not
0.05 m. Upsampling Heavenly or Portillo adds no measured detail. Breckenridge's bake
loses some of the available 1 m detail. Original tile manifests, datum transformations,
acquisition metadata, and independent survey checkpoints are not retained in the old
cache. The provenance files explicitly mark vertical datum verification as incomplete.

USGS quality levels specify separate positional accuracy and sampling requirements;
see [USGS quality levels](https://www.usgs.gov/3d-elevation-program/topographic-data-quality-levels-qls).
The general USGS orthometric datum policy is NAVD88, but this must be verified against
the actual source delivery, not inferred from its name. See the
[USGS processing requirements](https://www.usgs.gov/ngp-standards-and-specifications/lidar-base-specification-data-processing-and-handling-requirements).
Copernicus is a digital **surface** model referenced to EGM2008; its published global
accuracy statistics do not certify a particular steep mountainside. See the
[official Copernicus product description](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).

## Coordinate and height contract

All near-field raster, trail, lift, forest, and landmark geometry uses the **same
per-resort WGS84 UTM grid**. `scripts/dem/local-projection.ts` owns the offline vector
transform (Proj4js); the raster bake uses GDAL/PROJ with the same EPSG and projected
origin. Nine independent GDAL probes pin agreement within 1 mm. That tests transform
implementation, not the accuracy of OSM or survey coordinates.

```
assetX = projectedEasting - projectedCenterEasting
assetY = projectedNorthing - projectedCenterNorthing
gameX = assetX
gameZ = -assetY
gameY = source elevation in the documented vertical datum

cellSizeM = sizeM / (grid - 1)
col = (assetX + sizeM/2) / cellSizeM
row = (sizeM/2 - assetY) / cellSizeM
```

UTM grid north is not exactly true north, and grid distance is not exactly ground
distance. Never apply an approximate degrees-to-metres conversion to vectors over a
UTM raster. Survey work also needs grid convergence, combined scale factor, horizontal
datum realization and coordinate epoch. The current local frame is a translated UTM
grid, not a rigorous geocentric tangent ENU frame. Keep the game axis/sign convention.

`projectedRasterBounds` adds half a cell around the endpoint-inclusive sample grid so
pixel centres land on the intended coordinates. No half-pixel shift is permitted.
The runtime's sole physical height remains:

```
height(x,z) = bicubic(sourceGrid,x,z) + microDetail(x,z)
```

For normal real-mountain construction **microDetail = 0**. Explicit nonzero detail
options remain for synthetic experiments/tests and cannot support an accuracy claim.
No source grid cuts, banks, moguls, rock relief, tree wells or synthetic course ramps
are added. Trees are designed scenery inside OSM forests; the legacy `treeWells`
metadata field now means placement sites only. Snow normals, tracks and shading can
remain expressive without modifying physics. A future park needs separately sourced,
dated and measured feature geometry; an OSM park label alone does not establish jump
height. Do not restore a seven-metre kicker every few hundred metres on ordinary runs.

Bicubic interpolation can overshoot neighbouring samples. The audit reports the largest
overshoot encountered in 10,000 deterministic subcell probes. This is a sampled diagnostic,
not a global error bound. Render mesh LOD introduces a further surface approximation.
A strict survey acceptance must measure both, as well as the physical sampler. The far
horizon, water level offsets, landmark building dimensions and tree placements remain
illustrative and are outside the near-field elevation fidelity claim.

## Add or upgrade a mountain

1. **Agree on the intended accuracy and coverage before acquiring data.** Define the
   playable polygon and representative summit-to-base routes. Record a project-specific
   horizontal and vertical tolerance, required coverage, surface type (bare ground,
   canopy/buildings or dated snow), and acquisition season. A proposed starting target
   is 0.5 m horizontal and 0.25 m vertical, to be confirmed against the intended use.
   These are engineering targets, not an ASPRS certification claim.
2. **Acquire defensible inputs.** Prefer licensed bare-earth LiDAR DTM and classified
   point clouds with a dataset-specific accuracy report. Public USGS LiDAR may support
   the US resorts after checking actual coverage. Heavenly's seamless raster and
   Portillo's GLO-30 cannot establish these proposed tolerances. Obtain a suitable
   replacement survey where public data does not meet them. Capture original URLs,
   tile IDs, byte hashes, acquisition dates, processing version, license, CRS WKT/EPSG,
   datum realization/epoch, vertical units/geoid model, classification and nodata masks.
   Record gaps and water/vegetation treatment. Do not silently fill and call it measured.
3. **Archive independent control.** Obtain surveyed checkpoints, lift terminals and
   trail-edge/centreline observations independently of the DEM. Retain their reports,
   uncertainty, coordinate epoch, datum and collection date. Checkpoints must span the
   playable area, elevations, steep slopes and vegetation classes. Plan at least 30
   well-distributed points for an initial engineering audit; a survey professional
   determines the actual standard-specific sampling design. Points read back from the
   source DEM or OSM are not independent. Published resort summit/base statistics are
   useful plausibility checks only; endpoints and datums may differ.
4. **Normalize references explicitly.** Choose one target horizontal CRS and documented
   vertical datum. Apply verified datum/geoid transformations with required grids and
   record their hashes and commands. Ellipsoidal GNSS height is not orthometric height.
   A horizontal UTM transform does not convert vertical datum. Never fit a mountain-wide
   elevation offset or vertical multiplier to match marketing statistics.
5. **Bake the DEM once from originals.** Register configuration in
   `lib/game/terrain/resorts.ts`, then use `npm run bake-terrain -- <slug> --skip-trails`
   after satisfying the source prerequisites in `scripts/bake-resort.ts`. Archive the
   resulting pre-gameplay `.height.u16.br` and decoding `.meta.json` under
   `scripts/data/dem/`. Review grid placement, resampling error, seams, nodata and
   quantization. Current 1024² packing is an existing game budget, not a survey
   requirement: if it fails the agreed tolerance, implement measured adaptive/tiled
   resolution and validate mobile budgets instead of pretending interpolation fixes it.
6. **Register provenance and controls.** Add `<slug>.provenance.json` beside the source
   with SHA-256 of decompressed u16 bytes and exact source metadata bytes. Do not change
   fingerprints merely to silence a failing audit. Verified vertical datum requires
   dataset-specific evidence. See the existing manifests and `SourceManifest` in
   `scripts/audit-terrain.ts`. Add the new slug to config/profile/schema and loader
   allowlists, audit/control schema, attribution, UI and tests; search existing slugs
   to locate all registrations. The schemas intentionally reject unknown resorts.
7. **Bake vector geometry in the same grid.** Archive OSM `out geom` JSON under
   `scripts/data/osm/`, with timestamp, source IDs and licensing. Run
   `npx tsx scripts/bake-mountain-network.ts <slug>`. It clips to coverage, uses 0.1 m
   simplification and 0.1 m coordinate encoding, and preserves the DEM bytes. OSM's
   absolute error remains unknown. Default widths, inferred grooming and closed-piste
   boundary descent arcs must remain identified as assumptions. Re-bake landmarks
   with `npx tsx scripts/bake-landmarks.ts` if applicable; new landmarks require explicit
   source registration in that script. Validate far-field CRS/datum separately.
8. **Audit end to end.** Run the commands below. Inspect route starts, finishes, lengths,
   drops and geographic coordinates in the full report against independent observations.
   Measure along-route residuals and pitch transitions, not just summit and base.
   Report signed bias, RMSE, 95th-percentile absolute residual and worst error, split by
   slope, vegetation and surveyed coverage. Do not average away a failed sector.
9. **Accept only with evidence.** Missing control, uncertain datum, uncovered terrain,
   insufficient resolution or failed residuals blocks a survey-accuracy claim. The audit
   deliberately never emits a survey certificate, even when supplied points pass.
   Have an independent qualified reviewer assess the complete accuracy report and
   horizontal/vertical uncertainty budget. Record acceptance scope, date and exclusions.
10. **Version and ship together.** Bump `COURSE_VERSION` for surface, trail, or gate
    geometry changes; preserve the 120 Hz clock and v1 golden fixtures. Client and
    headless validator must load the identical asset pack. Verify ranked issuance,
    replay and stale-course rejection, then browser-test every resort on both backends
    and mobile budgets. Commit source manifests, baked outputs, reports and methodology
    together. Never mutate terrain files under an unchanged ranked course version.

## Reproducible checks

Run from the repository root after `npm ci`:

```sh
npx tsx scripts/bake-mountain-network.ts all --verify
npx tsx scripts/bake-landmarks.ts --verify
npm run validate-game-assets
npm run audit-terrain -- all --summary --output docs/terrain/accuracy-report.json
npm run audit-terrain -- breckenridge --output .agent-team/breckenridge-full-audit.json
npm test
npx tsc --noEmit
npm run build
```

The fidelity audit fails on changed source fingerprints, source/runtime sample mismatch,
changed decoding metadata, wrong CRS or invented physical relief. Full reports include
all selected route endpoints, drops and lengths; these are derived measurements, not
independent references. The checked-in summary is deterministic and excludes route rows.

For a real checkpoint comparison (after source datum evidence has been verified):

```sh
npm run audit-terrain -- breckenridge --controls /absolute/path/control.json --output .agent-team/control-report.json
```

Control format, illustrated with **synthetic values that are not survey evidence**:

```json
{
  "slug": "breckenridge",
  "horizontalCrs": "EPSG:4326",
  "verticalDatum": "NAVD88",
  "source": "Replace with the independent survey report and transformation record",
  "surveyDate": "2026-09-07",
  "independentOfDem": true,
  "toleranceM": 0.25,
  "checkpoints": [
    { "id": "CP-001", "lat": 39.4749, "lon": -106.081, "elevationM": 3000.0, "uncertaintyM": 0.02 }
  ]
}
```

Transform survey horizontal coordinates to the documented WGS84 representation first,
retaining the realization/epoch and transform report in `source`. The CLI rejects
unknown/mismatched datums, outside-box points, empty/duplicate/nonfinite inputs and
non-independent control. It does not guess datum shifts or clamp invalid control onto
an edge. Acceptance of an individual point requires `abs(residual) + uncertainty <=
tolerance`; any failure returns nonzero. Passing the supplied points does not establish
horizontal accuracy, adequate spatial coverage, or certification.

## Remaining work for survey acceptance

- Recover original raster delivery metadata and datum/epoch transformations for all three.
- Obtain genuinely independent control and trail/lift measurements.
- Preserve more of Breckenridge's 1 m detail; obtain better Heavenly and Portillo sources.
- Measure interpolation and rendered LOD error against the accepted surface, including cliffs.
- Independently validate far-field alignment, lakes, buildings and any claimed park features.

Do not convert any item in this list into a completed claim merely because source-fidelity
tests or a browser playtest passed.

## Executed buildout and engineering gates

The [implementation plan](../superpowers/plans/2026-09-07-survey-terrain.md) tracks the
remaining work task by task. Source discovery and source-window probes are documented
in [the acquisition guide](SOURCE-ACQUISITION.md). They do not silently select a new
runtime source.

```sh
npm run discover-terrain-sources -- all --output .agent-team/source-candidates.json
npm run measure-terrain-resolution -- all --summary --output .agent-team/resolution-report.json
npm run terrain-readiness -- all --output .agent-team/readiness-report.json
npm run terrain-readiness -- all --require-ready
```

See `scripts/discover-terrain-sources.ts` for the supported discovery arguments. The
last command is deliberately **nonzero (exit 2)** while any resort lacks sufficient
evidence. Report-only mode exits zero for successful report generation, even when the
reported status is `blocked`. Malformed input, stale source/course fingerprints and
invalid scope exit 1. None of these commands certifies a survey.

`docs/terrain/readiness/<slug>.json` binds evidence to the current course and source
hashes. Unknown source, datum, control and reviewer evidence is `null`. A source window
with 100% valid pixels does not establish full-resort coverage. The engineering gate
requires all four quadrants, minimum axis/elevation spans, the declared terrain classes,
and at least 30 independent control points. It checks worst individual horizontal and
vertical residuals including control uncertainty; a good average cannot hide a bad point.
It also checks a conservative combined vertical/control/mesh error budget.

A sampled mesh maximum is explicitly tagged `sampled`, which blocks a claim of a
full-scope error bound. Referenced evidence hashes and survey declarations must be
inspected independently: the gate validates declarations and active source fingerprints;
it does not authenticate remote documents or replace review of the survey methods.
The proposed 0.25/0.5 m targets are project engineering targets and remain provisional.

The [resolution report](resolution-report.json) measures rendered Float32 triangle
heights against the current physical surface along all selected named trail pieces,
including ±5 m lateral samples. Its diagonal and negative-coordinate behavior are tested
against the actual terrain renderer. It measures an approximation inside our pipeline,
not absolute error against the real mountain.

The [original-source experiment](breckenridge-source-resolution.json) uses a recovered
1024² Breckenridge 1 m source window in native NAD83 UTM13N. Point-sampling that local
window at the game's ~6 m spacing and reconstructing it with bicubic interpolation
produced ~0.111 m RMS loss and ~1.088 m worst sampled loss against the original raster.
This is not an exact reproduction of GDAL warp filtering, whole-mountain coverage, or
independent ground control. It demonstrates why “6 m grid from 1 m LiDAR” is insufficient
evidence for a 0.25 m worst-error target.

Uniform 1 m geometry over the current 1 km² streamed window would require 2,000,000
terrain triangles; even 2 m requires 500,000. The next runtime work therefore needs
adaptive geometry near the rider and error-driven refinement, with crack-free shared
edges, the same canonical physical surface, explicit measured error bounds, and mobile
resource validation. It must be evaluated against a source with adequate coverage and
known reference frames before a new terrain pack is promoted.


For the newly recovered Heavenly 0.5 m source window, the same local experiment
at ~6 m spacing measured ~0.134 m RMS processing loss and ~1.369 m worst sampled
loss. See [the source-window report](heavenly-source-resolution.json). These windows
remain in their native NAD83 reference frames; no unverified conversion to the game's
WGS84 frame is applied. The acquisition guide records the source coverage gaps.

```sh
npx tsx scripts/measure-source-resolution.ts .agent-team/terrain-source-probes/breckenridge-original/window-1m.tif --output .agent-team/breck-resolution.json
npx tsx scripts/measure-source-resolution.ts .agent-team/terrain-source-probes/heavenly-tahoe-original/window-native.tif --output .agent-team/heavenly-resolution.json
```

These source-window commands require the actual source probes first; see the acquisition
guide for the URLs and pixel-window extraction commands. The current production DEMs and
course v4 are retained until the independently validated promotion criteria are met.
