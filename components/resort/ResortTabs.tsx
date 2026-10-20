import Link from "next/link";
import { RESORT_TABS, resortTabPath, type ResortTabKey } from "@/lib/resort-pages";

/**
 * Overview | Snow report | Webcams — the resort page family's tab row
 * (parity plan P2). Plain markup with real links (no client state), so every
 * tab is in the server HTML for crawlers and the active one is marked with
 * aria-current. Renders inside the hero's width on every page of the family.
 */
export function ResortTabs({ slug, active }: { slug: string; active: ResortTabKey }) {
  return (
    <nav aria-label="Resort pages" className="border-b-[1.5px] border-ink bg-cream-50">
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 md:px-8" role="list">
        {RESORT_TABS.map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                href={resortTabPath(slug, tab.key)}
                prefetch={false}
                aria-current={current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border-b-[3px] px-3 py-2 text-sm font-bold uppercase tracking-[0.12em] transition-colors ${
                  current ? "border-alpen text-ink" : "border-transparent text-bark hover:border-bark/60 hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
