import { COURSE_VERSION } from "../../config/versions";
import type { DropInResortSlug } from "../../config/schema";
import type { TerrainMeta, TrailsFile } from "../../terrain/formats";
import type { RealTerrainAssets } from "../../terrain/terrain-source";

export interface TerrainLoadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function checked(fetcher: FetchLike, url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`terrain asset request failed (${response.status}) for ${url}`);
  return response;
}

export class TerrainAssetLoader {
  private controller: AbortController | null = null;

/**
   * `fetch` is bound to the global on purpose. Its WebIDL binding rejects any receiver that is not
   * the `Window`/`WorkerGlobalScope`, so calling an unbound `fetch` as a *method* —
   * `this.fetcher(url)` — throws `TypeError: Illegal invocation` in the browser while working
   * perfectly in every test that injects a plain function, because a plain function does not care
   * what `this` is. Binding here makes the loader correct under either call shape.
   */
  constructor(private readonly fetcher: FetchLike = fetch.bind(globalThis)) {}

  abort(): void { this.controller?.abort(new DOMException("Terrain load aborted", "AbortError")); }

  async load(slug: DropInResortSlug, options: TerrainLoadOptions = {}): Promise<RealTerrainAssets> {
    this.abort();
    const controller = new AbortController();
    this.controller = controller;
    const relayAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) relayAbort();
    else options.signal?.addEventListener("abort", relayAbort, { once: true });
    const report = options.onProgress ?? (() => {});
    let lastProgress = 0;
    const emit = (value: number) => {
      lastProgress = Math.max(lastProgress, Math.min(1, value));
      report(lastProgress);
    };
    try {
      const base = `/game/terrain/${slug}`;
      const metaResponse = await checked(this.fetcher, `${base}.meta.json?course=${COURSE_VERSION}`, controller.signal);
      const metaText = await metaResponse.text();
      const meta = JSON.parse(metaText) as TerrainMeta;
      const metaBytes = new TextEncoder().encode(metaText).byteLength;
      const heightBytes = meta.grid * meta.grid * 2;
      const estimatedTrailBytes = 32 * 1024;
      const estimatedTotal = metaBytes + heightBytes + estimatedTrailBytes;
      emit(metaBytes / estimatedTotal);

      const trailsPromise = checked(this.fetcher, `${base}.trails.json?course=${COURSE_VERSION}`, controller.signal)
        .then(async (response) => {
          const text = await response.text();
          emit((metaBytes + new TextEncoder().encode(text).byteLength) / estimatedTotal);
          return JSON.parse(text) as TrailsFile;
        });
      const heightPromise = checked(this.fetcher, `${base}.height.u16.br?course=${COURSE_VERSION}`, controller.signal)
        .then(async (response) => {
          if (!response.body) return response.arrayBuffer();
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = []; let loaded = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); loaded += value.byteLength;
            emit((metaBytes + Math.min(heightBytes, loaded)) / estimatedTotal);
          }
          const output = new Uint8Array(loaded); let offset = 0;
          for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
          return output.buffer;
        });
      const [trails, heightfield] = await Promise.all([trailsPromise, heightPromise]);
      emit(1);
      return { heightfield, meta, trails };
    } finally {
      options.signal?.removeEventListener("abort", relayAbort);
      if (this.controller === controller) this.controller = null;
    }
  }
}
