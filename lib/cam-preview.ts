import type { Cam } from "./types";
import roundshot from "../scripts/data/camera-previews/roundshot.json";

function webUrl(value: string | null): boolean {
  if (!value) return false;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
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
  // Roundshot thumbnail URLs are harvested from each public player's twitter:image.
  const thumbnail = (roundshot as Record<string, string>)[url.href];
  return thumbnail ? { cam, src: thumbnail, label: "Camera still" } : null;
}

export function cameraPreviews(cams: readonly Cam[]): { cam: Cam; src: string; label: string }[] {
  return availableCameras(cams).map(previewSource)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => (a.cam.consecutive_failures ?? 0) - (b.cam.consecutive_failures ?? 0) || Number(a.cam.embed_type === "youtube") - Number(b.cam.embed_type === "youtube"));
}
