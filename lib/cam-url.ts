import type { Cam } from "./types";

const YOUTUBE_ID_RE = /^[\w-]{11}$/;

/** Return normalized href if URL parses under an allowed scheme, else null. */
export function safeCamUrl(
  raw: string | null | undefined,
  protocols: readonly string[] = ["https:", "http:"],
): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return protocols.includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Resolve safe embed/feed URL for a camera, enforcing HTTPS for iframes and valid IDs for YouTube. */
export function camEmbedSrc(
  cam: Pick<Cam, "embed_type" | "embed_url" | "youtube_id">,
): string | null {
  if (cam.embed_type === "youtube") {
    return cam.youtube_id && YOUTUBE_ID_RE.test(cam.youtube_id)
      ? `https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1`
      : null;
  }
  if (cam.embed_type === "iframe") {
    return safeCamUrl(cam.embed_url, ["https:"]);
  }
  return safeCamUrl(cam.embed_url, ["https:", "http:"]);
}
