import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL, publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import { parseBatchBody, type BatchPath } from "@/lib/public-api/batch";
import type { BatchResponsePublic } from "@/lib/public-api/schema";
import { SITE_URL } from "@/lib/site";
import { GET as getResorts } from "@/app/api/v1/resorts/route";
import { GET as getSearchIndex } from "@/app/api/v1/resorts/search-index/route";
import { GET as getResort } from "@/app/api/v1/resorts/[slug]/route";
import { GET as getCams } from "@/app/api/v1/resorts/[slug]/cams/route";
import { GET as getPowder } from "@/app/api/v1/powder/route";
import { GET as getStatus } from "@/app/api/v1/status/route";
import { GET as getAsk } from "@/app/api/v1/ask/route";
import { GET as getHistory } from "@/app/api/v1/resorts/[slug]/history/route";
import { GET as getSeasonStats } from "@/app/api/v1/resorts/[slug]/season-stats/route";
import { GET as getMonthly } from "@/app/api/v1/resorts/[slug]/monthly/route";
import { GET as getLeaderboard } from "@/app/api/v1/leaderboards/[kind]/route";

// POST /api/v1/batch — up to 10 GET /api/v1/* paths in one request, answered
// in order with each route's own status and JSON body. The paths are run
// in-process against the route handlers themselves (same code, same cached
// catalogue), so a batch costs one function invocation and one request
// against the edge rate limit (60/min per IP across /api/v1 and /api/mcp)
// instead of ten. Read-only by construction: only the allow-listed GET
// routes dispatch. A bad path fails the whole batch with a 400 naming it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ALLOW = "POST, OPTIONS";

type SlugContext = { params: Promise<{ slug: string }> };

async function dispatch(item: BatchPath): Promise<Response> {
  const request = new Request(`${SITE_URL}${item.path}`, { method: "GET", headers: { accept: "application/json" } });
  const ctx: SlugContext = { params: Promise.resolve({ slug: item.slug ?? "" }) };
  switch (item.route) {
    case "resorts":
      return getResorts();
    case "searchIndex":
      return getSearchIndex();
    case "resort":
      return getResort(request, ctx);
    case "cams":
      return getCams(request, ctx);
    case "powder":
      return getPowder(request);
    case "status":
      return getStatus();
    case "ask":
      return getAsk(request);
    case "history":
      return getHistory(request, ctx);
    case "seasonStats":
      return getSeasonStats(request, ctx);
    case "monthly":
      return getMonthly(request, ctx);
    case "leaderboard":
      return getLeaderboard(request, { params: Promise.resolve({ kind: item.slug ?? "" }) });
  }
}

async function run(item: BatchPath): Promise<BatchResponsePublic["results"][number]> {
  try {
    const response = await dispatch(item);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = { error: "non_json_response", status: response.status };
    }
    return { path: item.path, status: response.status, body };
  } catch (error) {
    return { path: item.path, status: 500, body: { error: "handler_failed", detail: error instanceof Error ? error.message : String(error), status: 500 } };
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return publicError(400, "invalid_body", 'Send JSON: {"requests":[{"path":"/api/v1/resorts/alta"},{"path":"/api/v1/powder?state=CO"}]}.');
  }
  const parsed = parseBatchBody(body);
  if (!parsed.ok) return publicError(400, parsed.error, parsed.detail);
  const results = await Promise.all(parsed.paths.map(run));
  const out: BatchResponsePublic = {
    count: results.length,
    results,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: new Date().toISOString(),
  };
  // A POST is never edge-cached; the per-path routes keep their own windows.
  return publicJson(out, { cacheControl: "no-store", allowMethods: ALLOW });
}

export function OPTIONS(): Response {
  return publicOptions({ allowMethods: ALLOW });
}
