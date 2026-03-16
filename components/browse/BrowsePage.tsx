"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Header } from "@/components/layout/Header";
import type { ResortWithData } from "@/lib/types";
import { ConditionBadge, StateBadge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";

// Leaflet map — dynamic import, no SSR
const ResortMap = dynamic(() => import("@/components/browse/ResortMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-surface animate-pulse rounded-xl flex items-center justify-center">
      <span className="text-text-muted text-sm">Loading map…</span>
    </div>
  ),
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  resorts: ResortWithData[];
}

type StateFilter = string;
type ConditionFilter = "all" | "great" | "good" | "fair" | "poor";
type SortOption = "name" | "snow" | "conditions";

// ─── Constants ───────────────────────────────────────────────────────────────

const CONDITION_ORDER: Record<string, number> = {
  great: 0, good: 1, fair: 2, poor: 3,
};

// ─── Resort card ─────────────────────────────────────────────────────────────

function ResortCard({ resort }: { resort: ResortWithData }) {
  const snow = resort.snow_report;
  const camCount = resort.cams.filter((c) => c.is_active).length;
  const baseDepth = snow?.base_depth ?? null;

  return (
    <Link
      href={`/resorts/${resort.slug}`}
      className="group block bg-surface border border-border rounded-xl overflow-hidden
                 hover:border-border-hi hover:shadow-glow transition-all duration-220
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
    >
      {/* Snow depth bar */}
      <div className="h-1 w-full bg-surface2">
        {baseDepth != null && (
          <div
            className="h-full bg-gradient-to-r from-cyan to-powder transition-all duration-300"
            style={{ width: `${Math.min((baseDepth / 120) * 100, 100)}%` }}
          />
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-text-base font-semibold text-[15px] leading-tight group-hover:text-cyan transition-colors duration-150">
            {resort.name}
          </h2>
          <StateBadge>{resort.state}</StateBadge>
        </div>

        <p className="text-text-muted text-xs mb-3">{resort.region}</p>

        {snow ? (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-surface2 rounded-lg p-2 text-center">
              <div className="text-powder font-bold text-lg leading-none">{snow.base_depth ?? "—"}</div>
              <div className="text-text-muted text-[10px] mt-0.5">base″</div>
            </div>
            <div className="bg-surface2 rounded-lg p-2 text-center">
              <div className="text-cyan font-bold text-lg leading-none">{snow.new_snow_24h ?? "—"}</div>
              <div className="text-text-muted text-[10px] mt-0.5">24h″</div>
            </div>
            <div className="bg-surface2 rounded-lg p-2 text-center">
              <div className="text-text-base font-bold text-lg leading-none">
                {snow.trails_open != null && snow.trails_total != null
                  ? `${snow.trails_open}/${snow.trails_total}` : "—"}
              </div>
              <div className="text-text-muted text-[10px] mt-0.5">runs</div>
            </div>
          </div>
        ) : (
          <div className="bg-surface2 rounded-lg p-2 mb-3 text-center text-text-muted text-xs">
            No snow data yet
          </div>
        )}

        <div className="flex items-center justify-between">
          {resort.cond_rating ? (
            <ConditionBadge
              rating={resort.cond_rating}
              label={resort.cond_rating.charAt(0).toUpperCase() + resort.cond_rating.slice(1)}
            />
          ) : (
            <span className="text-text-muted text-xs">—</span>
          )}
          <span className="text-text-muted text-xs flex items-center gap-1">
            <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 10l4.553-2.069A1 1 0 0121 8.82V18a1 1 0 01-1.447.894L15 17M3 8h12v10H3a1 1 0 01-1-1V9a1 1 0 011-1z" />
            </svg>
            {camCount} cam{camCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
    </Link>
  );
}

// ─── Powder Alert banner ──────────────────────────────────────────────────────

function PowderAlert({ resorts }: { resorts: ResortWithData[] }) {
  const alerts = resorts
    .filter((r) => (r.snow_report?.new_snow_24h ?? 0) >= 6)
    .sort((a, b) => (b.snow_report?.new_snow_24h ?? 0) - (a.snow_report?.new_snow_24h ?? 0))
    .slice(0, 4);

  if (alerts.length === 0) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-cyan/10 border border-cyan/30 rounded-xl mb-6">
      <span className="text-lg shrink-0">🌨️</span>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-cyan font-semibold text-sm">Powder Alert</span>
        {alerts.map((r) => (
          <Link key={r.slug} href={`/resorts/${r.slug}`}
            className="text-text-subtle text-sm hover:text-cyan transition-colors">
            {r.name}{" "}
            <span className="text-powder font-medium">+{r.snow_report!.new_snow_24h}″</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Main BrowsePage ─────────────────────────────────────────────────────────

export function BrowsePage({ resorts }: Props) {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("All");
  const [condFilter, setCondFilter] = useState<ConditionFilter>("all");
  const [sort, setSort] = useState<SortOption>("name");
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);

  const availableStates = useMemo(() => {
    return [...new Set(resorts.map((r) => r.state))].sort();
  }, [resorts]);

  const filtered = useMemo(() => {
    let list = resorts;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.region.toLowerCase().includes(q) ||
          r.state.toLowerCase().includes(q)
      );
    }

    if (stateFilter !== "All") list = list.filter((r) => r.state === stateFilter);
    if (condFilter !== "all") list = list.filter((r) => r.cond_rating === condFilter);

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
  }, [resorts, search, stateFilter, condFilter, sort]);

  const handleClearSearch = useCallback(() => setSearch(""), []);

  return (
    <div className="min-h-screen bg-bg">
      <Header />

      {/* ── Page header ──────────────────────────────────────── */}
      <div className="border-b border-border px-4 py-5 md:px-8">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex items-end justify-between mb-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-text-base tracking-tight">
                Browse Resorts
              </h1>
              <p className="text-text-muted text-sm mt-0.5">
                {filtered.length} of {resorts.length} resorts
              </p>
            </div>
            <button
              onClick={() => setShowMap((v) => !v)}
              className="hidden md:flex items-center gap-2 text-text-muted hover:text-text-base text-sm
                         border border-border rounded-lg px-3 py-1.5 transition-colors duration-150"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 13l4.553 2.276A1 1 0 0021 21.382V10.618a1 1 0 00-1.447-.894L15 12m0 8V12m0 0L9 7" />
              </svg>
              {showMap ? "Hide map" : "Show map"}
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none"
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-4.35-4.35M17 11A6 6 0 105 11a6 6 0 0012 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by resort, region, or state…"
              className="w-full bg-surface border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm
                         text-text-base placeholder:text-text-muted
                         focus:outline-none focus:border-cyan focus:ring-1 focus:ring-cyan/30
                         transition-colors duration-150"
            />
            {search && (
              <button onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-base transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* State chips + sort */}
          <div className="flex items-center gap-2 flex-wrap">
            <Chip label="All" active={stateFilter === "All"} onClick={() => setStateFilter("All")} />
            {availableStates.map((s) => (
              <Chip key={s} label={s} active={stateFilter === s}
                onClick={() => setStateFilter(stateFilter === s ? "All" : s)} />
            ))}

            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-text-muted text-xs hidden sm:block">Sort:</span>
              {(["name", "snow", "conditions"] as SortOption[]).map((opt) => (
                <button key={opt} onClick={() => setSort(opt)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors duration-150 ${
                    sort === opt
                      ? "bg-cyan/10 border-cyan/40 text-cyan"
                      : "border-border text-text-muted hover:text-text-base"
                  }`}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto px-4 py-6 md:px-8">
        <PowderAlert resorts={resorts} />

        <div className={`grid gap-6 ${showMap ? "lg:grid-cols-[1fr_380px]" : ""}`}>
          {/* Resort grid */}
          <div>
            {filtered.length === 0 ? (
              <div className="text-center py-20 text-text-muted">
                <div className="text-4xl mb-3">⛷️</div>
                <p className="text-lg font-medium text-text-subtle">No resorts found</p>
                <p className="text-sm mt-1">Try a different search or clear your filters.</p>
                <button
                  onClick={() => { setSearch(""); setStateFilter("All"); setCondFilter("all"); }}
                  className="mt-4 text-cyan text-sm hover:underline">
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                {filtered.map((resort) => (
                  <div key={resort.id}
                    onMouseEnter={() => setHoveredSlug(resort.slug)}
                    onMouseLeave={() => setHoveredSlug(null)}>
                    <ResortCard resort={resort} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Map sidebar */}
          {showMap && (
            <div className="hidden lg:block sticky top-20 h-[calc(100vh-6rem)] rounded-xl overflow-hidden border border-border">
              <ResortMap
                resorts={filtered}
                hoveredSlug={hoveredSlug}
                onResortHover={setHoveredSlug}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
