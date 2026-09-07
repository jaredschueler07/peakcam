import { z } from "zod";
import { triageSchema } from "@/lib/bug-reports/review-schema";
import { privateReply, reviewerContext, reviewFailure } from "@/lib/bug-reports/review-server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { db } = await reviewerContext(); const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return privateReply({ error: "Invalid report." }, 400);
    const { data, error } = await db.from("bug_reports").select("id,created_at,description,page_path,status,duplicate_of,revision,diagnostics,admin_note,server_release,updated_at").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? privateReply({ report: data }) : privateReply({ error: "Report not found." }, 404);
  } catch (error) { return reviewFailure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { db, userId } = await reviewerContext();
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return privateReply({ error: "Send changes from PeakCam." }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return privateReply({ error: "Expected JSON." }, 415);
    const { id } = await context.params; if (!z.uuid().safeParse(id).success) return privateReply({ error: "Invalid report." }, 400);
    // Bound the stream, including requests without a truthful Content-Length.
    const reader = request.body?.getReader(); if (!reader) return privateReply({ error: "Missing changes." }, 400);
    let size = 0, text = ""; const decoder = new TextDecoder();
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 20_000) { await reader.cancel(); return privateReply({ error: "Changes too large." }, 413); } text += decoder.decode(value, { stream: true }); } text += decoder.decode(); } finally { reader.releaseLock(); }
    let raw: unknown; try { raw = JSON.parse(text); } catch { return privateReply({ error: "Invalid changes." }, 400); }
    const parsed = triageSchema.safeParse(raw); if (!parsed.success) return privateReply({ error: "Check the status, note and duplicate ID." }, 400);
    const change = parsed.data;
    const { data, error } = await db.rpc("triage_bug_report", { p_id: id, p_actor: userId, p_revision: change.revision, p_status: change.status, p_note: change.note, p_duplicate_of: change.duplicateOf });
    if (error) {
      const failures: Record<string, [number, string]> = { report_conflict: [409, "Another reviewer changed this report. Reload it before saving."], report_not_found: [404, "Report not found."], invalid_duplicate: [400, "Choose an existing original report. Groups cannot be nested or linked to themselves."], invalid_triage: [400, "Invalid changes."], reviewer_required: [403, "Reviewer access required."] };
      const known = error.code === "P0001" && failures[error.message]; if (known) return privateReply({ error: known[1] }, known[0]); throw error;
    }
    return privateReply({ revision: data });
  } catch (error) { return reviewFailure(error); }
}
