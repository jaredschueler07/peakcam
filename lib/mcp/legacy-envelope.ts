import { PROTOCOL_VERSION_META_KEY, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";

// Workaround for modelcontextprotocol/typescript-sdk#3159 (open as of
// @modelcontextprotocol/server 2.4.0; fix proposed in #3160).
//
// Some 2025-era clients put the 2026-07-28 per-request envelope key
// `io.modelcontextprotocol/protocolVersion` into `params._meta` while naming
// the 2025 revision they negotiated in `initialize` (e.g. "2025-06-18").
// The SDK routes any message carrying that key to its modern-era path, which
// answers -32022 "Unsupported protocol version" with `supported:
// ["2026-07-28"]` — even though the same endpoint just accepted that
// revision on `initialize` and serves it on the legacy path. The client then
// retries without the key and succeeds, so every session costs two failed
// round trips and two logged errors (`init 200, 400, 202, 400, 200`).
//
// Removing the claim key when it names a supported pre-2026 revision lets the
// SDK classify the message as legacy, where the MCP-Protocol-Version header
// (if any) is still checked against the supported list. Claims naming a
// modern revision, or a revision the SDK does not serve, pass through
// untouched and keep the SDK's own handling. Drop this once the SDK fix ships.

const FIRST_MODERN_REVISION = "2026-07-28";

/** Pre-2026 revisions the SDK serves through its legacy stateless fallback. */
const LEGACY_REVISIONS: ReadonlySet<string> = new Set(
  SUPPORTED_PROTOCOL_VERSIONS.filter((version) => version < FIRST_MODERN_REVISION),
);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The message without a legacy-revision envelope claim, or `undefined` when
 * there is nothing to strip. `initialize` is left alone: the SDK already
 * routes a pre-2026 claim on it to the legacy handshake.
 */
function stripClaim(message: unknown): Record<string, unknown> | undefined {
  if (!isObject(message) || message.method === "initialize") return undefined;
  const params = message.params;
  if (!isObject(params) || !isObject(params._meta)) return undefined;
  const claimed = params._meta[PROTOCOL_VERSION_META_KEY];
  if (typeof claimed !== "string" || !LEGACY_REVISIONS.has(claimed)) return undefined;
  const meta = { ...params._meta };
  delete meta[PROTOCOL_VERSION_META_KEY];
  return { ...message, params: { ...params, _meta: meta } };
}

/**
 * Returns a POST whose JSON-RPC body (single message or batch) no longer
 * carries a supported pre-2026 `io.modelcontextprotocol/protocolVersion`
 * claim, or the original request when nothing needed changing.
 */
export async function withoutLegacyEnvelopeClaim(request: Request): Promise<Request> {
  if (request.method !== "POST" || !(request.headers.get("content-type") ?? "").includes("application/json")) return request;
  let body: unknown;
  try {
    body = JSON.parse(await request.clone().text());
  } catch {
    return request;
  }
  let changed = false;
  const strip = (message: unknown) => {
    const stripped = stripClaim(message);
    if (stripped === undefined) return message;
    changed = true;
    return stripped;
  };
  const next = Array.isArray(body) ? body.map(strip) : strip(body);
  if (!changed) return request;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(next),
    signal: request.signal,
  });
}
