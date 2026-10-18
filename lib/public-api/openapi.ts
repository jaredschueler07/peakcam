// ─────────────────────────────────────────────────────────────
// Public API v1 — OpenAPI 3.1 document, generated from the zod registry.
//
// `components.schemas` is `z.toJSONSchema(publicApiRegistry)`, so the
// document can never drift from what the serializer emits: the tests parse
// serializer output against the same schemas. Pure (no Next.js) so the test
// can write it to disk for `npx @redocly/cli lint`.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";
import { SITE_URL } from "@/lib/site";
import {
  PUBLIC_API_ATTRIBUTION,
  PUBLIC_API_LICENSE_URL,
  PUBLIC_API_REVALIDATE_SECONDS,
} from "./headers";
import { PUBLIC_API_VERSION, publicApiRegistry } from "./schema";

type JsonObject = Record<string, unknown>;

/** Strip the per-schema `$schema`/`$id` zod adds; OpenAPI carries the dialect once at the root. */
function componentSchemas(): Record<string, JsonObject> {
  const { schemas } = z.toJSONSchema(publicApiRegistry, {
    uri: (id) => `#/components/schemas/${id}`,
    target: "draft-2020-12",
  });
  const out: Record<string, JsonObject> = {};
  for (const [id, schema] of Object.entries(schemas as Record<string, JsonObject>)) {
    const rest = { ...schema };
    delete rest.$schema;
    delete rest.$id;
    out[id] = rest;
  }
  return out;
}

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });

const SHARED_HEADERS = {
  "X-Attribution": {
    description: "Attribution line to carry with any reuse of the data.",
    schema: { type: "string", const: PUBLIC_API_ATTRIBUTION },
  },
  Link: {
    description: 'Web links: `rel="author"` (PeakCam) and `rel="license"` (terms of reuse).',
    schema: { type: "string" },
  },
  "Cache-Control": {
    description: `public, s-maxage=${PUBLIC_API_REVALIDATE_SECONDS}, stale-while-revalidate=3600 — data refreshes on a 15-minute ISR window; the sync jobs write new reports every 6 hours.`,
    schema: { type: "string" },
  },
};

function jsonResponse(description: string, schemaId: string) {
  return {
    description,
    headers: SHARED_HEADERS,
    content: { "application/json": { schema: ref(schemaId) } },
  };
}

const ERROR_404 = {
  description: "No active resort with that slug.",
  content: { "application/json": { schema: ref("Error") } },
};

// The limit is a Vercel WAF rule in front of the app (60 requests per 60 s
// per IP on /api/v1/ and /api/mcp, action Deny), so the blocked response is the
// edge's plain-text 403 with `x-vercel-mitigated: deny`, not a JSON 429.
const ERROR_403 = {
  description:
    "Rate limit exceeded: 60 requests per minute per IP across /api/v1 and /api/mcp. The edge answers a plain-text `Forbidden` with `x-vercel-mitigated: deny` and no Retry-After; the window resets within a minute.",
  content: { "text/plain": { schema: { type: "string", example: "Forbidden" } } },
};

const ERROR_400 = {
  description: "A query parameter failed validation.",
  content: { "application/json": { schema: ref("Error") } },
};

const SLUG_PARAM = {
  name: "slug",
  in: "path",
  required: true,
  description: "The resort slug, as in `https://www.peakcam.io/resorts/{slug}`.",
  schema: { type: "string", pattern: "^[a-z0-9-]+$" },
  example: "breckenridge",
};

