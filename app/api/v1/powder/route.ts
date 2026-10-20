import { z } from "zod";
import { loadPublicApiCatalog } from "@/lib/public-api/data";
import { publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { MeasurementSourceSchema, PowderWindowSchema } from "@/lib/public-api/schema";
import { rankPowder } from "@/lib/public-api/serialize";

// GET /api/v1/powder?window=24h&state=CO&minInches=6&source=snotel&limit=25
//
// Query-string variants share one ISR entry per distinct URL; the filters run
// over the cached catalogue in memory, so a new combination costs nothing
// beyond the serialisation.
// Caching: exporting OPTIONS (CORS preflight) makes Next treat the handler as
// non-static (`hasNonStaticMethods` in next/dist/server/route-modules/app-route),
// so a `revalidate` segment export would be inert here. The 15-minute policy is
// carried by `Cache-Control: s-maxage=900, stale-while-revalidate=3600` (the
// Vercel edge caches function responses on s-maxage) and by the Data Cache
// behind loadPublicApiCatalog(); a MISS costs one in-memory serialisation.

const QuerySchema = z.object({
  window: PowderWindowSchema.default("24h"),
  state: z.string().trim().min(1).max(40).optional(),
  minInches: z.coerce.number().min(0).max(500).optional(),
  source: MeasurementSourceSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const raw = Object.fromEntries(
    ["window", "state", "minInches", "source", "limit"].flatMap((k) => {
      const v = url.searchParams.get(k);
      return v === null || v === "" ? [] : [[k, v]];
    }),
  );
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return publicError(400, "invalid_query", `${issue.path.join(".") || "query"}: ${issue.message}`);
  }
  const q = parsed.data;
  const catalog = await loadPublicApiCatalog();
  const body = rankPowder(
    catalog.resorts,
    { window: q.window, state: q.state ?? null, minInches: q.minInches ?? null, source: q.source ?? null, limit: q.limit },
    // P7: each entry carries today's Snow Score when the index is served.
    { now: catalog.now, ...(catalog.scores !== undefined ? { scores: catalog.scores } : {}) },
  );
  return publicJson(body);
}

export function OPTIONS(): Response {
  return publicOptions();
}
