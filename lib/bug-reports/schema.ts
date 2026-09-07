import { z } from "zod";

export const MAX_REPORT_BYTES = 32_768;
export const MAX_BREADCRUMBS = 60;
export const HISTORY_MS = 10 * 60_000;
export const BUG_ACTIONS = [
  "page-view", "navigate", "button", "search-edited", "search-cleared", "selection-changed",
  "menu-opened", "camera-opened", "camera-reported", "game-started", "game-paused",
  "game-resumed", "game-restarted", "game-finished", "game-closed", "report-opened",
  "javascript-error", "unhandled-rejection", "resource-error", "offline", "online",
] as const;
export type BugAction = typeof BUG_ACTIONS[number];

/** No queries, fragments, account identifiers, arbitrary URLs or unknown paths. */
export function reportPath(raw: string): string {
  const path = raw.split(/[?#]/, 1)[0];
  if (/^\/(?:|map|compare|snow-report|favorites|dashboard|drop-in|about|methodology|account|auth|auth\/callback|alerts|alerts\/manage)$/.test(path)) return path;
  if (/^\/resorts\/[a-z][a-z0-9-]{0,79}(?:\/drop-in)?$/.test(path)) return path;
  return "/other";
}

const pathSchema = z.string().max(300).transform(reportPath);
const boundedNumber = z.number().finite().min(-10_000_000).max(10_000_000);
const releaseSchema = z.string().regex(/^(?:[a-f0-9]{7,40}|local|unknown)$/);
const sourceSchema = z.string().max(200).regex(/^\/_next\/static\/[a-zA-Z0-9_./-]+\.(?:js|mjs)$/);
export const errorNameSchema = z.enum(["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "SecurityError", "NetworkError", "AbortError", "UnknownError"]);
export const breadcrumbSchema = z.object({
  ageMs: z.number().int().min(0).max(HISTORY_MS),
  action: z.enum(BUG_ACTIONS),
  path: pathSchema,
  target: pathSchema.optional(),
  cameraId: z.uuid().optional(),
  errorName: errorNameSchema.optional(),
  source: sourceSchema.optional(),
  line: z.number().int().min(0).max(10_000_000).optional(),
  column: z.number().int().min(0).max(10_000_000).optional(),
});
export type Breadcrumb = z.infer<typeof breadcrumbSchema>;

export const gameReportSchema = z.object({
  resort: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  trailIndex: z.number().int().min(0).max(100_000),
  rider: z.enum(["skier", "snowboarder"]),
  stance: z.enum(["regular", "goofy"]),
  surface: z.enum(["powder", "packed", "firm", "ice", "slush"]),
  backend: z.enum(["webgl", "webgpu"]),
  physicsModel: z.enum(["v1", "v2"]),
  physicsVersion: z.number().int().min(1).max(1000),
  courseVersion: z.number().int().min(1).max(1000),
  ranked: z.boolean(), paused: z.boolean(), onGround: z.boolean(),
  elapsedSeconds: boundedNumber,
  x: boundedNumber, y: boundedNumber, z: boundedNumber, speedMps: boundedNumber,
  p95FrameMs: boundedNumber, quality: z.number().int().min(0).max(4),
});
export type GameReport = z.infer<typeof gameReportSchema>;
export const diagnosticsSchema = z.object({
  version: z.literal(1),
  release: releaseSchema,
  browser: z.enum(["Chrome", "Safari", "Firefox", "Edge", "Other"]),
  browserMajor: z.number().int().min(0).max(1000),
  platform: z.enum(["iOS", "Android", "macOS", "Windows", "Linux", "Other"]),
  viewport: z.object({ width: z.number().int().min(0).max(20_000), height: z.number().int().min(0).max(20_000), dpr: z.number().min(0).max(10) }),
  online: z.boolean(),
  breadcrumbs: z.array(breadcrumbSchema).max(MAX_BREADCRUMBS),
  game: gameReportSchema.optional(),
});
export type ReportDiagnostics = z.infer<typeof diagnosticsSchema>;
export const bugReportSchema = z.object({
  id: z.uuid(), sessionId: z.uuid(),
  description: z.string().trim().min(10).max(4000),
  pagePath: pathSchema,
  diagnostics: diagnosticsSchema.nullable(),
});
export type BugReportSubmission = z.infer<typeof bugReportSchema>;

export function errorLocation(filename: string, baseOrigin: string): string | undefined {
  try {
    const url = new URL(filename, baseOrigin);
    return url.origin === baseOrigin && sourceSchema.safeParse(url.pathname).success ? url.pathname : undefined;
  } catch { return undefined; }
}

/** Parse only browser family/version and OS, never send the raw user-agent string. */
export function browserDetails(ua: string): Pick<ReportDiagnostics, "browser" | "browserMajor" | "platform"> {
  const family = /Edg\/(\d+)/.exec(ua) || /(?:Chrome|CriOS)\/(\d+)/.exec(ua) || /(?:Firefox|FxiOS)\/(\d+)/.exec(ua) || /Version\/(\d+).*Safari/.exec(ua);
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Other";
  const platform = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  return { browser, browserMajor: Math.min(1000, Number(family?.[1] ?? 0)), platform };
}
