"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Camera } from "lucide-react";
import { pickPreview } from "@/components/map/MapCamPreview";
import { camDisplayName } from "@/lib/cam-name";
import type { ConditionRating, ResolvedWidget, WidgetConfig } from "@/lib/types";

const conditionColors: Record<ConditionRating, { bg: string; text: string; border: string; label: string }> = {
  great: { bg: "bg-great",  text: "text-cream-50", border: "border-forest-dk", label: "GREAT" },
  good:  { bg: "bg-good",   text: "text-cream-50", border: "border-forest-dk", label: "GOOD"  },
  fair:  { bg: "bg-fair",   text: "text-ink",      border: "border-bark-dk",   label: "FAIR"  },
  poor:  { bg: "bg-poor",   text: "text-cream-50", border: "border-bark-dk",   label: "POOR"  },
};

function formatInches(n: number | null | undefined): string {
  return n == null ? "\u2014" : `${n}"`;
}

function MissingBody({ type }: { type: WidgetConfig["type"] }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center overflow-hidden">
      <span className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark">
        {type}
      </span>
      {/* Reached both when the row is genuinely gone and when the lookup failed,
          so the copy must not assert deletion. */}
      <span className="font-display font-black text-ink mt-1">Couldn&apos;t load this {type}</span>
      <p className="text-bark text-xs mt-1">It may have been removed. Try refreshing.</p>
    </div>
  );
}

function ResortBody({ resolved }: { resolved: Extract<ResolvedWidget, { kind: "resort" }> }) {
  const { resort, snow, cams } = resolved;
  const cond = resort.cond_rating ? conditionColors[resort.cond_rating] : null;
  const camCount = cams.length;

  return (
    <Link
      href={`/resorts/${resort.slug}`}
      className="w-full h-full flex flex-col min-w-0 overflow-hidden p-4"
    >
      <span className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark truncate">
        {resort.state} · {resort.region}
      </span>
      <h3 className="font-display font-black text-ink text-lg sm:text-xl leading-[1.05] tracking-[-0.02em] truncate mt-1 min-w-0">
        {resort.name}
      </h3>

      <div className="mt-auto flex items-end justify-between gap-2 min-w-0 pt-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <div className="min-w-0">
            <div className="font-mono font-bold text-lg text-ink tabular-nums">{formatInches(snow?.base_depth)}</div>
            <div className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark">Base</div>
          </div>
          <div className="min-w-0">
            <div className="font-mono font-bold text-lg text-ink tabular-nums">{formatInches(snow?.new_snow_24h)}</div>
            <div className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark">24h</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {cond && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full border font-mono font-bold text-[10px] uppercase tracking-[0.14em] ${cond.bg} ${cond.text} ${cond.border}`}
              role="img"
              aria-label={`Conditions: ${cond.label}`}
            >
              {cond.label}
            </span>
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
    </Link>
  );
}

function CamBody({ resolved }: { resolved: Extract<ResolvedWidget, { kind: "cam" }> }) {
  const { cam, resort } = resolved;
  const preview = useMemo(() => pickPreview([cam]), [cam]);
  const [imgFailed, setImgFailed] = useState(false);
  const camName = camDisplayName(cam);
  const showThumb = Boolean(preview) && !imgFailed;

  const inner = showThumb && preview ? (
    <div className="relative w-full h-full min-w-0 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={preview.src}
        alt={`${camName}${resort ? ` at ${resort.name}` : ""}`}
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
        onError={() => setImgFailed(true)}
      />
      <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-ink/85 px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-cream-50">
        {preview.kind === "live" && (
          <span className="h-1.5 w-1.5 rounded-full bg-alpen animate-livePulse" aria-hidden />
        )}
        {preview.kind === "live" ? "Live" : "Preview"}
      </span>
      <div className="absolute inset-x-0 bottom-0 min-w-0 bg-gradient-to-t from-ink/75 to-transparent px-2 pb-1.5 pt-6">
        <div className="font-display font-black text-cream-50 truncate">{camName}</div>
        {resort && (
          <div className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-cream-50/80 truncate">
            {resort.name}
          </div>
        )}
      </div>
    </div>
  ) : (
    <div className="w-full h-full flex flex-col justify-center p-4 min-w-0 overflow-hidden">
      <span className="font-mono font-bold text-[10px] uppercase tracking-[0.14em] text-bark truncate">
        {resort?.name ?? "Cam"}
      </span>
      <span className="font-display font-black text-ink mt-1 truncate">{camName}</span>
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
}: {
  widget: WidgetConfig;
  resolved?: ResolvedWidget;
}) {
  if (!resolved || resolved.kind === "missing") {
    return <MissingBody type={resolved?.kind === "missing" ? resolved.type : widget.type} />;
  }
  if (resolved.kind === "resort") return <ResortBody resolved={resolved} />;
  return <CamBody resolved={resolved} />;
}
