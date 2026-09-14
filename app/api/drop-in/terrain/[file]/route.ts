/**
 * GET /api/drop-in/terrain/<slug>.<height.u16|far.bin>.br
 *
 * The baked terrain binaries are shipped brotli-compressed and served with
 * `Content-Encoding: br` (next.config.ts). Browsers only accept brotli over
 * HTTPS, so on a plain-HTTP origin (LAN dev, a preview box) the static fetch
 * fails. This route hands back the same bytes already decompressed, and the
 * loaders in `lib/descent/world/loadWorld.ts` fall through to it only when the
 * static fetch fails — production traffic never touches it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { NextResponse } from "next/server";

const ALLOWED = /^(ski-portillo|breckenridge|heavenly)\.(height\.u16|far\.bin)\.br$/;

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  if (!ALLOWED.test(file)) return NextResponse.json({ error: "unknown asset" }, { status: 404 });
  try {
    const compressed = await readFile(path.join(process.cwd(), "public", "game", "terrain", file));
    const raw = brotliDecompressSync(compressed);
    return new NextResponse(new Uint8Array(raw), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "asset unavailable" }, { status: 404 });
  }
}
