// ─────────────────────────────────────────────────────────────
// Public API — /.well-known/schemas/*.json, the zod registry as standalone
// JSON Schema (draft 2020-12) documents with absolute `$id`s and `$ref`s,
// so a client can validate one response shape without parsing the whole
// OpenAPI document. Pure; same registry as openapi.ts, so the two cannot
// disagree.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";
import { SITE_URL } from "@/lib/site";
import { PUBLIC_API_VERSION, publicApiRegistry } from "./schema";

export const SCHEMAS_PATH = "/.well-known/schemas";

/** Registry id → file stem. Response shapes get the short names the docs use; parts keep their kebab-cased id. */
const FILE_STEMS: Record<string, string> = {
  Resort: "resort",
  CamList: "cams",
  TimelapseList: "timelapses",
  PowderList: "powder",
  ResortList: "resort-list",
  SearchIndex: "search-index",
  Status: "status",
  Forecast: "forecast",
  ForecastAccuracy: "forecast-accuracy",
  AskAnswer: "ask",
  BatchRequest: "batch-request",
  BatchResponse: "batch",
  Error: "error",
  // P6: the conditions contract carries its major version in the file name.
  ResortConditions: "resort-conditions-v1",
  // P7: the score document is named after its route; the components record keeps a distinct stem.
  ResortScoreHistory: "score-components",
  ScoreComponents: "score-component-set",
  SnowReportList: "snow-report",
};

function kebab(id: string): string {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function schemaFileStem(id: string): string {
  return FILE_STEMS[id] ?? kebab(id);
}

export function schemaUrl(id: string, baseUrl: string = SITE_URL): string {
  return `${baseUrl}${SCHEMAS_PATH}/${schemaFileStem(id)}.json`;
}

type JsonObject = Record<string, unknown>;

/** Every registered schema, keyed by file stem, each a self-standing document. */
export function buildJsonSchemas(baseUrl: string = SITE_URL): Record<string, JsonObject> {
  const { schemas } = z.toJSONSchema(publicApiRegistry, {
    uri: (id) => schemaUrl(id, baseUrl),
    target: "draft-2020-12",
  });
  const out: Record<string, JsonObject> = {};
  for (const [id, schema] of Object.entries(schemas as Record<string, JsonObject>)) {
    out[schemaFileStem(id)] = { ...schema, title: id, "x-peakcam-api-version": PUBLIC_API_VERSION };
  }
  return out;
}

export interface SchemaIndexEntry {
  id: string;
  file: string;
  url: string;
  description: string | null;
}

/** The index document at /.well-known/schemas. */
export function buildSchemaIndex(baseUrl: string = SITE_URL): { apiVersion: string; openapi: string; count: number; schemas: SchemaIndexEntry[] } {
  const { schemas: raw } = z.toJSONSchema(publicApiRegistry, { uri: (id) => schemaUrl(id, baseUrl), target: "draft-2020-12" });
  const schemas: SchemaIndexEntry[] = Object.entries(raw as Record<string, JsonObject>)
    .map(([id, schema]) => ({
      id,
      file: `${schemaFileStem(id)}.json`,
      url: schemaUrl(id, baseUrl),
      description: typeof schema.description === "string" ? schema.description : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
  return { apiVersion: PUBLIC_API_VERSION, openapi: `${baseUrl}/api/v1/openapi.json`, count: schemas.length, schemas };
}

/** The file stems a static build should pre-render. */
export function schemaFileStems(): string[] {
  return buildSchemaIndex().schemas.map((s) => schemaFileStem(s.id));
}
