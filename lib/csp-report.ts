/**
 * CSP violation report intake — pure helpers for app/api/csp-report/route.ts.
 *
 * Browsers deliver reports in two shapes: the legacy `report-uri` POST
 * (`application/csp-report`, one `{"csp-report": {...}}` object) and the
 * Reporting API (`application/reports+json`, an array of `{type, url, body}`
 * where `body` uses camelCase keys). Both are reduced to the same minimal
 * record and forwarded to PostHog, after sampling, with query strings removed.
 * Nothing here logs; a report body can carry the full URL of whatever page the
 * visitor was on.
 */

export interface CspViolation {
  /** Effective directive, e.g. "script-src-elem" or "form-action". */
  directive: string;
  /** Hostname of the blocked resource, or a CSP keyword such as "inline"/"eval". */
  blockedHost: string;
  /** Pathname of the document that triggered the report; query/hash removed. */
  documentPath: string;
  /** "enforce" when the blocking policy fired, "report" for the report-only one. */
  disposition: "enforce" | "report";
}

/** Accept 1 in this many report requests. */
export const CSP_REPORT_SAMPLE_RATE = 20;
/** Hard cap on violations forwarded from one request. */
export const CSP_REPORT_MAX_VIOLATIONS = 20;
/** Reports larger than this are dropped unread. */
export const CSP_REPORT_MAX_BYTES = 64 * 1024;

export const CSP_VIOLATION_EVENT = "csp_violation";

const ACCEPTED_MEDIA_TYPES = new Set(["application/csp-report", "application/reports+json"]);

/** True for the two media types browsers use for CSP reports (parameters ignored). */
export function isCspReportContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return ACCEPTED_MEDIA_TYPES.has(mediaType);
}

/** Deterministic sampling: `random` in [0, 1) selects 1 request in `rate`. */
export function shouldSampleCspReport(random: number = Math.random(), rate: number = CSP_REPORT_SAMPLE_RATE): boolean {
  if (!(rate > 0)) return false;
  return Math.floor(random * rate) === 0;
}

const MAX_FIELD = 200;

function clip(value: string, max = MAX_FIELD): string {
  return value.length > max ? value.slice(0, max) : value;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** First token of a directive string ("script-src 'self' https://…" → "script-src"). */
function directiveName(effective: unknown, violated: unknown): string {
  const raw = asString(effective) || asString(violated);
  const name = raw.trim().split(/\s+/)[0] ?? "";
  return clip(name.toLowerCase(), 64) || "unknown";
}

/**
 * Reduce a blocked URI to a hostname. Browsers send either a URL (sometimes
 * truncated to its origin) or a keyword — "inline", "eval", "data", "blob",
 * "wasm-eval", "trusted-types-sink", "" — which is kept as-is.
 */
export function blockedHostOf(blockedUri: unknown): string {
  const raw = asString(blockedUri).trim();
  if (!raw) return "none";
  try {
    const url = new URL(raw);
    if (url.hostname) return clip(url.hostname.toLowerCase());
    // data:/blob:/about: URLs have no host; report the scheme only, never the payload.
    return clip(url.protocol.replace(/:$/, "").toLowerCase()) || "unknown";
  } catch {
    // Keyword or relative value. Keep it short and query-free.
    const keyword = raw.split(/[?#]/)[0] ?? "";
    return clip(keyword.toLowerCase(), 64) || "unknown";
  }
}

/** Pathname of the reporting document, with query string and fragment dropped. */
export function documentPathOf(documentUri: unknown): string {
  const raw = asString(documentUri).trim();
  if (!raw) return "unknown";
  try {
    return clip(new URL(raw).pathname || "/");
  } catch {
    return clip(raw.split(/[?#]/)[0] ?? "") || "unknown";
  }
}

function dispositionOf(value: unknown): CspViolation["disposition"] {
  return value === "enforce" ? "enforce" : "report";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fromLegacyReport(report: unknown): CspViolation | null {
  if (!isRecord(report)) return null;
  return {
    directive: directiveName(report["effective-directive"], report["violated-directive"]),
    blockedHost: blockedHostOf(report["blocked-uri"]),
    documentPath: documentPathOf(report["document-uri"]),
    disposition: dispositionOf(report["disposition"]),
  };
}

function fromReportingApiEntry(entry: unknown): CspViolation | null {
  if (!isRecord(entry) || entry.type !== "csp-violation" || !isRecord(entry.body)) return null;
  const body = entry.body;
  return {
    directive: directiveName(body.effectiveDirective, body.violatedDirective),
    blockedHost: blockedHostOf(body.blockedURL),
    documentPath: documentPathOf(body.documentURL ?? entry.url),
    disposition: dispositionOf(body.disposition),
  };
}

/**
 * Parse a decoded JSON report body of either shape. Unknown or malformed input
 * yields an empty list rather than an error, so the route can always answer
 * 204 without inspecting what it was sent.
 */
export function parseCspReports(body: unknown): CspViolation[] {
  const out: CspViolation[] = [];
  if (Array.isArray(body)) {
    for (const entry of body) {
      const violation = fromReportingApiEntry(entry);
      if (violation) out.push(violation);
      if (out.length >= CSP_REPORT_MAX_VIOLATIONS) break;
    }
    return out;
  }
  if (isRecord(body)) {
    if ("csp-report" in body) {
      const violation = fromLegacyReport(body["csp-report"]);
      if (violation) out.push(violation);
    } else if (body.type === "csp-violation") {
      const violation = fromReportingApiEntry(body);
      if (violation) out.push(violation);
    }
  }
  return out;
}

export interface PostHogTarget {
  apiKey: string;
  host: string;
}

/** Read the PostHog project key/host the browser SDK also uses; null when unset. */
export function postHogTargetFromEnv(env: Record<string, string | undefined> = process.env): PostHogTarget | null {
  const apiKey = env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!apiKey) return null;
  const host = (env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(/\/+$/, "");
  return { apiKey, host };
}

/** One PostHog capture payload per violation. No person profile is created. */
export function buildPostHogCapturePayload(apiKey: string, violation: CspViolation, timestamp: Date = new Date()) {
  return {
    api_key: apiKey,
    event: CSP_VIOLATION_EVENT,
    distinct_id: "csp-report",
    timestamp: timestamp.toISOString(),
    properties: {
      directive: violation.directive,
      blockedHost: violation.blockedHost,
      documentPath: violation.documentPath,
      disposition: violation.disposition,
      $process_person_profile: false,
    },
  };
}

/**
 * Forward violations to PostHog's capture endpoint. Never throws and never
 * logs: a failing analytics sink must not surface in the report route.
 */
export async function forwardCspViolations(
  violations: CspViolation[],
  target: PostHogTarget | null,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  if (!target || violations.length === 0) return 0;
  const url = `${target.host}/i/v0/e/`;
  let sent = 0;
  for (const violation of violations.slice(0, CSP_REPORT_MAX_VIOLATIONS)) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildPostHogCapturePayload(target.apiKey, violation)),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) sent += 1;
    } catch {
      // swallow — see above
    }
  }
  return sent;
}
