"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import Fuse from "fuse.js";
import { Search, SlidersHorizontal, MapPin, ChevronDown } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { SummitResortCard } from "@/components/browse/SummitResortCard";
import { PowderAlertSignup } from "@/components/alerts/PowderAlertSignup";
import { useFavorites } from "@/lib/useFavorites";
import { AuthModal } from "@/components/auth/AuthModal";
import type { ResortWithData } from "@/lib/types";
import { trackSearch, trackFilter } from "@/lib/posthog";

// MapLibre map — dynamic import, no SSR (requires window)
const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-cream animate-pulse rounded-[18px] border-[1.5px] border-ink flex items-center justify-center">
      <span className="font-mono text-bark text-xs uppercase tracking-[0.14em]">Loading map…</span>
    </div>
  ),
});

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  resorts: ResortWithData[];
}

type StateFilter = string;
type ConditionFilter = "all" | "great" | "good" | "fair" | "poor";
type SortOption = "popular" | "best" | "snow" | "name";

const SORT_LABEL: Record<SortOption, string> = {
  popular: "Popular",
  best:    "Best",
  snow:    "Snow",
  name:    "Name",
};

// ── Constants ────────────────────────────────────────────────────────────────

const CONDITION_ORDER: Record<string, number> = {
  great: 0, good: 1, fair: 2, poor: 3,
};

// Curated popularity ranking — order matters, top of list = top of grid.
// Based on brand recognition / skier visits; adjust freely.
const POPULAR_SLUGS: string[] = [
  "vail",
  "aspen-snowmass",
  "park-city",
  "jackson-hole",
  "whistler-blackcomb",
  "mammoth",
  "breckenridge",
  "palisades-tahoe",
  "big-sky",
  "killington",
  "stowe",
  "alta",
];
const POPULAR_RANK: Record<string, number> = Object.fromEntries(
  POPULAR_SLUGS.map((slug, idx) => [slug, idx]),
);

const STATE_NAMES: Record<string, string> = {
  AZ: "Arizona", BC: "British Columbia", CA: "California", CO: "Colorado",
  ID: "Idaho", MA: "Massachusetts", MD: "Maryland", ME: "Maine",
  MI: "Michigan", MN: "Minnesota", MT: "Montana", NH: "New Hampshire",
  NM: "New Mexico", NV: "Nevada", NY: "New York", OR: "Oregon",
  PA: "Pennsylvania", UT: "Utah", VA: "Virginia", VT: "Vermont",
  WA: "Washington", WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
};

