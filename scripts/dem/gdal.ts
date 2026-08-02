import { execFile } from "node:child_process";

type TranslateOptions = {
  /** Geographic bounds `[west, south, east, north]`. */
  bounds?: [number, number, number, number];
};

type GdalInfo = {
  width: number;
  height: number;
  epsg: number | null;
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

export function warpArgs(input: string, out: string, epsg: number, resM: number): string[] {
  return [
    "-t_srs",
    `EPSG:${epsg}`,
    "-tr",
    String(resM),
    String(resM),
    "-r",
    "bilinear",
    "-of",
    "GTiff",
    input,
    out,
  ];
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
): Promise<void> {
  await run("gdalwarp", warpArgs(input, out, epsg, resolutionM));
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
