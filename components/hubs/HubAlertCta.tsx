import type { ResortWithData } from "@/lib/types";
import type { Hub } from "@/lib/hubs";
import { DEFAULT_THRESHOLD } from "@/lib/alerts/client";
import { PowderAlertSignup } from "@/components/alerts/PowderAlertSignup";
import type { AlertResort } from "@/components/alerts/PowderAlertForm";

interface Props {
  hub: Hub;
  resorts: ResortWithData[];
  offSeason: boolean;
}

/**
 * The hub page's conversion: "Get {Label} powder alerts" opens the shared
 * PowderAlertSignup modal with every resort in the hub pre-selected (shown as
 * removable chips on the email step) at the default 6″ threshold, stamped
 * `source: hub:<slug>` so the funnel can be read per hub. Server Component
 * around the client trigger; only the slim AlertResort rows cross to the
 * browser, not the cams and snow reports.
 */
export function HubAlertCta({ hub, resorts, offSeason }: Props) {
  const alertResorts: AlertResort[] = resorts.map(({ id, name, slug, state, lat }) => ({ id, name, slug, state, lat }));
  const count = resorts.length;
  const headline = offSeason
    ? `Be first to know when ${hub.label} starts snowing.`
    : `Get an email when a ${hub.label} resort gets ${DEFAULT_THRESHOLD}″+.`;

  return (
    <section
      aria-labelledby="hub-alerts-heading"
      className="pc-on-ink rounded-[18px] border-[1.5px] border-ink bg-forest px-5 py-5 text-cream-50 shadow-stamp md:flex md:items-center md:justify-between md:gap-8"
    >
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-cream-50/80">Powder alerts</p>
        <h2 id="hub-alerts-heading" className="mt-1 font-display text-2xl font-black leading-tight">
          {headline}
        </h2>
        <p className="mt-1.5 text-sm text-cream-50/85">
          {count === 1 ? "The resort is" : `All ${count} resorts are`} pre-selected — drop any you don&apos;t want. Free, no account,
          one email per storm day, unsubscribe in one click.
        </p>
      </div>
      <div className="mt-4 shrink-0 md:mt-0">
        <PowderAlertSignup
          resorts={alertResorts}
          source={`hub:${hub.slug}`}
          preselectedSlugs={resorts.map((resort) => resort.slug)}
          preselectedThreshold={DEFAULT_THRESHOLD}
          label={`Get ${hub.label} powder alerts`}
        />
      </div>
    </section>
  );
}
