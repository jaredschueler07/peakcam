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
    <div className="h-full w-full bg-surface animate-pulse rounded-xl flex items-center justify-center">
      <span className="text-text-muted text-sm">Loading map...</span>
    </div>
  ),
});

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  resorts: ResortWithData[];
}

type StateFilter = string;
type ConditionFilter = "all" | "great" | "good" | "fair" | "poor";
type SortOption = "name" | "snow" | "conditions";

// ── Constants ────────────────────────────────────────────────────────────────

const CONDITION_ORDER: Record<string, number> = {
  great: 0, good: 1, fair: 2, poor: 3,
};

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
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium border cursor-pointer select-none transition-colors duration-200 whitespace-nowrap ${
        active
          ? "bg-cyan/20 border-cyan/50 text-cyan hover:bg-cyan/30"
          : "bg-text-base/10 border-text-base/20 text-text-subtle hover:bg-text-base/20"
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

  return (
    <div className="mb-10">
      <h2 className="font-display text-4xl md:text-5xl text-text-base mb-2 tracking-wide">
        TODAY&apos;S TOP CONDITIONS
      </h2>
      <p className="text-text-muted text-sm mb-4">Ranked by condition rating and recent snowfall</p>
      <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-hide">
        {featured.map((resort) => {
          const snow = resort.snow_report;
          const condColor =
            resort.cond_rating === "great" ? "#2ECC8F"
            : resort.cond_rating === "good" ? "#60C8FF"
            : resort.cond_rating === "fair" ? "#8AA3BE"
            : "#f87171";
          return (
            <Link
              key={resort.id}
              href={`/resorts/${resort.slug}`}
              className="group relative flex-shrink-0 w-72 bg-surface border border-border rounded-lg overflow-hidden
                         hover:border-cyan/50 hover:shadow-glow-ice transition-all duration-300
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {/* Alpenglow accent bar */}
              <div className="h-1 w-full bg-gradient-to-r from-alpenglow via-cyan to-alpenglow" />

              <div className="p-5">
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div>
                    <h3 className="text-text-base font-semibold text-lg leading-tight group-hover:text-cyan transition-colors duration-150">
                      {resort.name}
                    </h3>
                    <p className="text-text-muted text-xs mt-1">{resort.region}, {resort.state}</p>
                  </div>
                  <div
                    className="px-2.5 py-1 rounded text-xs font-semibold shrink-0"
                    style={{
                      backgroundColor: `${condColor}20`,
                      color: condColor,
                      border: `1px solid ${condColor}40`,
                    }}
                  >
                    {resort.cond_rating.toUpperCase()}
                  </div>
                </div>

                {snow && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-bg/50 rounded-lg p-2 text-center">
                      <div className="text-powder font-mono font-bold text-xl leading-none">{snow.base_depth ?? "\u2014"}</div>
                      <div className="text-text-muted text-[10px] mt-1">base&quot;</div>
                    </div>
                    <div className="bg-bg/50 rounded-lg p-2 text-center">
                      <div className="text-cyan font-mono font-bold text-xl leading-none">{snow.new_snow_24h ?? "\u2014"}</div>
                      <div className="text-text-muted text-[10px] mt-1">24h&quot;</div>
                    </div>
                    <div className="bg-bg/50 rounded-lg p-2 text-center">
                      <div className="text-text-base font-mono font-bold text-xl leading-none">
                        {snow.trails_open != null && snow.trails_total != null
                          ? `${snow.trails_open}/${snow.trails_total}` : "\u2014"}
                      </div>
                      <div className="text-text-muted text-[10px] mt-1">runs</div>
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
    <div className="flex items-center gap-3 px-5 py-3 bg-alpenglow/10 border border-alpenglow/30 rounded-lg mb-8">
      {/* Pulsing dot */}
      <span className="relative flex h-3 w-3 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-alpenglow opacity-75" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-alpenglow" />
      </span>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-alpenglow font-semibold text-sm">Powder Alert</span>
        {alerts.map((r) => (
          <Link
            key={r.slug}
            href={`/resorts/${r.slug}`}
            className="text-text-subtle text-sm hover:text-cyan transition-colors"
          >
            {r.name}{" "}
            <span className="text-powder font-medium">+{r.snow_report!.new_snow_24h}&quot;</span>
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
  const [sort, setSort] = useState<SortOption>("name");
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

    if (sort === "name") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === "snow") {
      list = [...list].sort(
        (a, b) => (b.snow_report?.base_depth ?? -1) - (a.snow_report?.base_depth ?? -1)
      );
    } else if (sort === "conditions") {
      list = [...list].sort(
        (a, b) =>
          (CONDITION_ORDER[a.cond_rating] ?? 99) - (CONDITION_ORDER[b.cond_rating] ?? 99)
      );
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
    <div id="conditions" className="min-h-screen bg-bg">
      <Header showSearch={false} />

      {/* ── Frosted glass search + filter bar ─────────────────── */}
      <div className="sticky top-0 z-30 border-b border-border backdrop-blur-md bg-surface/85">
        <div className="max-w-screen-2xl mx-auto px-4 py-5 md:px-8">
          {/* Top row: search + map toggle */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1 relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none"
                size={20}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search resorts..."
                className="w-full pl-12 pr-9 py-3 bg-bg/50 border border-border focus:border-cyan/50 rounded-lg text-text-base placeholder:text-text-muted outline-none transition-colors"
              />
              {search && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-base transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium border cursor-pointer select-none transition-colors duration-200 whitespace-nowrap ${
                stateFilter !== "All"
                  ? "bg-cyan/20 border-cyan/50 text-cyan"
                  : "bg-text-base/10 border-text-base/20 text-text-subtle hover:bg-text-base/20"
              }`}
            >
              <MapPin size={14} />
              {stateFilter === "All" ? "All States" : `${stateFilter} — ${STATE_NAMES[stateFilter] ?? stateFilter}`}
              <ChevronDown size={14} className={`transition-transform ${showStates ? "rotate-180" : ""}`} />
            </button>

            <span className="w-px h-5 bg-border mx-1 hidden sm:block" />

            {/* Feature filters */}
            <FilterChip label="Fresh Snow" active={freshSnow} onClick={() => setFreshSnow((v) => !v)} />
            <FilterChip label="Live Cams" active={hasLiveCams} onClick={() => setHasLiveCams((v) => !v)} />
            {user && (
              <FilterChip label="My Favorites" active={showFavoritesOnly} onClick={() => setShowFavoritesOnly((v) => !v)} />
            )}

            <span className="w-px h-5 bg-border mx-1 hidden sm:block" />

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
                className="hidden md:flex items-center gap-2 text-text-muted hover:text-text-base text-sm
                           border border-border rounded-lg px-3 py-2.5 transition-colors duration-150 mr-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 13l4.553 2.276A1 1 0 0021 21.382V10.618a1 1 0 00-1.447-.894L15 12m0 8V12m0 0L9 7" />
                </svg>
                {showMap ? "Hide map" : "Show map"}
              </button>
              <SlidersHorizontal size={14} className="text-text-muted" />
              <span className="text-text-muted text-xs hidden sm:block">Sort:</span>
              {(["name", "snow", "conditions"] as SortOption[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSort(opt)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors duration-200 ${
                    sort === opt
                      ? "bg-cyan/20 border-cyan/50 text-cyan"
                      : "border-border text-text-muted hover:text-text-base"
                  }`}
                >
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {showStates && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border">
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

        {/* Powder alert signup banner */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 bg-surface border border-border rounded-lg mb-8">
          <div>
            <p className="text-text-base font-semibold text-sm">Never miss a powder day</p>
            <p className="text-text-muted text-xs">Get email alerts when your resorts hit your snow threshold.</p>
          </div>
          <PowderAlertSignup resorts={resorts} />
        </div>

        {/* Section header */}
        <div className="flex items-end justify-between gap-4 mb-8 flex-wrap">
          <div>
            <h2 className="font-display text-5xl md:text-6xl text-text-base mb-2">
              TODAY&apos;S CONDITIONS
            </h2>
            <p className="text-text-subtle text-lg">
              Real-time snow reports from {filtered.length} of {resorts.length} resorts
            </p>
          </div>
        </div>

        <div className={`grid gap-6 ${showMap ? "lg:grid-cols-[1fr_380px]" : ""}`}>
          {/* Resort grid */}
          <div>
            {filtered.length === 0 ? (
              <div className="text-center py-20 text-text-muted">
                <p className="text-lg font-medium text-text-subtle">No resorts found</p>
                <p className="text-sm mt-1">Try a different search or clear your filters.</p>
                <button
                  onClick={() => { setSearch(""); setStateFilter("All"); setCondFilter("all"); setHasLiveCams(false); setFreshSnow(false); }}
                  className="mt-4 text-cyan text-sm hover:underline"
                >
                  Clear all filters
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
            <div className="hidden lg:block sticky top-20 h-[calc(100vh-6rem)] rounded-xl overflow-hidden border border-border">
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
