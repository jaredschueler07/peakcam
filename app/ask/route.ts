import { randomUUID } from "node:crypto";
import { answerHttp, readQuestion } from "@/lib/ask/http";
import { PUBLIC_API_POST_METHODS, publicError, publicJson, publicOptions } from "@/lib/public-api/headers";
import type { AskAnswerPublic } from "@/lib/public-api/schema";
import { SITE_URL } from "@/lib/site";

// GET /ask?query=...  ·  POST /ask {"query": "..."}
//
// NLWeb-compatible adapter over the same router as /api/v1/ask: the
// response is the NLWeb list shape (`query_id`, `results[]` with `url`,
// `name`, `site`, `score`, `description`, `schema_object`) so an NLWeb
// client can consume it unchanged, with the full PeakCam answer under
// `peakcam`. `mode`, `prev`, `site` and `streaming` are accepted and ignored
// (no streaming: every answer is one deterministic tool call). proxy.ts
// excludes /ask from the Supabase session refresh.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE = new URL(SITE_URL).host;

interface NlwebResult {
  url: string;
  name: string;
  site: string;
  score: number;
  description: string;
  schema_object: Record<string, unknown>;
}

function toNlweb(answer: AskAnswerPublic, queryId: string) {
  const results: NlwebResult[] = [];
  if (answer.answerable) {
    const primary = answer.resort;
    results.push({
      url: answer.citations[0] ?? `${SITE_URL}/connect`,
      name: primary ? `${primary.name} — PeakCam` : `PeakCam ${answer.intent.replace(/_/g, " ")}`,
      site: SITE,
      score: 100,
      description: answer.sentence,
      schema_object: {
        "@context": "https://schema.org",
        "@type": primary ? "SkiResort" : "Dataset",
        name: primary?.name ?? "PeakCam snow data",
        url: answer.citations[0] ?? SITE_URL,
        description: answer.sentence,
        dateModified: answer.asOf ?? answer.generatedAt,
        ...(primary ? {} : { creator: { "@type": "Organization", name: "PeakCam", url: SITE_URL } }),
      },
    });
    for (const r of answer.resorts.slice(1)) {
      results.push({
        url: r.canonicalUrl,
        name: `${r.name} — PeakCam`,
        site: SITE,
        score: 90,
        description: `${r.name} on PeakCam: latest measured snow, season status and webcams.`,
        schema_object: { "@context": "https://schema.org", "@type": "SkiResort", name: r.name, url: r.canonicalUrl },
      });
    }
  }
  return {
    query_id: queryId,
    results,
    ...(answer.answerable ? {} : { message: answer.sentence, suggestions: answer.suggestions }),
    peakcam: answer,
  };
}

async function handle(request: Request): Promise<Response> {
  const read = await readQuestion(request);
  if (!read.ok) return publicError(read.status, read.error, read.detail);
  const url = new URL(request.url);
  const queryId = url.searchParams.get("query_id") ?? randomUUID();
  const answer = await answerHttp(request, read.question);
  return publicJson(toNlweb(answer, queryId), {
    allowMethods: PUBLIC_API_POST_METHODS,
    cacheControl: answer.answerable ? undefined : "no-store",
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export function OPTIONS(): Response {
  return publicOptions({ allowMethods: PUBLIC_API_POST_METHODS });
}
