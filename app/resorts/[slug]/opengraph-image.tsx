import { ImageResponse } from "next/og";
import { getResortBySlug } from "@/lib/supabase";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COND_COLOR: Record<string, string> = {
  great: "#2ECC8F",
  good: "#60C8FF",
  fair: "#F59E0B",
  poor: "#f87171",
};

export default async function OgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let resort = null;
  try {
    resort = await getResortBySlug(slug);
  } catch {}

  const condColor = resort
    ? (COND_COLOR[resort.cond_rating] ?? "#60C8FF")
    : "#60C8FF";
  const snow = resort?.snow_report;

  const conditionsNarrative = snow?.conditions 
    ? (snow.conditions.includes("||") ? snow.conditions.split("||")[1] : snow.conditions) 
    : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(160deg, #060B12 0%, #0E1825 55%, #0D1F35 100%)",
          padding: "52px 64px 48px",
          fontFamily: "Arial, sans-serif",
          color: "#E8F0F8",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Mountain silhouette — decorative background layer */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            display: "flex",
          }}
        >
          <svg
            viewBox="0 0 1200 280"
            style={{ width: 1200, height: 280, opacity: 0.07 }}
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M0,280 L0,200 L120,90 L220,155 L360,35 L480,120 L600,18 L720,100 L840,55 L960,130 L1060,48 L1140,100 L1200,70 L1200,280 Z"
              fill="#60C8FF"
            />
            <path
              d="M0,280 L0,230 L80,170 L180,210 L300,130 L420,185 L540,110 L660,170 L780,125 L900,180 L1020,135 L1120,165 L1200,145 L1200,280 Z"
              fill="#60C8FF"
              opacity="0.5"
            />
          </svg>
        </div>

        {/* Accent glow — top right */}
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -80,
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: "radial-gradient(circle, #60C8FF0A 0%, transparent 70%)",
            display: "flex",
          }}
        />

        {/* Top bar: brand + URL */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 17,
              color: "#60C8FF",
              letterSpacing: "0.25em",
              fontWeight: 700,
            }}
          >
            PEAKCAM
          </div>
          <div style={{ fontSize: 14, color: "#2E4A68", letterSpacing: "0.05em" }}>
            peakcam.vercel.app
          </div>
        </div>

        {/* Main content area */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            marginTop: 20,
          }}
        >
          {resort ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {/* State · Region chip */}
              <div
                style={{
                  display: "flex",
                  marginBottom: 18,
                }}
              >
                <div
                  style={{
                    padding: "5px 16px",
                    background: "#1A2840",
                    borderRadius: 4,
                    fontSize: 13,
                    color: "#8AA3BE",
                    letterSpacing: "0.15em",
                    fontWeight: 600,
                    border: "1px solid #243850",
                    display: "flex",
                  }}
                >
                  {resort.state} · {resort.region}
                </div>
              </div>

              {/* Resort name */}
              <div
                style={{
                  fontSize: resort.name.length > 22 ? 58 : resort.name.length > 16 ? 68 : 80,
                  fontWeight: 900,
                  lineHeight: 1.0,
                  letterSpacing: "-0.02em",
                  color: "#E8F0F8",
                  display: "flex",
                }}
              >
                {resort.name}
              </div>

              {/* Cam count subtitle */}
              <div
                style={{
                  fontSize: 20,
                  color: "#4A6480",
                  marginTop: 12,
                  fontWeight: 400,
                  display: "flex",
                }}
              >
                {resort.cams.length} live cam{resort.cams.length !== 1 ? "s" : ""} · Real-time snow data
              </div>
            </div>
          ) : (
            <div
              style={{
                fontSize: 80,
                fontWeight: 900,
                color: "#E8F0F8",
                display: "flex",
              }}
            >
              PeakCam
            </div>
          )}
        </div>

        {/* Stats footer row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginTop: 28,
            paddingTop: 28,
            borderTop: "1px solid #1A2840",
          }}
        >
          {/* Condition badge */}
          <div
            style={{
              display: "flex",
              padding: "8px 20px",
              background: condColor + "18",
              border: `1px solid ${condColor}44`,
              borderRadius: 4,
              color: condColor,
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.15em",
            }}
          >
            {resort ? resort.cond_rating.toUpperCase() : "LIVE CAMS"}
          </div>

          {/* Base depth */}
          {snow?.base_depth != null && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                paddingLeft: 16,
                borderLeft: "1px solid #1A2840",
              }}
            >
              <div
                style={{ fontSize: 11, color: "#4A6480", letterSpacing: "0.12em", display: "flex" }}
              >
                BASE
              </div>
              <div
                style={{ fontSize: 26, fontWeight: 800, color: "#E8F0F8", lineHeight: 1.1, display: "flex" }}
              >
                {snow.base_depth}&quot;
              </div>
            </div>
          )}

          {/* New snow 24h */}
          {snow?.new_snow_24h != null && snow.new_snow_24h > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                paddingLeft: 16,
                borderLeft: "1px solid #1A2840",
              }}
            >
              <div
                style={{ fontSize: 11, color: "#4A6480", letterSpacing: "0.12em", display: "flex" }}
              >
                NEW 24H
              </div>
              <div
                style={{ fontSize: 26, fontWeight: 800, color: "#60C8FF", lineHeight: 1.1, display: "flex" }}
              >
                {snow.new_snow_24h}&quot;
              </div>
            </div>
          )}

          {/* Conditions string */}
          {conditionsNarrative && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                paddingLeft: 16,
                borderLeft: "1px solid #1A2840",
              }}
            >
              <div
                style={{ fontSize: 11, color: "#4A6480", letterSpacing: "0.12em", display: "flex" }}
              >
                CONDITIONS
              </div>
              <div
                style={{ fontSize: 20, fontWeight: 700, color: "#E8F0F8", lineHeight: 1.2, display: "flex" }}
              >
                {conditionsNarrative}
              </div>
            </div>
          )}

          {/* Trails */}
          {snow?.trails_open != null && snow.trails_total != null && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                paddingLeft: 16,
                borderLeft: "1px solid #1A2840",
              }}
            >
              <div
                style={{ fontSize: 11, color: "#4A6480", letterSpacing: "0.12em", display: "flex" }}
              >
                TRAILS
              </div>
              <div
                style={{ fontSize: 26, fontWeight: 800, color: "#E8F0F8", lineHeight: 1.1, display: "flex" }}
              >
                {snow.trails_open}/{snow.trails_total}
              </div>
            </div>
          )}

          {/* Spacer + live indicator */}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#2ECC8F",
                display: "flex",
              }}
            />
            <div style={{ fontSize: 13, color: "#2ECC8F", letterSpacing: "0.1em", display: "flex" }}>
              LIVE
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
