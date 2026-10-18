import { answerHttp, readQuestion } from "@/lib/ask/http";
import { PUBLIC_API_POST_METHODS, publicError, publicJson, publicOptions } from "@/lib/public-api/headers";

// GET /api/v1/ask?q=is+alta+open  ·  POST /api/v1/ask {"query": "..."}
//
// The deterministic answer endpoint: lib/ask/router.ts picks a resort and an
// intent from the wording and lib/ask/answer.ts runs the one MCP tool that
// serves it, returning the tool's structured result plus a dated sentence.
// No language model. Unanswerable questions come back 200 with
// `answerable: false` and suggestions; only a missing or oversized question
// is a 400. Answers are cacheable for the public API window because the
// router is a pure function of the question and the cached catalogue.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const read = await readQuestion(request);
  if (!read.ok) return publicError(read.status, read.error, read.detail);
  const answer = await answerHttp(request, read.question);
  return publicJson(answer, {
    allowMethods: PUBLIC_API_POST_METHODS,
    // Unanswerable questions are not pinned at the edge; a typo should not be cached for 15 minutes.
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
