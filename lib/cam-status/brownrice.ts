/** Provider metadata is parsed as text, never executed. All upstream hosts and paths are constrained. */
export type FeedState = "available" | "unavailable" | "unknown";
export function brownriceCamera(url: string): string | null {
  try {
    const u = new URL(url);
    return u.origin === "https://player.brownrice.com" && !u.username && !u.password ? /^\/embed\/([a-zA-Z0-9_-]{1,80})\/?$/.exec(u.pathname)?.[1] ?? null : null;
  } catch { return null; }
}
function providerURL(raw: string): URL | null {
  try {
    const u = new URL(raw.replaceAll("&amp;", "&"));
    return u.protocol === "https:" && /^live\d{1,3}\.brownrice\.com$/.test(u.hostname) && (!u.port || u.port === "444") && !u.username && !u.password ? u : null;
  } catch { return null; }
}
export function playerScript(html: string, camera: string): string | null {
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const u = providerURL(match[1]);
    if (u && u.pathname === "/" && u.searchParams.get("sn") === camera && !u.port) return u.href;
  }
  return null;
}
export function streamURL(script: string, camera: string): string | null {
  const field = (name: string) => new RegExp(`camera\\[['"]${name}['"]\\]\\s*=\\s*['"]([^'"]*)['"]`).exec(script)?.[1];
  if (field("name") !== camera) return null;
  const base = providerURL(field("streamurl") ?? "");
  if (!base || base.pathname !== "/" || base.search || base.hash) return null;
  const suffix = field("typeid") === "20" ? ".stream_360p/playlist.m3u8" : field("typeid") === "5" ? ".stream_aac/playlist.m3u8" : ".stream/main_playlist.m3u8";
  return new URL(`/${camera}/${camera}${suffix}`, base).href;
}
async function boundedText(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) throw new Error("empty");
  let size = 0, text = ""; const decoder = new TextDecoder();
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new Error("large"); } text += decoder.decode(value, { stream: true }); }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
/** HLS playlist availability only; it cannot certify that a browser is decoding video. */
export async function checkBrownrice(embed: string, fetcher: typeof fetch = fetch): Promise<FeedState> {
  const camera = brownriceCamera(embed); if (!camera) return "unknown";
  const signal = AbortSignal.timeout(7000);
  const get = (url: string) => fetcher(url, { signal, redirect: "error", headers: { "User-Agent": "PeakCam/1.0 camera availability", "Referer": "https://www.peakcam.io/" } });
  try {
    const page = await get(`https://player.brownrice.com/embed/${camera}`);
    if (!page.ok) { await page.body?.cancel(); return "unknown"; }
    const scriptURL = playerScript(await boundedText(page, 200_000), camera); if (!scriptURL) return "unknown";
    const config = await get(scriptURL); if (!config.ok) { await config.body?.cancel(); return "unknown"; }
    const playlistURL = streamURL(await boundedText(config, 500_000), camera); if (!playlistURL) return "unknown";
    const playlist = await get(playlistURL);
    if (!playlist.ok) { await playlist.body?.cancel(); return playlist.status === 404 || playlist.status === 410 || playlist.status >= 500 ? "unavailable" : "unknown"; }
    const text = await boundedText(playlist, 100_000);
    if (!text.trimStart().startsWith("#EXTM3U")) return "unknown";
    // Resolve one variant within the SAME directory/origin. Never fetch arbitrary playlist URLs.
    const variant = text.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith("#"));
    if (!variant) return "unavailable";
    if (!text.includes("#EXT-X-STREAM-INF")) return "available";
    const next = new URL(variant, playlistURL), root = new URL(playlistURL);
    if (next.origin !== root.origin || !next.pathname.startsWith(root.pathname.slice(0, root.pathname.lastIndexOf("/") + 1)) || !next.pathname.endsWith(".m3u8") || next.username || next.password) return "unknown";
    const media = await get(next.href);
    if (!media.ok) { await media.body?.cancel(); return media.status === 404 || media.status === 410 || media.status >= 500 ? "unavailable" : "unknown"; }
    const contents = await boundedText(media, 100_000);
    return contents.trimStart().startsWith("#EXTM3U") && /#EXTINF:/.test(contents) ? "available" : "unknown";
  } catch { return "unknown"; }
}
