import type { Cam } from "./types";
import roundshot from "../scripts/data/camera-previews/roundshot.json";

// Player URL → `/cams/{id}/thumbnail`, harvested from each public player's twitter:image.
const ROUNDSHOT_THUMBNAILS = roundshot as Record<string, string>;

function webUrl(value: string | null): boolean {
  if (!value) return false;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}

/** Embed URL for a YouTube stream. `playsinline` is the iOS fix: without it
 *  Safari pops the muted autoplay into fullscreen. The rest trims YouTube's
 *  chrome and keeps the end-screen rail to the operator's own channel. */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3`;
}

function roundshotThumbnail(embedUrl: string): string | null {
  try {
    return ROUNDSHOT_THUMBNAILS[new URL(embedUrl).href] ?? null;
  } catch {
    return null;
  }
}

/** Full-size still for a Roundshot player URL, or null when the player is not
 *  a known Roundshot cam. Roundshot serves the still at the thumbnail URL
 *  minus its `/thumbnail` suffix (it 302s to the latest capture). */
export function roundshotStillUrl(embedUrl: string | null): string | null {
  if (!embedUrl) return null;
  const thumbnail = roundshotThumbnail(embedUrl);
  if (!thumbnail) return null;
  const still = thumbnail.replace(/\/thumbnail\/?$/, "");
  return still === thumbnail ? null : still;
}

/** Availability is configuration/health state, never proof of a live broadcast. */
export function availableCameras(cams: readonly Cam[]): Cam[] {
  return cams.filter(cam => cam.is_active && !cam.auto_disabled && (
    cam.embed_type === "youtube" ? /^[\w-]{11}$/.test(cam.youtube_id ?? "") : webUrl(cam.embed_url)
  ));
}

function previewSource(cam: Cam): { cam: Cam; src: string; label: string } | null {
  if (cam.embed_type === "image" && cam.embed_url?.startsWith("https://")) return { cam, src: cam.embed_url, label: "Camera still" };
  if (cam.embed_type === "youtube") return { cam, src: `https://i.ytimg.com/vi/${cam.youtube_id}/hqdefault.jpg`, label: "Stream preview" };
  if (cam.embed_type !== "iframe" || !cam.embed_url) return null;
  const url = new URL(cam.embed_url);
  // Brownrice publishes this exact snapshot URL in its player's og:image.
  const stream = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
  if (url.protocol === "https:" && url.hostname === "player.brownrice.com" && stream) {
    return { cam, src: `https://player.brownrice.com/snapshot/${stream}`, label: "Camera still" };
  }
  const thumbnail = roundshotThumbnail(cam.embed_url);
  return thumbnail ? { cam, src: thumbnail, label: "Camera still" } : null;
}

export function cameraPreviews(cams: readonly Cam[]): { cam: Cam; src: string; label: string }[] {
  return availableCameras(cams).map(previewSource)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => (a.cam.consecutive_failures ?? 0) - (b.cam.consecutive_failures ?? 0) || Number(a.cam.embed_type === "youtube") - Number(b.cam.embed_type === "youtube"));
}
