import fs from "node:fs";
import path from "node:path";
import type { ResortBakeConfig } from "../../lib/game/terrain/resorts";

export type DemSource =
  | { kind: "3dep"; project: string }
  | { kind: "copernicus"; tile: string }
  | { kind: "terrarium" };

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

/**
 * 3DEP 1 m project tiles use 10 km UTM indices in `_xNNyNNN_` filenames.
 * Keep a one-tile safety margin around the requested warp extent; GDAL crops
 * the mosaic precisely later.
 */
export function select3depTiles(keys: string[], bounds: UtmBounds): string[] {
  const x0 = Math.floor(bounds.west / 10_000) - 1;
  const x1 = Math.floor(bounds.east / 10_000) + 1;
  const y0 = Math.floor(bounds.south / 10_000) - 1;
  const y1 = Math.floor(bounds.north / 10_000) + 1;
  return keys.filter((key) => {
    const match = /_x(\d+)y(\d+)_/i.exec(path.basename(key));
    if (!match) return false;
    const x = Number(match[1]);
    const y = Number(match[2]);
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  });
}

/**
 * Fetch just the 3DEP project tiles needed by a projected resort extent.
 * Existing non-empty files are reused so an interrupted bake can resume.
 */
export async function fetch3depTiles(
  project: string,
  bounds: UtmBounds,
  destinationDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const keys = select3depTiles(await list3depProjectTiles(project, fetchImpl), bounds);
  if (keys.length === 0) {
    throw new Error(`3DEP ${project} has no indexed GeoTIFF tiles covering the requested UTM extent`);
  }
  fs.mkdirSync(destinationDir, { recursive: true });
  const files: string[] = [];
  for (const key of keys) {
    const output = path.join(destinationDir, path.basename(key));
    if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
      const response = await fetchOk(fetchImpl, threeDepTileUrl(key), `3DEP tile ${path.basename(key)}`);
      fs.writeFileSync(output, Buffer.from(await response.arrayBuffer()));
    }
    files.push(output);
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
        name: "USGS 3D Elevation Program (3DEP)",
        licence: "United States public domain",
        notice: ["Source: U.S. Geological Survey 3D Elevation Program."],
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
