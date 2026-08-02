import { execFile, spawn } from "node:child_process";
import { fromFile } from "geotiff";

type TranslateOptions = {
  /** Geographic bounds `[west, south, east, north]`. */
  bounds?: [number, number, number, number];
};

type GdalInfo = {
  width: number;
  height: number;
  epsg: number | null;
};

export type WarpGrid = {
  bounds: { west: number; south: number; east: number; north: number };
  width: number;
  height: number;
};

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout);
        return;
      }

      const detail = stderr.trim() || error.message;
      const wrapped = new Error(`${command} failed: ${detail}`) as NodeJS.ErrnoException;
      wrapped.code = (error as NodeJS.ErrnoException).code;
      reject(wrapped);
    });
  });
}

export function vrtArgs(inputs: string[], out: string): string[] {
  return [out, ...inputs];
}

export function warpArgs(
  input: string,
  out: string,
  epsg: number,
  resM: number,
  grid?: WarpGrid,
  dstNodata?: number,
): string[] {
  const args = [
    "-t_srs",
    `EPSG:${epsg}`,
  ];
  // Without -dstnodata, cells no source tile reaches keep gdalwarp's init value
  // (0 m) and read as real terrain. Tagging them makes the gap detectable.
  if (dstNodata !== undefined) args.push("-dstnodata", String(dstNodata));
  if (grid) {
    const { west, south, east, north } = grid.bounds;
    args.push("-te", String(west), String(south), String(east), String(north));
    args.push("-ts", String(grid.width), String(grid.height));
  } else {
    args.push("-tr", String(resM), String(resM));
  }
  args.push("-r", "bilinear", "-of", "GTiff", input, out);
  return args;
}

export async function gdalAvailable(): Promise<boolean> {
  try {
    await run("gdalinfo", ["--version"]);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function buildVrt(inputs: string[], out: string): Promise<void> {
  await run("gdalbuildvrt", vrtArgs(inputs, out));
}

export async function warpToUtm(
  input: string,
  out: string,
  epsg: number,
  resolutionM: number,
  grid?: WarpGrid,
  dstNodata?: number,
): Promise<void> {
  await run("gdalwarp", warpArgs(input, out, epsg, resolutionM, grid, dstNodata));
}

export function fillNodataArgs(input: string, out: string, maxDistancePx: number): string[] {
  // Inverse-distance interpolation from the hole edges, and deliberately zero
  // smoothing iterations: smoothing would also touch the real terrain around
  // the hole, changing cells that had perfectly good source data.
  return ["-q", "-md", String(maxDistancePx), "-interp", "inv_dist", "-of", "GTiff", input, out];
}

/** Interpolate the band's tagged nodata cells from their surrounding values. */
export async function fillNodata(input: string, out: string, maxDistancePx: number): Promise<void> {
  await run("gdal_fillnodata", fillNodataArgs(input, out, maxDistancePx));
}

export type Raster = { values: ArrayLike<number>; width: number; height: number };

/** Read band 1 of a GeoTIFF into memory, in natural north-to-south row order. */
export async function readRaster(path: string): Promise<Raster> {
  const tiff = await fromFile(path);
  const image = await tiff.getImage();
  const rasters = await image.readRasters();
  return {
    values: rasters[0] as ArrayLike<number>,
    width: image.getWidth(),
    height: image.getHeight(),
  };
}

/** Transform one XY coordinate with GDAL/PROJ, returning projected XY. */
export function transformPoint(
  x: number,
  y: number,
  sourceEpsg: number,
  targetEpsg: number,
): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    const child = spawn("gdaltransform", ["-s_srs", `EPSG:${sourceEpsg}`, "-t_srs", `EPSG:${targetEpsg}`], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`gdaltransform failed: ${stderr.trim() || `exit ${code}`}`));
        return;
      }
      const values = stdout.trim().split(/\s+/).map(Number);
      if (values.length < 2 || !Number.isFinite(values[0]) || !Number.isFinite(values[1])) {
        reject(new Error(`gdaltransform returned invalid coordinates: ${stdout.trim()}`));
        return;
      }
      resolve([values[0], values[1]]);
    });
    child.stdin.end(`${x} ${y}\n`);
  });
}

export async function translateToTiff(
  input: string,
  out: string,
  opts: TranslateOptions = {},
): Promise<void> {
  const args = ["-of", "GTiff"];
  if (opts.bounds) {
    const [west, south, east, north] = opts.bounds;
    args.push("-projwin", String(west), String(north), String(east), String(south));
  }
  args.push(input, out);
  await run("gdal_translate", args);
}

export async function gdalInfo(path: string): Promise<GdalInfo> {
  const raw = await run("gdalinfo", ["-json", path]);
  const info = JSON.parse(raw) as {
    size?: [number, number];
    coordinateSystem?: { wkt?: string };
    stac?: { "proj:epsg"?: number };
  };
  if (!info.size || info.size.length !== 2) {
    throw new Error("gdalinfo returned JSON without raster dimensions");
  }

  const authorities = [...(info.coordinateSystem?.wkt ?? "").matchAll(/ID\["EPSG",(\d+)\]/g)];
  const wktEpsg = authorities.length > 0 ? Number(authorities.at(-1)?.[1]) : null;
  return {
    width: info.size[0],
    height: info.size[1],
    epsg: info.stac?.["proj:epsg"] ?? wktEpsg,
  };
}
