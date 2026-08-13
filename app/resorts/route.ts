import { NextResponse, type NextRequest } from "next/server";

/**
 * `/resorts` is the URL people guess — and the one the nav's "Resorts" item
 * implies — but the browse directory genuinely lives at `/`. It used to 404,
 * dead-ending bookmarks, shared links, and crawlers.
 *
 * A 308 to `/` rather than a second copy of the directory: two crawlable URLs
 * serving the same 150-resort listing would split the ranking signal for the
 * one page that matters. Any query string rides along, so `/resorts?q=vail`
 * still lands on the browse page with its search prefilled.
 *
 * Why a route handler and not a page calling `permanentRedirect()`: a page's
 * redirect is delivered as an RSC payload the client router follows, which
 * measured as `200 OK` with an empty document for a plain HTTP client. This
 * emits a real `308` + `Location`, which is what a bookmark or a crawler needs.
 * `/resorts/[slug]` is unaffected — a segment's own handler and its dynamic
 * children don't collide.
 */
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  return NextResponse.redirect(url, 308);
}
