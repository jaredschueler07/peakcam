import { ImageResponse } from "next/og";
import { getAllResorts } from "@/lib/supabase";
import { hubSummary, resolveHub, type ResolvedHub } from "@/lib/hubs";
import { hubCamStats } from "@/lib/hub-copy";
import { POPULAR_RANK } from "@/lib/popular-resorts";
import type { ResortWithData } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 3600;
export const alt = "PeakCam — ski resort webcams and snow report for a state or region";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Poster palette, same as the site-wide card (app/opengraph-image.tsx).
const CREAM = "#f1e7cf";
const CREAM_50 = "#faf4e6";
const INK = "#2a1f14";
const BARK = "#63482d";
const FOREST = "#3c5a3a";
const ALPEN = "#d9552f";

const stamp = (background: string, color: string) => ({
  display: "flex",
  alignItems: "center",
  background,
  color,
  border: `2px solid ${INK}`,
  borderRadius: 999,
  padding: "10px 22px",
  fontFamily: "Arial, sans-serif",
  fontSize: 17,
  fontWeight: 700,
  letterSpacing: "0.1em",
  boxShadow: `4px 4px 0 ${INK}`,
  whiteSpace: "nowrap" as const,
});

/**
 * Per-hub social card: the place name, its resort and cam counts, and the
 * deepest base when one is reporting. A failed lookup renders the generic
 * card rather than failing the request — a share preview must never 500.
 */
export default async function OgImage({ params }: { params: Promise<{ hub: string }> }) {
  const { hub: slug } = await params;

  let resolved: ResolvedHub<ResortWithData> | null = null;
  try {
    resolved = resolveHub(slug, await getAllResorts());
  } catch {}

  const label = resolved?.hub.label ?? "Ski resort webcams";
  const count = resolved?.count ?? 0;
  const cams = resolved ? hubCamStats(resolved.resorts).total : 0;
  const summary = resolved ? hubSummary(resolved.resorts) : null;
  const deepest = summary?.deepestBase ?? null;
  // The three most recognisable resorts, curated order first, then alphabetical.
  const names = resolved
    ? [...resolved.resorts]
        .sort((a, b) => (POPULAR_RANK[a.slug] ?? 999) - (POPULAR_RANK[b.slug] ?? 999) || a.name.localeCompare(b.name, "en"))
        .slice(0, 3)
        .map((resort) => resort.name)
    : [];
  const headlineSize = label.length > 20 ? 72 : label.length > 12 ? 88 : 104;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: CREAM,
          padding: 56,
          fontFamily: "Georgia, 'Times New Roman', serif",
          color: INK,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Ridgeline — poster block-print silhouette, bottom third */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex" }}>
          <svg viewBox="0 0 1200 340" width={1200} height={340} xmlns="http://www.w3.org/2000/svg">
            <path
              d="M0,340 L0,232 L150,112 L262,196 L392,74 L520,178 L640,58 L764,166 L900,96 L1024,190 L1120,128 L1200,176 L1200,340 Z"
              fill={FOREST}
              opacity="0.28"
            />
            <path
              d="M0,340 L0,282 L120,214 L232,262 L360,176 L488,244 L620,152 L742,232 L880,180 L1010,246 L1120,204 L1200,232 L1200,340 Z"
              fill={INK}
              opacity="0.85"
            />
          </svg>
        </div>

        {/* Top rule: wordmark + domain */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `3px solid ${INK}`,
            paddingBottom: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span style={{ fontSize: 46, fontWeight: 900, letterSpacing: "-0.02em" }}>Peak</span>
            <span style={{ fontSize: 46, fontWeight: 900, fontStyle: "italic", letterSpacing: "-0.02em", color: ALPEN }}>Cam</span>
          </div>
          <div style={{ display: "flex", fontFamily: "Arial, sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: "0.2em", color: BARK }}>
            PEAKCAM.IO/SKI-CAMS
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: -10 }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Arial, sans-serif",
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: "0.22em",
              color: BARK,
              marginBottom: 16,
            }}
          >
            LIVE WEBCAMS · SNOW REPORT
          </div>
          <div
            style={{
              display: "flex",
              fontSize: headlineSize,
              fontWeight: 900,
              lineHeight: 1.0,
              letterSpacing: "-0.03em",
              maxWidth: 1080,
            }}
          >
            {label}
          </div>
          {resolved && (
            <div style={{ display: "flex", fontSize: 26, color: BARK, marginTop: 18, maxWidth: 1080 }}>
              {count} ski {count === 1 ? "resort" : "resorts"}
              {cams > 0 ? ` · ${cams} live ${cams === 1 ? "cam" : "cams"}` : ""}
              {names.length > 0 ? ` · ${names.join(", ")}` : ""}
            </div>
          )}
        </div>

        {/* Stamp row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {deepest ? (
            <div style={stamp(FOREST, CREAM_50)}>{`DEEPEST BASE ${deepest.value}″ · ${deepest.name.toUpperCase()}`}</div>
          ) : (
            <div style={stamp(FOREST, CREAM_50)}>{resolved ? "SENSOR & MODEL SNOW DATA" : "150+ RESORTS"}</div>
          )}
          <div style={stamp(CREAM_50, INK)}>FREE POWDER ALERTS</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
