// The homepage "More than cams" section (components/home/FeatureShowcase.tsx):
// which resort the two per-resort cards point at, and the cards themselves.
// Pure, so the choice and every href are covered by lib/home-showcase.test.ts.

import { isOffSeason } from "@/lib/map-utils";
import { MAX_COMPARE_RESORTS } from "@/lib/compare-params";
import type { ResortWithData } from "@/lib/types";

/** What the picker reads; the homepage's `getAllResorts()` rows satisfy it. */
export type ShowcaseResort = Pick<ResortWithData, "id" | "slug" | "name" | "lat" | "snotel_station_id">;

/** Today's score per resort id; only the number is read. */
export type ShowcaseScoreIndex = Readonly<Record<string, { score: number } | undefined>>;

/**
 * Used when no in-season station resort has a score today (summer, or the
 * score table not served): a SNOTEL-backed resort whose history page shows the
 * normal band. Tried in order; the first one present in the catalogue wins.
 */
export const SHOWCASE_FALLBACK_SLUGS: readonly string[] = ["alta", "palisades-tahoe", "jackson-hole"];

/**
 * The resort the history and forecast cards name: today's top-scored in-season
 * resort that has a SNOTEL station (the history page's normal band and past
 * seasons are station data). Ties go to the name, so the pick is stable across
 * renders. Falls back to SHOWCASE_FALLBACK_SLUGS, then to null (the cards then
 * link to the leaderboards and the snow report instead).
 */
export function pickShowcaseResort<T extends ShowcaseResort>(
  resorts: readonly T[],
  scores: ShowcaseScoreIndex | null | undefined,
  now: Date,
): T | null {
  const scoreOf = (r: T) => scores?.[r.id]?.score ?? -1;
  const scored = resorts
    .filter((r) => r.snotel_station_id && !isOffSeason(r.lat, now) && scoreOf(r) >= 0)
    .sort((a, b) => scoreOf(b) - scoreOf(a) || a.name.localeCompare(b.name));
  if (scored.length) return scored[0];
  for (const slug of SHOWCASE_FALLBACK_SLUGS) {
    const hit = resorts.find((r) => r.slug === slug);
    if (hit) return hit;
  }
  return null;
}

export interface ShowcaseCard {
  id: string;
  /** Short label above the title. */
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  /** Link text; names the resort when the card points at one. */
  cta: string;
}

/**
 * The cards, in display order. Every href is a route in `app/`; the two
 * per-resort ones render for any catalogue slug (history falls back to model
 * estimates without a station, the forecast page to "no run stored").
 * Powder alerts are left out on purpose: the homepage already carries the
 * signup banner right under this section.
 */
export function buildShowcaseCards(resort: Pick<ShowcaseResort, "slug" | "name"> | null): ShowcaseCard[] {
  return [
    {
      id: "history",
      eyebrow: "Snow history",
      title: "Ten seasons, day by day",
      body: "This season's snowfall against the long-term normal, ten past seasons with their powder days and biggest storms, and the average by month.",
      href: resort ? `/resorts/${resort.slug}/history` : "/snow-report/season-snowfall",
      cta: resort ? `See ${resort.name}'s history` : "See season snowfall",
    },
    {
      id: "forecast",
      eyebrow: "14-day forecast",
      title: "Several models, one blend",
      body: "Daily snow at the summit and the base from a blend of weather models, with the range between them and each model's own run.",
      href: resort ? `/resorts/${resort.slug}/snow-forecast` : "/snow-report",
      cta: resort ? `See ${resort.name}'s forecast` : "See snow reports",
    },
    {
      id: "leaderboards",
      eyebrow: "Leaderboards",
      title: "Who has the most snow",
      body: "Season snowfall, powder days, deepest base and the most snow in the last seven days, each ranking dated to its reading.",
      href: "/snow-report/leaderboards",
      cta: "Open the leaderboards",
    },
    {
      id: "percent-of-normal",
      eyebrow: "Percent of normal",
      title: "Ahead or behind for the date",
      body: "Each station's snowpack against its own 1991 to 2020 median for today's date.",
      href: "/snow-report/percent-of-normal",
      cta: "See percent of normal",
    },
    {
      id: "compare",
      eyebrow: "Compare",
      title: "Resorts side by side",
      body: `Put up to ${MAX_COMPARE_RESORTS} resorts next to each other: base depth, new snow in 24 and 48 hours, trails and lifts open, and webcams.`,
      href: "/compare",
      cta: "Compare resorts",
    },
    {
      id: "opening-dates",
      eyebrow: "Opening dates",
      title: "When each mountain opens",
      body: "Projected and confirmed opening days for the season, with a link to the source where there is one.",
      href: "/opening-dates",
      cta: "See opening dates",
    },
    {
      id: "passes",
      eyebrow: "Season passes",
      title: "Conditions by pass",
      body: "Today's snow at the resorts on Ikon, Epic, Indy, Mountain Collective and Power Pass.",
      href: "/passes",
      cta: "Browse by pass",
    },
    {
      id: "connect",
      eyebrow: "AI assistants",
      title: "Ask in plain language",
      body: "Connect PeakCam to Claude, ChatGPT or another assistant and ask for conditions, history or a forecast by resort name.",
      href: "/connect",
      cta: "Set it up",
    },
  ];
}
