"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Camera, ChevronLeft, ChevronRight, Mountain } from "lucide-react";
import { availableCameras, cameraPreview, cameraPreviews } from "@/lib/cam-preview";
import { camDisplayName } from "@/lib/cam-name";
import { isOffSeason } from "@/lib/map-utils";
import type { Cam, ConditionRating, ResolvedWidget, Resort, SnowReport, WidgetConfig } from "@/lib/types";

const conditionColors: Record<ConditionRating, { bg: string; text: string; border: string; label: string }> = {
  great: { bg: "bg-great",  text: "text-cream-50", border: "border-forest-dk", label: "GREAT" },
  good:  { bg: "bg-good",   text: "text-cream-50", border: "border-forest-dk", label: "GOOD"  },
  fair:  { bg: "bg-fair",   text: "text-ink",      border: "border-bark-dk",   label: "FAIR"  },
  poor:  { bg: "bg-poor",   text: "text-cream-50", border: "border-bark-dk",   label: "POOR"  },
};

const REFRESH_MS = 30_000;

function formatInches(n: number | null | undefined): string {
  return n == null ? "\u2014" : `${n}"`;
}

function appendCacheBust(src: string, tick: number): string {
  if (!tick) return src;
  return `${src}${src.includes("?") ? "&" : "?"}_t=${tick}`;
}

