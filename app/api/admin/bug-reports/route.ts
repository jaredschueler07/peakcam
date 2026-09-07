import { inboxQuery } from "@/lib/bug-reports/review-schema";
import { privateReply, reviewerContext, reviewFailure } from "@/lib/bug-reports/review-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { db } = await reviewerContext();
    const parsed = inboxQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return privateReply({ error: "Invalid filters." }, 400);
    const { page, status, group } = parsed.data;
    let query = db.from("bug_reports_inbox").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("id", { ascending: false });
    if (group) query = query.or(`id.eq.${group},duplicate_of.eq.${group}`);
    else if (status !== "all") query = query.eq("status", status);
    const { data, count, error } = await query.range((page - 1) * 25, page * 25 - 1);
    if (error) throw error;
    return privateReply({ reports: data, total: count, page });
  } catch (error) { return reviewFailure(error); }
}
