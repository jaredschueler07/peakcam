import { SITE_URL } from "@/lib/site";
import { loadPublicApiCatalog } from "@/lib/public-api/data";
import { indexMarkdown, markdownPageHeaders } from "@/lib/public-api/markdown-page";
import { serializeResortList } from "@/lib/public-api/serialize";

// GET /index.md — the site as one markdown document: a dated summary, the
// measured 24 h leaders, state hubs, and every machine-readable entry point.
// Same caching posture as the per-resort alternate (GET only, ISR 900 s).
export const revalidate = 900;

export async function GET(): Promise<Response> {
  const catalog = await loadPublicApiCatalog();
  const list = serializeResortList(catalog.resorts, { now: catalog.now, openings: catalog.openings });
  return new Response(indexMarkdown(list), { headers: markdownPageHeaders(`${SITE_URL}/`) });
}
