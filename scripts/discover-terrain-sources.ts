/** Offline source discovery only: catalog bounds do not establish valid DEM coverage. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { RESORT_BAKE_CONFIGS } from '../lib/game/terrain/resorts';
import { localProjection } from './dem/local-projection';

export const TNM_ENDPOINT = 'https://tnmaccess.nationalmap.gov/api/v1/products';
export const TNM_DATASET = 'Digital Elevation Model (DEM) 1 meter';
export type DiscoverySlug = 'breckenridge' | 'heavenly';
type Bounds = { west: number; south: number; east: number; north: number };
export type Candidate = {
  sourceId: string; title: string; downloadUrl: string; metadataUrl: string;
  vendorMetadataUrl: string | null; publicationDate: string | null;
  lastUpdated: string | null; sizeInBytes: number | null; bounds: Bounds;
  status: 'catalog-candidate-not-coverage';
};
type Page = { queryUrl: string; fetchedAt: string; serverDate: string | null; responseSha256: string; offset: number; count: number };
type Options = { pageSize?: number; maxPages?: number; timeoutMs?: number; onPage?: (page: Page, raw: string) => void };

/** Densify the projected playable-square perimeter before bounding it in lon/lat. */
export function discoveryBounds(slug: DiscoverySlug): Bounds {
  const cfg = RESORT_BAKE_CONFIGS[slug];
  if (slug !== 'breckenridge' && slug !== 'heavenly') throw new Error('TNM discovery supports breckenridge and heavenly only');
  const projection = localProjection(cfg.center);
  const bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  for (let i = 0; i <= 32; i++) for (let edge = 0; edge < 4; edge++) {
    const h = cfg.sizeM / 2, v = -h + cfg.sizeM * i / 32;
    const [lat, lon] = projection.inverse(edge < 2 ? v : edge === 2 ? -h : h, edge >= 2 ? v : edge === 0 ? -h : h);
    bounds.west = Math.min(bounds.west, lon); bounds.east = Math.max(bounds.east, lon);
    bounds.south = Math.min(bounds.south, lat); bounds.north = Math.max(bounds.north, lat);
  }
  return bounds;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid TNM object');
  return value as Record<string, unknown>;
}
function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing TNM string');
  return value;
}
function url(value: unknown): string {
  const text = nonempty(value), parsed = new URL(text);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Invalid TNM URL protocol');
  return text;
}
function nullableString(value: unknown): string | null { return value === undefined || value === null ? null : nonempty(value); }
function candidate(value: unknown): Candidate {
  const item = record(value), bbox = record(item.boundingBox);
  for (const key of ['minX', 'minY', 'maxX', 'maxY']) if (typeof bbox[key] !== 'number' || !Number.isFinite(bbox[key])) throw new Error('Invalid TNM bounds');
  const bounds = { west: bbox.minX as number, south: bbox.minY as number, east: bbox.maxX as number, north: bbox.maxY as number };
  if (bounds.west >= bounds.east || bounds.south >= bounds.north || bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90) throw new Error('Invalid TNM bounds');
  const size = item.sizeInBytes;
  if (size != null && (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)) throw new Error('Invalid TNM size');
  return { sourceId: nonempty(item.sourceId), title: nonempty(item.title), downloadUrl: url(item.downloadURL), metadataUrl: url(item.metaUrl), vendorMetadataUrl: item.vendorMetaUrl == null ? null : url(item.vendorMetaUrl), publicationDate: nullableString(item.publicationDate), lastUpdated: nullableString(item.lastUpdated), sizeInBytes: size == null ? null : size as number, bounds, status: 'catalog-candidate-not-coverage' };
}

