"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Fuse from "fuse.js";
import { X, Plus, Share2, Camera, ArrowLeft, AlertTriangle } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { MAX_COMPARE_RESORTS, buildCompareHref } from "@/lib/compare-params";
import type { ResortWithData, ConditionRating } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RESORTS = MAX_COMPARE_RESORTS;

// Poster condition palette (matches ConditionBadge)
const conditionChip: Record<ConditionRating, string> = {
  great: "bg-great text-cream-50 border-forest-dk",
  good:  "bg-good text-cream-50 border-forest-dk",
  fair:  "bg-fair text-ink border-bark-dk",
  poor:  "bg-poor text-cream-50 border-bark-dk",
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
  const max = Math.max(...valid);
  if (max === 0) return false;
  const countAtMax = valid.filter(v => v === max).length;
  if (countAtMax === valid.length) return false;
  return value === max;
}

/** Returns true if `value` is the lowest (best rank) among `allValues`. */
function isBestLow(value: number | null, allValues: (number | null)[]): boolean {
  if (value === null) return false;
  const valid = allValues.filter((v): v is number => v !== null);
  if (valid.length < 2) return false;
  const min = Math.min(...valid);
  const countAtMin = valid.filter(v => v === min).length;
  if (countAtMin === valid.length) return false;
  return value === min;
}

/** Cams are always an array from getAllResorts(), but never trust partial data. */
function camsOf(resort: ResortWithData) {
  return Array.isArray(resort?.cams) ? resort.cams : [];
}

