// ─────────────────────────────────────────────────────────────
// MCP Server Card for `io.peakcam/snow` (SEP-2127, Extensions Track, Final).
//
// Shape: the v1 Server Card schema, which is the single source of truth the
// SEP delegates to:
//   https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json
//   (source: https://github.com/modelcontextprotocol/experimental-ext-server-card/blob/main/schema.json)
// Required: $schema, name, version, description (1–100 chars). Optional:
// title, websiteUrl, repository, remotes[{type, url, supportedProtocolVersions}],
// icons, _meta. The card deliberately does NOT list tools, prompts or auth at
// the top level (docs/discovery.md: those stay subject to runtime listing), so
// the human-oriented summary the plan asks for sits under a namespaced
// `_meta` key, which the schema allows for vendor data.
//
// Pure: no Next imports, so tests/mcp-listings.test.ts can assert on it.
// ─────────────────────────────────────────────────────────────

import { SITE_URL } from "@/lib/site";
import { PEAKCAM_MCP_VERSION } from "@/lib/mcp/server";
import { PUBLIC_API_LICENSE_URL } from "@/lib/public-api/headers";
import {
  CONNECT_TOOLS,
  CONNECT_URL,
  EXTERNAL_LINKS,
  MCP_ENDPOINT,
  MCP_NAME,
  MCP_PROTOCOL_VERSIONS,
  MCP_RESOURCE_TEMPLATE,
  MCP_TITLE,
} from "./links";

export const SERVER_CARD_SCHEMA = "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
export const SERVER_CARD_MEDIA_TYPE = "application/mcp-server-card+json";

/** Schema caps `description` at 100 characters; the test enforces it. */
export const MCP_DESCRIPTION =
  "Live snow reports, SNOTEL measurements, webcams and powder rankings for 150 ski resorts.";

/** The version `initialize` reports (lib/mcp/server.ts reads it from package.json). */
export const MCP_VERSION: string = PEAKCAM_MCP_VERSION;

export interface ServerCard {
  $schema: typeof SERVER_CARD_SCHEMA;
  name: string;
  version: string;
  description: string;
  title: string;
  websiteUrl: string;
  repository: { url: string; source: "github" };
  remotes: { type: "streamable-http"; url: string; supportedProtocolVersions: string[] }[];
  _meta: Record<string, unknown>;
}

export function buildServerCard(): ServerCard {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: MCP_NAME,
    version: MCP_VERSION,
    description: MCP_DESCRIPTION,
    title: MCP_TITLE,
    websiteUrl: CONNECT_URL,
    repository: { url: EXTERNAL_LINKS.repo, source: "github" },
    remotes: [
      {
        type: "streamable-http",
        url: MCP_ENDPOINT,
        supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS],
      },
    ],
    _meta: {
      // Vendor namespace (schema: optional prefix of dot-labels then "/").
      // Advisory only: clients list tools over the protocol.
      "io.peakcam/connect": {
        documentation: CONNECT_URL,
        authentication: { required: false, schemes: [] },
        access: "read-only",
        capabilities: { tools: {}, resources: {} },
        tools: CONNECT_TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.summary })),
        resourceTemplates: [MCP_RESOURCE_TEMPLATE],
        contact: "mailto:hello@peakcam.io",
        license: PUBLIC_API_LICENSE_URL,
        attribution:
          "Quote with a link to the resort's PeakCam page. SNOTEL numbers are USDA NRCS measurements; model numbers are estimates and must be labelled; cam frames are linked, not redistributed.",
        openapi: `${SITE_URL}/api/v1/openapi.json`,
        apiCatalog: `${SITE_URL}/.well-known/api-catalog`,
      },
    },
  };
}
