// ─────────────────────────────────────────────────────────────
// The resort page family (parity plan P2): the overview at /resorts/{slug}
// and its question-shaped subpages. One registry feeds the tab row, the
// sitemap, the breadcrumbs, the markdown alternates' link lists and the
// route tests, so a subpage cannot exist in one place and not another.
// Pure: no Next.js, no database.
// ─────────────────────────────────────────────────────────────

import { SITE_URL } from "./site";

export type ResortTabKey = "overview" | "snow-report" | "snow-forecast" | "webcams" | "history";

export interface ResortTab {
  key: ResortTabKey;
  /** Tab label and breadcrumb leaf. */
  label: string;
  /** Path segment under /resorts/{slug}; "" for the overview. */
  segment: string;
}

/**
 * Overview first, then the question order a skier asks in: what is on the
 * ground (snow report), what is coming (forecast, P4), what does it look like
 * (webcams), how does this season compare (history, P5).
 */
export const RESORT_TABS: readonly ResortTab[] = [
  { key: "overview", label: "Overview", segment: "" },
  { key: "snow-report", label: "Snow report", segment: "snow-report" },
  { key: "snow-forecast", label: "Forecast", segment: "snow-forecast" },
  { key: "webcams", label: "Webcams", segment: "webcams" },
  { key: "history", label: "History", segment: "history" },
];

/** The subpages (everything but the overview), for the sitemap and markdown link lists. */
export const RESORT_SUBPAGES: readonly ResortTab[] = RESORT_TABS.filter((t) => t.segment !== "");

export function resortTab(key: ResortTabKey): ResortTab {
  const tab = RESORT_TABS.find((t) => t.key === key);
  if (!tab) throw new Error(`resortTab: unknown tab "${key}"`);
  return tab;
}

/** Site-relative path: "/resorts/alta", "/resorts/alta/snow-report". */
export function resortTabPath(slug: string, key: ResortTabKey): string {
  const { segment } = resortTab(key);
  return segment ? `/resorts/${slug}/${segment}` : `/resorts/${slug}`;
}

/** Absolute canonical URL for a tab. */
export function resortTabUrl(slug: string, key: ResortTabKey, baseUrl: string = SITE_URL): string {
  return `${baseUrl}${resortTabPath(slug, key)}`;
}

/** The markdown alternate for a tab: "/resorts/alta/snow-report/index.md". */
export function resortTabMarkdownPath(slug: string, key: ResortTabKey): string {
  return `${resortTabPath(slug, key)}/index.md`;
}

/** "{Resort} Snow Report — Measured Conditions | PeakCam" */
export function snowReportTitle(resortName: string): string {
  return `${resortName} Snow Report — Measured Conditions | PeakCam`;
}

/** "{Resort} Snow Forecast — 14-Day Multi-Model Blend | PeakCam" */
export function snowForecastTitle(resortName: string): string {
  return `${resortName} Snow Forecast — 14-Day Multi-Model Blend | PeakCam`;
}

/** "{Resort} Webcams — 4 Live Cams | PeakCam" (singular when there is one). */
export function webcamsTitle(resortName: string, camCount: number): string {
  const cams = camCount === 1 ? "1 Live Cam" : `${camCount} Live Cams`;
  return `${resortName} Webcams — ${cams} | PeakCam`;
}

// ── Breadcrumbs ──────────────────────────────────────────────

import { HUB_BASE_PATH, stateHub, stateHubPath } from "./hubs";
import type { BreadcrumbItem } from "@/components/hubs/HubBreadcrumb";

/**
 * Home › {State hub} › {Resort} › {Tab}. The second crumb is the resort's
 * /ski-cams state hub (a real page in the crawl path) — the same trail the
 * overview renders — and the subpage adds its label as the leaf. One trail
 * feeds both the visible HubBreadcrumb and the BreadcrumbList JSON-LD.
 */
export function resortBreadcrumb(
  resort: { name: string; slug: string; state: string | null | undefined },
  tab: ResortTabKey = "overview",
): BreadcrumbItem[] {
  const code = resort.state?.trim() ?? "";
  const hub = code ? { label: stateHub(code).label, href: stateHubPath(code) } : { label: "Ski cams", href: HUB_BASE_PATH };
  const trail: BreadcrumbItem[] = [
    { label: "Home", href: "/" },
    hub,
    { label: resort.name, href: resortTabPath(resort.slug, "overview") },
  ];
  if (tab !== "overview") trail.push({ label: resortTab(tab).label, href: resortTabPath(resort.slug, tab) });
  return trail;
}

/** BreadcrumbList JSON-LD for a trail of site-relative hrefs. */
export function breadcrumbListLd(items: readonly BreadcrumbItem[], baseUrl: string = SITE_URL): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: !item.href || item.href === "/" ? baseUrl : `${baseUrl}${item.href}`,
    })),
  };
}
