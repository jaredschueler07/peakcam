"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { ConditionBadge } from "@/components/ui/Badge";
import type { ResortWithData } from "@/lib/types";

type SortKey = "name" | "base" | "24h" | "48h" | "trails" | "lifts" | "conditions" | "pctNormal" | "trend";
type SortDir = "asc" | "desc";

export function SnowReportPage({ resorts }: { resorts: ResortWithData[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("base");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [stateFilter, setStateFilter] = useState("All");

  const states = useMemo(() => [...new Set(resorts.map((r) => r.state))].sort(), [resorts]);
  const hasPctNormal = useMemo(() => resorts.some(r => r.snow_report?.pct_of_normal != null), [resorts]);
  const hasTrend = useMemo(() => resorts.some(r => r.snow_report?.trend_7d != null), [resorts]);
  const hasTrails = useMemo(() => resorts.some(r => r.snow_report?.trails_open != null), [resorts]);
  const hasLifts = useMemo(() => resorts.some(r => r.snow_report?.lifts_open != null), [resorts]);

  const CONDITION_ORDER: Record<string, number> = {
    great: 0, good: 1, fair: 2, poor: 3,
  };

  const sorted = useMemo(() => {
    let list = resorts.filter((r) => r.snow_report);
    if (stateFilter !== "All") list = list.filter((r) => r.state === stateFilter);

    return [...list].sort((a, b) => {
      const sa = a.snow_report!;
      const sb = b.snow_report!;
      let diff = 0;

      switch (sortKey) {
        case "name": diff = a.name.localeCompare(b.name); break;
        case "base": diff = (sa.base_depth ?? -1) - (sb.base_depth ?? -1); break;
        case "24h": diff = (sa.new_snow_24h ?? -1) - (sb.new_snow_24h ?? -1); break;
        case "48h": diff = (sa.new_snow_48h ?? -1) - (sb.new_snow_48h ?? -1); break;
        case "trails": diff = (sa.trails_open ?? -1) - (sb.trails_open ?? -1); break;
        case "lifts": diff = (sa.lifts_open ?? -1) - (sb.lifts_open ?? -1); break;
        case "pctNormal": diff = (sa.pct_of_normal ?? -1) - (sb.pct_of_normal ?? -1); break;
        case "trend": {
          const tOrd: Record<string, number> = { rising: 2, stable: 1, falling: 0 };
          diff = (tOrd[sa.trend_7d ?? ""] ?? -1) - (tOrd[sb.trend_7d ?? ""] ?? -1); break;
        }
        case "conditions": diff = (CONDITION_ORDER[a.cond_rating] ?? 99) - (CONDITION_ORDER[b.cond_rating] ?? 99); break;
      }

      return sortDir === "desc" ? -diff : diff;
    });
  }, [resorts, sortKey, sortDir, stateFilter]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    const active = sortKey === field;
    return (
      <button
        onClick={() => handleSort(field)}
        className={`flex items-center gap-1 text-xs uppercase tracking-wider font-semibold transition-colors
          ${active ? "text-cyan" : "text-text-muted hover:text-text-subtle"}`}
      >
        {label}
        {active && (
          <span className="text-[10px]">{sortDir === "desc" ? "▼" : "▲"}</span>
        )}
      </button>
    );
  }

  const resortsWithoutData = resorts.filter((r) => !r.snow_report).length;

  return (
    <div className="min-h-screen bg-bg">
      <Header />

      <div className="max-w-screen-2xl mx-auto px-4 py-6 md:px-8">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-heading font-bold text-text-base uppercase tracking-wider">
              Snow Report
            </h1>
            <p className="text-text-muted text-sm mt-0.5">
              {sorted.length} resorts with snow data
              {resortsWithoutData > 0 && ` · ${resortsWithoutData} awaiting data`}
            </p>
          </div>
          <Link href="/" className="text-text-muted hover:text-cyan text-sm transition-colors">
            ← Browse
          </Link>
        </div>

        {/* State filter */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <button
            onClick={() => setStateFilter("All")}
            className={`text-xs px-2.5 py-1 rounded-lg border transition-colors duration-150 ${
              stateFilter === "All"
                ? "bg-cyan/10 border-cyan/40 text-cyan"
                : "border-border text-text-muted hover:text-text-base"
            }`}
          >
            All States
          </button>
          {states.map((s) => (
            <button
              key={s}
              onClick={() => setStateFilter(stateFilter === s ? "All" : s)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors duration-150 ${
                stateFilter === s
                  ? "bg-cyan/10 border-cyan/40 text-cyan"
                  : "border-border text-text-muted hover:text-text-base"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface border-b border-border">
                <th className="text-left px-4 py-3"><SortHeader label="Resort" field="name" /></th>
                <th className="text-left px-3 py-3 hidden sm:table-cell"><span className="text-xs uppercase tracking-wider text-text-muted font-semibold">State</span></th>
                <th className="text-right px-3 py-3"><SortHeader label="Base" field="base" /></th>
                <th className="text-right px-3 py-3"><SortHeader label="24h" field="24h" /></th>
                <th className="text-right px-3 py-3 hidden md:table-cell"><SortHeader label="48h" field="48h" /></th>
                {hasTrails && <th className="text-right px-3 py-3 hidden md:table-cell"><SortHeader label="Trails" field="trails" /></th>}
                {hasLifts && <th className="text-right px-3 py-3 hidden lg:table-cell"><SortHeader label="Lifts" field="lifts" /></th>}
                {hasPctNormal && <th className="text-right px-3 py-3 hidden lg:table-cell"><SortHeader label="% Normal" field="pctNormal" /></th>}
                {hasTrend && <th className="text-center px-3 py-3 hidden lg:table-cell"><SortHeader label="Trend" field="trend" /></th>}
                <th className="text-center px-3 py-3"><SortHeader label="Conditions" field="conditions" /></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((resort, i) => {
                const snow = resort.snow_report!;
                return (
                  <tr
                    key={resort.id}
                    className={`border-b border-border/50 hover:bg-surface transition-colors
                      ${i % 2 === 0 ? "bg-bg" : "bg-surface/30"}`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/resorts/${resort.slug}`}
                        className="text-text-base font-medium hover:text-cyan transition-colors"
                      >
                        {resort.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-text-muted hidden sm:table-cell">{resort.state}</td>
                    <td className="px-3 py-3 text-right">
                      <span className="text-powder font-bold tabular-nums">
                        {snow.base_depth != null ? `${snow.base_depth}″` : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={`font-bold tabular-nums ${(snow.new_snow_24h ?? 0) >= 8 ? "text-cyan" : "text-text-subtle"}`}>
                        {snow.new_snow_24h != null ? `${snow.new_snow_24h}″` : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right hidden md:table-cell">
                      <span className="text-text-subtle tabular-nums">
                        {snow.new_snow_48h != null ? `${snow.new_snow_48h}″` : "—"}
                      </span>
                    </td>
                    {hasTrails && (
                    <td className="px-3 py-3 text-right hidden md:table-cell">
                      <span className="text-text-base tabular-nums">
                        {snow.trails_open != null && snow.trails_total != null
                          ? `${snow.trails_open}/${snow.trails_total}` : "—"}
                      </span>
                    </td>
                    )}
                    {hasLifts && (
                    <td className="px-3 py-3 text-right hidden lg:table-cell">
                      <span className="text-text-base tabular-nums">
                        {snow.lifts_open != null && snow.lifts_total != null
                          ? `${snow.lifts_open}/${snow.lifts_total}` : "—"}
                      </span>
                    </td>
                    )}
                    {hasPctNormal && (
                    <td className="px-3 py-3 text-right hidden lg:table-cell">
                      {snow.pct_of_normal != null ? (
                        <span className={`font-bold tabular-nums ${
                          snow.pct_of_normal >= 110 ? "text-[#2ECC8F]" :
                          snow.pct_of_normal >= 90 ? "text-text-base" :
                          snow.pct_of_normal >= 70 ? "text-yellow-400" : "text-red-400"
                        }`}>
                          {snow.pct_of_normal}%
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    )}
                    {hasTrend && (
                    <td className="px-3 py-3 text-center hidden lg:table-cell">
                      {snow.trend_7d ? (
                        <span className={`text-sm ${
                          snow.trend_7d === "rising" ? "text-[#2ECC8F]" :
                          snow.trend_7d === "falling" ? "text-red-400" : "text-text-subtle"
                        }`}>
                          {snow.trend_7d === "rising" ? "↑" : snow.trend_7d === "falling" ? "↓" : "→"}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    )}
                    <td className="px-3 py-3 text-center">
                      <ConditionBadge
                        rating={resort.cond_rating}
                        label={resort.cond_rating.charAt(0).toUpperCase() + resort.cond_rating.slice(1)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="text-center py-20 text-text-muted">
            <div className="text-4xl mb-3">❄️</div>
            <p className="text-lg font-medium text-text-subtle">No snow data available</p>
            <p className="text-sm mt-1">Snow reports will appear once data starts flowing in.</p>
          </div>
        )}
      </div>
    </div>
  );
}
