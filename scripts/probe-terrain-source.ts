/** Extract a bounded native-pixel window without warping, filling nodata or altering production data. */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fromFile } from 'geotiff';
import { PLAUSIBLE_ELEVATION_M } from './dem/nodata';
const exec = promisify(execFile);
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
export type PixelWindow = [number, number, number, number];
export function validateWindow(window: PixelWindow, width: number, height: number) {
  const [x, y, w, h] = window;
  if (![x, y, w, h, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || w < 1 || h < 1 || width < 1 || height < 1 || w * h > 4_194_304 || x + w > width || y + h > height) throw new Error('Pixel window invalid, exceeds source bounds or exceeds 4,194,304-pixel limit');
}
export function validCoverage(values: ArrayLike<number>, noData: number | null) {
  let valid = 0, min = Infinity, max = -Infinity;
  // Float32 storage rounds nodata while GDAL JSON may abbreviate it.
  const marker = noData === null ? null : Math.fround(noData);
  if (!values.length) throw new Error('Empty source window');
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v) || v === noData || v === marker || v < PLAUSIBLE_ELEVATION_M.min || v > PLAUSIBLE_ELEVATION_M.max) continue;
    valid++; min = Math.min(min, v); max = Math.max(max, v);
  }
  return { sampleCount: values.length, validSamples: valid, validFraction: valid / values.length, minimumM: valid ? min : null, maximumM: valid ? max : null };
}
export async function probeSource(sourceUrl: string, window: PixelWindow, directory: string) {
  const url = new URL(sourceUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use a public HTTPS source URL without credentials, query or fragment');
  fs.mkdirSync(directory, { recursive: true });
  const env = { ...process.env, GDAL_HTTP_TIMEOUT: '30', GDAL_DISABLE_READDIR_ON_OPEN: 'EMPTY_DIR' };
  const run = async (command: string, args: string[]) => (await exec(command, args, { env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
  const startedAt = new Date().toISOString();
  const sourcePath = `/vsicurl/${sourceUrl}`, sourceRaw = await run('gdalinfo', ['-json', sourcePath]);
  fs.writeFileSync(path.join(directory, 'source-info.json'), sourceRaw);
  const source = JSON.parse(sourceRaw) as { size: [number, number] };
  if (!Array.isArray(source.size)) throw new Error('Source has no raster dimensions');
  validateWindow(window, ...source.size);
  const windowPath = path.join(directory, 'window-native.tif');
  const translateArgs = ['-srcwin', ...window.map(String), '-of', 'GTiff', sourcePath, windowPath];
  const log = await run('gdal_translate', translateArgs);
  fs.writeFileSync(path.join(directory, 'translate.log'), log);
  const windowRaw = await run('gdalinfo', ['-json', '-stats', windowPath]);
  fs.writeFileSync(path.join(directory, 'window-info.json'), windowRaw);
  const info = JSON.parse(windowRaw) as { size: [number, number]; geoTransform: number[]; stac?: { 'proj:epsg'?: number }; bands: { noDataValue?: number }[] };
  const tiff = await fromFile(windowPath);
  let coverage: ReturnType<typeof validCoverage>;
  try {
    const image = await tiff.getImage(), rasters = await image.readRasters({ samples: [0] });
    coverage = validCoverage(rasters[0] as ArrayLike<number>, info.bands[0].noDataValue ?? null);
  } finally { await tiff.close(); }
  const report = { schemaVersion: 1, startedAt, completedAt: new Date().toISOString(), sourceUrl, sourceSha256: null, sourceHashNote: 'Original remote tile was range-read, not downloaded in full. Hashes below identify the extracted window and metadata only.', pixelWindow: window, gdalVersion: (await run('gdalinfo', ['--version'])).trim(), commands: { translate: ['gdal_translate', ...translateArgs] }, sourceInfoSha256: hash(sourceRaw), windowInfoSha256: hash(windowRaw), windowSha256: hash(fs.readFileSync(windowPath)), windowFile: windowPath, dimensions: info.size, geoTransform: info.geoTransform, sourceHorizontalEpsg: info.stac?.['proj:epsg'] ?? null, verticalDatumVerified: false, coverage, status: 'native-window-probe-not-whole-resort-or-survey-validation' };
  fs.writeFileSync(path.join(directory, 'probe-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
async function main() {
  const [sourceUrl, x, y, width, height, directory, ...extra] = process.argv.slice(2);
  if (!sourceUrl || !directory || extra.length) throw new Error('Usage: probe-terrain-source.ts HTTPS_URL xoff yoff width height output-directory');
  console.log(JSON.stringify(await probeSource(sourceUrl, [Number(x), Number(y), Number(width), Number(height)], directory), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(String(error)); process.exitCode = 1; });
