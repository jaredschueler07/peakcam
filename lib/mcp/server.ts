// ─────────────────────────────────────────────────────────────
// MCP server `io.peakcam/snow` — identity, instructions, registration.
//
// `registerPeakCam(server, data)` registers the eight tools from tools.ts
// (every one read-only, idempotent, closed-world) and the
// `peakcam://resorts/{slug}` markdown resource on any McpServer. The
// resource is byte-for-byte the Sprint 4 `/resorts/{slug}/index.md`
// document (lib/public-api/markdown-page.ts); the tools' `content` uses the
// compact renderer in lib/public-api/markdown.ts. The route
// (app/api/mcp/route.ts) hands it mcp-handler's per-request server with the
// production data source; the tests hand it an in-memory server with
// fixtures. Nothing in here touches the network.
// ─────────────────────────────────────────────────────────────

import { McpServer, ResourceTemplate, type ServerOptions, type ToolAnnotations } from "@modelcontextprotocol/server";
import pkg from "@/package.json";
import { SITE_URL } from "@/lib/site";
import { resortMarkdown as resortPageMarkdown } from "@/lib/public-api/markdown-page";
import { serializeResort } from "@/lib/public-api/serialize";
import { buildTools, closeMatches, findResort, serializeOptionsFor } from "./tools";
import type { McpDataSource } from "./types";

export const PEAKCAM_MCP_NAME = "io.peakcam/snow";
export const PEAKCAM_MCP_TITLE = "PeakCam Snow";
export const PEAKCAM_MCP_VERSION: string = pkg.version;
export const PEAKCAM_MCP_ENDPOINT = `${SITE_URL}/api/mcp`;
export const PEAKCAM_RESOURCE_TEMPLATE = "peakcam://resorts/{slug}";

export const PEAKCAM_MCP_INSTRUCTIONS = [
  `PeakCam Snow is read-only snow data for about 150 ski resorts in the US, Canada, Chile and Argentina (${SITE_URL}).`,
  "Every snow number carries a `source`: `snotel` means measured at a USDA NRCS SNOTEL station near the resort (quality-controlled, refreshed every 6 hours, valid at the station's elevation rather than the summit); `open_meteo` means a weather-model estimate for resorts with no station; `pipeline`, `manual` and `resort` are blends or hand-entered values.",
  "Webcams are returned as links only: the resort's PeakCam page, the operator's stream URL and, when one exists, a still-image URL with its capture time. Never describe a frame you have not seen.",
  "Workflow: search_resorts turns a name into a slug; get_resort_conditions, get_resort_cams, get_forecast and get_snow_history take that slug; find_powder ranks resorts by new snow (sourceOnly=\"snotel\" for measured-only); compare_resorts sets 2–6 resorts side by side; get_opening_dates lists season dates.",
  "When you answer, label each number with its source and time (for example \"6 in in 24 h, SNOTEL-measured, 2026-12-20 12:00 UTC\"), call model values estimates, and link the resort's canonicalUrl. Each resort is also readable as markdown at peakcam://resorts/{slug}.",
].join("\n\n");

/** Every PeakCam tool reads cached public data and changes nothing. */
export const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const satisfies ToolAnnotations;

/** `Implementation` for the initialize handshake; mcp-handler passes it through untouched. */
export const peakCamServerInfo = {
  name: PEAKCAM_MCP_NAME,
  version: PEAKCAM_MCP_VERSION,
  title: PEAKCAM_MCP_TITLE,
  websiteUrl: SITE_URL,
};

export const peakCamServerOptions: ServerOptions = {
  instructions: PEAKCAM_MCP_INSTRUCTIONS,
  capabilities: { tools: {}, resources: {} },
};

export function resortResourceUri(slug: string): string {
  return `peakcam://resorts/${slug}`;
}

export function registerPeakCam(server: McpServer, data: McpDataSource): void {
  for (const tool of buildTools(data)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
      },
      (args) => tool.handler(args),
    );
  }

  server.registerResource(
    "resort",
    new ResourceTemplate(PEAKCAM_RESOURCE_TEMPLATE, {
      list: async () => {
        const catalog = await data.catalog();
        return {
          resources: catalog.resorts.map((r) => ({
            uri: resortResourceUri(r.slug),
            name: r.slug,
            title: r.name,
            description: `${r.name} snow report, season status and cams (${r.region}, ${r.state}, ${r.country}).`,
            mimeType: "text/markdown",
          })),
        };
      },
      complete: {
        slug: async (value) => {
          const catalog = await data.catalog();
          const prefix = value.toLowerCase();
          return catalog.resorts
            .map((r) => r.slug)
            .filter((s) => s.startsWith(prefix))
            .slice(0, 20);
        },
      },
    }),
    {
      title: "Resort snow report",
      description:
        "Markdown snow report for one resort, the same document as https://www.peakcam.io/resorts/{slug}/index.md: latest measurements with source and station, season status, webcams as links, and the canonical PeakCam URL.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const slug = String(Array.isArray(variables.slug) ? variables.slug[0] : variables.slug).toLowerCase();
      const catalog = await data.catalog();
      const resort = findResort(catalog, slug);
      if (!resort) {
        const close = closeMatches(catalog.resorts, slug, 3).map((r) => resortResourceUri(r.slug));
        throw new Error(`No active resort with slug "${slug}".${close.length ? ` Close matches: ${close.join(", ")}` : ""}`);
      }
      const doc = serializeResort(resort, serializeOptionsFor(catalog, resort));
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: resortPageMarkdown(doc, { now: catalog.now }) }] };
    },
  );
}

/** A standalone server, for tests and any non-HTTP transport. */
export function createPeakCamServer(data: McpDataSource): McpServer {
  const server = new McpServer(peakCamServerInfo, peakCamServerOptions);
  registerPeakCam(server, data);
  return server;
}