export async function queryProducts(slug: DiscoverySlug, fetchImpl: typeof fetch = fetch, options: Options = {}) {
  const { pageSize = 100, maxPages = 50, timeoutMs = 30_000, onPage } = options;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) throw new Error('Invalid discovery bounds/options');
  const startedAt = new Date().toISOString(), bounds = discoveryBounds(slug);
  const pages: Page[] = [], products: Candidate[] = [], ids = new Map<string, Candidate>(), signatures = new Set<string>();
  let offset = 0, total: number | undefined, duplicateCount = 0;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const params = new URLSearchParams({ datasets: TNM_DATASET, bbox: [bounds.west, bounds.south, bounds.east, bounds.north].join(','), max: String(pageSize), offset: String(offset), sort: 'title' });
    const queryUrl = `${TNM_ENDPOINT}?${params}`;
    const response = await fetchImpl(queryUrl, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'peakcam-terrain-discovery/1.0' } });
    if (!response.ok) throw new Error(`TNM HTTP ${response.status} at offset ${offset}: ${queryUrl}`);
    const raw = await response.text(), data = record(JSON.parse(raw));
    if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || (data.total as number) < 0 || !Array.isArray(data.errors)) throw new Error('Malformed TNM page');
    if (data.errors.length) throw new Error(`TNM reported errors: ${JSON.stringify(data.errors)}`);
    if (total !== undefined && total !== data.total) throw new Error('TNM total changed during pagination; repeat discovery');
    total = data.total as number;
    const items = data.items.map(candidate);
    if (items.length > pageSize || offset + items.length > total) throw new Error('TNM page length exceeds advertised total/page size');
    const signature = items.map(item => item.sourceId).sort().join('\n');
    if (items.length && signatures.has(signature)) throw new Error('TNM repeated pagination page');
    signatures.add(signature);
    const page: Page = { queryUrl, fetchedAt: new Date().toISOString(), serverDate: response.headers.get('date'), responseSha256: createHash('sha256').update(raw).digest('hex'), offset, count: items.length };
    onPage?.(page, raw); pages.push(page);
    for (const item of items) {
      const previous = ids.get(item.sourceId);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(item)) throw new Error(`Conflicting duplicate TNM source ID ${item.sourceId}`);
        duplicateCount++;
      } else { ids.set(item.sourceId, item); products.push(item); }
    }
    offset += items.length;
    if (offset >= total) return { schemaVersion: 1 as const, slug, startedAt, completedAt: new Date().toISOString(), endpoint: TNM_ENDPOINT, dataset: TNM_DATASET, queryBoundsWgs84: bounds, status: 'catalog-candidates-not-coverage' as const, catalogTotal: total, uniqueCount: products.length, duplicateCount, validRasterCoverage: null, pages, products };
    if (!items.length) throw new Error('TNM empty page before advertised total');
  }
  throw new Error(`TNM exceeded bounded page limit ${maxPages}; no complete inventory emitted`);
}

async function main() {
  const args = process.argv.slice(2), slug = args.shift() ?? 'all';
  let output: string | undefined, archive = '.agent-team/terrain-source-probes';
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    if (!value || !['--output', '--archive'].includes(flag ?? '')) throw new Error('Usage: discover-terrain-sources.ts all|breckenridge|heavenly [--output file] [--archive directory]');
    if (flag === '--output') output = value; else archive = value;
  }
  if (!['all', 'breckenridge', 'heavenly'].includes(slug)) throw new Error('Unknown TNM resort');
  const inventories = [];
  for (const resort of (slug === 'all' ? ['breckenridge', 'heavenly'] : [slug]) as DiscoverySlug[]) {
    const archiveDir = path.join(archive, resort, new Date().toISOString().replaceAll(':', '-'));
    fs.mkdirSync(archiveDir, { recursive: true });
    inventories.push(await queryProducts(resort, fetch, { onPage: (page, raw) => {
      fs.writeFileSync(path.join(archiveDir, `tnm-${page.offset}.json`), raw);
      fs.writeFileSync(path.join(archiveDir, `tnm-${page.offset}.request.json`), `${JSON.stringify(page, null, 2)}\n`);
    } }));
  }
  const report = `${JSON.stringify({ schemaVersion: 1, inventories }, null, 2)}\n`;
  if (output) fs.writeFileSync(output, report); else process.stdout.write(report);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(String(error)); process.exitCode = 1; });