export function buildOpenApiDocument(baseUrl: string = SITE_URL): JsonObject {
  return {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "PeakCam Public API",
      version: PUBLIC_API_VERSION,
      summary: "Live ski-resort snow conditions and webcams with per-field provenance.",
      description: [
        "Read-only JSON for the resorts PeakCam tracks across North and South America: latest snow report (base depth, 24/48 h new snow, SWE, percent of the 30-year normal, 7-day trend), season status, and webcams with a still image where one exists.",
        "",
        "Every snow number carries its own `source` and `measuredAt`. `snotel` values are NRCS SNOTEL/SCAN station telemetry, quality-controlled by PeakCam and synced every six hours; `open_meteo` values are weather-model estimates for resorts without a station. A station sits at one elevation, so its numbers can differ from a resort's own marketing report.",
        "",
        `No authentication. Rate limit: 60 requests per minute per IP. Responses are cacheable for ${PUBLIC_API_REVALIDATE_SECONDS} s. When you quote a value, cite the resort's \`canonicalUrl\` and keep the attribution line.`,
        "",
        `Methodology: ${baseUrl}/methodology. Machine-readable site map for agents: ${baseUrl}/llms.txt.`,
      ].join("\n"),
      contact: { name: "PeakCam", url: baseUrl },
      license: { name: "PeakCam Terms of Service", url: PUBLIC_API_LICENSE_URL },
      "x-attribution": PUBLIC_API_ATTRIBUTION,
    },
    externalDocs: { description: "How the numbers are measured", url: `${baseUrl}/methodology` },
    servers: [{ url: `${baseUrl}/api/v1`, description: "Production" }],
    // Explicitly unauthenticated: an empty requirement list is the OpenAPI
    // way to say "no security scheme applies" (and what linters look for).
    security: [],
    tags: [
      { name: "resorts", description: "Catalogue and per-resort conditions." },
      { name: "cams", description: "Webcams and stills." },
      { name: "powder", description: "Ranked new-snow queries." },
    ],
    paths: {
      "/resorts": {
        get: {
          operationId: "listResorts",
          tags: ["resorts"],
          summary: "List every active resort with headline snow numbers",
          description: "Alphabetical. One row per resort with base depth and new snow, the report source, rating, season status and cam counts. Fetch `/resorts/{slug}` for provenance per field, the season detail and the cam list.",
          responses: { "200": jsonResponse("The resort list.", "ResortList"), "403": ERROR_403 },
        },
      },
      "/resorts/{slug}": {
        get: {
          operationId: "getResort",
          tags: ["resorts"],
          summary: "One resort: location, latest snow report with provenance, season, cams",
          parameters: [SLUG_PARAM],
          responses: {
            "200": jsonResponse("The resort document.", "Resort"),
            "404": ERROR_404,
            "403": ERROR_403,
          },
        },
      },
      "/resorts/{slug}/cams": {
        get: {
          operationId: "getResortCams",
          tags: ["cams"],
          summary: "The resort's webcams",
          description: "Active cams with health (`live`), a still URL where the operator publishes one or PeakCam captured one, and `capturedAt` only for PeakCam captures. Frames are linked, never proxied; rights stay with the operator.",
          parameters: [SLUG_PARAM],
          responses: {
            "200": jsonResponse("The cam list.", "CamList"),
            "404": ERROR_404,
            "403": ERROR_403,
          },
        },
      },
      "/powder": {
        get: {
          operationId: "findPowder",
          tags: ["powder"],
          summary: "Resorts ranked by new snow",
          description: "Ranked by the chosen window (default 24 h) descending, the other window as tiebreak. Resorts without a value for the window are omitted. `source=snotel` restricts to station-measured reports.",
          parameters: [
            { name: "window", in: "query", schema: { type: "string", enum: ["24h", "48h"], default: "24h" } },
            { name: "state", in: "query", description: "State/province code or country name as stored, case-insensitive (`CO`, `BC`, `Chile`).", schema: { type: "string" } },
            { name: "minInches", in: "query", description: "Minimum new snow in the window, inches.", schema: { type: "number", minimum: 0 } },
            { name: "source", in: "query", description: "Keep only reports from this source.", schema: ref("MeasurementSource") },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 25 } },
          ],
          responses: {
            "200": jsonResponse("The ranking.", "PowderList"),
            "400": ERROR_400,
            "403": ERROR_403,
          },
        },
      },
    },
    components: { schemas: componentSchemas() },
  };
}
