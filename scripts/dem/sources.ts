import fs from "node:fs";
import path from "node:path";
import type { ResortBakeConfig } from "../../lib/game/terrain/resorts";

export type DemSource =
  /**
   * One or more 3DEP 1 m projects, mosaicked in the listed order. A resort
   * whose box crosses a project boundary (Heavenly straddles the CA/NV state
   * line) needs several; every project must be the same product type, because
   * bare-earth and DSM must never be blended within one resort.
   */
  | { kind: "3dep"; projects: string[] }
  /**
   * 3DEP 1/3 arc-second seamless (~10 m), the national coverage layer. Its
   * 1°×1° cell ids follow mechanically from the bake box, so there is nothing
   * to configure — but it is a *different product* from the 1 m projects above
   * and carries its own `kind` so a baked asset can never claim a resolution
   * it does not have. Never wire this up as an automatic fallback from `3dep`:
   * a resort whose configured source does not cover it must fail the bake and
   * force a decision, not quietly ship 10 m terrain labelled 1 m.
   */
  | { kind: "3dep-seamless" }
  | { kind: "copernicus"; tile: string }
  | { kind: "terrarium" };

/** Geographic extent in degrees, for choosing seamless cells. */
export type LonLatBounds = { west: number; south: number; east: number; north: number };

export type DemAttribution = {
  name: string;
  licence: string;
  notice: string[];
};

/**
 * Anonymous USGS TNM S3 endpoint for staged 1 m project GeoTIFFs.
 *
 * The project layout is intentionally centralized here because it is an
 * external contract. The two Phase 1 projects must be smoke-tested from a
 * networked host before committing rebaked assets.
 */
export const THREE_DEP_PROJECT_ROOT =
  "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects";
const THREE_DEP_BUCKET_ROOT = "https://prd-tnm.s3.amazonaws.com";
const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TILE_KEY_RE = /^StagedProducts\/Elevation\/1m\/Projects\/[A-Za-z0-9_-]+\/TIFF\/[^/]+\.tiff?$/i;

export type UtmBounds = { west: number; south: number; east: number; north: number };

export function threeDepListingUrl(project: string, continuationToken?: string): string {
  if (!PROJECT_RE.test(project)) throw new Error(`invalid 3DEP project: ${project}`);
  const prefix = `StagedProducts/Elevation/1m/Projects/${project}/TIFF/`;
  const params = new URLSearchParams({ "list-type": "2", prefix });
  if (continuationToken) params.set("continuation-token", continuationToken);
  return `${THREE_DEP_BUCKET_ROOT}/?${params}`;
}

export function threeDepTileUrl(key: string): string {
  if (!TILE_KEY_RE.test(key)) throw new Error(`invalid 3DEP tile key: ${key}`);
  return `${THREE_DEP_BUCKET_ROOT}/${key}`;
}

// ─── 3DEP 1/3 arc-second seamless (~10 m) ────────────────────

const SEAMLESS_ROOT = `${THREE_DEP_BUCKET_ROOT}/StagedProducts/Elevation/13/TIFF/current`;
const SEAMLESS_CELL_RE = /^[ns]\d{2}[we]\d{3}$/;

/**
 * Cell id of the 1°×1° seamless tile containing `lat, lon`.
 *
 * Like the 1 m tile index, the id names the cell's NORTH-WEST corner, so the
 * latitude ceils and the longitude FLOORS: `n39w120` spans lat 38–39 and lon
 * −120 to −119 (measured: UL −120.0005556, 39.0005556). Flooring the longitude
 * is the part worth guarding — truncating toward zero turns Heavenly's
 * −119.912 into `w119`, a real cell one degree east that would silently return
 * the wrong mountain.
 */
export function seamlessCellId(lat: number, lon: number): string {
  const latIndex = Math.ceil(lat);
  const lonIndex = Math.floor(lon);
  const ns = latIndex >= 0 ? "n" : "s";
  const we = lonIndex >= 0 ? "e" : "w";
  return (
    ns +
    String(Math.abs(latIndex)).padStart(2, "0") +
    we +
    String(Math.abs(lonIndex)).padStart(3, "0")
  );
}

