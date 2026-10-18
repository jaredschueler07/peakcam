// ─────────────────────────────────────────────────────────────
// "What the instruments say" — the resort's stations by elevation band with
// the newest reading from each, the network named and the age shown.
//
// Pure presentational: the page passes the serialised `measuredNow` rows
// (lib/public-api/serialize.ts serializeStations) so the API, the markdown
// alternate and this block show the same numbers. Age is computed against
// the catalogue's `generatedAt`, not render time, so the ISR'd HTML and the
// hydrated tree agree (no Date.now() here).
// ─────────────────────────────────────────────────────────────

import type { MeasuredNowPublic } from "@/lib/public-api/schema";
import { STATION_SOURCES } from "@/lib/stations/index";

export interface MeasuredNowProps {
  rows: readonly MeasuredNowPublic[];
  /** Named so the empty state can say which station already feeds the snow report. */
  resortName: string;
}

const ROLE_LABEL: Record<MeasuredNowPublic["role"], string> = {
  summit: "Summit",
  mid: "Mid-mountain",
  base: "Base",
  approach: "Approach",
};

const ROLE_ORDER: MeasuredNowPublic["role"][] = ["summit", "mid", "base", "approach"];

/** `12 min ago`, `3 h ago`, `2 d ago` from whole minutes. */
export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

function fmt(value: number | null, unit: string): string {
  if (value == null) return "–";
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${n}${unit}`;
}

export function MeasuredNow({ rows, resortName }: MeasuredNowProps) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (b.elevationFt ?? 0) - (a.elevationFt ?? 0));
  const sources = [...new Set(sorted.map((r) => r.source))];
  const hasSnow = sorted.some((r) => r.snowDepthIn != null || r.newSnowIn != null);

  return (
    <section id="instruments" className="scroll-mt-20" aria-labelledby="instruments-heading">
      <div className="flex items-baseline justify-between mb-4 gap-4">
        <h2 id="instruments-heading" className="font-heading text-xl font-semibold uppercase tracking-wider text-text-base">
          What the instruments say
        </h2>
        <span className="text-text-muted text-xs">by elevation band</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Latest station observations near {resortName}, by elevation band</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-text-muted">
              <th scope="col" className="px-4 py-3 font-medium">Band</th>
              <th scope="col" className="px-4 py-3 font-medium">Station</th>
              {hasSnow && (
                <th scope="col" className="px-4 py-3 font-medium text-right">Depth</th>
              )}
              {hasSnow && (
                <th scope="col" className="px-4 py-3 font-medium text-right">New</th>
              )}
              <th scope="col" className="px-4 py-3 font-medium text-right">Temp</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Wind</th>
              <th scope="col" className="px-4 py-3 font-medium text-right">Read</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.stationId} className="border-t border-border/60">
                <th scope="row" className="px-4 py-3 font-medium text-text-base whitespace-nowrap">
                  {ROLE_LABEL[r.role]}
                </th>
                <td className="px-4 py-3 text-text-base">
                  <span className="block">{r.name ?? r.sourceId}</span>
                  <span className="block text-xs text-text-muted">
                    {STATION_SOURCES[r.source].label}
                    {r.elevationFt != null ? ` · ${r.elevationFt.toLocaleString("en-US")} ft` : ""}
                    {r.distanceKm != null ? ` · ${r.distanceKm.toFixed(1)} km` : ""}
                  </span>
                </td>
                {hasSnow && <td className="px-4 py-3 text-right font-mono tabular-nums">{fmt(r.snowDepthIn, "″")}</td>}
                {hasSnow && <td className="px-4 py-3 text-right font-mono tabular-nums">{fmt(r.newSnowIn, "″")}</td>}
                <td className="px-4 py-3 text-right font-mono tabular-nums">{fmt(r.tempF, "°F")}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{fmt(r.windMph, " mph")}</td>
                <td className="px-4 py-3 text-right text-xs text-text-muted whitespace-nowrap">
                  <time dateTime={r.observedAt}>{formatAge(r.ageMinutes)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-text-muted text-xs mt-2">
        Each row is one sensor at its own elevation, not a mountain average. Daily networks (SNOTEL, GHCN) read once a day; hourly ones
        (NWS, ECCC, BC ASWS) carry temperature and wind but no depth. Sources: {sources.map((s) => STATION_SOURCES[s].attribution).join("; ")}.
      </p>
    </section>
  );
}
