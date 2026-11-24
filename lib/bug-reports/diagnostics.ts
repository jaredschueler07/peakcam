/**
 * Pure, Zod-free bug-report diagnostics types, allowlists, and sanitizers.
 *
 * Client modules (`BugReportProvider`, `lib/bug-reports/client.ts`,
 * `lib/bug-reports/history.ts`) import from here so Zod stays server-only in
 * `lib/bug-reports/schema.ts` rather than bloating every page's root JS chunk.
 */

export const MAX_REPORT_BYTES = 32_768;
export const MAX_BREADCRUMBS = 60;
export const HISTORY_MS = 10 * 60_000;

export const BUG_ACTIONS = [
  "page-view", "navigate", "button", "search-edited", "search-cleared", "selection-changed",
  "menu-opened", "camera-opened", "camera-reported", "game-started", "game-paused",
  "game-resumed", "game-restarted", "game-finished", "game-closed", "report-opened",
  "javascript-error", "unhandled-rejection", "resource-error", "offline", "online",
] as const;
export type BugAction = (typeof BUG_ACTIONS)[number];

export const ERROR_NAMES = [
  "Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError",
  "SecurityError", "NetworkError", "AbortError", "UnknownError",
] as const;
export type ErrorName = (typeof ERROR_NAMES)[number];

export const BROWSERS = ["Chrome", "Safari", "Firefox", "Edge", "Other"] as const;
export const PLATFORMS = ["iOS", "Android", "macOS", "Windows", "Linux", "Other"] as const;

export interface Breadcrumb {
  ageMs: number;
  action: BugAction;
  path: string;
  target?: string;
  cameraId?: string;
  errorName?: ErrorName;
  source?: string;
  line?: number;
  column?: number;
}

export interface GameReport {
  resort: string;
  trailIndex: number;
  rider: "skier" | "snowboarder";
  stance: "regular" | "goofy";
  surface: "powder" | "packed" | "firm" | "ice" | "slush";
  backend: "webgl" | "webgpu";
  physicsModel: "v1" | "v2";
  physicsVersion: number;
  courseVersion: number;
  ranked: boolean;
  paused: boolean;
  onGround: boolean;
  elapsedSeconds: number;
  x: number;
  y: number;
  z: number;
  speedMps: number;
  p95FrameMs: number;
  quality: number;
}

export interface ReportDiagnostics {
  version: 1;
  release: string;
  browser: (typeof BROWSERS)[number];
  browserMajor: number;
  platform: (typeof PLATFORMS)[number];
  viewport: { width: number; height: number; dpr: number };
  online: boolean;
  breadcrumbs: Breadcrumb[];
  game?: GameReport;
}

export interface BugReportSubmission {
  id: string;
  sessionId: string;
  description: string;
  pagePath: string;
  diagnostics: ReportDiagnostics | null;
}

const SLUG_SEGMENT = "[a-z][a-z0-9-]{0,79}";
const STATIC_REPORT_PATH_RE = /^\/(?:|map|compare|snow-report|favorites|dashboard|drop-in|about|methodology|account|auth|auth\/callback|alerts|alerts\/manage|opening-dates|passes|ski-cams|privacy|terms|admin\/bug-reports)$/;
const HUB_REPORT_PATH_RE = new RegExp(`^\\/(?:ski-cams|snow-report|passes)\\/${SLUG_SEGMENT}$`);
const SNOW_REPORT_SUB_RE = /^\/snow-report\/(?:percent-of-normal|leaderboards|best-powder-this-week|deepest-base|season-powder-days|season-snowfall)$/;
const RESORT_REPORT_PATH_RE = new RegExp(`^\\/resorts\\/${SLUG_SEGMENT}(?:\\/(?:drop-in|snow-report|snow-forecast|webcams|history))?$`);