/** Every seamless cell a geographic box touches, west-to-east then south-to-north. */
export function seamlessCellsFor(bounds: LonLatBounds): string[] {
  const cells: string[] = [];
  for (let lat = Math.ceil(bounds.south); lat <= Math.ceil(bounds.north); lat++) {
    for (let lon = Math.floor(bounds.west); lon <= Math.floor(bounds.east); lon++) {
      // Address each cell by a point safely inside it, so the id round-trips
      // through the same ceil/floor rule rather than a second formula.
      cells.push(seamlessCellId(lat - 0.5, lon + 0.5));
    }
  }
  return cells;
}

export function seamlessCellUrl(cell: string): string {
  if (!SEAMLESS_CELL_RE.test(cell)) throw new Error(`invalid 3DEP seamless cell: ${cell}`);
  return `${SEAMLESS_ROOT}/${cell}/USGS_13_${cell}.tif`;
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((match) =>
    decodeXml(match[1]),
  );
}

async function fetchOk(fetchImpl: typeof fetch, url: string, label: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { "User-Agent": "peakcam-dem-bake/1.0" } });
  } catch (error) {
    throw new Error(`${label} request failed: ${String(error)}`);
  }
  if (!response.ok) throw new Error(`${label} failed: HTTP ${response.status} ${response.statusText}`);
  return response;
}

/** Return the staged GeoTIFF keys in a 3DEP project, following S3 pagination. */
export async function list3depProjectTiles(project: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const response = await fetchOk(fetchImpl, threeDepListingUrl(project, token), `3DEP ${project} listing`);
    const xml = await response.text();
    keys.push(...xmlValues(xml, "Key").filter((key) => TILE_KEY_RE.test(key)));
    const truncated = xmlValues(xml, "IsTruncated")[0] === "true";
    token = truncated ? xmlValues(xml, "NextContinuationToken")[0] : undefined;
    if (truncated && !token) throw new Error(`3DEP ${project} listing is truncated without a continuation token`);
  } while (token);
  if (keys.length === 0) throw new Error(`3DEP ${project} listing contained no GeoTIFF tiles`);
  return keys;
}

const TILE_SPAN_M = 10_000;

/**
 * Source pixels the warp needs beyond the destination extent. Bilinear taps
 * reach half a destination cell past the edge; 100 m is far more than that and
 * still far less than the 10 km it costs to be wrong.
 */
const TILE_MARGIN_M = 100;

/**
 * The 3DEP index is asymmetric, and the asymmetry is the whole trap: a tile
 * index names its NORTH-WEST corner in 10 km units. So `x` is the tile's west
 * edge (floor) but `y` is its NORTH edge (ceil) — tile `yN` spans
 * `[(N-1)·10km, N·10km]`.
 *
 * Measured on the staged rasters (allowing for their ~6 m overlap collar):
 *   x24y431 → UL (239994, 4310006), LR (250006, 4299994)
 *   x24y432 → UL (239994, 4320006), LR (250006, 4309994)
 *   x25y432 → UL (249994, 4320006), LR (260006, 4309994)
 *
 * Reading `y` as a south edge (`floor`) shifts the whole window one row south.
 * That never dropped a needed tile here only because a ±1-tile margin papered
 * over it — at the cost of three rows of ~250 MB tiles instead of one.
 */
export function tileIndexFor(easting: number, northing: number): { x: number; y: number } {
  return { x: Math.floor(easting / TILE_SPAN_M), y: Math.ceil(northing / TILE_SPAN_M) };
}

/** Nominal footprint of tile `xNN yNNN` — the exact inverse of `tileIndexFor`. */
export function tileFootprint(x: number, y: number): UtmBounds {
  return {
    west: x * TILE_SPAN_M,
    east: (x + 1) * TILE_SPAN_M,
    south: (y - 1) * TILE_SPAN_M,
    north: y * TILE_SPAN_M,
  };
}

/**
 * The staged tiles whose footprint meets the requested warp extent.
 *
 * Selection is an intersection test against the real footprint rather than an
 * index window with a slop factor, so it neither drops a needed tile nor
 * fetches a row of unused ones.
 *
 * Projects use at least two naming conventions for the same index —
 * `USGS_1M_11_x23y430_CA_SierraNevada_B22.tif` and
 * `USGS_one_meter_x24y432_NV_Reno_Carson_QL1_2017.tif` — so match on the
 * `_xNNyNNN_` field alone and never on the surrounding product prefix.
 *
 * Selecting a tile says only that it *overlaps* the box. It does not promise
 * the tile holds data there: 3DEP acquisition boundaries end mid-tile, and a
 * staged tile is nodata outside its project's collection area. Actual coverage
 * is settled after the warp, by the nodata audit.
 */
