import Link from "next/link";
import { buildShowcaseCards, type ShowcaseResort } from "@/lib/home-showcase";

// Homepage "More than cams" section: one card per deeper feature (season
// history, the 14-day blend, leaderboards, percent of normal, compare, opening
// dates, passes, the map), each linking to the page that has it.
// No hooks and no fetching: app/page.tsx picks the resort from data it already
// has and passes this in as a slot, so nothing here adds a homepage query.

interface FeatureShowcaseProps {
  /** The resort the history and forecast cards name (lib/home-showcase.ts pickShowcaseResort). */
  resort: Pick<ShowcaseResort, "slug" | "name"> | null;
}

export function FeatureShowcase({ resort }: FeatureShowcaseProps) {
  const cards = buildShowcaseCards(resort);

  return (
    <section aria-label="More PeakCam features" className="mb-10" data-testid="feature-showcase">
      <div className="pc-eyebrow mb-1" style={{ color: "var(--pc-bark)" }}>
        Beyond the cams
      </div>
      {/* No id: BrowsePage renders this slot twice (one copy per breakpoint). */}
      <h2
        className="font-display font-black text-3xl md:text-5xl text-ink mb-1 leading-[0.95] tracking-[-0.02em]"
      >
        Dig <em className="text-alpen italic font-bold">deeper</em>.
      </h2>
      <p className="text-bark text-sm mb-5">
        Every resort page also carries its snow history, a 14-day forecast and the stations behind the numbers.
      </p>
      {/* A swipe row on phones so the resort grid stays close; a grid from md up. */}
      <ul
        className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2 scrollbar-hide snap-x
                   md:grid md:grid-cols-2 md:overflow-visible md:mx-0 md:px-0 md:pb-0 lg:grid-cols-4"
      >
        {cards.map((card) => (
          <li key={card.id} className="flex-shrink-0 w-64 snap-start md:w-auto">
            <Link
              href={card.href}
              prefetch={false}
              className="group flex h-full flex-col bg-cream-50 border-[1.5px] border-ink rounded-[18px] p-5
                         shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]
                         transition-[transform,box-shadow] duration-150"
            >
              <span className="font-mono font-bold text-[10.5px] text-bark uppercase tracking-[0.14em] mb-2">
                {card.eyebrow}
              </span>
              <h3 className="font-display font-black text-[20px] leading-[1.05] tracking-[-0.01em] text-ink mb-2">
                {card.title}
              </h3>
              <p className="text-bark text-sm leading-snug mb-4">{card.body}</p>
              <span className="mt-auto pt-3 border-t-[1.5px] border-dashed border-bark/60 text-sm font-bold text-ink underline decoration-alpen/60 decoration-2 underline-offset-[3px] group-hover:decoration-alpen">
                {card.cta}
                <span aria-hidden="true">{"\u00a0"}→</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
