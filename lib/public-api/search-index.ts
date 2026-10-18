// ─────────────────────────────────────────────────────────────
// Public API — /api/v1/resorts/search-index.
//
// The lightest possible catalogue: slug, name, the aliases the ask router
// accepts, state, country, coordinates and the page URL, for an agent that
// wants to resolve names on its own side before calling anything else.
// Pure; cached a day at the edge because it changes only on import.
// ─────────────────────────────────────────────────────────────

import { publishedAliases } from "@/lib/ask/aliases";
import type { PublicApiCatalog } from "./data";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL } from "./headers";
import type { SearchIndexPublic } from "./schema";
import { resortCanonicalUrl } from "./serialize";

export const SEARCH_INDEX_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

export function buildSearchIndex(catalog: PublicApiCatalog, baseUrl?: string): SearchIndexPublic {
  const resorts = [...catalog.resorts]
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((r) => ({
      slug: r.slug,
      name: r.name,
      aliases: publishedAliases(r),
      state: r.state,
      country: r.country,
      lat: r.lat,
      lon: r.lng,
      canonicalUrl: resortCanonicalUrl(r.slug, baseUrl),
    }));
  return {
    count: resorts.length,
    resorts,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: catalog.now.toISOString(),
  };
}
