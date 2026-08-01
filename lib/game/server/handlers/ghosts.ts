/**
 * lib/game/server/handlers/ghosts.ts
 * ──────────────────────────────────
 * `GET /api/drop-in/ghosts/[runId]` — the PCGH blob of one accepted run.
 *
 * Serves raw bytes, not JSON: the client feeds them straight to `decodeGhost`
 * and base64 would cost a third more transfer for nothing.
 *
 * Rejected runs are invisible here. They exist for anti-cheat telemetry, and
 * `LeaderboardReader.acceptedGhost` filters on `accepted` in the query rather
 * than trusting RLS to do it — a signed-in caller's own rejected rows are
 * readable under the second policy in migration 015.
 *
 * A run's ghost never changes once written, so responses are immutable and
 * cached for a year. The `ETag` is the stored `ghost_sha256`, which makes a
 * conditional re-request free.
 */

import { z } from "zod";

import type { LeaderboardReader } from "../run-repository";
import { jsonError } from "./http";

/** One year, immutable: a run's ghost bytes are write-once. */
export const GHOST_CACHE_CONTROL = "public, max-age=31536000, immutable";

const runIdSchema = z.uuid();

export interface GhostHandlerDeps {
  reader: () => LeaderboardReader;
}

export async function handleGetGhost(
  request: Request,
  runId: string,
  deps: GhostHandlerDeps,
): Promise<Response> {
  const parsed = runIdSchema.safeParse(runId);
  if (!parsed.success) {
    // Not a uuid means not a run — same answer as a run that does not exist,
    // so probing tells an attacker nothing.
    return jsonError(404, "Ghost not found");
  }

  const ghost = await deps.reader().acceptedGhost(parsed.data);
  if (!ghost) {
    return jsonError(404, "Ghost not found");
  }

  const etag = ghost.sha256Hex ? `"${ghost.sha256Hex}"` : undefined;
  if (etag && request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { "Cache-Control": GHOST_CACHE_CONTROL, ETag: etag },
    });
  }

  return new Response(bodyOf(ghost.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(ghost.bytes.byteLength),
      "Cache-Control": GHOST_CACHE_CONTROL,
      ...(etag ? { ETag: etag } : {}),
    },
  });
}

/**
 * `Uint8Array` views can share a larger buffer; copy to a standalone
 * `ArrayBuffer` so the response never carries neighbouring bytes.
 */
function bodyOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