export const SOURCE_PATH_RE = /^\/_next\/static\/[a-zA-Z0-9_./-]+\.(?:js|mjs)$/;
export const RELEASE_RE = /^(?:[a-f0-9]{7,40}|local|unknown)$/;
export const RESORT_SLUG_RE = /^[a-z][a-z0-9-]{0,79}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** No queries, fragments, account identifiers, arbitrary URLs or unknown paths. */
export function reportPath(raw: string): string {
  const path = String(raw).slice(0, 300).split(/[?#]/, 1)[0];
  if (
    STATIC_REPORT_PATH_RE.test(path) ||
    SNOW_REPORT_SUB_RE.test(path) ||
    HUB_REPORT_PATH_RE.test(path) ||
    RESORT_REPORT_PATH_RE.test(path)
  ) {
    return path;
  }
  return "/other";
}

export function errorLocation(filename: string, baseOrigin: string): string | undefined {
  try {
    const url = new URL(filename, baseOrigin);
    return url.origin === baseOrigin && url.pathname.length <= 200 && SOURCE_PATH_RE.test(url.pathname)
      ? url.pathname
      : undefined;
  } catch {
    return undefined;
  }
}

/** Parse only browser family/version and OS, never send the raw user-agent string. */
export function browserDetails(ua: string): Pick<ReportDiagnostics, "browser" | "browserMajor" | "platform"> {
  const family = /Edg\/(\d+)/.exec(ua) || /(?:Chrome|CriOS)\/(\d+)/.exec(ua) || /(?:Firefox|FxiOS)\/(\d+)/.exec(ua) || /Version\/(\d+).*Safari/.exec(ua);
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Safari/.test(ua) ? "Safari" : "Other";
  const platform = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  return { browser, browserMajor: Math.min(1000, Number(family?.[1] ?? 0)), platform };
}

export function parseErrorName(raw: unknown): ErrorName {
  return typeof raw === "string" && (ERROR_NAMES as readonly string[]).includes(raw)
    ? (raw as ErrorName)
    : "UnknownError";
}

function isBoundedInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function isBoundedNum(v: unknown, min = -10_000_000, max = 10_000_000): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

export function parseBreadcrumb(input: unknown): Breadcrumb | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  if (!isBoundedInt(r.ageMs, 0, HISTORY_MS)) return null;
  if (typeof r.action !== "string" || !(BUG_ACTIONS as readonly string[]).includes(r.action)) return null;
  if (typeof r.path !== "string" || r.path.length > 300) return null;

  const crumb: Breadcrumb = {
    ageMs: r.ageMs,
    action: r.action as BugAction,
    path: reportPath(r.path),
  };
  if (r.target !== undefined) {
    if (typeof r.target !== "string" || r.target.length > 300) return null;
    crumb.target = reportPath(r.target);
  }
  if (r.cameraId !== undefined) {
    if (typeof r.cameraId !== "string" || !UUID_RE.test(r.cameraId)) return null;
    crumb.cameraId = r.cameraId;
  }
  if (r.errorName !== undefined) {
    if (typeof r.errorName !== "string" || !(ERROR_NAMES as readonly string[]).includes(r.errorName)) return null;
    crumb.errorName = r.errorName as ErrorName;
  }
  if (r.source !== undefined) {
    if (typeof r.source !== "string" || r.source.length > 200 || !SOURCE_PATH_RE.test(r.source)) return null;
    crumb.source = r.source;
  }
  if (r.line !== undefined) {
    if (!isBoundedInt(r.line, 0, 10_000_000)) return null;
    crumb.line = r.line;
  }
  if (r.column !== undefined) {
    if (!isBoundedInt(r.column, 0, 10_000_000)) return null;
    crumb.column = r.column;
  }
  return crumb;
}

const RIDERS = ["skier", "snowboarder"] as const;
const STANCES = ["regular", "goofy"] as const;
const SURFACES = ["powder", "packed", "firm", "ice", "slush"] as const;
const BACKENDS = ["webgl", "webgpu"] as const;
const PHYSICS_MODELS = ["v1", "v2"] as const;

export function parseGameReport(input: unknown): GameReport | undefined {
  if (!input || typeof input !== "object") return undefined;
  const g = input as Record<string, unknown>;
  if (typeof g.resort !== "string" || !RESORT_SLUG_RE.test(g.resort)) return undefined;
  if (!isBoundedInt(g.trailIndex, 0, 100_000)) return undefined;
  if (typeof g.rider !== "string" || !(RIDERS as readonly string[]).includes(g.rider)) return undefined;
  if (typeof g.stance !== "string" || !(STANCES as readonly string[]).includes(g.stance)) return undefined;
  if (typeof g.surface !== "string" || !(SURFACES as readonly string[]).includes(g.surface)) return undefined;
  if (typeof g.backend !== "string" || !(BACKENDS as readonly string[]).includes(g.backend)) return undefined;
  if (typeof g.physicsModel !== "string" || !(PHYSICS_MODELS as readonly string[]).includes(g.physicsModel)) return undefined;
  if (!isBoundedInt(g.physicsVersion, 1, 1000) || !isBoundedInt(g.courseVersion, 1, 1000)) return undefined;
  if (typeof g.ranked !== "boolean" || typeof g.paused !== "boolean" || typeof g.onGround !== "boolean") return undefined;
  if (!isBoundedNum(g.elapsedSeconds) || !isBoundedNum(g.x) || !isBoundedNum(g.y) || !isBoundedNum(g.z) || !isBoundedNum(g.speedMps) || !isBoundedNum(g.p95FrameMs)) return undefined;
  if (!isBoundedInt(g.quality, 0, 4)) return undefined;
  return {
    resort: g.resort,
    trailIndex: g.trailIndex,
    rider: g.rider as GameReport["rider"],
    stance: g.stance as GameReport["stance"],
    surface: g.surface as GameReport["surface"],
    backend: g.backend as GameReport["backend"],
    physicsModel: g.physicsModel as GameReport["physicsModel"],
    physicsVersion: g.physicsVersion,
    courseVersion: g.courseVersion,
    ranked: g.ranked,
    paused: g.paused,
    onGround: g.onGround,
    elapsedSeconds: g.elapsedSeconds,
    x: g.x,
    y: g.y,
    z: g.z,
    speedMps: g.speedMps,
    p95FrameMs: g.p95FrameMs,
    quality: g.quality,
  };
}

export function buildClientDiagnostics(params: {
  release: string;
  userAgent: string;
  width: number;
  height: number;
  dpr: number;
  online: boolean;
  breadcrumbs: Breadcrumb[];
  game?: GameReport;
}): ReportDiagnostics {
  const release = RELEASE_RE.test(params.release) ? params.release : "unknown";
  const details = browserDetails(params.userAgent);
  const w = Number.isFinite(params.width) ? Math.max(0, Math.min(20_000, Math.round(params.width))) : 0;
  const h = Number.isFinite(params.height) ? Math.max(0, Math.min(20_000, Math.round(params.height))) : 0;
  const dpr = Number.isFinite(params.dpr) ? Math.max(0, Math.min(10, params.dpr)) : 1;
  return {
    version: 1,
    release,
    ...details,
    viewport: { width: w, height: h, dpr },
    online: Boolean(params.online),
    breadcrumbs: params.breadcrumbs.slice(-MAX_BREADCRUMBS),
    ...(params.game ? { game: params.game } : {}),
  };
}

export function newClientUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
