// GET /api/mcp/server-card — the SEP-2127 reserved location for the
// `io.peakcam/snow` Server Card: `<streamable-http-url>/server-card`, where
// the streamable HTTP URL is /api/mcp. Byte-identical to
// /.well-known/mcp/server-card.json (same builder, same handlers), which stays
// the address the execution plan, llms.txt and server.json advertise.
// proxy.ts already excludes `api/mcp/` from the Supabase session refresh.
export { GET, OPTIONS, dynamic } from "@/app/.well-known/mcp/server-card.json/route";
