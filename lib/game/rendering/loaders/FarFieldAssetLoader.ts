import { COURSE_VERSION } from "../../config/versions";
import type { DropInResortSlug } from "../../config/schema";
import {
  decodeFarField,
  farFieldAssetUrl,
  validateFarFieldForResort,
  type DecodedFarField,
} from "../../terrain/far-field-format";

/**
 * Fetches and decodes `<slug>.far.bin.br`, the baked far field.
 *
 * Mirrors `TerrainAssetLoader`'s shape (one `AbortController` per load, superseded by the next
 * call) with one deliberate difference: **it never rejects for a bad asset.** The far field is an
 * enhancement over the procedural ridge bands, not a prerequisite for a run, so a missing file, a
 * truncated download, a format-version bump or an asset baked for the wrong resort all resolve to
 * `null` and leave `SceneFactory`'s fallback horizon in place. Only an abort propagates, because a
 * caller that cancelled needs to know it was cancelled.
 *
 * The `.br` bytes are served with `Content-Encoding: br` (see `next.config.ts`) so the browser
 * decompresses transparently — client `DecompressionStream` support for brotli is not portable.
 */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface FarFieldLoadOptions {
  signal?: AbortSignal;
  /** Where the asset claims to belong; a mismatch is rejected rather than rendered. */
  expect: { centre: [number, number]; radiusM: number };
  /** Defaults to `console.warn`; injected in tests. */
  onWarn?: (message: string) => void;
}

export class FarFieldAssetLoader {
  private controller: AbortController | null = null;

/**
   * `fetch` is bound to the global on purpose. Its WebIDL binding rejects any receiver that is not
   * the `Window`/`WorkerGlobalScope`, so calling an unbound `fetch` as a *method* —
   * `this.fetcher(url)` — throws `TypeError: Illegal invocation` in the browser while working
   * perfectly in every test that injects a plain function, because a plain function does not care
   * what `this` is. Binding here makes the loader correct under either call shape.
   */
  constructor(private readonly fetcher: FetchLike = fetch.bind(globalThis)) {}

  abort(): void {
    this.controller?.abort(new DOMException("Far field load aborted", "AbortError"));
  }

  async load(slug: DropInResortSlug, options: FarFieldLoadOptions): Promise<DecodedFarField | null> {
    this.abort();
    const controller = new AbortController();
    this.controller = controller;
    const relayAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) relayAbort();
    else options.signal?.addEventListener("abort", relayAbort, { once: true });
    const warn = options.onWarn ?? ((message: string) => console.warn(message));

    try {
      const url = `${farFieldAssetUrl(slug)}?course=${COURSE_VERSION}`;
      // Read into a local first: `this.fetcher(...)` would call it as a method, and an
      // unbound `fetch` rejects a non-global receiver. See the constructor.
      const fetcher = this.fetcher;
      const response = await fetcher(url, { signal: controller.signal });
      if (!response.ok) {
        warn(`[Drop In] no far field for ${slug} (${response.status}); keeping the ridge bands`);
        return null;
      }
      const asset = decodeFarField(new Uint8Array(await response.arrayBuffer()));
      validateFarFieldForResort(asset.meta, { slug, ...options.expect });
      return asset;
    } catch (error) {
      // An abort is the caller's own doing, not a bad asset — let it through.
      if (controller.signal.aborted) throw error;
      warn(
        `[Drop In] far field for ${slug} is unusable (${error instanceof Error ? error.message : error}); ` +
          "keeping the ridge bands",
      );
      return null;
    } finally {
      options.signal?.removeEventListener("abort", relayAbort);
      if (this.controller === controller) this.controller = null;
    }
  }
}
