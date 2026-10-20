"use client";

import { useForecastTime } from "@/lib/use-forecast-time";
import { hasCurrentSnowForecast } from "@/lib/snow-forecast";
import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { Heart } from "lucide-react";
import { ConditionBadge } from "@/components/ui/Badge";
import type { ResortWithData, WeatherPeriod, LiveConditions, Cam, UserCondition, ForecastPeriod, HourlyWeather } from "@/lib/types";
import { CamCaption, CamPlayer } from "@/components/cam/CamPlayer";
import { CamLightbox } from "@/components/cam/CamLightbox";
import { ConditionsHero } from "@/components/resort/ConditionsHero";
import { ForecastTable } from "@/components/resort/ForecastTable";
import { ForecastStrip, type ForecastStripData } from "@/components/resort/ForecastStrip";
import { HourlyTimeline } from "@/components/resort/HourlyTimeline";
import dynamic from "next/dynamic";
const ConditionVoter = dynamic(() => import("./ConditionVoter").then(m => ({ default: m.ConditionVoter })));
const UserConditionsForm = dynamic(() => import("./UserConditionsForm").then(m => ({ default: m.UserConditionsForm })));
const UserConditionsList = dynamic(() => import("./UserConditionsList").then(m => ({ default: m.UserConditionsList })));
import { useFavorites } from "@/lib/useFavorites";
import { AuthModal } from "@/components/auth/AuthModal";
import { trackResortView, trackCamClick } from "@/lib/posthog";
import { trackViewContent } from "@/lib/meta-pixel-events";
import { isDropInResort } from "@/lib/drop-in";
import DropInLink from "@/components/drop-in/DropInLink";
import { useHydrated } from "@/lib/use-hydrated";
import { formatLocalDateTime, formatUtcDate } from "@/lib/format-date";
import { ResortAlertCapture } from "@/components/alerts/ResortAlertCapture";
import { NearbyResorts, type NearbyResortsData } from "@/components/resort/NearbyResorts";
import { HubBreadcrumb, type BreadcrumbItem } from "@/components/hubs/HubBreadcrumb";
import type { Quotable } from "@/lib/quotable";
import { CamTimelineStrip } from "@/components/resort/CamTimelineStrip";
import { TimelapseTile } from "@/components/resort/TimelapseClips";
import type { CamTimelapseClip } from "@/lib/cam-timelapse";
import { resortTabPath } from "@/lib/resort-pages";
import type { CamTimeline } from "@/lib/cam-timeline";
import { MeasuredNow } from "@/components/resort/MeasuredNow";
import type { MeasuredNowPublic } from "@/lib/public-api/schema";
import { StatusChip } from "@/components/resort/StatusChip";
import { FreshnessLabels } from "@/components/resort/FreshnessLabels";
import type { ResortConditionsView } from "@/lib/public-api/conditions";
import { ScoreCard } from "@/components/resort/ScoreCard";
import type { ResortScoreHistoryPublic } from "@/lib/public-api/schema";

interface Props {
  resort: ResortWithData;
  weather: WeatherPeriod[] | null;
  forecastPeriods?: ForecastPeriod[] | null;
  /** The stored multi-model blend (P4), already serialised; null when no run is current. */
  forecastStrip?: ForecastStripData | null;
  hourlyData?: HourlyWeather[] | null;
  liveConditions?: LiveConditions | null;
  userConditions?: UserCondition[];
  /** Server-computed neighbours + hub links (app/resorts/[slug]/page.tsx); omitted → no block. */
  nearby?: NearbyResortsData | null;
  /** Dated, source-labelled first sentence under the H1 (lib/quotable.ts); omitted → none. */
  freshness?: Pick<Quotable, "segments"> | null;
  /** Home / {State hub} / {Resort}; the page emits the matching BreadcrumbList JSON-LD. Omitted → the plain "All Resorts" link. */
  breadcrumb?: BreadcrumbItem[] | null;
  /** Server-fetched still archive for one cam (getResortCamTimeline); null/omitted → no strip. */
  camTimeline?: CamTimeline | null;
  /** The resort's newest 24 h timelapse clip (getResortTimelapses + pickResortTimelapse); null until the renderer has one. */
  timelapse?: (CamTimelapseClip & { camId: string }) | null;
  /** Tab row for the page family (ResortTabs) and the labelled description block, rendered between the hero and the content. */
  subnav?: React.ReactNode;
  /** Station layer rows (lib/public-api/serialize.ts serializeStations); empty/omitted → no "What the instruments say" block. */
  measuredNow?: MeasuredNowPublic[] | null;
  /** The P6 conditions contract (lib/public-api/conditions.ts resortConditionsView): status chip in the hero, freshness labels under the snow strip. Omitted → neither. */
  conditions?: ResortConditionsView | null;
  /** The P7 Snow Score document (lib/public-api/score.ts buildScoreDocument): ring, components and sparkline above the snow strip. Omitted or unavailable → no card. */
  score?: ResortScoreHistoryPublic | null;
}