function getFirstCamThumbnail(resort: ResortWithData) {
  const cams = camsOf(resort);
  const ytCam = cams.find((c) => c.embed_type === "youtube" && c.youtube_id);
  if (ytCam) return { type: "youtube" as const, url: `https://img.youtube.com/vi/${ytCam.youtube_id}/mqdefault.jpg` };
  const imgCam = cams.find((c) => c.embed_type === "image" && c.embed_url && c.is_active);
  if (imgCam) return { type: "image" as const, url: imgCam.embed_url! };
  return null;
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
          placeholder="Add a resort…"
          className="w-full pl-4 pr-9 py-2.5 bg-snow text-ink placeholder:text-bark
                     border-[1.5px] border-ink rounded-full shadow-stamp-sm
                     focus:shadow-[3px_3px_0_#a93f20] focus:border-alpen-dk
                     outline-none text-[16px] md:text-sm font-medium transition-shadow duration-100"
        />
        <Plus
          size={15}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-bark pointer-events-none"
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-cream-50 border-[1.5px] border-ink rounded-[14px] shadow-stamp z-50 max-h-60 overflow-y-auto">
          {results.map((resort) => (
            <button
              key={resort.slug}
              onClick={() => {
                onAdd(resort);
                setQuery("");
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2.5 min-h-11 hover:bg-cream transition-colors flex items-center justify-between gap-2 border-b border-dashed border-bark/30 last:border-b-0"
            >
              <div>
                <span className="font-display font-black text-ink text-[14px]">{resort.name}</span>
                <span className="font-mono text-[10.5px] text-bark uppercase tracking-[0.12em] ml-2">{resort.state}</span>
              </div>
              {resort.snow_report?.base_depth != null && (
                <span className="font-mono font-bold text-alpen-dk text-[12px] shrink-0 tabular-nums">
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
  const chipCls = resort.cond_rating ? conditionChip[resort.cond_rating] : null;
  const thumb = getFirstCamThumbnail(resort);
  const activeCamCount = camsOf(resort).filter((c) => c.is_active).length;

  return (
    <div className="flex flex-col gap-3 p-4">
      {/*
        Webcam thumbnail. The box is a fixed 16:9 flex item with `shrink-0` and
        `min-h-0` so a late-loading cam image can never stretch it — in a column
        flex container `min-height: auto` would otherwise let the loaded image
        grow the box and shove the Remove button out from under the cursor
        mid-click. Every child is absolutely positioned inside the same box, so
        the placeholder and the loaded image occupy identical space.
      */}
      <div className="relative w-full aspect-video shrink-0 min-h-0 rounded-[14px] overflow-hidden bg-cream border-[1.5px] border-ink shadow-stamp-sm">
        {thumb ? (
          <Link href={`/resorts/${resort.slug}`} tabIndex={-1} className="absolute inset-0 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb.url}
              alt={`${resort.name} webcam`}
              loading="lazy"
              width={320}
              height={180}
              decoding="async"
              className="absolute inset-0 w-full h-full object-contain"
            />
            <div className="absolute inset-0 bg-ink/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
              <Camera size={20} className="text-cream-50" />
            </div>
          </Link>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-bark">
            <Camera size={18} />
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em]">
              {activeCamCount} cam{activeCamCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Resort info + remove button */}
      <div className="relative z-10">
        <div className="flex items-start justify-between gap-1">
          <Link href={`/resorts/${resort.slug}`} className="hover:text-alpen transition-colors flex-1 min-w-0">
            <h3 className="font-display font-black text-ink text-[16px] leading-[1.05] tracking-[-0.01em]">{resort.name}</h3>
          </Link>
          {/* Sits above the cam panel in stacking order, with a 32px hit target
              that grows to 40px on coarse pointers. */}
          <button
            type="button"
            onClick={onRemove}
            className="relative z-10 shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-cream-50 border-[1.5px] border-ink text-ink hover:bg-alpen hover:text-cream-50 shadow-[2px_2px_0_#2a1f14] transition-colors touch-manipulation"
            aria-label={`Remove ${resort.name} from comparison`}
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
        <p className="font-mono text-[10.5px] text-bark uppercase tracking-[0.12em] mt-1">
          {resort.region} · {resort.state}
        </p>
        {chipCls && (
          <span
            className={`inline-flex mt-2 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-[0.08em] border-[1.5px] ${chipCls}`}
          >
            {resort.cond_rating.toUpperCase()}
          </span>
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
        isBest ? "bg-alpen/10" : ""
      }`}
    >
      <span
        className={`font-display font-black text-2xl tabular-nums tracking-[-0.01em] ${
          isBest ? "text-alpen" : "text-ink"
        }`}
      >
        {value}
        {isBest && (
          <span className="ml-1.5 text-[10px] font-sans font-bold text-alpen/70 align-middle">
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
  /** Slugs from the URL that didn't match any resort (shown as a soft notice). */
  missingSlugs?: string[];
  /** True when the resort catalog couldn't be fetched at all. */
  loadFailed?: boolean;
}

export function ComparePage({
  allResorts,
  initialResorts,
  missingSlugs = [],
  loadFailed = false,
}: Props) {
  const router = useRouter();
  const [resorts, setResorts] = useState<ResortWithData[]>(initialResorts);
  const [copied, setCopied] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState(false);
  const isFirstRender = useRef(true);

  // Sync URL when resorts change (skip on initial mount to avoid replacing server URL)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    router.replace(buildCompareHref(resorts.map((r) => r.slug)), { scroll: false });
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
  const showNotice = !dismissedNotice && (loadFailed || missingSlugs.length > 0);

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
        display: (() => {
          const raw = r.snow_report?.conditions;
          if (!raw) return r.cond_rating?.toUpperCase() ?? "—";
          if (raw.includes("||")) {
            const [, narrative] = raw.split("||");
            return narrative || raw;
          }
          return raw;
        })(),
        isBest: isBestLow(condRanks[i], condRanks),
      })),
    },
    {
      label: "WEBCAMS",
      values: resorts.map((r) => ({
        display: `${camsOf(r).filter((c) => c.is_active).length}`,
        isBest: false,
      })),
    },
  ];

  return (
    <div className="min-h-screen pc-paper">
      <Header showSearch={false} />

      <div className="max-w-screen-xl mx-auto px-4 py-5 md:py-8 md:px-8">
        {/* Page header */}
        <div className="mb-5 md:mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-bark hover:text-ink text-[13px] font-semibold mb-5 py-2 px-1 min-h-11 transition-colors"
          >
            <ArrowLeft size={14} />
            Back to resorts
          </Link>
          <div className="pc-eyebrow mb-1" style={{ color: "var(--pc-bark)" }}>
            Side-by-side · up to {MAX_RESORTS}
          </div>
          <h1 className="font-display font-black text-4xl md:text-6xl text-ink leading-[0.95] tracking-[-0.02em]">
            Compare <em className="text-alpen italic font-bold">resorts</em>.
          </h1>
        </div>

        {/* Soft failure notices — never a blank page, never a 500 */}
        {showNotice && (
          <div
            role="status"
            className="mb-8 flex items-start gap-3 rounded-[14px] border-[1.5px] border-ink bg-cream-50 px-4 py-3 shadow-stamp-sm"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-alpen-dk" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink">
                {loadFailed
                  ? "We couldn’t load resort data just now."
                  : `We couldn’t find ${missingSlugs.length === 1 ? "that resort" : "those resorts"}.`}
              </p>
              <p className="mt-0.5 text-[12.5px] text-bark break-words">
                {loadFailed ? (
                  <>Snow reports are temporarily unavailable — please try again in a moment.</>
                ) : (
                  <>
                    Skipped{" "}
                    <span className="font-mono text-[11.5px] text-ink break-all">
                      {missingSlugs
                        .map((s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s))
                        .join(", ")}
                    </span>
                    . {resorts.length > 0 ? "The rest are shown below." : "Search below to pick resorts."}
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissedNotice(true)}
              className="relative z-10 -mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-bark transition-colors hover:bg-cream hover:text-ink"
              aria-label="Dismiss notice"
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap mb-5 md:mb-8">
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
                className="inline-flex items-center gap-2 px-4 py-2 min-h-11 bg-cream-50 text-ink
                           border-[1.5px] border-ink rounded-full shadow-stamp-sm
                           hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]
                           transition-[transform,box-shadow] duration-100 text-[13px] font-semibold"
              >
                <Share2 size={14} />
                {copied ? "Copied!" : "Share"}
              </button>
              <button
                onClick={() => setResorts([])}
                className="text-bark hover:text-ink text-[13px] font-semibold px-3 py-2 min-h-11 transition-colors"
              >
                Clear all
              </button>
            </>
          )}
        </div>

        {/* Empty state */}
        {resorts.length === 0 && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">⛷</div>
            <h2 className="font-display font-black text-ink text-2xl leading-tight">No resorts selected.</h2>
            <p className="text-bark text-sm mt-2 mb-8">
              Search above to add resorts, or try a popular comparison:
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {[["alta", "snowbird"], ["jackson-hole", "big-sky"], ["vail", "breckenridge"]].map(([a, b]) => {
                const ra = allResorts.find(r => r.slug === a);
                const rb = allResorts.find(r => r.slug === b);
                if (!ra || !rb) return null;
                return (
                  <button key={`${a}-${b}`}
                    onClick={() => { addResort(ra); addResort(rb); }}
                    className="px-4 py-2 min-h-11 bg-cream-50 text-ink border-[1.5px] border-ink rounded-full
                               shadow-stamp-sm hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]
                               transition-[transform,box-shadow] duration-100 text-[13px] font-semibold">
                    {ra.name} <span className="text-bark font-normal italic">vs</span> {rb.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Single resort prompt */}
        {resorts.length === 1 && (
          <p className="text-bark text-sm mb-6 text-center italic">
            Add at least one more resort to start comparing.
          </p>
        )}

        {resorts.length > 0 && <section aria-label="Mobile resort comparison" className="md:hidden">
          {resorts.length > 2 && <p className="mb-3 text-sm text-bark">Swipe across to compare all {resorts.length} resorts.</p>}
          <div className="overflow-x-auto rounded-xl border border-ink bg-cream-50" tabIndex={0} aria-label="Comparison values">
            <div style={{ width: `${Math.max(1, resorts.length / 2) * 100}%` }}>
              <div className="grid bg-cream" style={{ gridTemplateColumns: `repeat(${resorts.length}, minmax(0, 1fr))` }}>
                {resorts.map(resort => <div key={resort.slug} className="min-w-0 border-b border-r border-ink/20 p-3">
                  <Link href={`/resorts/${resort.slug}`} className="block min-h-11 break-words font-display text-base font-bold">{resort.name}</Link>
                  <button onClick={() => removeResort(resort.slug)} aria-label={`Remove ${resort.name} from comparison`} className="mt-2 min-h-11 rounded-full border border-bark px-3 text-xs font-bold">Remove</button>
                </div>)}
              </div>
              {statRows.map(row => <div key={row.label} className="border-b border-ink/20 last:border-0">
                <h2 className="sticky left-0 w-max max-w-[calc(100vw-3rem)] px-3 pt-3 text-xs font-bold text-bark">{row.label}</h2>
                <div className="grid" style={{ gridTemplateColumns: `repeat(${resorts.length}, minmax(0, 1fr))` }}>{row.values.map((cell, i) => <div key={resorts[i].slug} className={`break-words px-3 pb-3 pt-1 text-base font-bold ${cell.isBest ? "text-forest" : "text-ink"}`}>{cell.display}</div>)}</div>
              </div>)}
            </div>
          </div>
        </section>}

        {/* Comparison grid */}
        {resorts.length > 0 && (
          <div className="hidden md:block overflow-x-auto -mx-4 px-4 pb-4">
            <div
              className="min-w-fit rounded-[18px] border-[1.5px] border-ink shadow-stamp overflow-hidden bg-cream-50"
              style={{
                display: "grid",
                gridTemplateColumns: `140px repeat(${resorts.length}, minmax(180px, 1fr))`,
              }}
            >
              {/* Header row */}
              <div className="bg-cream border-b-[1.5px] border-r-[1.5px] border-dashed border-bark" />
              {resorts.map((resort, i) => (
                <div
                  key={resort.slug}
                  className={`bg-cream border-b-[1.5px] border-dashed border-bark ${
                    i < resorts.length - 1 ? "border-r-[1.5px]" : ""
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
                      className={`bg-cream-50 sticky left-0 z-10 flex items-center px-4 py-4 border-r-[1.5px] border-dashed border-bark ${
                        isLast ? "" : "border-b"
                      }`}
                    >
                      <span className="font-mono font-bold text-[11px] tracking-[0.14em] uppercase text-bark">
                        {row.label}
                      </span>
                    </div>

                    {/* Value cells */}
                    {row.values.map((cell, resortIdx) => (
                      <div
                        key={`${row.label}-${resorts[resortIdx].slug}`}
                        className={`bg-cream-50 border-dashed border-bark ${
                          resortIdx < resorts.length - 1 ? "border-r-[1.5px]" : ""
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