export function select3depTiles(keys: string[], bounds: UtmBounds): string[] {
  const low = tileIndexFor(bounds.west - TILE_MARGIN_M, bounds.south - TILE_MARGIN_M);
  const high = tileIndexFor(bounds.east + TILE_MARGIN_M, bounds.north + TILE_MARGIN_M);
  return keys.filter((key) => {
    const name = path.basename(key);
    // The index field alone is not enough to identify a raster: GDAL sidecars
    // (`....tif.aux.xml`) carry the same `_xNNyNNN_` and would otherwise be
    // handed to the VRT as if they were tiles.
    if (!/\.tiff?$/i.test(name)) return false;
    const match = /_x(\d+)y(\d+)_/i.exec(name);
    if (!match) return false;
    const x = Number(match[1]);
    const y = Number(match[2]);
    return x >= low.x && x <= high.x && y >= low.y && y <= high.y;
  });
}

export type ProjectContribution = { project: string; tiles: number };

/**
 * Fetch the tiles every configured 3DEP project contributes to a projected
 * resort extent, cached one directory per project so two projects that happen
 * to name a tile identically cannot collide. Existing non-empty files are
 * reused so an interrupted bake can resume.
 *
 * A project contributing zero tiles is reported rather than fatal — with a
 * one-tile margin a project can legitimately sit just outside the box — but it
 * is also the signature of a misspelled project or an unmatched filename
 * convention, so `onContribution` exists to make it visible. Only an empty
 * union is fatal here; partial coverage of the box is caught downstream by the
 * nodata audit, which can quantify it.
 */
export async function fetch3depTiles(
  projects: string[],
  bounds: UtmBounds,
  cacheRoot: string,
  fetchImpl: typeof fetch = fetch,
  onContribution: (contribution: ProjectContribution) => void = () => {},
): Promise<string[]> {
  if (projects.length === 0) throw new Error("3DEP source lists no projects");
  const files: string[] = [];
  for (const project of projects) {
    const keys = select3depTiles(await list3depProjectTiles(project, fetchImpl), bounds);
    onContribution({ project, tiles: keys.length });
    const destinationDir = path.join(cacheRoot, project);
    if (keys.length > 0) fs.mkdirSync(destinationDir, { recursive: true });
    for (const key of keys) {
      const output = path.join(destinationDir, path.basename(key));
      if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
        const response = await fetchOk(fetchImpl, threeDepTileUrl(key), `3DEP tile ${path.basename(key)}`);
        fs.writeFileSync(output, Buffer.from(await response.arrayBuffer()));
      }
      files.push(output);
    }
  }
  if (files.length === 0) {
    throw new Error(
      `3DEP ${projects.join(", ")} has no indexed GeoTIFF tiles covering the requested UTM extent`,
    );
  }
  return files;
}

/** Resort DEMs are design inputs: never infer a source from geography. */
export function resolveDemSource(cfg: ResortBakeConfig): DemSource {
  return cfg.demSource;
}

export function attributionFor(source: DemSource): DemAttribution {
  switch (source.kind) {
    case "3dep":
      return {
        name: "USGS 3D Elevation Program (3DEP), 1 m lidar projects",
        licence: "United States public domain",
        notice: ["Source: U.S. Geological Survey 3D Elevation Program, 1 meter project DEMs."],
      };
    case "3dep-seamless":
      // Same public-domain terms, no extra obligation — but the product is
      // named distinctly, because "3DEP" alone does not say which resolution.
      return {
        name: "USGS 3D Elevation Program (3DEP), 1/3 arc-second seamless",
        licence: "United States public domain",
        notice: [
          "Source: U.S. Geological Survey 3D Elevation Program, 1/3 arc-second seamless DEM (approximately 10 m).",
        ],
      };
    case "copernicus":
      return {
        name: "Copernicus DEM GLO-30",
        licence: "Copernicus DEM Licence",
        notice: [
          "Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.",
          "Article 6(c) liability disclaimer required: no warranty and limitation of liability; reproduce the canonical licence notice verbatim when distributing derived data.",
        ],
      };
    case "terrarium":
      return {
        name: "AWS Terrain Tiles (Mapzen / Tilezen Terrarium)",
        licence: "Mixed-source licences, including CC-BY inputs",
        notice: [
          "Terrarium fallback attaches source-specific CC-BY attribution obligations; preserve every applicable Mapzen/Tilezen source credit.",
        ],
      };
  }
}
