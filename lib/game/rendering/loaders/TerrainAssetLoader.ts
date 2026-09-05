import { terrainAssetUrls } from "../../config/terrain-assets";
import type { DropInResortSlug } from "../../config/schema";
import type { TerrainMeta, TrailsFile } from "../../terrain/formats";
import type { RealTerrainAssets } from "../../terrain/terrain-source";

export interface TerrainLoadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function checked(fetcher: FetchLike, url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetcher(url, { signal, mode: "cors", credentials: "same-origin" });
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
      if (controller.signal.aborted) return;
      lastProgress = Math.max(lastProgress, Math.min(1, value));
      report(lastProgress);
    };
    try {
      controller.signal.throwIfAborted();
      const urls = terrainAssetUrls(slug);
      // All three URLs are versioned and known before metadata arrives. Start them
      // together; metadata only refines the progress denominator, never gates I/O.
      let metaBytes = 0, trailBytes = 0, loadedHeight = 0, heightBytes = 2049 * 2049 * 2;
      const progress = () => emit(Math.min(0.99, (metaBytes + trailBytes + loadedHeight) / (metaBytes + Math.max(trailBytes, 32 * 1024) + heightBytes)));
      const metaPromise = checked(this.fetcher, urls.meta, controller.signal).then(async response => {
        const text = await response.text(), meta = JSON.parse(text) as TerrainMeta;
        metaBytes = new TextEncoder().encode(text).byteLength;
        heightBytes = meta.grid * meta.grid * 2;
        progress(); return meta;
      });
      const trailsPromise = checked(this.fetcher, urls.trails, controller.signal).then(async response => {
        const text = await response.text(); trailBytes = new TextEncoder().encode(text).byteLength;
        progress(); return JSON.parse(text) as TrailsFile;
      });
      const heightPromise = checked(this.fetcher, urls.height, controller.signal).then(async response => {
        if (!response.body) { const result = await response.arrayBuffer(); loadedHeight = result.byteLength; progress(); return result; }
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); loadedHeight += value.byteLength; progress();
          }
        } finally { reader.releaseLock(); }
        const output = new Uint8Array(loadedHeight); let offset = 0;
        for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
        return output.buffer;
      });
      const [meta, trails, heightfield] = await Promise.all([metaPromise, trailsPromise, heightPromise]);
      controller.signal.throwIfAborted();
      emit(1);
      return { heightfield, meta, trails };
    } catch (reason) {
      controller.abort(reason);
      throw reason;
    } finally {
      options.signal?.removeEventListener("abort", relayAbort);
      if (this.controller === controller) this.controller = null;
    }
  }
}
