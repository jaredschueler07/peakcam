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

export interface CameraPreview {
  cam: Cam;
  src: string;
  label: string;
  /** ISO time the frame was captured, when the still came from our capture job; null for provider stills (no capture time is inferred). */
  capturedAt: string | null;
}

/**
 * The still a cam can show before anything plays: the image feed itself, the
 * YouTube poster, or a provider-published snapshot for the players we know.
 * Null when the provider exposes no still (generic iframes, link-outs). Safe
 * on any row — a malformed URL is "no preview", never a throw — so resort
 * pages can server-render an <img> per cam tile and crawlers see a picture
 * of the mountain instead of an empty "Tap to load" box.
 */
export function cameraPreview(cam: Cam): CameraPreview | null {
  try {
    return previewSource(cam);
  } catch {
    return null;
  }
}

function previewSource(cam: Cam): CameraPreview | null {
  return providerStill(cam) ?? capturedStill(cam);
}

/**
 * The frame our own capture job stored for a click-to-play cam (migration 022).
 * Used only when the provider publishes no still of its own, so the card never
 * shows an older captured frame in place of a live provider snapshot.
 */
function capturedStill(cam: Cam): CameraPreview | null {
  if (!cam.still_url?.startsWith("https://")) return null;
  return { cam, src: cam.still_url, label: "Captured still", capturedAt: cam.still_captured_at ?? null };
}

/** A still the provider itself publishes for this cam, or null. Exported for the capture job, which targets exactly the cams this returns null for. */
export function providerStill(cam: Cam): CameraPreview | null {
  try {
    return providerStillSource(cam);
  } catch {
    return null;
  }
}

function providerStillSource(cam: Cam): CameraPreview | null {
  const p = (src: string, label: string): CameraPreview => ({ cam, src, label, capturedAt: null });
  if (cam.embed_type === "image" && cam.embed_url?.startsWith("https://")) return p(cam.embed_url, "Camera still");
  if (cam.embed_type === "youtube") return p(`https://i.ytimg.com/vi/${cam.youtube_id}/hqdefault.jpg`, "Stream preview");
  if (cam.embed_type !== "iframe" || !cam.embed_url) return null;
  const url = new URL(cam.embed_url);
  if (url.protocol !== "https:") return null;
  // Brownrice publishes player.brownrice.com/snapshot/<stream> in its player's
  // og:image, and the same stream id is served from the regional liveN hosts,
  // from /snapshot/ URLs stored as iframes, and from longer player paths such
  // as /embed/<stream>/timelapse/24hr or /embed/<stream>&em=1.
  const stream = url.pathname.match(/^\/(?:embed|snapshot)\/([A-Za-z0-9_-]{1,80})(?:[/&]|$)/)?.[1];
  if (stream && (url.hostname === "player.brownrice.com" || /^live\d{1,3}\.brownrice\.com$/.test(url.hostname))) {
    return p(`https://player.brownrice.com/snapshot/${stream}`, "Camera still");
  }
  // ipcamlive serves a per-alias snapshot next to each player (302 to the latest JPEG).
  const alias = url.searchParams.get("alias");
  if (/^(?:www|g\d{1,2})\.ipcamlive\.com$/.test(url.hostname) && url.pathname === "/player/player.php" && alias && /^[\w-]{1,64}$/.test(alias)) {
    return p(`https://${url.hostname}/player/snapshot.php?alias=${encodeURIComponent(alias)}`, "Camera still");
  }
  // Ozolio's player fetches its own poster frame from pub.api?cmd=poster (refreshed every 15 min).
  const oid = url.searchParams.get("oid");
  if (url.hostname === "relay.ozolio.com" && url.pathname === "/pub.api" && url.searchParams.get("cmd") === "embed" && oid && /^[\w-]{1,64}$/.test(oid)) {
    return p(`https://relay.ozolio.com/pub.api?cmd=poster&oid=${encodeURIComponent(oid)}`, "Camera still");
  }
  // Taos Ski Valley's weather page is a plain <img> refreshed in place.
  if (url.hostname === "tsvweather.brownrice.com" && url.pathname === "/poco-webcam.php") {
    return p("https://tsvweather.brownrice.com/img/poco.jpg", "Camera still");
  }
  // Roundshot thumbnail URLs are harvested from each public player's twitter:image.
  const thumbnail = (roundshot as Record<string, string>)[url.href];
  return thumbnail ? p(thumbnail, "Camera still") : null;
}

/** Card order: editorial rank first (null after every ranked cam), then health, then non-YouTube stills before YouTube posters. */
const rankOf = (cam: Cam) => (typeof cam.preview_rank === "number" ? cam.preview_rank : Number.MAX_SAFE_INTEGER);

export function cameraPreviews(cams: readonly Cam[]): CameraPreview[] {
  return availableCameras(cams).filter(cam => cam.card_preview !== false).map(previewSource)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => rankOf(a.cam) - rankOf(b.cam)
      || (a.cam.consecutive_failures ?? 0) - (b.cam.consecutive_failures ?? 0)
      || Number(a.cam.embed_type === "youtube") - Number(b.cam.embed_type === "youtube"));
}
