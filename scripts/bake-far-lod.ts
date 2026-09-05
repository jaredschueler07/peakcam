/** Offline topology-only LOD of committed PCFF; no DEM/network access. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { decodeFarField, type DecodedFarField } from '../lib/game/terrain/far-field-format';
import { buildRingRadii, segmentsForRing, type RingBand } from './bake-far-field';
import type { FarFieldLodFile } from '../lib/game/terrain/far-field-lod';

export function bakeFarLod(asset: DecodedFarField, bands: RingBand[], innerRadiusM: number, sourceSha256: string): FarFieldLodFile {
  const radii = buildRingRadii(innerRadiusM, asset.meta.radiusM, bands);
  let count = 0, previous = 0;
  const rings = radii.map(radius => {
    const segments = segmentsForRing(radius, bands, asset.wedges.length, previous);
    previous = segments; const start = count; count += segments + 1;
    return { radius, segments, start };
  });
  const rows = new Set(rings.map((_, i) => i).filter(i => i % 2 === 0));
  rows.add(rings.length - 1);
  for (const wedge of asset.wedges) {
    if (wedge.positions.length / 3 !== count) throw new Error('PCFF ring layout differs from sidecar');
    let peak = 0;
    for (let i = 0; i < count; i++) if (wedge.positions[i * 3 + 1] > wedge.positions[peak * 3 + 1]) peak = i;
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      if (peak >= ring.start && peak <= ring.start + ring.segments) rows.add(r);
      for (let j = 0; j <= ring.segments; j++) {
        const at = (ring.start + j) * 3;
        // Independent horizontal-axis u16 quantisation can perturb radius <0.5m.
        if (Math.abs(Math.hypot(wedge.positions[at], wedge.positions[at + 2]) - ring.radius) > 0.6) throw new Error('PCFF radial layout mismatch');
      }
    }
  }
  const selectedRows = [...rows].sort((a, b) => a - b);
  const wedges = asset.wedges.map(wedge => {
    const selected = selectedRows.map(row => {
      const ring = rings[row]; let max = 0;
      for (let j = 1; j <= ring.segments; j++) if (wedge.positions[(ring.start + j) * 3 + 1] > wedge.positions[(ring.start + max) * 3 + 1]) max = j;
      const columns = new Set<number>([0, ring.segments, max]);
      for (let j = 0; j <= ring.segments; j += 2) columns.add(j);
      return { ...ring, columns: [...columns].sort((a, b) => a - b) };
    });
    const indices: number[] = [];
    for (let r = 1; r < selected.length; r++) {
      const inner = selected[r - 1], outer = selected[r]; let a = 0, b = 0;
      while (a + 1 < inner.columns.length || b + 1 < outer.columns.length) {
        const advanceInner = b + 1 >= outer.columns.length || (a + 1 < inner.columns.length && inner.columns[a + 1] / inner.segments <= outer.columns[b + 1] / outer.segments);
        if (advanceInner) { indices.push(inner.start + inner.columns[a], inner.start + inner.columns[++a], outer.start + outer.columns[b]); }
        else { indices.push(inner.start + inner.columns[a], outer.start + outer.columns[b + 1], outer.start + outer.columns[b]); b++; }
      }
    }
    return { vertexCount: count, indices };
  });
  if (wedges.reduce((total, w) => total + w.indices.length / 3, 0) >= 30_000) throw new Error('Far LOD exceeds 30k triangle budget');
  return { version: 1, slug: asset.meta.slug, sourceSha256, radialRows: selectedRows, wedges };
}

export function runFarLodBake(slug: string, verify = false): void {
  const base = `public/game/terrain/${slug}`, raw = brotliDecompressSync(fs.readFileSync(`${base}.far.bin.br`));
  const asset = decodeFarField(raw), sidecar = JSON.parse(fs.readFileSync(`${base}.far.json`, 'utf8'));
  const lod = bakeFarLod(asset, sidecar.bands, sidecar.innerRadiusM, createHash('sha256').update(raw).digest('hex'));
  const bytes = Buffer.from(JSON.stringify(lod));
  if (verify) { if (!fs.readFileSync(`${base}.far-lod.json`).equals(bytes)) throw new Error('Far LOD is not reproducible'); }
  else fs.writeFileSync(`${base}.far-lod.json`, bytes);
  console.log(`${slug}: ${lod.wedges.reduce((n, w) => n + w.indices.length / 3, 0)} triangles, ${bytes.length} bytes / ${brotliCompressSync(bytes).length} brotli`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const slug of ['breckenridge', 'heavenly', 'ski-portillo']) runFarLodBake(slug, process.argv.includes('--verify'));
}
