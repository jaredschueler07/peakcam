import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { bakeFarLod } from './bake-far-lod';
import { buildRingRadii, segmentsForRing } from './bake-far-field';
import { decodeFarField } from '../lib/game/terrain/far-field-format';
import { decodeFarFieldLod } from '../lib/game/terrain/far-field-lod';

for (const slug of ['breckenridge', 'heavenly', 'ski-portillo']) test(`${slug} far LOD reproduces and preserves peaks, winding and sibling edges`, () => {
  const base = `public/game/terrain/${slug}`, raw = brotliDecompressSync(fs.readFileSync(`${base}.far.bin.br`));
  const asset = decodeFarField(raw), sidecar = JSON.parse(fs.readFileSync(`${base}.far.json`, 'utf8'));
  const hash = createHash('sha256').update(raw).digest('hex');
  const lod = bakeFarLod(asset, sidecar.bands, sidecar.innerRadiusM, hash);
  assert.equal(JSON.stringify(lod), fs.readFileSync(`${base}.far-lod.json`, 'utf8'));
  assert.ok(brotliCompressSync(Buffer.from(JSON.stringify(lod))).length < 12_000);
  assert.ok(lod.wedges.reduce((sum, w) => sum + w.indices.length / 3, 0) < 30_000);
  assert.ok(decodeFarFieldLod(lod, asset, hash));
  let start = 0, previous = 0;
  const rings = buildRingRadii(sidecar.innerRadiusM, asset.meta.radiusM, sidecar.bands).map(radius => {
    const segments = segmentsForRing(radius, sidecar.bands, asset.wedges.length, previous);
    previous = segments; const ring = { start, segments }; start += segments + 1; return ring;
  });
  for (let w = 0; w < asset.wedges.length; w++) {
    const p = asset.wedges[w].positions, indices = lod.wedges[w].indices, used = new Set(indices);
    let peak = 0;
    for (let i = 0; i < p.length / 3; i++) if (p[i * 3 + 1] > p[peak * 3 + 1]) peak = i;
    assert.ok(used.has(peak), 'global wedge peak survives');
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const up = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
      assert.ok(up >= -0.05, 'triangle remains upward-facing');
    }
    const next = (w + 1) % asset.wedges.length, q = asset.wedges[next].positions, neighbor = new Set(lod.wedges[next].indices);
    for (const row of lod.radialRows) {
      const ring = rings[row], a = ring.start + ring.segments, b = ring.start;
      assert.ok(used.has(a) && neighbor.has(b), 'same rows anchor both sides of every wedge seam');
      assert.ok(Math.hypot(p[a * 3] - q[b * 3], p[a * 3 + 1] - q[b * 3 + 1], p[a * 3 + 2] - q[b * 3 + 2]) < 0.7, 'existing independent u16 wedge quantisation tolerance');
    }
  }
  const bad = structuredClone(lod); bad.wedges[0].indices[0] = lod.wedges[0].vertexCount;
  assert.equal(decodeFarFieldLod(bad, asset, hash), null);
  assert.equal(decodeFarFieldLod(lod, asset, 'stale'), null);
  bad.wedges[0].indices[0] = 0.5; assert.equal(decodeFarFieldLod(bad, asset, hash), null);
});
