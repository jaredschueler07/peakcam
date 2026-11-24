import { z } from "zod";
import {
  BROWSERS,
  BUG_ACTIONS,
  ERROR_NAMES,
  HISTORY_MS,
  MAX_BREADCRUMBS,
  MAX_REPORT_BYTES,
  PLATFORMS,
  RELEASE_RE,
  RESORT_SLUG_RE,
  SOURCE_PATH_RE,
  browserDetails,
  errorLocation,
  reportPath,
  type Breadcrumb,
  type BugAction,
  type BugReportSubmission,
  type GameReport,
  type ReportDiagnostics,
} from "./diagnostics";

export {
  BUG_ACTIONS,
  HISTORY_MS,
  MAX_BREADCRUMBS,
  MAX_REPORT_BYTES,
  browserDetails,
  errorLocation,
  reportPath,
};
export type { Breadcrumb, BugAction, BugReportSubmission, GameReport, ReportDiagnostics };

const pathSchema = z.string().max(300).transform(reportPath);
const boundedNumber = z.number().finite().min(-10_000_000).max(10_000_000);
const releaseSchema = z.string().regex(RELEASE_RE);
const sourceSchema = z.string().max(200).regex(SOURCE_PATH_RE);
export const errorNameSchema = z.enum(ERROR_NAMES);
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

export const gameReportSchema = z.object({
  resort: z.string().regex(RESORT_SLUG_RE),
  trailIndex: z.number().int().min(0).max(100_000),
  rider: z.enum(["skier", "snowboarder"]),
  stance: z.enum(["regular", "goofy"]),
  surface: z.enum(["powder", "packed", "firm", "ice", "slush"]),
  backend: z.enum(["webgl", "webgpu"]),
  physicsModel: z.enum(["v1", "v2"]),
  physicsVersion: z.number().int().min(1).max(1000),
  courseVersion: z.number().int().min(1).max(1000),
  ranked: z.boolean(),
  paused: z.boolean(),
  onGround: z.boolean(),
  elapsedSeconds: boundedNumber,
  x: boundedNumber,
  y: boundedNumber,
  z: boundedNumber,
  speedMps: boundedNumber,
  p95FrameMs: boundedNumber,
  quality: z.number().int().min(0).max(4),
});

export const diagnosticsSchema = z.object({
  version: z.literal(1),
  release: releaseSchema,
  browser: z.enum(BROWSERS),
  browserMajor: z.number().int().min(0).max(1000),
  platform: z.enum(PLATFORMS),
  viewport: z.object({
    width: z.number().int().min(0).max(20_000),
    height: z.number().int().min(0).max(20_000),
    dpr: z.number().min(0).max(10),
  }),
  online: z.boolean(),
  breadcrumbs: z.array(breadcrumbSchema).max(MAX_BREADCRUMBS),
  game: gameReportSchema.optional(),
});

export const bugReportSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  description: z.string().trim().min(10).max(4000),
  pagePath: pathSchema,
  diagnostics: diagnosticsSchema.nullable(),
});
