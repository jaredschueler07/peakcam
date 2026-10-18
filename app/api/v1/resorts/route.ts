import { loadPublicApiCatalog } from "@/lib/public-api/data";
import { publicJson, publicOptions } from "@/lib/public-api/headers";
import { serializeResortList } from "@/lib/public-api/serialize";

// GET /api/v1/resorts — every active resort as a light row. ISR'd for 15
// minutes on top of the hourly catalogue cache; a failed read throws so the
// last good document keeps serving (same policy as the pages).
// Caching: exporting OPTIONS (CORS preflight) makes Next treat the handler as
// non-static (`hasNonStaticMethods` in next/dist/server/route-modules/app-route),
// so a `revalidate` segment export would be inert here. The 15-minute policy is
// carried by `Cache-Control: s-maxage=900, stale-while-revalidate=3600` (the
// Vercel edge caches function responses on s-maxage) and by the Data Cache
// behind loadPublicApiCatalog(); a MISS costs one in-memory serialisation.

export async function GET(): Promise<Response> {
  const catalog = await loadPublicApiCatalog();
  const body = serializeResortList(catalog.resorts, { now: catalog.now, openings: catalog.openings });
  return publicJson(body);
}

export function OPTIONS(): Response {
  return publicOptions();
}
