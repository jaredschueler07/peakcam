import type { DecodedFarField } from './far-field-format';
export interface FarFieldLodFile {
  version: 1; slug: string; sourceSha256: string; radialRows: number[];
  wedges: Array<{ vertexCount: number; indices: number[] }>;
}
/** Optional enhancement: return no LOD for corrupt, stale or mismatched topology. */
export function decodeFarFieldLod(value: unknown, asset: DecodedFarField, sourceSha256: string): Uint32Array[] | null {
  const file = value as FarFieldLodFile | null;
  if (!file || file.version !== 1 || file.slug !== asset.meta.slug || file.sourceSha256 !== sourceSha256 || !Array.isArray(file.wedges) || file.wedges.length !== asset.wedges.length) return null;
  let total = 0;
  for (let i = 0; i < file.wedges.length; i++) {
    const wedge = file.wedges[i], count = asset.wedges[i].positions.length / 3;
    if (!wedge || wedge.vertexCount !== count || !Array.isArray(wedge.indices) || wedge.indices.length < 3 || wedge.indices.length % 3 !== 0 || wedge.indices.length > asset.wedges[i].indices.length) return null;
    total += wedge.indices.length / 3;
    if (total >= 30_000) return null;
    for (const index of wedge.indices) if (!Number.isInteger(index) || index < 0 || index >= count) return null;
    for (let j = 0; j < wedge.indices.length; j += 3) if (wedge.indices[j] === wedge.indices[j + 1] || wedge.indices[j] === wedge.indices[j + 2] || wedge.indices[j + 1] === wedge.indices[j + 2]) return null;
  }
  return file.wedges.map(wedge => new Uint32Array(wedge.indices));
}