function slippyTileUrl(lat: number | undefined, lng: number | undefined, zoom = 11): string | null {
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (clampedLat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return `https://a.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}@2x.png`;
}

function useInView(rootMargin = "200px") {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(
    () => typeof window !== "undefined" && typeof IntersectionObserver === "undefined",
  );
  const [pageHidden, setPageHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting);
        }
      },
      { rootMargin, threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  useEffect(() => {
    const syncVisibility = () => setPageHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  return { ref, active: inView && !pageHidden, inView };
}

/**
 * Orders a resort's active cameras with editorial/health-ranked previewable cams first,
 * followed by any remaining embeddable cams (e.g. generic iframes without a static preview).
 * Cams flagged `card_preview: false` (dead, placeholder or wrong view) are left out
 * unless they are the only cams the resort has.
 */
export function selectDashboardCams(cams: readonly Cam[]): Cam[] {
  const rankedPreviews = cameraPreviews(cams).map((p) => p.cam);
  const seen = new Set(rankedPreviews.map((c) => c.id));
  const embeddable = availableCameras(cams).filter((c) => !seen.has(c.id) && c.embed_type !== "link");
  const rest = embeddable.filter((c) => c.card_preview !== false);
  const primary = [...rankedPreviews, ...rest];
  if (primary.length > 0) return primary;
  return embeddable.filter((c) => c.card_preview === false);
}

function AutoCamFeed({
  cam,
  resortName,
  active,
  inView,
  showLabel = true,
  compact = false,
  onExhausted,
}: {
  cam: Cam;
  resortName?: string;
  active: boolean;
  inView: boolean;
  showLabel?: boolean;
  compact?: boolean;
  onExhausted?: (camId: string) => void;
}) {
  const preview = useMemo(() => cameraPreview(cam), [cam]);
  const [tick, setTick] = useState(0);
  const [failedCamId, setFailedCamId] = useState<string | null>(null);
  const [loadedIframeCamId, setLoadedIframeCamId] = useState<string | null>(null);
  const imgFailed = failedCamId === cam.id;
  const iframeLoaded = loadedIframeCamId === cam.id;
  const camName = camDisplayName(cam);

  // Auto-refresh live image & snapshot-backed (Brownrice, IPCamLive, Ozolio, TSV) feeds in-viewport
  const isLiveSnapshot =
    Boolean(preview) &&
    (cam.embed_type === "image" || preview?.label === "Camera still");

  useEffect(() => {
    if (!active || !isLiveSnapshot || imgFailed) return;
    const id = window.setInterval(() => {
      setTick(Date.now());
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [active, isLiveSnapshot, imgFailed]);

  const shouldMountYoutube =
    cam.embed_type === "youtube" && Boolean(cam.youtube_id) && inView;
  const shouldMountGenericIframe =
    cam.embed_type === "iframe" &&
    Boolean(cam.embed_url) &&
    (!preview || imgFailed) &&
    inView;

  const iframeSrc =
    cam.embed_type === "youtube" && cam.youtube_id
      ? `https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0`
      : cam.embed_url ?? null;

  const showStill = Boolean(preview) && !imgFailed;
  const stillSrc = preview
    ? isLiveSnapshot
      ? appendCacheBust(preview.src, tick)
      : preview.src
    : null;

  return (
    <div className="relative w-full h-full min-w-0 overflow-hidden bg-ink select-none">
      {showStill && stillSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={stillSrc}
          alt={`${camName}${resortName ? ` at ${resortName}` : ""}`}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            iframeLoaded ? "opacity-0" : "opacity-100"
          }`}
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailedCamId(cam.id);
            // A failed still only exhausts a cam that has nothing else to show.
            // YouTube and iframe cams fall through to their embed (mounted once
            // the card scrolls into view), so a 404 poster must not drop them.
            if (cam.embed_type !== "youtube" && cam.embed_type !== "iframe") {
              onExhausted?.(cam.id);
            }
          }}
        />
      )}

      {(shouldMountYoutube || shouldMountGenericIframe) && iframeSrc && (
        <iframe
          src={iframeSrc}
          title={`${camName}${resortName ? ` — ${resortName}` : ""}`}
          className={`absolute inset-0 w-full h-full border-0 pointer-events-none transition-opacity duration-300 ${
            iframeLoaded || !showStill ? "opacity-100" : "opacity-0"
          }`}
          allow="autoplay; encrypted-media; picture-in-picture"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoadedIframeCamId(cam.id)}
        />
      )}

      {!showStill && !shouldMountYoutube && !shouldMountGenericIframe && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center bg-ink text-cream-50/80">
          <Camera size={18} className="mb-1 opacity-70" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] truncate max-w-full">
            {camName}
          </span>
        </div>
      )}

      <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-ink/85 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-cream-50 border border-cream-50/15">
        <span className="h-1.5 w-1.5 rounded-full bg-alpen animate-livePulse" aria-hidden />
        {shouldMountYoutube || shouldMountGenericIframe
          ? "Live"
          : isLiveSnapshot
            ? "Auto"
            : "Preview"}
      </span>

      {showLabel && (
        <div className="absolute inset-x-0 bottom-0 z-10 min-w-0 bg-gradient-to-t from-ink/85 via-ink/40 to-transparent px-2.5 pb-1.5 pt-5">
          <div
            className={`font-display font-bold text-cream-50 truncate ${
              compact ? "text-xs" : "text-xs sm:text-sm"
            }`}
          >
            {camName}
          </div>
          {cam.elevation && !compact && (
            <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-cream-50/75 truncate">
              {cam.elevation.includes("ft") ? cam.elevation : `${cam.elevation} ft`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ZeroCamFallback({
  resort,
  snow,
}: {
  resort: Resort;
  snow: SnowReport | null;
}) {
  const tileUrl = useMemo(() => slippyTileUrl(resort.lat, resort.lng, 11), [resort.lat, resort.lng]);
  const [tileFailed, setTileFailed] = useState(false);

  const metrics: Array<{ label: string; value: string }> = [];
  if (snow?.new_snow_48h != null) metrics.push({ label: "48h", value: `${snow.new_snow_48h}"` });
  if (snow?.swe_in != null) metrics.push({ label: "SWE", value: `${snow.swe_in}"` });
  if (snow?.pct_of_normal != null) metrics.push({ label: "Normal", value: `${Math.round(snow.pct_of_normal)}%` });
  if (resort.elevation_summit_ft) {
    metrics.push({ label: "Summit", value: `${resort.elevation_summit_ft.toLocaleString()}'` });
  } else if (typeof resort.lat === "number" && typeof resort.lng === "number") {
    metrics.push({
      label: "Coords",
      value: `${Math.abs(resort.lat).toFixed(1)}°${resort.lat >= 0 ? "N" : "S"}`,
    });
  }

  return (
    <div className="relative w-full h-full min-h-[76px] rounded-xl overflow-hidden border border-ink/20 bg-cream pc-topo flex flex-col justify-between p-2.5">
      {tileUrl && !tileFailed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tileUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-35 mix-blend-multiply pointer-events-none"
          loading="lazy"
          onError={() => setTileFailed(true)}
        />
      )}
      <div className="relative z-10 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-ink/85 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-cream-50">
          <Mountain size={11} aria-hidden />
          Telemetry
        </span>
        {resort.elevation_base_ft && resort.elevation_summit_ft && (
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink/80 bg-cream-50/85 px-1.5 py-0.5 rounded border border-ink/15">
            {resort.elevation_base_ft.toLocaleString()}&apos;–{resort.elevation_summit_ft.toLocaleString()}&apos;
          </span>
        )}
      </div>

      {metrics.length > 0 && (
        <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-auto pt-2">
          {metrics.slice(0, 4).map((m) => (
            <div
              key={m.label}
              className="rounded-lg bg-cream-50/90 border border-ink/15 px-2 py-1 backdrop-blur-[2px]"
            >
              <div className="font-mono font-bold text-xs text-ink tabular-nums truncate">
                {m.value}
              </div>
              <div className="font-mono font-bold text-[9px] uppercase tracking-[0.12em] text-bark truncate">
                {m.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MissingBody({ type }: { type: WidgetConfig["type"] }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center overflow-hidden">
      <span className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark">
        {type}
      </span>
      <span className="font-display font-black text-ink mt-1">Couldn&apos;t load this {type}</span>
      <p className="text-bark text-xs mt-1">It may have been removed. Try refreshing.</p>
    </div>
  );
}

function ResortBody({
  widget,
  resolved,
  isListView = false,
}: {
  widget: WidgetConfig;
  resolved: Extract<ResolvedWidget, { kind: "resort" }>;
  isListView?: boolean;
}) {
  const { resort, snow, cams } = resolved;
  const { ref, active, inView } = useInView("200px");
  const [failedCamIds, setFailedCamIds] = useState<Set<string>>(() => new Set());
  const [selectedIdx, setSelectedIdx] = useState(0);

  const usableCams = useMemo(
    () => selectDashboardCams(cams).filter((c) => !failedCamIds.has(c.id)),
    [cams, failedCamIds],
  );

  const offSeason = useMemo(() => {
    if (typeof resort.lat !== "number" || !Number.isFinite(resort.lat)) return false;
    return isOffSeason(resort.lat, new Date());
  }, [resort.lat]);

  const hasEarlySeasonSnow = (snow?.new_snow_24h ?? 0) >= 2 || (snow?.base_depth ?? 0) >= 20;
  const showOffSeasonBadge = offSeason && !hasEarlySeasonSnow;
  const cond = resort.cond_rating ? conditionColors[resort.cond_rating] : null;
  const camCount = cams.length;

  // Multi-cam bento mode for tall/large grid cards with 2+ usable cameras
  const isBentoMultiCam =
    !isListView &&
    usableCams.length >= 2 &&
    (widget.h >= 4 || (widget.w >= 6 && widget.h >= 3));

  const bentoCount =
    usableCams.length >= 4 && widget.h >= 4 && widget.w >= 4 ? 4 : 2;
  const safeIdx = usableCams.length > 0 ? selectedIdx % usableCams.length : 0;
  const primaryCam = usableCams[safeIdx] ?? null;

  const handleExhausted = (camId: string) => {
    setFailedCamIds((prev) => {
      if (prev.has(camId)) return prev;
      const next = new Set(prev);
      next.add(camId);
      return next;
    });
  };

  // The whole card opens the resort through a stretched link rendered after
  // the content (last in the DOM, z-10), so the card body is never inside an
  // <a> and the camera switcher buttons (z-20) sit above the link as valid,
  // independently focusable controls instead of interactive content nested
  // in an anchor.
  return (
    <div ref={ref} className="relative w-full h-full min-w-0 overflow-hidden">
      <div className="w-full h-full flex flex-col min-w-0 overflow-hidden p-3.5 sm:p-4">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <span className="block font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark truncate">
              {resort.state} · {resort.region}
            </span>
            <h3 className="font-display font-black text-ink text-lg sm:text-xl leading-[1.05] tracking-[-0.02em] truncate mt-0.5 min-w-0">
              {resort.name}
            </h3>
          </div>
        </div>

        {/* Auto-loading middle viewport: Multi-Cam Bento, Single Live Cam + Switcher, or Telemetry Fallback */}
        <div className="flex-1 min-h-[76px] my-2.5 relative overflow-hidden rounded-xl">
          {isBentoMultiCam ? (
            <div
              className={`w-full h-full grid gap-1.5 ${
                bentoCount === 4
                  ? "grid-cols-2 grid-rows-2"
                  : widget.w >= widget.h * 2
                    ? "grid-cols-2 grid-rows-1"
                    : "grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1"
              }`}
            >
              {usableCams.slice(0, bentoCount).map((cam) => (
                <div
                  key={cam.id}
                  className="relative w-full h-full min-h-0 rounded-lg overflow-hidden border border-ink/20"
                >
                  <AutoCamFeed
                    cam={cam}
                    resortName={resort.name}
                    active={active}
                    inView={inView}
                    compact={bentoCount === 4}
                    onExhausted={handleExhausted}
                  />
                </div>
              ))}
            </div>
          ) : primaryCam ? (
            <div className="relative w-full h-full rounded-xl overflow-hidden border border-ink/20">
              <AutoCamFeed
                cam={primaryCam}
                resortName={resort.name}
                active={active}
                inView={inView}
                onExhausted={handleExhausted}
              />
              {usableCams.length > 1 && (
                <div className="absolute right-2 top-2 z-20 inline-flex items-center gap-0.5 rounded-full bg-ink/85 p-0.5 text-cream-50 border border-cream-50/15">
                  <button
                    type="button"
                    aria-label="Previous camera"
                    onClick={() => setSelectedIdx((i) => (i - 1 + usableCams.length) % usableCams.length)}
                    className="p-1 hover:text-alpen transition-colors rounded-full"
                  >
                    <ChevronLeft size={12} strokeWidth={2.5} />
                  </button>
                  <span className="px-1 font-mono text-[9.5px] font-bold tabular-nums">
                    {safeIdx + 1}/{usableCams.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Next camera"
                    onClick={() => setSelectedIdx((i) => (i + 1) % usableCams.length)}
                    className="p-1 hover:text-alpen transition-colors rounded-full"
                  >
                    <ChevronRight size={12} strokeWidth={2.5} />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <ZeroCamFallback resort={resort} snow={snow} />
          )}
        </div>

        <div className="flex items-end justify-between gap-2 min-w-0 pt-0.5">
          <div className="flex items-baseline gap-3 min-w-0">
            <div className="min-w-0">
              <div className="font-mono font-bold text-base sm:text-lg text-ink tabular-nums leading-tight">
                {formatInches(snow?.base_depth)}
              </div>
              <div className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark">
                Base
              </div>
            </div>
            <div className="min-w-0">
              <div className="font-mono font-bold text-base sm:text-lg text-ink tabular-nums leading-tight">
                {formatInches(snow?.new_snow_24h)}
              </div>
              <div className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark">
                24h
              </div>
            </div>
            {snow?.new_snow_48h != null && widget.w >= 4 && (
              <div className="min-w-0 hidden sm:block">
                <div className="font-mono font-bold text-base sm:text-lg text-ink tabular-nums leading-tight">
                  {formatInches(snow.new_snow_48h)}
                </div>
                <div className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark">
                  48h
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showOffSeasonBadge ? (
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full border border-bark-dk bg-bark/20 text-ink font-mono font-bold text-[10px] uppercase tracking-[0.14em]"
                role="img"
                aria-label="Conditions: Off-season"
              >
                Off-season
              </span>
            ) : (
              cond && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full border font-mono font-bold text-[10px] uppercase tracking-[0.14em] ${cond.bg} ${cond.text} ${cond.border}`}
                  role="img"
                  aria-label={`Conditions: ${cond.label}`}
                >
                  {cond.label}
                </span>
              )
            )}
            <div
              className="flex items-center gap-1 text-bark-dk"
              role="img"
              aria-label={`${camCount} webcam${camCount !== 1 ? "s" : ""} available`}
            >
              <Camera size={14} strokeWidth={2.3} />
              <span className="font-mono font-bold text-[13px] tabular-nums">{camCount}</span>
            </div>
          </div>
        </div>
      </div>
      <Link
        href={`/resorts/${resort.slug}`}
        aria-label={`Open ${resort.name}`}
        className="absolute inset-0 z-10 rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-alpen"
      />
    </div>
  );
}

function CamBody({ resolved }: { resolved: Extract<ResolvedWidget, { kind: "cam" }> }) {
  const { cam, resort } = resolved;
  const { ref, active, inView } = useInView("200px");
  const camName = camDisplayName(cam);

  const inner = (
    <div ref={ref} className="relative w-full h-full min-w-0 overflow-hidden bg-ink">
      <AutoCamFeed
        cam={cam}
        resortName={resort?.name}
        active={active}
        inView={inView}
        showLabel={false}
      />
      <div className="absolute inset-x-0 bottom-0 z-10 min-w-0 bg-gradient-to-t from-ink/85 via-ink/40 to-transparent px-3 pb-2 pt-6">
        <div className="font-display font-black text-cream-50 truncate">{camName}</div>
        {resort && (
          <div className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-cream-50/80 truncate">
            {resort.name}
          </div>
        )}
      </div>
    </div>
  );

  const className = "w-full h-full min-w-0 overflow-hidden block";
  if (resort) {
    return (
      <Link href={`/resorts/${resort.slug}`} className={className}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}

export function DashboardWidget({
  widget,
  resolved,
  isListView = false,
}: {
  widget: WidgetConfig;
  resolved?: ResolvedWidget;
  isListView?: boolean;
}) {
  if (!resolved || resolved.kind === "missing") {
    return <MissingBody type={resolved?.kind === "missing" ? resolved.type : widget.type} />;
  }
  if (resolved.kind === "resort") {
    return <ResortBody widget={widget} resolved={resolved} isListView={isListView} />;
  }
  return <CamBody resolved={resolved} />;
}
