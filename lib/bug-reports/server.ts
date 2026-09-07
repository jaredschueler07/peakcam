import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { bugReportSchema, MAX_REPORT_BYTES, type BugReportSubmission } from "./schema";

export interface ReportStoreInput { report: BugReportSubmission; sessionHash: string; ipHash: string; serverRelease: string }
export type ReportStoreResult = { id: string } | { error: "rate_limited" | "unavailable" };
export interface ReportDependencies {
  secret: string;
  release: string;
  now?: () => Date;
  store(input: ReportStoreInput): Promise<ReportStoreResult>;
}

function reply(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "3600" } : {}) } });
}

/** Bound actual streamed bytes too; Content-Length is optional and untrusted. */
async function readBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_REPORT_BYTES) throw new RangeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError();
  const decoder = new TextDecoder(); let total = 0, body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REPORT_BYTES) { await reader.cancel(); throw new RangeError(); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode(); return JSON.parse(body);
  } finally { reader.releaseLock(); }
}

export async function handleBugReport(request: Request, deps: ReportDependencies): Promise<Response> {
  // The site is the only browser caller; this endpoint has no cross-origin API.
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return reply(403, { error: "Please send reports from PeakCam." });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply(415, { error: "Expected JSON." });
  let raw: unknown;
  try { raw = await readBody(request); }
  catch (error) { return reply(error instanceof RangeError ? 413 : 400, { error: "The report is invalid or too large." }); }
  const parsed = bugReportSchema.safeParse(raw);
  if (!parsed.success) return reply(400, { error: "Add a description of 10–4,000 characters and try again." });
  if (!deps.secret) return reply(503, { error: "Reporting is temporarily unavailable." });
  // Vercel overwrites X-Forwarded-For. Other hosts must provide an equivalent trusted proxy.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  const ip = isIP(forwarded) ? forwarded : "unknown";
  const date = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const hash = (kind: string, value: string) => createHmac("sha256", deps.secret).update(`bug-report:${kind}:${kind === "ip" ? date : "session"}:${value}`).digest("hex");
  try {
    const result = await deps.store({ report: parsed.data, sessionHash: hash("session", parsed.data.sessionId), ipHash: hash("ip", ip), serverRelease: deps.release });
    if ("error" in result) return result.error === "rate_limited" ? reply(429, { error: "Please try again in an hour." }) : reply(503, { error: "Reporting is temporarily unavailable." });
    return reply(201, { id: result.id });
  } catch { return reply(503, { error: "Reporting is temporarily unavailable." }); }
}
