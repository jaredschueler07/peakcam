import type { NormalBandPoint, CurvePoint } from "@/lib/season-stats";
import { SEASON_CURVE_DAYS, dateForDayOfSeason, type SeasonRef } from "@/lib/snow-history";

/**
 * The cumulative-snowfall curve for the season against the station's normal
 * band, as one inline SVG. A Server Component: no hydration, no library; the
 * numbers are in the markup (a <desc> and a visually hidden summary) so the
 * chart is readable by crawlers and screen readers, not only by eye.
 */
export interface SeasonCurveChartProps {
  season: SeasonRef;
  points: CurvePoint[];
  band: NormalBandPoint[];
  /** Last season's cumulative curve by day, for a thin comparison line; optional. */
  lastSeason?: { label: string; points: Array<{ dayOfSeason: number; cumulativeIn: number }> } | null;
  normalYears: number | null;
  recentYears: number | null;
}

const W = 720;
const H = 300;
const PAD = { top: 16, right: 16, bottom: 36, left: 44 };

const MONTH_TICKS: Array<{ day: number; label: string }> = [
  { day: 1, label: "Oct" },
  { day: 32, label: "Nov" },
  { day: 62, label: "Dec" },
  { day: 93, label: "Jan" },
  { day: 124, label: "Feb" },
  { day: 152, label: "Mar" },
  { day: 183, label: "Apr" },
  { day: 213, label: "May" },
  { day: 244, label: "Jun" },
];

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function SeasonCurveChart({ season, points, band, lastSeason, normalYears, recentYears }: SeasonCurveChartProps) {
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const days = SEASON_CURVE_DAYS;
  const maxValue = Math.max(
    10,
    ...points.map((p) => p.cumulativeIn),
    ...band.map((b) => b.p75In),
    ...(lastSeason?.points.map((p) => p.cumulativeIn) ?? []),
  );
  const yMax = Math.ceil(maxValue / 50) * 50 || 50;
  const x = (day: number) => PAD.left + ((Math.min(day, days) - 1) / (days - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
  const path = (pts: Array<{ dayOfSeason: number; cumulativeIn: number }>) =>
    pts.length ? pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.dayOfSeason).toFixed(1)},${y(p.cumulativeIn).toFixed(1)}`).join(" ") : "";
  const bandPath = band.length
    ? [
        ...band.map((b, i) => `${i === 0 ? "M" : "L"}${x(b.dayOfSeason).toFixed(1)},${y(b.p75In).toFixed(1)}`),
        ...[...band].reverse().map((b) => `L${x(b.dayOfSeason).toFixed(1)},${y(b.p25In).toFixed(1)}`),
        "Z",
      ].join(" ")
    : "";
  const meanPath = path(band.map((b) => ({ dayOfSeason: b.dayOfSeason, cumulativeIn: b.meanIn })));
  const recentPath = path(band.filter((b) => b.recentMeanIn != null).map((b) => ({ dayOfSeason: b.dayOfSeason, cumulativeIn: b.recentMeanIn as number })));
  const currentPath = path(points);
  const lastPath = lastSeason ? path(lastSeason.points.filter((p) => p.dayOfSeason <= days)) : "";
  const last = points[points.length - 1];
  const yTicks = Array.from({ length: Math.floor(yMax / 50) + 1 }, (_, i) => i * 50);
  const isNorth = season.startDate.slice(5) === "10-01";
  const ticks = isNorth ? MONTH_TICKS : MONTH_TICKS.map((t) => ({ day: t.day, label: dateForDayOfSeason(t.day, season).slice(5, 7) }));
  const normalAtToday = last ? band.find((b) => b.dayOfSeason === last.dayOfSeason) : undefined;

  const desc = last
    ? `Cumulative measured snowfall for ${season.label}: ${fmt(last.cumulativeIn)} inches by ${last.date}` +
      (normalAtToday ? `, against a ${normalYears ?? 30}-winter mean of ${fmt(normalAtToday.meanIn)} inches by the same day (middle half ${fmt(normalAtToday.p25In)} to ${fmt(normalAtToday.p75In)}).` : ".")
    : `No daily readings yet for ${season.label}.`;

  return (
    <figure className="rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-3 shadow-stamp sm:p-4">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="season-curve-title season-curve-desc" className="h-auto w-full">
        <title id="season-curve-title">Season snowfall curve, {season.label}</title>
        <desc id="season-curve-desc">{desc}</desc>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#2a1f14" strokeOpacity={t === 0 ? 0.6 : 0.12} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fontFamily="ui-monospace, monospace" fill="#5a4330">
              {t}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t.day}>
            <line x1={x(t.day)} x2={x(t.day)} y1={PAD.top} y2={PAD.top + innerH} stroke="#2a1f14" strokeOpacity={0.08} strokeWidth={1} />
            <text x={x(t.day) + 3} y={H - PAD.bottom + 16} fontSize={11} fontFamily="ui-monospace, monospace" fill="#5a4330">
              {t.label}
            </text>
          </g>
        ))}
        {bandPath && <path d={bandPath} fill="#3c5a3a" fillOpacity={0.14} stroke="none" />}
        {meanPath && <path d={meanPath} fill="none" stroke="#3c5a3a" strokeWidth={2} strokeDasharray="6 4" />}
        {recentPath && <path d={recentPath} fill="none" stroke="#3c5a3a" strokeWidth={1.5} strokeDasharray="2 4" strokeOpacity={0.8} />}
        {lastPath && <path d={lastPath} fill="none" stroke="#7a5a3a" strokeWidth={1.5} strokeOpacity={0.7} />}
        {currentPath && <path d={currentPath} fill="none" stroke="#2a1f14" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />}
        {last && <circle cx={x(last.dayOfSeason)} cy={y(last.cumulativeIn)} r={4.5} fill="#d9552f" stroke="#2a1f14" strokeWidth={1.5} />}
        <text x={PAD.left} y={12} fontSize={11} fontFamily="ui-monospace, monospace" fill="#5a4330">
          inches since {isNorth ? "Oct 1" : "Apr 1"}
        </text>
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-bark">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="inline-block h-[3px] w-6 rounded bg-ink" /> {season.label} measured
        </span>
        {lastSeason && (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-block h-[2px] w-6 rounded bg-bark/70" /> {lastSeason.label}
          </span>
        )}
        {band.length > 0 && (
          <>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block h-[2px] w-6 border-t-2 border-dashed border-forest" /> {normalYears ?? 30}-winter mean
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block h-[2px] w-6 border-t-2 border-dotted border-forest/80" /> last {recentYears ?? 10} winters
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block h-3 w-6 rounded bg-forest/15" /> middle half of winters (p25–p75)
            </span>
          </>
        )}
      </figcaption>
      <p className="sr-only">{desc}</p>
    </figure>
  );
}
