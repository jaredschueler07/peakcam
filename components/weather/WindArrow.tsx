"use client";

interface WindArrowProps {
  /** Compass point ("N", "WNW", …). Missing / blank / unrecognized renders nothing —
   *  NWS returns an empty windDirection for calm periods. */
  direction?: string | null;
  size?: number;
  className?: string;
  /** Hide from the a11y tree when the parent already labels the wind readout. */
  decorative?: boolean;
}

/** Arrow points in the direction wind blows TO:
 *  N wind (from north) → arrow points south (180°) */
const COMPASS_DEGREES: Record<string, number> = {
  N: 180, NNE: 202.5, NE: 225, ENE: 247.5,
  E: 270, ESE: 292.5, SE: 315, SSE: 337.5,
  S: 0, SSW: 22.5, SW: 45, WSW: 67.5,
  W: 90, WNW: 112.5, NW: 135, NNW: 157.5,
};

/** Normalize a raw direction string to a known compass point, or "" when the
 *  value is missing, blank, or not a compass point. */
export function normalizeCompass(direction?: string | null): string {
  const d = direction?.trim().toUpperCase() ?? "";
  return d in COMPASS_DEGREES ? d : "";
}

/** Convert compass direction to degrees. Unknown/missing → 180 (legacy default). */
export function compassToDegrees(direction?: string | null): number {
  return COMPASS_DEGREES[normalizeCompass(direction)] ?? 180;
}

export default function WindArrow({
  direction,
  size = 16,
  className,
  decorative = false,
}: WindArrowProps) {
  const compass = normalizeCompass(direction);
  // No usable direction → no arrow and no dangling "Wind from " label.
  if (!compass) return null;

  const degrees = COMPASS_DEGREES[compass];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Wind from ${compass}`}
      style={{ transform: `rotate(${degrees}deg)` }}
    >
      {/* Upward-pointing arrow (default points north / up) */}
      <path
        d="M8 2L12 10H4L8 2Z"
        fill="#E8E8E8"
        fillOpacity={0.9}
      />
      <line
        x1="8" y1="10" x2="8" y2="14"
        stroke="#E8E8E8"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
