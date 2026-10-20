import type { MonthClimatologyPublic } from "@/lib/public-api/schema";
import { formatDayLabel, inchesLabel } from "@/lib/season-stats";

const num = "font-mono text-[13px] font-bold tabular-nums";

/**
 * Average monthly snowfall as bars (30-winter) with the recent-decade value
 * as a tick, plus the full table underneath so every number is in the HTML.
 * Months with no readings in any winter (summer) are left out of the chart.
 */
export function MonthlyBars({ months }: { months: MonthClimatologyPublic[] }) {
  const shown = months.filter((m) => m.thirtyYear.yearsTracked > 0 || m.recentDecade.yearsTracked > 0);
  const max = Math.max(1, ...shown.map((m) => Math.max(m.thirtyYear.avgSnowfallIn ?? 0, m.recentDecade.avgSnowfallIn ?? 0)));
  const W = 720;
  const H = 220;
  const PAD = { top: 14, right: 12, bottom: 28, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, shown.length);
  const barW = slot * 0.56;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const yMax = Math.ceil(max / 10) * 10 || 10;
  const ticks = [0, Math.round(yMax / 2), yMax];

  return (
    <div className="space-y-4">
      {shown.length > 0 && (
        <figure className="rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-3 shadow-stamp sm:p-4">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby="monthly-bars-title" className="h-auto w-full">
            <title id="monthly-bars-title">Average monthly snowfall, 30 winters, with the last ten winters marked</title>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y((t / yMax) * max)} y2={y((t / yMax) * max)} stroke="#2a1f14" strokeOpacity={t === 0 ? 0.6 : 0.12} />
                <text x={PAD.left - 8} y={y((t / yMax) * max) + 4} textAnchor="end" fontSize={11} fontFamily="ui-monospace, monospace" fill="#5a4330">
                  {t}
                </text>
              </g>
            ))}
            {shown.map((m, i) => {
              const cx = PAD.left + slot * i + slot / 2;
              const v30 = m.thirtyYear.avgSnowfallIn ?? 0;
              const v10 = m.recentDecade.avgSnowfallIn;
              return (
                <g key={m.month}>
                  <rect x={cx - barW / 2} y={y(v30)} width={barW} height={Math.max(0, PAD.top + innerH - y(v30))} fill="#3c5a3a" stroke="#2a1f14" strokeWidth={1.5} />
                  {v10 != null && <line x1={cx - barW / 2 - 4} x2={cx + barW / 2 + 4} y1={y(v10)} y2={y(v10)} stroke="#d9552f" strokeWidth={3} />}
                  <text x={cx} y={H - PAD.bottom + 16} textAnchor="middle" fontSize={11} fontFamily="ui-monospace, monospace" fill="#5a4330">
                    {m.label}
                  </text>
                  <text x={cx} y={y(v30) - 5} textAnchor="middle" fontSize={11} fontFamily="ui-monospace, monospace" fill="#2a1f14">
                    {Math.round(v30)}
                  </text>
                </g>
              );
            })}
          </svg>
          <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-bark">
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block h-3 w-4 border border-ink bg-forest" /> 30-winter average, inches
            </span>
            <span className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block h-[3px] w-5 bg-alpen" /> last ten winters
            </span>
          </figcaption>
        </figure>
      )}
      <div className="overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink/15">
              <th scope="col" className="pc-eyebrow px-3 py-3 sm:px-4">Month</th>
              <th scope="col" className="pc-eyebrow px-3 py-3 text-right">Avg snowfall</th>
              <th scope="col" className="pc-eyebrow px-3 py-3 text-right">Last 10 winters</th>
              <th scope="col" className="pc-eyebrow hidden px-3 py-3 text-right sm:table-cell">Snow days</th>
              <th scope="col" className="pc-eyebrow hidden px-3 py-3 text-right md:table-cell">Avg depth</th>
              <th scope="col" className="pc-eyebrow hidden px-3 py-3 text-right md:table-cell">Biggest storm</th>
              <th scope="col" className="pc-eyebrow hidden px-4 py-3 text-right lg:table-cell">Winters</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {shown.map((m) => (
              <tr key={m.month}>
                <td className="px-3 py-3 font-bold text-ink sm:px-4">{m.label}</td>
                <td className={`${num} px-3 py-3 text-right text-ink`}>{inchesLabel(m.thirtyYear.avgSnowfallIn)}</td>
                <td className={`${num} px-3 py-3 text-right ${m.recentVsThirtyPct != null && m.recentVsThirtyPct < 90 ? "text-alpen-dk" : m.recentVsThirtyPct != null && m.recentVsThirtyPct > 110 ? "text-forest" : "text-bark-dk"}`}>
                  {inchesLabel(m.recentDecade.avgSnowfallIn)}
                  {m.recentVsThirtyPct != null && <span className="ml-1 text-xs font-normal text-bark">({m.recentVsThirtyPct}%)</span>}
                </td>
                <td className={`${num} hidden px-3 py-3 text-right text-bark-dk sm:table-cell`}>{m.thirtyYear.avgSnowDays ?? "—"}</td>
                <td className={`${num} hidden px-3 py-3 text-right text-bark-dk md:table-cell`}>{inchesLabel(m.thirtyYear.avgDepthIn)}</td>
                <td className="hidden px-3 py-3 text-right md:table-cell">
                  {m.thirtyYear.maxStormIn != null ? (
                    <>
                      <span className={num}>{inchesLabel(m.thirtyYear.maxStormIn)}</span>
                      {m.thirtyYear.maxStormStart && <span className="block text-xs text-bark">{formatDayLabel(m.thirtyYear.maxStormStart, 0)}</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${num} hidden px-4 py-3 text-right text-bark lg:table-cell`}>{m.thirtyYear.yearsTracked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.some((m) => m.baselineNote) && (
        <ul className="space-y-1 text-sm text-bark-dk">
          {shown.filter((m) => m.baselineNote).map((m) => (
            <li key={m.month}>
              <span className="font-bold text-ink">{m.label}:</span> {m.baselineNote}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
