import Link from "next/link";
import type { FeaturedHubCam } from "@/lib/hub-copy";
import { camDisplayName } from "@/lib/cam-name";
import { HubFeaturedCam } from "./HubFeaturedCam";

/**
 * The featured-cam grid: one click-to-play tile per pick from
 * lib/hub-copy.ts featuredHubCams, captioned with a link to the resort's
 * full cam list. Server Component around client tiles — the captions and
 * links are in the HTML, only the players hydrate.
 */
export function HubFeaturedCams({ featured }: { featured: FeaturedHubCam[] }) {
  if (featured.length === 0) return null;
  return (
    <ul className="grid gap-5 md:grid-cols-3">
      {featured.map(({ resort, cam }) => {
        const cams = resort.cams.filter((c) => c.is_active).length;
        return (
          <li key={cam.id}>
            <HubFeaturedCam
              cam={cam}
              resortSlug={resort.slug}
              resortName={resort.name}
              resortUrl={resort.cam_page_url || resort.website_url}
            />
            <p className="mt-2 flex items-baseline justify-between gap-3 text-sm">
              <Link href={`/resorts/${resort.slug}#cameras`} className="min-w-0 truncate font-bold text-ink underline-offset-2 hover:underline">
                {resort.name}
              </Link>
              <span className="shrink-0 text-xs text-bark">
                {camDisplayName(cam)}
                {cams > 1 ? ` · ${cams} cams` : ""}
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