const FUSE_OPTIONS: import("fuse.js").IFuseOptions<ResortWithData> = {
  keys: [
    { name: "name", weight: 0.5 },
    { name: "region", weight: 0.3 },
    { name: "state", weight: 0.2 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
};

// ── Filter chip ──────────────────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onClick,
  icon,
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 min-h-[40px] text-[13px] font-semibold border-[1.5px] cursor-pointer select-none transition-colors duration-150 whitespace-nowrap ${
        active
          ? "bg-ink border-ink text-cream-50"
          : "bg-cream-50 border-bark text-ink hover:border-ink hover:bg-cream"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── TODAY'S TOP CONDITIONS — editorial strip ─────────────────────────────────

function FeaturedRow({ resorts }: { resorts: ResortWithData[] }) {
  const featured = useMemo(() => {
    const sorted = resorts
      .filter((r) => r.snow_report && r.cond_rating)
      .sort((a, b) => {
        const condDiff = (CONDITION_ORDER[a.cond_rating] ?? 99) - (CONDITION_ORDER[b.cond_rating] ?? 99);
        if (condDiff !== 0) return condDiff;
        return (b.snow_report?.new_snow_24h ?? 0) - (a.snow_report?.new_snow_24h ?? 0);
      })
      .slice(0, 4);
    const hasGoodOrBetter = sorted.some(r => r.cond_rating === "great" || r.cond_rating === "good");
    return hasGoodOrBetter ? sorted : [];
  }, [resorts]);

  if (featured.length === 0) return null;

  // Condition chip palette — matches ConditionBadge tokens
  const chipClass: Record<string, string> = {
    great: "bg-great text-cream-50 border-forest-dk",
    good:  "bg-good text-cream-50 border-forest-dk",
    fair:  "bg-fair text-ink border-bark-dk",
    poor:  "bg-poor text-cream-50 border-bark-dk",
  };

  return (
    <div className="mb-10">
      <div className="pc-eyebrow mb-1" style={{ color: "var(--pc-bark)" }}>
        Today&apos;s Top
      </div>
      <h2 className="font-display font-black text-4xl md:text-5xl text-ink mb-1 leading-[0.95] tracking-[-0.02em]">
        Got the <em className="text-alpen not-italic font-bold italic">goods</em>.
      </h2>
      <p className="text-bark text-sm mb-5">Ranked by condition rating and recent snowfall.</p>
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2 scrollbar-hide">
        {featured.map((resort) => {
          const snow = resort.snow_report;
          const chip = chipClass[resort.cond_rating] ?? "bg-cream-50 text-ink border-bark";
          return (
            <Link
              key={resort.id}
              href={`/resorts/${resort.slug}`}
              className="group relative flex-shrink-0 w-72 bg-cream-50 border-[1.5px] border-ink rounded-[18px] overflow-hidden
                         shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]
                         transition-[transform,box-shadow] duration-150
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-alpen"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 font-mono font-bold text-[10.5px] text-bark uppercase tracking-[0.14em] mb-1.5">
                      <span className="px-2 py-0.5 bg-ink text-cream-50 rounded-full">{resort.state}</span>
                    </div>
                    <h3 className="font-display font-black text-[20px] leading-[1.05] tracking-[-0.01em] text-ink">
                      {resort.name}
                    </h3>
                    <p className="text-bark text-xs mt-1">{resort.region}</p>
                  </div>
                  <span className={`inline-flex items-center rounded-full border-[1.5px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] shrink-0 ${chip}`}>
                    {resort.cond_rating.toUpperCase()}
                  </span>
                </div>

                {snow && (
                  <div className="grid grid-cols-3 gap-2 pt-3 border-t-[1.5px] border-dashed border-bark/60">
                    <div className="text-center">
                      <div className="font-display font-black text-ink text-2xl leading-none tabular-nums">
                        {snow.base_depth ?? "\u2014"}
                      </div>
                      <div className="pc-eyebrow mt-1" style={{ fontSize: 9.5 }}>Base&quot;</div>
                    </div>
                    <div className="text-center">
                      <div className="font-display font-black text-alpen text-2xl leading-none tabular-nums">
                        {snow.new_snow_24h ?? "\u2014"}
                      </div>
                      <div className="pc-eyebrow mt-1" style={{ fontSize: 9.5 }}>24h&quot;</div>
                    </div>
                    <div className="text-center">
                      <div className="font-display font-black text-ink text-2xl leading-none tabular-nums">
                        {snow.trails_open != null && snow.trails_total != null
                          ? `${snow.trails_open}/${snow.trails_total}` : "\u2014"}
                      </div>
                      <div className="pc-eyebrow mt-1" style={{ fontSize: 9.5 }}>Runs</div>
                    </div>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ── Powder Alert banner ──────────────────────────────────────────────────────

function PowderAlert({ resorts }: { resorts: ResortWithData[] }) {
  const alerts = resorts
    .filter((r) => (r.snow_report?.new_snow_24h ?? 0) >= 8)
    .sort((a, b) => (b.snow_report?.new_snow_24h ?? 0) - (a.snow_report?.new_snow_24h ?? 0))
    .slice(0, 4);

  if (alerts.length === 0) return null;

  return (
    <div className="flex items-center gap-3 px-5 py-3 bg-alpen text-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp mb-8">
      <span className="relative flex h-3 w-3 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cream-50 opacity-75" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-cream-50" />
      </span>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono font-bold text-[11px] uppercase tracking-[0.16em]">Pow Day</span>
        {alerts.map((r) => (
          <Link
            key={r.slug}
            href={`/resorts/${r.slug}`}
            className="text-cream-50 text-sm font-semibold hover:underline decoration-2 underline-offset-2"
          >
            {r.name}{" "}
            <span className="font-mono font-bold tabular-nums">+{r.snow_report!.new_snow_24h}&quot;</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Main BrowsePage ──────────────────────────────────────────────────────────

export function BrowsePage({ resorts }: Props) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("All");
  const [condFilter, setCondFilter] = useState<ConditionFilter>("all");
  const [hasLiveCams, setHasLiveCams] = useState(false);
  const [freshSnow, setFreshSnow] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortOption>("popular");
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showStates, setShowStates] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { user, isFavorite, toggle: toggleFav } = useFavorites();

  const availableStates = useMemo(() => {
    return [...new Set(resorts.map((r) => r.state))].sort();
  }, [resorts]);

  const fuse = useMemo(() => new Fuse(resorts, FUSE_OPTIONS), [resorts]);

  const filtered = useMemo(() => {
    let list = resorts;

    if (search.trim()) {
      list = fuse.search(search.trim()).map((result) => result.item);
    }

    if (stateFilter !== "All") list = list.filter((r) => r.state === stateFilter);
    if (condFilter !== "all") list = list.filter((r) => r.cond_rating === condFilter);
    if (hasLiveCams) list = list.filter((r) => r.cams.some((c) => c.is_active));
    if (freshSnow) list = list.filter((r) => (r.snow_report?.new_snow_24h ?? 0) >= 8);
    if (showFavoritesOnly) list = list.filter((r) => isFavorite(r.id));

    if (sort === "popular") {
      // Curated list first (in configured order), then the rest sorted
      // by "best" (condition rank → 24h snow desc → name) as a tiebreaker.
      list = [...list].sort((a, b) => {
        const aPop = POPULAR_RANK[a.slug];
        const bPop = POPULAR_RANK[b.slug];
        if (aPop != null && bPop != null) return aPop - bPop;
        if (aPop != null) return -1;
        if (bPop != null) return 1;
        const condDiff =
          (CONDITION_ORDER[a.cond_rating] ?? 99) - (CONDITION_ORDER[b.cond_rating] ?? 99);
        if (condDiff !== 0) return condDiff;
        const aSnow = a.snow_report?.new_snow_24h ?? -1;
        const bSnow = b.snow_report?.new_snow_24h ?? -1;
        if (aSnow !== bSnow) return bSnow - aSnow;
        return a.name.localeCompare(b.name);
      });
    } else if (sort === "best") {
      // Condition rank first (great → poor, unknown last),
      // tiebreak by 24h fresh snow desc so powder rises inside each tier.
      list = [...list].sort((a, b) => {
        const condDiff =
          (CONDITION_ORDER[a.cond_rating] ?? 99) - (CONDITION_ORDER[b.cond_rating] ?? 99);
        if (condDiff !== 0) return condDiff;
        const aSnow = a.snow_report?.new_snow_24h ?? -1;
        const bSnow = b.snow_report?.new_snow_24h ?? -1;
        if (aSnow !== bSnow) return bSnow - aSnow;
        return a.name.localeCompare(b.name);
      });
    } else if (sort === "snow") {
      list = [...list].sort(
        (a, b) => (b.snow_report?.base_depth ?? -1) - (a.snow_report?.base_depth ?? -1)
      );
    } else if (sort === "name") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [resorts, fuse, search, stateFilter, condFilter, hasLiveCams, freshSnow, showFavoritesOnly, isFavorite, sort]);

  const handleClearSearch = useCallback(() => setSearch(""), []);

  // Debounced search tracking
  const searchTrackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!search.trim()) return;
    if (searchTrackTimer.current) clearTimeout(searchTrackTimer.current);
    searchTrackTimer.current = setTimeout(() => {
      trackSearch(search.trim(), filtered.length);
    }, 1000);
    return () => {
      if (searchTrackTimer.current) clearTimeout(searchTrackTimer.current);
    };
  }, [search, filtered.length]);

  // Filter tracking
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (stateFilter !== "All") trackFilter("state", stateFilter);
  }, [stateFilter]);

  useEffect(() => {
    if (condFilter !== "all") trackFilter("condition", condFilter);
  }, [condFilter]);

  useEffect(() => {
    if (freshSnow) trackFilter("fresh_snow", "true");
  }, [freshSnow]);

  useEffect(() => {
    if (hasLiveCams) trackFilter("live_cams", "true");
  }, [hasLiveCams]);

  return (
    <div id="conditions" className="min-h-screen pc-paper">
      <Header showSearch={false} />

      {/* ── Sticky paper search + filter bar ─────────────────── */}
      <div className="sticky top-0 z-30 border-b-[1.5px] border-ink bg-cream/95 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-4 py-5 md:px-8">
          {/* Top row: search input (pc-input style) */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1 relative">
              <Search
                className="absolute left-5 top-1/2 -translate-y-1/2 text-bark pointer-events-none"
                size={18}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search 128 resorts…"
                className="w-full pl-12 pr-10 py-3 bg-snow text-ink placeholder:text-bark
                           border-[1.5px] border-ink rounded-full shadow-stamp
                           focus:shadow-[4px_4px_0_#a93f20] focus:border-alpen-dk
                           outline-none transition-shadow duration-100 font-medium"
              />
              {search && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-bark hover:text-ink transition-colors"
                  aria-label="Clear search"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Filter chips row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* State dropdown */}
            <button
              onClick={() => setShowStates(v => !v)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 min-h-[40px] text-[13px] font-semibold border-[1.5px] cursor-pointer select-none transition-colors duration-150 whitespace-nowrap ${
                stateFilter !== "All"
                  ? "bg-ink border-ink text-cream-50"
                  : "bg-cream-50 border-bark text-ink hover:border-ink hover:bg-cream"
              }`}
            >
              <MapPin size={14} />
              {stateFilter === "All" ? "All States" : `${stateFilter} — ${STATE_NAMES[stateFilter] ?? stateFilter}`}
              <ChevronDown size={14} className={`transition-transform ${showStates ? "rotate-180" : ""}`} />
            </button>

            <span className="w-px h-5 bg-bark/40 mx-1 hidden sm:block" />

            {/* Feature filters */}
            <FilterChip label="Fresh Snow" active={freshSnow} onClick={() => setFreshSnow((v) => !v)} />
            <FilterChip label="Live Cams" active={hasLiveCams} onClick={() => setHasLiveCams((v) => !v)} />
            {user && (
              <FilterChip label="My Favorites" active={showFavoritesOnly} onClick={() => setShowFavoritesOnly((v) => !v)} />
            )}

            <span className="w-px h-5 bg-bark/40 mx-1 hidden sm:block" />

            {/* Condition filters */}
            {(["all", "great", "good", "fair", "poor"] as ConditionFilter[]).map((c) => (
              <FilterChip
                key={c}
                label={c === "all" ? "Any Condition" : c.charAt(0).toUpperCase() + c.slice(1)}
                active={condFilter === c}
                onClick={() => setCondFilter(condFilter === c ? "all" : c)}
              />
            ))}

            {/* Sort + Map toggle */}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setShowMap((v) => !v)}
                className="hidden md:flex items-center gap-2 text-ink text-[13px] font-semibold
                           bg-cream-50 border-[1.5px] border-ink rounded-full px-3.5 py-2 shadow-stamp-sm
                           hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]
                           transition-[transform,box-shadow] duration-100 mr-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 13l4.553 2.276A1 1 0 0021 21.382V10.618a1 1 0 00-1.447-.894L15 12m0 8V12m0 0L9 7" />
                </svg>
                {showMap ? "Hide map" : "Show map"}
              </button>
              <SlidersHorizontal size={14} className="text-bark" />
              <span className="font-mono text-[11px] text-bark uppercase tracking-[0.14em] hidden sm:block">Sort:</span>
              {(["popular", "best", "snow", "name"] as SortOption[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSort(opt)}
                  className={`text-[12px] font-semibold px-3 py-1 rounded-full border-[1.5px] transition-colors duration-150 ${
                    sort === opt
                      ? "bg-ink border-ink text-cream-50"
                      : "border-bark text-ink hover:border-ink hover:bg-cream-50"
                  }`}
                >
                  {SORT_LABEL[opt]}
                </button>
              ))}
            </div>
          </div>
          {showStates && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t-[1.5px] border-dashed border-bark">
              <FilterChip label="All" active={stateFilter === "All"} onClick={() => { setStateFilter("All"); setShowStates(false); }} />
              {availableStates.map((s) => (
                <FilterChip key={s} label={s} active={stateFilter === s}
                  onClick={() => { setStateFilter(stateFilter === s ? "All" : s); setShowStates(false); }}
                  title={STATE_NAMES[s] ?? s} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto px-4 py-8 md:px-8">
        <FeaturedRow resorts={resorts} />
        <PowderAlert resorts={resorts} />

        {/* Powder alert signup banner — forest card */}
        <div className="flex items-center justify-between gap-4 px-6 py-5 bg-forest text-cream-50
                        border-[1.5px] border-ink rounded-[18px] shadow-stamp mb-8">
          <div>
            <p className="font-display font-black text-lg leading-tight">
              Never miss a <em className="text-mustard italic">pow day</em>.
            </p>
            <p className="text-cream-50/80 text-sm mt-1">Email alerts when your resorts hit your snow threshold.</p>
          </div>
          <PowderAlertSignup resorts={resorts} />
        </div>

        {/* Section header */}
        <div className="flex items-end justify-between gap-4 mb-8 flex-wrap">
          <div>
            <div className="pc-eyebrow mb-1" style={{ color: "var(--pc-bark)" }}>
              Real-time · {filtered.length} of {resorts.length}
            </div>
            <h2 className="font-display font-black text-5xl md:text-6xl text-ink leading-[0.95] tracking-[-0.02em]">
              Today&apos;s <em className="text-alpen italic font-bold">conditions</em>.
            </h2>
          </div>
        </div>

        <div className={`grid gap-6 ${showMap ? "lg:grid-cols-[1fr_380px]" : ""}`}>
          {/* Resort grid */}
          <div>
            {filtered.length === 0 ? (
              <div className="text-center py-20 text-bark">
                <p className="font-display font-black text-2xl text-ink">No resorts found.</p>
                <p className="text-sm mt-1 text-bark">Try a different search or clear your filters.</p>
                <button
                  onClick={() => { setSearch(""); setStateFilter("All"); setCondFilter("all"); setHasLiveCams(false); setFreshSnow(false); }}
                  className="mt-4 inline-flex items-center gap-2 font-semibold text-[13px]
                             bg-ink text-cream-50 border-[1.5px] border-ink rounded-full px-4 py-2
                             shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]
                             transition-[transform,box-shadow] duration-100"
                >
                  Clear all filters →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filtered.map((resort) => (
                  <div
                    key={resort.id}
                    onMouseEnter={() => setHoveredSlug(resort.slug)}
                    onMouseLeave={() => setHoveredSlug(null)}
                  >
                    <SummitResortCard
                      resort={resort}
                      favorited={isFavorite(resort.id)}
                      onToggleFavorite={user ? () => toggleFav(resort.id) : () => setShowAuthModal(true)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Map sidebar */}
          {showMap && (
            <div className="hidden lg:block sticky top-20 h-[calc(100vh-6rem)] rounded-[18px] overflow-hidden border-[1.5px] border-ink shadow-stamp">
              <MapView
                resorts={filtered}
                hoveredSlug={hoveredSlug}
                onResortHover={setHoveredSlug}
                onResortClick={(slug) => { window.location.href = `/resorts/${slug}`; }}
                variant="sidebar"
              />
            </div>
          )}
        </div>
      </div>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </div>
  );
}
