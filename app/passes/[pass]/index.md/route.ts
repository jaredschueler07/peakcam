import { getAllResorts } from "@/lib/supabase";
import { buildPassPage, isSeasonPassSlug, passMarkdown } from "@/lib/passes";
import { markdownPageHeaders } from "@/lib/public-api/markdown-page";

// GET /passes/{pass}/index.md — the pass page as markdown (rel="alternate"
// from the page's metadata). GET only, ISR 15 minutes, noindex with a
// canonical Link like the resort alternates.
export const revalidate = 900;

export async function GET(_request: Request, { params }: { params: Promise<{ pass: string }> }): Promise<Response> {
  const { pass } = await params;
  if (!isSeasonPassSlug(pass)) {
    return new Response(`No season pass "${pass}". The passes are at /passes.\n`, {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const page = buildPassPage(pass, await getAllResorts());
  return new Response(passMarkdown(page), { headers: markdownPageHeaders(page.pageUrl) });
}
