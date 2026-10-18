import { after } from "next/server";
import {
  CSP_REPORT_MAX_BYTES,
  forwardCspViolations,
  isCspReportContentType,
  parseCspReports,
  postHogTargetFromEnv,
  shouldSampleCspReport,
} from "@/lib/csp-report";

/**
 * CSP violation sink for both the enforced and the report-only policies in
 * next.config.ts (`report-uri` and `report-to csp-endpoint`).
 *
 * 1 in 20 requests is kept; the rest are answered 204 unread. Kept reports are
 * reduced to {directive, blockedHost, documentPath, disposition} — query
 * strings and fragments are dropped — and forwarded to PostHog as
 * `csp_violation` after the response is sent. The body is never logged.
 */

const NO_CONTENT = () => new Response(null, { status: 204 });

export async function POST(request: Request) {
  if (!isCspReportContentType(request.headers.get("content-type"))) {
    return new Response(null, { status: 415 });
  }
  if (!shouldSampleCspReport()) return NO_CONTENT();

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > CSP_REPORT_MAX_BYTES) return NO_CONTENT();
    body = JSON.parse(text);
  } catch {
    return NO_CONTENT();
  }

  const violations = parseCspReports(body);
  const target = postHogTargetFromEnv();
  if (violations.length > 0 && target) {
    after(() => forwardCspViolations(violations, target));
  }
  return NO_CONTENT();
}
