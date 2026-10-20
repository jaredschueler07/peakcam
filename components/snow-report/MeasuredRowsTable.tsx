import Link from "next/link";
import type { MeasuredRow } from "@/lib/snow-hubs";
import { stateLabel } from "@/lib/hubs";
import { formatMountainTime, inches, sourceLabel } from "@/lib/quotable";

/**
 * The ranked "today's numbers" table the per-state snow-report hubs and the
 * pass pages share: the leaderboard layout (rank, resort, base, new snow,
 * source, dated) over lib/snow-hubs.ts MeasuredRow. Server markup only.
 */

const num = "font-mono text-[13px] font-bold tabular-nums";

function Cell({ value, strong = false }: { value: number | null; strong?: boolean }) {
  if (value == null) return <span className={`${num} text-bark`}>—</span>;
  return <span className={`${num} ${strong && value > 0 ? "text-ink" : "text-bark-dk"}`}>{inches(value)}</span>;
}

export function MeasuredRowsTable({ rows, placeColumn }: { rows: MeasuredRow[]; placeColumn: "region" | "state" }) {
  return (
    <div className="overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink/15">
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right sm:px-4">#</th>
            <th scope="col" className="pc-eyebrow px-3 py-3">Resort</th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right">Base</th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right">24 h</th>
            <th scope="col" className="pc-eyebrow hidden px-3 py-3 text-right sm:table-cell">48 h</th>
            <th scope="col" className="pc-eyebrow hidden px-3 py-3 md:table-cell">Source</th>
            <th scope="col" className="pc-eyebrow hidden px-4 py-3 text-right md:table-cell">Dated</th>
            <th scope="col" className="pc-eyebrow hidden px-3 py-3 text-right lg:table-cell">Cams</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {rows.map((row, i) => (
            <tr key={row.slug}>
              <td className={`${num} px-3 py-3 text-right text-bark sm:px-4`}>{i + 1}</td>
              <td className="px-3 py-3">
                <Link href={`/resorts/${row.slug}`} prefetch={false} className="font-bold text-ink underline-offset-2 hover:underline">
                  {row.name}
                </Link>
                <span className="block text-xs text-bark">
                  {placeColumn === "state" ? stateLabel(row.state) : row.region || "—"}
                  <span className="md:hidden">{row.source ? ` · ${sourceLabel(row.source)}` : " · no report"}</span>
                </span>
              </td>
              <td className="px-3 py-3 text-right"><Cell value={row.baseIn} strong /></td>
              <td className="px-3 py-3 text-right"><Cell value={row.new24In} strong /></td>
              <td className="hidden px-3 py-3 text-right sm:table-cell"><Cell value={row.new48In} /></td>
              <td className="hidden px-3 py-3 text-xs text-bark md:table-cell">
                {row.source ? `${sourceLabel(row.source)}${row.stationName ? ` · ${row.stationName}` : ""}` : "no report yet"}
              </td>
              <td className="hidden px-4 py-3 text-right text-xs text-bark md:table-cell">
                {row.measuredAt ? <time dateTime={row.measuredAt}>{formatMountainTime(row.measuredAt)}</time> : "—"}
              </td>
              <td className={`${num} hidden px-3 py-3 text-right text-bark lg:table-cell`}>{row.liveCams}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
