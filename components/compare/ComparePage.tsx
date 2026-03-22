"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Fuse from "fuse.js";
import { X, Plus, Share2, Camera, ArrowLeft } from "lucide-react";
import { Header } from "@/components/layout/Header";
import type { ResortWithData, ConditionRating } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RESORTS = 4;

const conditionColors: Record<ConditionRating, string> = {
  great: "#2ECC8F",
  good: "#60C8FF",
  fair: "#8AA3BE",
  poor: "#f87171",
};

const CONDITION_ORDER: Record<ConditionRating, number> = {
  great: 0,
  good: 1,
  fair: 2,
  poor: 3,
};

const FUSE_OPTIONS = {
  keys: [
    { name: "name", weight: 0.6 },
    { name: "region", weight: 0.3 },
    { name: "state", weight: 0.1 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if `value` is the highest among `allValues` (with 2+ valid entries). */
function isBestHigh(value: number | null, allValues: (number | null)[]): boolean {
  if (value === null) return false;
  const valid = allValues.filter((v): v is number => v !== null);
  if (valid.length < 2) return false;
  return value === Math.max(...valid);
}

/** Returns true if `value` is the lowest (best rank) among `allValues`. */
function isBestLow(value: number | null, allValues: (number | null)[]): boolean {
  if (value === null) return false;
  const valid = allValues.filter((v): v is number => v !== null);
  if (valid.length < 2) return false;
  return value === Math.min(...valid);
}

function getFirstYoutubeCam(resort: ResortWithData) {
  return resort.cams.find((c) => c.embed_type === "youtube" && c.youtube_id) ?? null;
}

// ── Resort picker ─────────────────────────────────────────────────────────────

function ResortPicker({
  allResorts,
  selectedSlugs,
  onAdd,
}: {
  allResorts: ResortWithData[];
  selectedSlugs: string[];
  onAdd: (resort: ResortWithData) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const available = useMemo(
    () => allResorts.filter((r) => !selectedSlugs.includes(r.slug)),
    [allResorts, selectedSlugs]
  );

  const fuse = useMemo(() => new Fuse(available, FUSE_OPTIONS), [available]);

  const results = useMemo(() => {
    if (!query.trim()) return available.slice(0, 8);
    return fuse
      .search(query.trim())
      .map((r) => r.item)
      .slice(0, 8);
  }, [query, fuse, available]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full max-w-xs">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Add a resort..."
          className="w-full pl-4 pr-9 py-2.5 bg-surface2 border border-border focus:border-cyan/50 rounded-lg text-text-base placeholder:text-text-muted outline-none text-sm transition-colors"
        />
        <Plus
          size={15}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface2 border border-border rounded-lg shadow-card-hover z-50 max-h-60 overflow-y-auto">
          {results.map((resort) => (
            <button
              key={resort.slug}
              onClick={() => {
                onAdd(resort);
                setQuery("");
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2.5 hover:bg-surface3 transition-colors flex items-center justify-between gap-2"
            >
              <div>
                <span className="text-text-base text-sm font-medium">{resort.name}</span>
                <span className="text-text-muted text-xs ml-2">{resort.state}</span>
              </div>
              {resort.snow_report?.base_depth != null && (
                <span className="text-cyan text-xs font-mono shrink-0">
                  {resort.snow_report.base_depth}&quot;
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Column header (resort name + webcam thumbnail) ────────────────────────────

function ResortColumnHeader({
  resort,
  onRemove,
}: {
  resort: ResortWithData;
  onRemove: () => void;
}) {
  const condColor = resort.cond_rating ? conditionColors[resort.cond_rating] : null;
  const cam = getFirstYoutubeCam(resort);
  const activeCamCount = resort.cams.filter((c) => c.is_active).length;

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Webcam thumbnail */}
      <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-surface2 border border-border">
        {cam?.youtube_id ? (
          <Link href={`/resorts/${resort.slug}`} tabIndex={-1}>
            <img
              src={`https://img.youtube.com/vi/${cam.youtube_id}/mqdefault.jpg`}
              alt={`${resort.name} webcam`}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-bg/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
              <Camera size={20} className="text-text-base" />
            </div>
          </Link>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-text-muted">
            <Camera size={18} />
            <span className="text-xs">
              {activeCamCount} cam{activeCamCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Resort info + remove button */}
      <div>
        <div className="flex items-start justify-between gap-1">
          <Link href={`/resorts/${resort.slug}`} className="hover:text-cyan transition-colors flex-1 min-w-0">
            <h3 className="font-semibold text-text-base text-sm leading-snug">{resort.name}</h3>
          </Link>
          <button
            onClick={onRemove}
            className="shrink-0 text-text-muted hover:text-text-base transition-colors mt-0.5 p-0.5"
            aria-label={`Remove ${resort.name} from comparison`}
          >
            <X size={13} />
          </button>
        </div>
        <p className="text-text-muted text-xs mt-0.5">
          {resort.region}, {resort.state}
        </p>
        {condColor && (
          <div
            className="inline-flex mt-2 px-2 py-0.5 rounded text-xs font-semibold"
            style={{
              backgroundColor: `${condColor}20`,
              color: condColor,
              border: `1px solid ${condColor}40`,
            }}
          >
            {resort.cond_rating.toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat cell ─────────────────────────────────────────────────────────────────

function StatCell({ value, isBest }: { value: string; isBest: boolean }) {
  return (
    <div
      className={`px-4 py-4 text-center h-full flex items-center justify-center transition-colors ${
        isBest ? "bg-cyan/5" : ""
      }`}
    >
      <span
        className={`font-mono text-xl font-semibold tabular-nums ${
          isBest ? "text-cyan" : "text-text-base"
        }`}
      >
        {value}
        {isBest && (
          <span className="ml-1.5 text-[10px] font-sans font-normal text-cyan/70 align-middle">
            ▲
          </span>
        )}
      </span>
    </div>
  );
}

// ── Main ComparePage ──────────────────────────────────────────────────────────

interface Props {
  allResorts: ResortWithData[];
  initialResorts: ResortWithData[];
}

export function ComparePage({ allResorts, initialResorts }: Props) {
  const router = useRouter();
  const [resorts, setResorts] = useState<ResortWithData[]>(initialResorts);
  const [copied, setCopied] = useState(false);
  const isFirstRender = useRef(true);

  // Sync URL when resorts change (skip on initial mount to avoid replacing server URL)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const slugs = resorts.map((r) => r.slug).join(",");
    const url = slugs ? `/compare?resorts=${slugs}` : "/compare";
    router.replace(url, { scroll: false });
  }, [resorts, router]);

  function addResort(resort: ResortWithData) {
    if (resorts.length >= MAX_RESORTS) return;
    setResorts((prev) => [...prev, resort]);
  }

  function removeResort(slug: string) {
    setResorts((prev) => prev.filter((r) => r.slug !== slug));
  }

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available — silent fail
    }
  }

  // Pre-compute arrays for "best" highlighting
  const baseDepths = resorts.map((r) => r.snow_report?.base_depth ?? null);
  const snow24hVals = resorts.map((r) => r.snow_report?.new_snow_24h ?? null);
  const snow48hVals = resorts.map((r) => r.snow_report?.new_snow_48h ?? null);
  const trailsRatios = resorts.map((r) => {
    const o = r.snow_report?.trails_open;
    const t = r.snow_report?.trails_total;
    return o != null && t != null && t > 0 ? o / t : null;
  });
  const liftsRatios = resorts.map((r) => {
    const o = r.snow_report?.lifts_open;
    const t = r.snow_report?.lifts_total;
    return o != null && t != null && t > 0 ? o / t : null;
  });
  const condRanks = resorts.map((r) =>
    r.cond_rating != null ? CONDITION_ORDER[r.cond_rating] : null
  );

  type StatRow = {
    label: string;
    values: { display: string; isBest: boolean }[];
  };

  const statRows: StatRow[] = [
    {
      label: "BASE DEPTH",
      values: resorts.map((r, i) => ({
        display: r.snow_report?.base_depth != null ? `${r.snow_report.base_depth}"` : "—",
        isBest: isBestHigh(baseDepths[i], baseDepths),
      })),
    },
    {
      label: "24H SNOW",
      values: resorts.map((r, i) => ({
        display: r.snow_report?.new_snow_24h != null ? `${r.snow_report.new_snow_24h}"` : "—",
        isBest: isBestHigh(snow24hVals[i], snow24hVals),
      })),
    },
    {
      label: "48H SNOW",
      values: resorts.map((r, i) => ({
        display: r.snow_report?.new_snow_48h != null ? `${r.snow_report.new_snow_48h}"` : "—",
        isBest: isBestHigh(snow48hVals[i], snow48hVals),
      })),
    },
    {
      label: "TRAILS OPEN",
      values: resorts.map((r, i) => {
        const o = r.snow_report?.trails_open;
        const t = r.snow_report?.trails_total;
        return {
          display: o != null && t != null ? `${o}/${t}` : "—",
          isBest: isBestHigh(trailsRatios[i], trailsRatios),
        };
      }),
    },
    {
      label: "LIFTS OPEN",
      values: resorts.map((r, i) => {
        const o = r.snow_report?.lifts_open;
        const t = r.snow_report?.lifts_total;
        return {
          display: o != null && t != null ? `${o}/${t}` : "—",
          isBest: isBestHigh(liftsRatios[i], liftsRatios),
        };
      }),
    },
    {
      label: "CONDITIONS",
      values: resorts.map((r, i) => ({
        display: r.snow_report?.conditions ?? r.cond_rating?.toUpperCase() ?? "—",
        isBest: isBestLow(condRanks[i], condRanks),
      })),
    },
    {
      label: "WEBCAMS",
      values: resorts.map((r) => ({
        display: `${r.cams.filter((c) => c.is_active).length}`,
        isBest: false,
      })),
    },
  ];

  return (
    <div className="min-h-screen bg-bg">
      <Header showSearch={false} />

      <div className="max-w-screen-xl mx-auto px-4 py-8 md:px-8">
        {/* Page header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-subtle text-sm mb-5 transition-colors"
          >
            <ArrowLeft size={14} />
            Back to Resorts
          </Link>
          <h1 className="font-display text-5xl md:text-6xl text-text-base tracking-wide mb-2">
            COMPARE RESORTS
          </h1>
          <p className="text-text-subtle">
            Side-by-side snow conditions — up to {MAX_RESORTS} resorts
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap mb-8">
          {resorts.length < MAX_RESORTS && (
            <ResortPicker
              allResorts={allResorts}
              selectedSlugs={resorts.map((r) => r.slug)}
              onAdd={addResort}
            />
          )}

          {resorts.length > 0 && (
            <>
              <button
                onClick={handleShare}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-surface2 border border-border hover:border-cyan/50 rounded-lg text-text-subtle hover:text-text-base text-sm transition-colors"
              >
                <Share2 size={14} />
                {copied ? "Copied!" : "Share"}
              </button>
              <button
                onClick={() => setResorts([])}
                className="text-text-muted hover:text-text-base text-sm transition-colors"
              >
                Clear all
              </button>
            </>
          )}
        </div>

        {/* Empty state */}
        {resorts.length === 0 && (
          <div className="text-center py-24 border border-dashed border-border rounded-xl">
            <div className="text-5xl mb-4">⛷</div>
            <h2 className="text-text-base font-semibold text-xl mb-2">No resorts selected</h2>
            <p className="text-text-muted text-sm mb-6">
              Search above to add resorts, or use the Compare button on any{" "}
              <Link href="/" className="text-cyan hover:underline">
                resort card
              </Link>
              .
            </p>
          </div>
        )}

        {/* Single resort prompt */}
        {resorts.length === 1 && (
          <p className="text-text-muted text-sm mb-6 text-center">
            Add at least one more resort to start comparing.
          </p>
        )}

        {/* Comparison grid */}
        {resorts.length > 0 && (
          <div className="overflow-x-auto -mx-4 px-4 pb-4">
            <div
              className="min-w-fit rounded-xl border border-border overflow-hidden"
              style={{
                display: "grid",
                gridTemplateColumns: `140px repeat(${resorts.length}, minmax(180px, 1fr))`,
              }}
            >
              {/* Header row */}
              <div className="bg-surface2 border-b border-r border-border" />
              {resorts.map((resort, i) => (
                <div
                  key={resort.slug}
                  className={`bg-surface2 border-b border-border ${
                    i < resorts.length - 1 ? "border-r" : ""
                  }`}
                >
                  <ResortColumnHeader resort={resort} onRemove={() => removeResort(resort.slug)} />
                </div>
              ))}

              {/* Stat rows */}
              {statRows.map((row, rowIdx) => {
                const isLast = rowIdx === statRows.length - 1;
                return (
                  <React.Fragment key={row.label}>
                    {/* Label cell */}
                    <div
                      className={`bg-surface sticky left-0 z-10 flex items-center px-4 py-4 border-r border-border ${
                        isLast ? "" : "border-b"
                      }`}
                    >
                      <span className="text-text-muted text-[11px] font-semibold tracking-wider uppercase">
                        {row.label}
                      </span>
                    </div>

                    {/* Value cells */}
                    {row.values.map((cell, resortIdx) => (
                      <div
                        key={`${row.label}-${resorts[resortIdx].slug}`}
                        className={`bg-surface border-border ${
                          resortIdx < resorts.length - 1 ? "border-r" : ""
                        } ${isLast ? "" : "border-b"}`}
                      >
                        <StatCell value={cell.display} isBest={cell.isBest} />
                      </div>
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
