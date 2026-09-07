import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { authorizeReviewer, ReviewAccessError } from "./review-access";

export async function reviewerContext() {
  const auth = await createSupabaseServerClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ReviewAccessError(503);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = await authorizeReviewer({
    async verifiedUserId() { const { data, error } = await auth.auth.getUser(); return error ? null : data.user?.id ?? null; },
    async isReviewer(id) { const { data, error } = await db.from("bug_report_reviewers").select("user_id").eq("user_id", id).maybeSingle(); if (error) throw new ReviewAccessError(503); return Boolean(data); },
  });
  return { db, userId };
}
export function privateReply(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } }); }
export function reviewFailure(error: unknown) { return error instanceof ReviewAccessError ? privateReply({ error: error.message }, error.status) : privateReply({ error: "The inbox is temporarily unavailable." }, 503); }
