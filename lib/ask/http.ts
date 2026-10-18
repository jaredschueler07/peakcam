// ─────────────────────────────────────────────────────────────
// Ask over HTTP — shared by /api/v1/ask and the NLWeb-shaped /ask.
//
// Reads the question from `q`, `query` or `question` (GET) or a JSON body
// with any of those keys (POST), hashes the caller's IP the way
// /api/cam-reports/submit does (salted, day-scoped, no salt → no hash), and
// runs the router against the production data source with the same tool
// handlers the MCP server registers. Importing this module imports the anon
// Supabase client, so only routes import it.
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { productionDataSource } from "@/lib/mcp/data";
import { buildTools } from "@/lib/mcp/tools";
import type { AskAnswerPublic } from "@/lib/public-api/schema";
import { answerQuestion, type AskTool } from "./answer";
import { MAX_QUESTION_LENGTH } from "./router";

const QUESTION_KEYS = ["q", "query", "question"] as const;

/** The non-recursive tool set the HTTP answer endpoints route into. */
const TOOLS: readonly AskTool[] = buildTools(productionDataSource).filter((t) => t.name !== "ask") as unknown as AskTool[];

export type QuestionRead = { ok: true; question: string } | { ok: false; status: number; error: string; detail: string };

/** Pull the question out of a GET query string or a POST body (JSON or form). */
export async function readQuestion(request: Request): Promise<QuestionRead> {
  const url = new URL(request.url);
  let question: string | null = null;
  for (const key of QUESTION_KEYS) {
    const v = url.searchParams.get(key);
    if (v && v.trim()) {
      question = v;
      break;
    }
  }
  if (request.method === "POST" && question === null) {
    const type = request.headers.get("content-type") ?? "";
    try {
      if (type.includes("application/json")) {
        const body = (await request.json()) as Record<string, unknown>;
        for (const key of QUESTION_KEYS) {
          const v = body?.[key];
          if (typeof v === "string" && v.trim()) {
            question = v;
            break;
          }
        }
      } else if (type.includes("application/x-www-form-urlencoded")) {
        const form = new URLSearchParams(await request.text());
        for (const key of QUESTION_KEYS) {
          const v = form.get(key);
          if (v && v.trim()) {
            question = v;
            break;
          }
        }
      } else if (type.startsWith("text/plain")) {
        const text = await request.text();
        if (text.trim()) question = text;
      }
    } catch {
      return { ok: false, status: 400, error: "invalid_body", detail: "The body could not be parsed. Send JSON like {\"query\":\"is alta open\"}." };
    }
  }
  if (question === null) {
    return { ok: false, status: 400, error: "missing_query", detail: "Pass the question as ?q= (or ?query=) on GET, or as {\"query\": ...} in a JSON POST body." };
  }
  const trimmed = question.trim();
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    return { ok: false, status: 400, error: "query_too_long", detail: `Questions are limited to ${MAX_QUESTION_LENGTH} characters.` };
  }
  return { ok: true, question: trimmed };
}

/** Salted, day-scoped hash of the first `x-forwarded-for` hop; null when there is no salt or no IP. */
export function hashClientIp(request: Request): string | null {
  const salt = process.env.CAM_REPORT_SALT;
  if (!salt) return null;
  const xff = request.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || null;
  if (!ip) return null;
  const today = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}${salt}${today}`).digest("hex").slice(0, 32);
}

export async function answerHttp(request: Request, question: string): Promise<AskAnswerPublic> {
  return answerQuestion({ tools: TOOLS, data: productionDataSource }, question, { via: "api", ipHash: hashClientIp(request) });
}
