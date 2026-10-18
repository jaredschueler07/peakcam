import { loadPublicApiCatalog } from "@/lib/public-api/data";
import { publicJson, publicOptions } from "@/lib/public-api/headers";
import { buildStatus, STATUS_CACHE_CONTROL } from "@/lib/public-api/status";

// GET /api/v1/status — service status derived from the data: snow-report
// freshness against the 6-hourly sync cadence and cam health from the last
// probe. 200 with `status: "degraded"` when a check fails (read the body);
// 503 only when the catalogue read itself throws. Five-minute CDN window.
// Caching: see app/api/v1/resorts/route.ts (OPTIONS makes the route dynamic,
// so Cache-Control carries the policy).

export async function GET(): Promise<Response> {
  try {
    const catalog = await loadPublicApiCatalog();
    return publicJson(buildStatus(catalog), { cacheControl: STATUS_CACHE_CONTROL });
  } catch (error) {
    return publicJson(
      { status: "degraded", generatedAt: new Date().toISOString(), issues: [`The catalogue read failed: ${error instanceof Error ? error.message : String(error)}`] },
      { status: 503, cacheControl: "no-store" },
    );
  }
}

export function OPTIONS(): Response {
  return publicOptions();
}
