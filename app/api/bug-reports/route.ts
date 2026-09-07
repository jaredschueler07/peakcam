import { createClient } from "@supabase/supabase-js";
import { handleBugReport } from "@/lib/bug-reports/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return handleBugReport(request, {
    secret,
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 40) ?? "local",
    async store({ report, sessionHash, ipHash, serverRelease }) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!url || !secret) return { error: "unavailable" };
      const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.rpc("submit_bug_report", {
        p_id: report.id, p_description: report.description, p_page_path: report.pagePath,
        p_diagnostics: report.diagnostics, p_session_hash: sessionHash, p_ip_hash: ipHash,
        p_server_release: serverRelease,
      });
      if (error) {
        if (error.code === "P0001" && error.message === "bug_report_rate_limited") return { error: "rate_limited" };
        // Do not send report descriptions, headers or SQL error details to shared logs.
        console.error("[bug-reports] storage unavailable", error.code);
        return { error: "unavailable" };
      }
      return typeof data === "string" ? { id: data } : { error: "unavailable" };
    },
  });
}
