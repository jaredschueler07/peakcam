"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { isOffSeason } from "@/lib/map-utils";
import { parseResortSlugsParam, parseThresholdParam, suggestMoreResorts } from "@/lib/alerts/client";
import { PowderAlertForm, type AlertResort, type PowderAlertSubscription } from "./PowderAlertForm";

/**
 * Headline + lede for /alerts. The server renders it as the Suspense fallback
 * (so the static HTML carries the h1 for crawlers) and the client renders it
 * again once the query string is known — with the same props in the common
 * case, so nothing visibly changes.
 */
export function AlertsIntro({ offSeason }: { offSeason: boolean }) {
  return (
    <>
      <h1 className="font-display text-4xl font-black text-ink">
        {offSeason ? "First snow is coming. Hear about it first." : "Never miss a powder day."}
      </h1>
      <p className="my-5 text-lg text-bark">
        {offSeason
          ? "Pick your mountains and a fresh-snow threshold — we email you the morning it happens."
          : "Choose your mountains and how much fresh snow makes the trip worthwhile. We’ll email you when conditions meet your threshold."}
      </p>
    </>
  );
}

/**
 * The interactive half of /alerts. Reads `?resort=slug,slug` and `?threshold=`
 * on the client only (useSearchParams) so the page itself stays static.
 */
export function AlertsPageContent({ resorts, initialOffSeason }: { resorts: AlertResort[]; initialOffSeason: boolean }) {
  const params = useSearchParams();
  const slugs = useMemo(() => parseResortSlugsParam(params.get("resort")), [params]);
  const threshold = parseThresholdParam(params.get("threshold"));
  // Lazy initializer so the impure new Date() runs once (same pattern as
  // SummitResortCard); this subtree is client-rendered, never hydrated.
  const [now] = useState(() => new Date());
  const first = slugs.length > 0 ? resorts.find((r) => r.slug === slugs[0]) : undefined;
  // A deep link to an Andes resort in July is in season even though the
  // northern default says otherwise.
  const offSeason = first ? isOffSeason(first.lat, now) : initialOffSeason;
  const [subscription, setSubscription] = useState<PowderAlertSubscription | null>(null);
  const suggestions = useMemo(
    () => (subscription ? suggestMoreResorts(resorts, subscription.resortIds) : []),
    [resorts, subscription]
  );

  return (
    <>
      <AlertsIntro offSeason={offSeason} />
      <div className="rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
        <PowderAlertForm
          key={slugs.join(",")}
          resorts={resorts}
          preselectedSlugs={slugs}
          preselectedThreshold={threshold}
          source="alerts_page"
          onDone={setSubscription}
          doneExtra={suggestions.length > 0 ? <MoreMountains resorts={suggestions} /> : null}
        />
      </div>
    </>
  );
}

// The subscribe endpoint never edits an address that is already subscribed
// (lib/alerts/subscribe-core.ts), so re-posting with more resorts would only
// re-send the manage link. Additions go through that link; these chips point
// at the resort pages so the suggestion is still worth a click.
function MoreMountains({ resorts }: { resorts: AlertResort[] }) {
  return (
    <div className="mt-6 border-t border-ink/15 pt-5 text-left">
      <h3 className="font-display text-lg font-bold text-ink">Add more mountains</h3>
      <p className="mt-1 text-sm text-bark">
        The link in your email adds or removes mountains in one click. A few worth watching:
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {resorts.map((r) => (
          <li key={r.id}>
            <Link
              href={`/resorts/${r.slug}`}
              className="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-bark bg-cream-50 px-3 py-1.5 pointer-coarse:min-h-11 text-[13px] font-bold text-ink hover:border-ink"
            >
              {r.name}
              <span className="font-normal text-bark">· {r.state}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
