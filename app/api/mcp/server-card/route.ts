// GET /api/mcp/server-card — the SEP-2127 reserved location for the
// `io.peakcam/snow` Server Card: `<streamable-http-url>/server-card`, where
// the streamable HTTP URL is /api/mcp. Byte-identical to
// /.well-known/mcp/server-card.json (same builder, same handlers), which stays
// the address the execution plan, llms.txt and server.json advertise.
// proxy.ts already excludes `api/mcp/` from the Supabase session refresh.
//
// Segment config must be a literal in this file (Next cannot parse a
// re-exported `dynamic`), so it is restated here; keep it equal to the
// .well-known route's.
export const dynamic = "force-static";

export { GET, OPTIONS } from "@/app/.well-known/mcp/server-card.json/route";
