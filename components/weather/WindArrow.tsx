"use client";

interface WindArrowProps {
  direction: string;
  size?: number;
  className?: string;
}

/** Convert compass direction to degrees.
 *  Arrow points in the direction wind blows TO:
 *  N wind (from north) → arrow points south (180°) */
export function compassToDegrees(direction: string): number {
  const map: Record<string, number> = {
    N: 180, NNE: 202.5, NE: 225, ENE: 247.5,
    E: 270, ESE: 292.5, SE: 315, SSE: 337.5,
    S: 0, SSW: 22.5, SW: 45, WSW: 67.5,
    W: 90, WNW: 112.5, NW: 135, NNW: 157.5,
  };
  return map[direction.toUpperCase()] ?? 180;
}

export default function WindArrow({
  direction,
  size = 16,
  className,
}: WindArrowProps) {
  const degrees = compassToDegrees(direction);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-label={`Wind from ${direction}`}
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
