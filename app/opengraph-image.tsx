import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "PeakCam — live ski resort webcams and snow reports";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The site-wide social card. The root page (and every route that doesn't ship
 * its own `opengraph-image`) had no og:image at all, so shared links previewed
 * as a bare text blob.
 *
 * Deliberately static: no DB read, no remote font fetch. This renders at build
 * time and must never be the reason a build fails or a preview is blank. The
 * per-resort card at app/resorts/[slug]/opengraph-image.tsx still wins for
 * resort pages — a nested image file overrides an inherited one.
 */

const CREAM = "#f1e7cf";
const CREAM_50 = "#faf4e6";
const INK = "#2a1f14";
const BARK = "#7a5a3a";
const FOREST = "#3c5a3a";
const ALPEN = "#d9552f";

export default function OpengraphImage() {
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
        <div
          style={{ position: "absolute", bottom: 0, left: 0, right: 0, display: "flex" }}
        >
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
            <span style={{ fontSize: 46, fontWeight: 900, letterSpacing: "-0.02em" }}>
              Peak
            </span>
            <span
              style={{
                fontSize: 46,
                fontWeight: 900,
                fontStyle: "italic",
                letterSpacing: "-0.02em",
                color: ALPEN,
              }}
            >
              Cam
            </span>
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Arial, sans-serif",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "0.2em",
              color: BARK,
            }}
          >
            PEAKCAM.IO
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: -20 }}>
          <div
            style={{
              display: "flex",
              fontFamily: "Arial, sans-serif",
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: "0.22em",
              color: BARK,
              marginBottom: 18,
            }}
          >
            LIVE WEBCAMS · SNOW REPORTS · FORECASTS
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 92,
              fontWeight: 900,
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              maxWidth: 900,
            }}
          >
            Every mountain. Every cam.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 92,
              fontWeight: 900,
              fontStyle: "italic",
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              color: ALPEN,
            }}
          >
            One glance.
          </div>
        </div>

        {/* Stamp row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: FOREST,
              color: CREAM_50,
              border: `2px solid ${INK}`,
              borderRadius: 999,
              padding: "12px 26px",
              fontFamily: "Arial, sans-serif",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.12em",
              boxShadow: `5px 5px 0 ${INK}`,
            }}
          >
            150+ RESORTS
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: CREAM_50,
              color: INK,
              border: `2px solid ${INK}`,
              borderRadius: 999,
              padding: "12px 26px",
              fontFamily: "Arial, sans-serif",
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.12em",
              boxShadow: `5px 5px 0 ${INK}`,
            }}
          >
            ROCKIES TO THE ANDES
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