// ─── "Updated …" stamp ───────────────────────────────────────────────────────

/**
 * Hydration-safe timestamp. This whole page is a client component that is
 * also server-rendered (UTC) and ISR-cached; formatting `updated_at` in the
 * visitor's timezone at render time produced "Sep 27, 2:52 PM" on the server
 * and "Sep 27, 9:52 AM" in the browser → React #418 on every resort page, and
 * React then re-rendered the entire tree client-side. Render the deterministic
 * UTC date first, and swap in the local date+time once hydrated. The machine-
 * readable ISO lives in `dateTime` either way.
 */
function UpdatedStamp({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  return <time dateTime={iso}>{hydrated ? formatLocalDateTime(iso) : formatUtcDate(iso)}</time>;
}

// ─── Breakpoint ──────────────────────────────────────────────────────────────

/**
 * Tailwind's `lg` (64rem), read as a store so the phone and desktop layouts
 * below can mount different trees without a hydration mismatch: `false` on the
 * server and during hydration, the real value from the first client render on.
 *
 * Why not CSS alone: on phones the first cam is hoisted above the weather card
 * (browser-test D5 — it sat ~2,000 px down), and on desktop it stays in the
 * grid. Both copies are in the server HTML so either width is right before
 * any JS runs (the wrong one is `display: none`), but two mounted players for
 * one cam would mean two snapshot refresh timers, two favorite buttons and a
 * `cam_played` from a tile nobody can see — so once the width is known the
 * hidden copy is unmounted.
 */
const LG_QUERY = "(min-width: 64rem)";
function subscribeToLg(onChange: () => void) {
  const media = window.matchMedia(LG_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const readIsLg = () => window.matchMedia(LG_QUERY).matches;
const readIsLgOnServer = () => false;

// ─── Conditions strip ────────────────────────────────────────────────────────

function ConditionsStrip({ resort }: { resort: ResortWithData }) {
  const snow = resort.snow_report;
  if (!snow) return null;

  const trendIcons: Record<string, string> = { rising: "↑", stable: "→", falling: "↓" };
  const trendColors: Record<string, string> = { rising: "text-[#2ECC8F]", stable: "text-text-subtle", falling: "text-red-400" };
  const outlookLabels: Record<string, string> = {
    more_snow: "More snow expected",
    stable: "Conditions stable",
    warming: "Warming trend",
    melt_risk: "Melt risk",
  };
  const outlookColors: Record<string, string> = {
    more_snow: "text-cyan",
    stable: "text-text-subtle",
    warming: "text-yellow-400",
    melt_risk: "text-red-400",
  };

  const stats = [
    { label: "Base Depth", value: snow.base_depth != null ? `${snow.base_depth}″` : "—", color: "text-powder" },
    { label: "24h New Snow", value: snow.new_snow_24h != null ? `${snow.new_snow_24h}″` : "—", color: "text-cyan" },
    { label: "48h New Snow", value: snow.new_snow_48h != null ? `${snow.new_snow_48h}″` : "—", color: "text-text-subtle" },
    ...(snow.swe_in != null ? [{ label: "SWE", value: `${snow.swe_in}″`, color: "text-text-base" }] : []),
    ...(snow.pct_of_normal != null ? [{
      label: "% of Normal",
      value: `${snow.pct_of_normal}%`,
      color: snow.pct_of_normal >= 110 ? "text-[#2ECC8F]" : snow.pct_of_normal >= 90 ? "text-text-base" : snow.pct_of_normal >= 70 ? "text-yellow-400" : "text-red-400",
    }] : []),
    ...(snow.trend_7d ? [{
      label: "7-Day Trend",
      value: `${trendIcons[snow.trend_7d] ?? ""} ${snow.trend_7d.charAt(0).toUpperCase() + snow.trend_7d.slice(1)}`,
      color: trendColors[snow.trend_7d] ?? "text-text-base",
    }] : []),
    {
      label: "Trails Open",
      value: snow.trails_open != null ? `${snow.trails_open}${snow.trails_total ? `/${snow.trails_total}` : ""}` : "—",
      color: "text-text-base",
    },
    {
      label: "Lifts Open",
      value: snow.lifts_open != null ? `${snow.lifts_open}${snow.lifts_total ? `/${snow.lifts_total}` : ""}` : "—",
      color: "text-text-base",
    },
  ];

  return (
    <div className="flex flex-wrap gap-3">
      {stats.map((s) => (
        <div key={s.label} className="bg-surface border border-border rounded-xl px-4 py-3 min-w-[100px]">
          <div className={`text-2xl font-bold ${s.color} leading-none`}>{s.value}</div>
          <div className="text-text-muted text-xs mt-1">{s.label}</div>
        </div>
      ))}
      {(() => {
        if (!snow.conditions) return null;
        const conditionsRaw = snow.conditions;
        const [tagsStr, narrativeStr] = conditionsRaw.includes("||") ? conditionsRaw.split("||") : ["", conditionsRaw];
        const tags = tagsStr ? tagsStr.split(",") : [];
        const narrative = narrativeStr || conditionsRaw;

        return (
          <div className="bg-surface border border-border rounded-xl px-4 py-3 flex-1 min-w-[200px]">
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded bg-surface2 border border-border text-text-subtle text-[10px] uppercase tracking-wider font-bold">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="text-text-base text-sm font-medium leading-snug">{narrative}</div>
          </div>
        );
      })()}
      {snow.outlook && (
        <div className={`bg-surface border border-border rounded-xl px-4 py-3 ${outlookColors[snow.outlook] ?? "text-text-base"}`}>
          <div className="text-sm font-semibold">{outlookLabels[snow.outlook] ?? snow.outlook}</div>
          <div className="text-text-muted text-xs mt-1">Outlook</div>
        </div>
      )}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function ResortDetailPage({ resort, weather, forecastPeriods, forecastStrip = null, hourlyData, liveConditions, userConditions = [], nearby = null, freshness = null, breadcrumb = null, camTimeline = null, timelapse = null, subnav = null, measuredNow = null, conditions = null, score = null }: Props) {
  const activeCams = resort.cams.filter((c) => c.is_active);
  const embeddableCams = activeCams.filter((c) => c.embed_type !== "link");
  const snow = resort.snow_report;
  const forecastTime = useForecastTime();
  const isUS = resort.country === "US";
  const { user, isFavorite, toggle: toggleFav } = useFavorites();
  // Which surface raised the auth gate (favorite_resort, resort_nudge) — the
  // modal stamps it on AUTH_GATE_SHOWN; null when closed.
  const [authSource, setAuthSource] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Shared across every ResortAlertCapture on the page so subscribing in one
  // flips them all to the success state.
  const [alertSubscribed, setAlertSubscribed] = useState(false);
  const favorited = isFavorite(resort.id);

  const hydrated = useHydrated();
  const isLg = useSyncExternalStore(subscribeToLg, readIsLg, readIsLgOnServer);
  // The cam that leads the page on phones: the first one that can embed, else
  // the first link-out. Until the width is known both placements are mounted
  // and CSS picks; afterwards only the visible one stays.
  const leadCam = embeddableCams[0] ?? activeCams[0] ?? null;
  const mountMobileLead = !hydrated || !isLg;
  const mountDesktopOnly = !hydrated || isLg;

  const openLightbox = (cam: Cam) => {
    trackCamClick(resort.slug, cam.name, "lightbox");
    setLightboxIndex(embeddableCams.findIndex((c) => c.id === cam.id));
  };

  useEffect(() => {
    trackResortView(resort.name, resort.slug);
    trackViewContent(resort.name, resort.slug);
  }, [resort.name, resort.slug]);

  // Deep links such as /resorts/x#cameras landed at scrollY 0 (browser-test
  // D5): the browser's own fragment jump happens against the pre-hydration
  // layout, and the sections above the grid then change height. Re-run the
  // jump once the tree has settled; scroll-mt on the sections keeps the
  // target clear of the sticky header.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const frame = requestAnimationFrame(() => target.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      {authSource && <AuthModal onClose={() => setAuthSource(null)} source={authSource} />}
      <Header showSearch={false} />

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div className="bg-gradient-to-b from-surface2 to-bg border-b border-border px-4 py-6 md:px-8 md:py-8">
        <div className="max-w-5xl mx-auto">
          {breadcrumb && breadcrumb.length > 0 ? (
            <div className="mb-4 py-2">
              <HubBreadcrumb items={breadcrumb} />
            </div>
          ) : (
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-text-muted hover:text-cyan text-sm py-2 px-1 pointer-coarse:min-h-11 transition-colors mb-4"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              All Resorts
            </Link>
          )}

          {hasCurrentSnowForecast(hourlyData, forecastTime ?? NaN) && (
            <div className="flex items-center gap-2 px-3 py-1.5 mb-4 bg-cyan/10 border border-cyan/30 rounded-lg w-fit">
              <svg className="w-4 h-4 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 2v4m0 12v4m-6.93-2.93l2.83-2.83m8.2-8.2l2.83-2.83M2 12h4m12 0h4m-2.93 6.93l-2.83-2.83m-8.2-8.2L4.07 5.07" />
              </svg>
              <span className="text-cyan text-sm font-semibold">Snow forecast</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="min-w-0">
                <h1 className="break-words text-3xl md:text-4xl font-heading font-bold text-text-base uppercase tracking-wider leading-tight">
                  {resort.name}
                </h1>
              </div>
              {freshness && freshness.segments.length > 0 && (
                <p id="resort-freshness" className="mt-2 max-w-2xl text-[15px] leading-snug text-bark-dk" data-testid="resort-freshness">
                  {freshness.segments.map((segment, index) =>
                    segment.href ? (
                      <Link
                        key={index}
                        href={segment.href}
                        prefetch={false}
                        className="font-bold text-ink underline decoration-alpen/60 decoration-2 underline-offset-[3px] hover:decoration-alpen"
                      >
                        {segment.text}
                      </Link>
                    ) : (
                      <span key={index}>{segment.text}</span>
                    ),
                  )}
                </p>
              )}
              <p className="text-text-muted text-sm mt-1.5">
                {resort.region} · {resort.state}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              {conditions && conditions.contract.status.value && (
                <StatusChip status={conditions.contract.status.value} sentence={conditions.sentence} source={conditions.contract.status.source} />
              )}
              {resort.cond_rating && (
                <ConditionBadge
                  rating={resort.cond_rating}
                  label={resort.cond_rating.charAt(0).toUpperCase() + resort.cond_rating.slice(1)}
                />
              )}
              <button
                onClick={event => {
                  event.currentTarget.focus();
                  if (!user) { setAuthSource("favorite_resort"); return; }
                  toggleFav(resort.id);
                }}
                className={`min-h-11 min-w-11 p-2 rounded-lg border transition-all duration-[220ms] ${
                  favorited
                    ? "bg-alpenglow/15 border-alpenglow/40 text-alpenglow hover:bg-alpenglow/25"
                    : "bg-surface2/50 border-border text-text-muted hover:text-alpenglow hover:border-alpenglow/30 hover:bg-alpenglow/10"
                }`}
                aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                title={favorited ? "Remove from favorites" : user ? "Add to favorites" : "Sign in to save favorites"}
              >
                <Heart size={18} fill={favorited ? "currentColor" : "none"} strokeWidth={favorited ? 0 : 1.5} />
              </button>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {resort.instagram_url && (
                  <a href={resort.instagram_url} target="_blank" rel="noopener noreferrer"
                    className="text-text-muted hover:text-cyan transition-colors p-2 pointer-coarse:p-3 -m-1" aria-label="Instagram" title="Instagram">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                    </svg>
                  </a>
                )}
                {resort.facebook_url && (
                  <a href={resort.facebook_url} target="_blank" rel="noopener noreferrer"
                    className="text-text-muted hover:text-cyan transition-colors p-2 pointer-coarse:p-3 -m-1" aria-label="Facebook" title="Facebook">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </a>
                )}
                {resort.x_url && (
                  <a href={resort.x_url} target="_blank" rel="noopener noreferrer"
                    className="text-text-muted hover:text-cyan transition-colors p-2 pointer-coarse:p-3 -m-1" aria-label="X (Twitter)" title="X (Twitter)">
                    <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </a>
                )}
                {resort.website_url && (
                  <a
                    href={resort.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-muted hover:text-cyan text-sm border border-border hover:border-border-hi
                               inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 transition-all duration-150"
                  >
                    Resort site ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {subnav}

      {/* ── Content ───────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 py-8 md:px-8 space-y-10">

        {/* Phones: the product's core content first. One live cam straight
            under the hero, then the one-field alert signup, before the weather
            card and everything else pushes them 2.6 screens down. Desktop keeps
            the cam in the grid below (see LG_QUERY). */}
        {mountMobileLead && (
          <section className="space-y-6 lg:hidden" aria-label={leadCam ? "Live cam and powder alerts" : "Powder alerts"}>
            {leadCam && (
              <div id="lead-cam" className="scroll-mt-20">
                <CamPlayer
                  cam={leadCam}
                  resortSlug={resort.slug}
                  resortName={resort.name}
                  resortUrl={resort.cam_page_url || resort.website_url}
                  index={0}
                  onExpand={leadCam.embed_type !== "link" ? () => openLightbox(leadCam) : undefined}
                />
                <CamCaption cam={leadCam} />
              </div>
            )}
            <ResortAlertCapture resort={resort} subscribed={alertSubscribed} onSubscribed={() => setAlertSubscribed(true)} />
          </section>
        )}

        {/* Drop In — pilot resorts only. The map cards were the only way in, so
            the game's own "Back to conditions" landed you on a page with no way
            to return to it. */}
        {isDropInResort(resort.slug) && (
          <section>
            <DropInLink slug={resort.slug} variant="block" />
          </section>
        )}

        {/* ConditionsHero — big glanceable numbers */}
        {weather && weather.length > 0 ? (
          <section>
            <ConditionsHero
              currentTemp={weather[0].high}
              feelsLike={weather[0].feelsLike}
              newSnow24h={snow?.new_snow_24h}
              windSpeed={weather[0].windSpeed}
              windDirection={weather[0].windDirection}
              windGust={weather[0].windGust}
              precipProbability={weather[0].precipProbability}
            />
          </section>
        ) : (
          <section>
            <div className="bg-surface border border-border rounded-xl p-6 text-center text-text-muted text-sm">
              Forecast unavailable — weather data temporarily unreachable.
            </div>
          </section>
        )}

        <nav aria-label="Resort sections" className="flex flex-wrap gap-2">
          {[['cameras', 'Cameras'], ['conditions-report', 'Conditions'], ['forecast', 'Forecast']].map(([id, label]) => <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center rounded-full border border-ink bg-cream-50 px-4 text-sm font-bold">{label}</a>)}
        </nav>
        {/* P7: the Snow Score card, when the scorer has a row for this resort. */}
        {score && score.available && (
          <section id="snow-score" className="scroll-mt-20" aria-label="Snow Score">
            <ScoreCard doc={score} resortName={resort.name} />
          </section>
        )}
        {/* Snow conditions strip */}
        {snow ? (
          <section id="conditions-report" className="scroll-mt-20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base">Snow Report</h2>
              {resort.snotel_station_id && (
                <a
                  href={`https://www.nrcs.usda.gov/wps/portal/wcc/home/snowpackProfile?station=${resort.snotel_station_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-muted hover:text-cyan text-xs py-2 px-1 pointer-coarse:min-h-11 inline-flex items-center transition-colors"
                >
                  SNOTEL Source ↗
                </a>
              )}
            </div>
            <ConditionsStrip resort={resort} />
            <p className="text-text-muted text-xs mt-2">
              Updated <UpdatedStamp iso={snow.updated_at} /> · Source: {snow.source}
            </p>
            {conditions && <FreshnessLabels contract={conditions.contract} />}
          </section>
        ) : (
          <section id="conditions-report" className="scroll-mt-20">
            <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base mb-3">Snow Report</h2>
            <div className="bg-surface border border-border rounded-xl p-6 text-center text-text-muted text-sm">
              No snow data available yet. Check back after the first SNOTEL sync.
            </div>
          </section>
        )}

        {/* Desktop: the alert signup directly under the numbers it is about.
            Phones already have it under the lead cam above. */}
        {mountDesktopOnly && (
          <section className="hidden lg:block" aria-label="Powder alerts">
            <ResortAlertCapture resort={resort} subscribed={alertSubscribed} onSubscribed={() => setAlertSubscribed(true)} />
          </section>
        )}

        {/* ForecastTable — 5-day morning/afternoon/evening */}
        {forecastPeriods && forecastPeriods.length > 0 ? (
          <section id="forecast" className="scroll-mt-20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base">5-Day Forecast</h2>
              {isUS && (
                <a
                  href={`https://forecast.weather.gov/MapClick.php?lat=${resort.lat}&lon=${resort.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-muted hover:text-cyan text-xs py-2 px-1 pointer-coarse:min-h-11 inline-flex items-center transition-colors"
                >
                  NWS Forecast ↗
                </a>
              )}
            </div>
            {/* The 14-day blended strip (P4) sits above the period table; the
                table's snow totals are re-scaled to the same blend upstream. */}
            {forecastStrip && (
              <div className="mb-4">
                <ForecastStrip data={forecastStrip} />
              </div>
            )}
            <ForecastTable periods={forecastPeriods} />
            <p className="text-text-muted text-xs mt-2">
              {forecastStrip
                ? `Snow amounts: PeakCam blend of ${forecastStrip.summary.models.length} models (Open-Meteo, CC BY 4.0) · Narrative, temperature and wind: ${isUS ? "National Weather Service" : "Open-Meteo"} · Updated hourly`
                : isUS
                  ? "Via National Weather Service · Updated hourly · Snow amounts are estimates from the forecast wording"
                  : "Via Open-Meteo · Updated hourly"}
            </p>
          </section>
        ) : (
          <section id="forecast" className="scroll-mt-20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base">{forecastStrip ? "14-Day Forecast" : "5-Day Forecast"}</h2>
              {isUS && (
                <a
                  href={`https://forecast.weather.gov/MapClick.php?lat=${resort.lat}&lon=${resort.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-text-muted hover:text-cyan text-xs py-2 px-1 pointer-coarse:min-h-11 inline-flex items-center transition-colors"
                >
                  NWS Forecast ↗
                </a>
              )}
            </div>
            {forecastStrip ? (
              <ForecastStrip data={forecastStrip} />
            ) : (
              <div className="bg-surface border border-border rounded-xl p-6 text-center text-text-muted text-sm">
                Weather data temporarily unavailable.
              </div>
            )}
          </section>
        )}

        {/* HourlyTimeline — 48h collapsible chart */}
        {hourlyData && hourlyData.length > 0 && (
          <section>
            <HourlyTimeline hourlyData={hourlyData} />
          </section>
        )}

        {/* Station layer (migration 026): the nearest instruments by elevation
            band, each with its network and the age of its reading. Rendered
            from the same serialised rows the public API returns. */}
        {measuredNow && measuredNow.length > 0 && <MeasuredNow rows={measuredNow} resortName={resort.name} />}

        {/* Live cams */}
        <section id="cameras" className="scroll-mt-20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base">
              Live Cams
              {/* Real separator text — a CSS margin alone glued the count onto
                  "Cams" in the accessibility tree ("Live Cams3 available"). */}
              {activeCams.length > 0 && (
                <span className="text-bark text-sm font-normal">
                  {" · "}
                  {activeCams.length} available
                </span>
              )}
            </h2>
            {resort.cam_page_url && (
              <a
                href={resort.cam_page_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-muted hover:text-cyan text-xs transition-colors"
              >
                View all on resort site ↗
              </a>
            )}
          </div>

          {activeCams.length === 0 ? (
            <div className="bg-surface border border-border rounded-xl p-6 text-center text-text-muted text-sm">
              No cams indexed yet for this resort.{" "}
              {resort.cam_page_url && (
                <a href={resort.cam_page_url} target="_blank" rel="noopener noreferrer"
                  className="text-cyan hover:underline">
                  View on resort website ↗
                </a>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeCams.map((cam, i) => {
                  // The lead cam already sits under the hero on phones; it
                  // stays in the grid only on desktop.
                  const isLead = cam.id === leadCam?.id;
                  if (isLead && !mountDesktopOnly) return null;
                  return (
                    <div key={cam.id} className={isLead ? "hidden lg:block" : undefined}>
                      <CamPlayer
                        cam={cam}
                        resortSlug={resort.slug}
                        resortName={resort.name}
                        resortUrl={resort.cam_page_url || resort.website_url}
                        index={i}
                        onExpand={cam.embed_type !== "link" ? () => openLightbox(cam) : undefined}
                      />
                      <CamCaption cam={cam} />
                    </div>
                  );
                })}
              </div>
              {/* Still archive (migration 024): "Last 24 h" frames + the last
                  storm keeper for one archive-allowed cam. Renders nothing
                  until the capture job has stored frames for this resort. */}
              <CamTimelineStrip timeline={camTimeline} cams={activeCams} />
              {/* Timelapse clip (P8 block 2): the newest 24 h MP4 at the resort, poster until pressed. */}
              <TimelapseTile
                clip={timelapse}
                cams={activeCams}
                webcamsHref={resortTabPath(resort.slug, "webcams")}
              />
              {/* A single-cam resort has nothing left for the grid on phones. */}
              {activeCams.length === 1 && (
                <p className="text-text-muted text-sm lg:hidden">
                  The only cam we have for {resort.name} is at the top of this page.{" "}
                  <a href="#lead-cam" className="text-cyan hover:underline">
                    Jump to it ↑
                  </a>
                </p>
              )}
            </>
          )}
        </section>

        {/* Nearby resorts + hub links — the page's only links to other resorts
            (growth-audit S2). One mount serves both layouts: the cameras
            section above is shared, only the lead cam moves on phones. */}
        {nearby && <NearbyResorts resortName={resort.name} resortSlug={resort.slug} {...nearby} />}

        {/* Community conditions — vote + detailed report */}
        <section>
          <h2 className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base mb-4">
            Community Conditions
          </h2>
          <div className="space-y-4">
            <ConditionVoter resortId={resort.id} resortSlug={resort.slug} liveConditions={liveConditions ?? null} />
            {/* Alerts need no account, so the signup replaces the old "Sign in
                to … get powder alerts" nudge; the account is the secondary ask. */}
            <ResortAlertCapture resort={resort} subscribed={alertSubscribed} onSubscribed={() => setAlertSubscribed(true)} />
            {!user && (
              <p className="text-text-muted text-xs text-center">
                <button
                  type="button"
                  onClick={() => setAuthSource("resort_nudge")}
                  className="inline-flex min-h-11 items-center px-1 text-cyan hover:underline"
                >
                  Sign in to save favorites
                </button>
              </p>
            )}
            <UserConditionsForm resortId={resort.id} resortSlug={resort.slug} />
            <UserConditionsList conditions={userConditions} />
          </div>
        </section>

        {/* Footer nav. The "More in {State} →" hub link lives in NearbyResorts
            above, next to the compare and region links — not repeated here. */}
        <div className="border-t border-border pt-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-text-muted hover:text-cyan text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to all resorts
          </Link>
        </div>

      </div>

      {lightboxIndex !== null && (
        <CamLightbox
          cams={embeddableCams}
          initialIndex={lightboxIndex}
          resortSlug={resort.slug}
          resortName={resort.name}
                    resortUrl={resort.cam_page_url || resort.website_url}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
