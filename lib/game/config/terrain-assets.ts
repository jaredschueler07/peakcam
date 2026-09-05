import { COURSE_VERSION } from "./versions";
import type { DropInResortSlug } from "./schema";
/** Shared by server preload hints and runtime fetches so the browser can reuse each response. */
export function terrainAssetUrls(slug: DropInResortSlug) {
  const base = `/game/terrain/${slug}`;
  return {
    meta: `${base}.meta.json?course=${COURSE_VERSION}`,
    trails: `${base}.trails.json?course=${COURSE_VERSION}`,
    height: `${base}.height.u16.br?course=${COURSE_VERSION}`,
  };
}
