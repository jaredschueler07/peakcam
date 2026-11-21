import { getAllResorts, getHubLiftsIndex } from "@/lib/supabase";
import { SITE_URL } from "@/lib/site";
import { buildSnowHub } from "@/lib/snow-hubs";
import { markdownPageHeaders } from "@/lib/public-api/markdown-page";
import { snowHubMarkdown } from "@/lib/snow-hubs";

// GET /snow-report/{hub}/index.md — the state snow-report hub as markdown
// (rel="alternate" from the page's metadata). GET only, ISR 15 minutes,
// noindex with a canonical Link like the resort alternates.
export const revalidate = 900;

export async function GET(_request: Request, { params }: { params: Promise<{ hub: string }> }): Promise<Response> {
  const { hub } = await params;
  const page = /^[a-z0-9][a-z0-9-]{0,99}$/.test(hub) ? await (async () => { const resorts = await getAllResorts(); return buildSnowHub(hub, resorts, SITE_URL, await getHubLiftsIndex(new Date(), resorts)); })() : null;
  if (!page) {
    return new Response(`No snow-report hub "${hub}". List them at /ski-cams or /index.md.\n`, {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new Response(snowHubMarkdown(page), { headers: markdownPageHeaders(page.pageUrl) });
}
