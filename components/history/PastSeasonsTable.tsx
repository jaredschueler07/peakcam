import type { PastSeasonPublic } from "@/lib/public-api/schema";
import { formatDayLabel, inchesLabel } from "@/lib/season-stats";

const num = "font-mono text-[13px] font-bold tabular-nums";

/** A 52-point weekly cumulative sparkline, scaled to the table's largest season. */
function Sparkline({ values, max }: { values: number[]; max: number }) {
  const w = 104;
  const h = 24;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - (v / (max || 1)) * h).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden className="block">
      <polyline points={pts.join(" ")} fill="none" stroke="#2a1f14" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function ensoClass(phase: string | undefined): string {
  if (phase === "el-nino") return "bg-alpen/15 text-alpen-dk";
  if (phase === "la-nina") return "bg-forest/15 text-forest";
  return "bg-cream-dk text-bark-dk";
}

/**
 * Up to ten past seasons, newest first. Server-rendered: every number is in
 * the HTML for crawlers and answer engines; the sparkline is decoration on
 * top of the weekly totals the API carries.
 */
export function PastSeasonsTable({ seasons, threshold, showEnso }: { seasons: PastSeasonPublic[]; threshold: number; showEnso: boolean }) {
  const max = Math.max(1, ...seasons.map((s) => s.totalIn));
  return (
    <div className="overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink/15">
            <th scope="col" className="pc-eyebrow px-3 py-3 sm:px-4">Season</th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right">Snowfall</th>
            <th scope="col" className="pc-eyebrow hidden px-3 py-3 text-right md:table-cell">% of normal</th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right">Snow days</th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right">Powder days</th>
            <th scope="col" className="pc-eyebrow hidden px-3 py-3 text-right md:table-cell">Biggest storm</th>
            <th scope="col" className="pc-eyebrow hidden px-3 py-3 text-right md:table-cell">Deepest base</th>
            {showEnso && <th scope="col" className="pc-eyebrow hidden px-3 py-3 lg:table-cell">ENSO</th>}
            <th scope="col" className="pc-eyebrow hidden px-4 py-3 lg:table-cell">Curve</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {seasons.map((s) => (
            <tr key={s.season.key}>
              <td className="px-3 py-3 font-bold text-ink sm:px-4">
                {s.season.label}
                <span className="block text-xs font-normal text-bark">{s.daysMeasured} days measured</span>
              </td>
              <td className={`${num} px-3 py-3 text-right text-ink`}>{inchesLabel(s.totalIn)}</td>
              <td className={`${num} hidden px-3 py-3 text-right md:table-cell ${s.percentOfNormal != null && s.percentOfNormal >= 100 ? "text-forest" : "text-bark-dk"}`}>
                {s.percentOfNormal != null ? `${s.percentOfNormal}%` : "—"}
              </td>
              <td className={`${num} px-3 py-3 text-right text-bark-dk`}>{s.snowDays}</td>
              <td className={`${num} px-3 py-3 text-right text-ink`} title={`Days with ${threshold} in. or more`}>
                {s.powderDays}
              </td>
              <td className="hidden px-3 py-3 text-right md:table-cell">
                {s.maxStorm ? (
                  <>
                    <span className={num}>{inchesLabel(s.maxStorm.totalIn)}</span>
                    <span className="block text-xs text-bark">
                      {formatDayLabel(s.maxStorm.start)}
                      {s.maxStorm.days > 1 ? ` – ${formatDayLabel(s.maxStorm.end)}` : ""}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="hidden px-3 py-3 text-right md:table-cell">
                {s.deepestBase ? (
                  <>
                    <span className={num}>{inchesLabel(s.deepestBase.depthIn)}</span>
                    <span className="block text-xs text-bark">{formatDayLabel(s.deepestBase.date)}</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              {showEnso && (
                <td className="hidden px-3 py-3 lg:table-cell">
                  {s.enso ? (
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${ensoClass(s.enso.phase)}`} title={`DJF ONI ${s.enso.oni > 0 ? "+" : ""}${s.enso.oni} °C`}>
                      {s.enso.label}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              )}
              <td className="hidden px-4 py-3 lg:table-cell">
                <Sparkline values={s.weeklyCumulativeIn} max={max} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
