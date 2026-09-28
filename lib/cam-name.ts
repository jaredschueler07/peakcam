import type { Cam } from "./types";

/**
 * Cam naming (and elevation formatting), in one place.
 *
 * `cams.name` is typed non-null but plenty of imported rows carry a blank
 * string, which used to render as empty captions, empty `alt` text, and
 * `"Vail — Live Webcam"` with a hole in the middle in the JSON-LD. This lived
 * inside `components/cam/CamEmbed.tsx`, a `"use client"` module, so Server
 * Components couldn't reach it and open-coded `cam.name` instead. It's plain
 * data logic — it belongs in lib.
 */

/** Last path segment of a cam URL, humanized — "…/CP/AGS.png" → "AGS". */
function nameFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const { pathname, hostname } = new URL(url, "https://cam.invalid");
    const file = pathname.split("/").filter(Boolean).pop() ?? "";
    const stem = file.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_+]+/g, " ").trim();
    if (stem) return stem;
    return hostname === "cam.invalid" ? "" : hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type NameableCam = Pick<Cam, "name" | "embed_url" | "youtube_id">;

/**
 * Display name for a cam: the stored name, then the feed URL's filename, then
 * the YouTube id, then `fallback`. Pass `fallback: ""` at call sites that would
 * rather omit the element than print a generic label.
 *
 * Cheap on anything that came out of `lib/supabase.ts`: the query layer has
 * already resolved the derivable part into `name`, so this short-circuits on
 * the first branch and only the literal fallback is decided here.
 */
export function camDisplayName(cam: NameableCam, fallback = "Live cam"): string {
  return (
    cam.name?.trim() ||
    nameFromUrl(cam.embed_url) ||
    cam.youtube_id?.trim() ||
    fallback
  );
}

/**
 * Resolve `name` on freshly-fetched cam rows, once, at the data edge.
 *
 * Deliberately falls back to `""` rather than "Live cam": what to print when a
 * cam is genuinely unnameable is a presentation call (some surfaces drop the
 * element entirely), and that stays with `camDisplayName`.
 */
export function withResolvedCamNames<T extends NameableCam>(cams: T[]): T[] {
  return cams.map((cam) => {
    const name = camDisplayName(cam, "");
    return name === cam.name ? cam : { ...cam, name };
  });
}

// ── Elevation ────────────────────────────────────────────────

/**
 * `cams.elevation` is a free-text column: most rows hold a number as a string,
 * but blanks, whitespace, and non-numeric junk all occur. `Number("")` is 0,
 * so a naive `Number.isFinite` check printed "0′" for a blank cell, a plain
 * truthiness check printed "NaN′ elevation" for junk, and a surface that read
 * the column raw printed a unit-less "9000". One parser for every surface —
 * the resort page's captions and players and the hubs' featured-cam posters.
 * The locale is pinned because these render inside `"use client"` components:
 * the server HTML and the browser's hydration pass must agree on the separator.
 */
export function camElevationFt(elevation: Cam["elevation"]): string | null {
  const raw = elevation?.trim();
  if (!raw) return null;
  const feet = Number(raw);
  if (!Number.isFinite(feet) || feet <= 0) return null;
  return `${feet.toLocaleString("en-US")}′`;
}
