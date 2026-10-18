import { loadPublicApiCatalog } from "@/lib/public-api/data";
import { publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildSearchIndex, SEARCH_INDEX_CACHE_CONTROL } from "@/lib/public-api/search-index";

// GET /api/v1/resorts/search-index — slug, name, aliases, state, country,
// coordinates and page URL for every active resort, for client-side name
// matching. Static segment, so it wins over /api/v1/resorts/[slug]. The
// list changes only when resorts are imported, hence the 24 h edge window.

export async function GET(): Promise<Response> {
  const catalog = await loadPublicApiCatalog();
  return publicJson(buildSearchIndex(catalog), { cacheControl: SEARCH_INDEX_CACHE_CONTROL });
}

export function OPTIONS(): Response {
  return publicOptions();
}
