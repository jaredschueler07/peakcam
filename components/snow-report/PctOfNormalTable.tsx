import Link from "next/link";
import type { PctOfNormalEntry } from "@/lib/quotable";
import { formatMountainTime, inches } from "@/lib/quotable";

const num = "font-mono text-[13px] font-bold tabular-nums";

/**
 * The leaderboard rows. A Server Component: the order was decided once per
 * ISR render by lib/quotable.ts rankPctOfNormal, there is nothing to hydrate,
 * and the rows are what crawlers and answer engines index. Readable at 375 px:
 * the "measured" column collapses under the resort name on small screens.
 */
export function PctOfNormalTable({ rows }: { rows: PctOfNormalEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-ink/15">
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right sm:px-4">
              #
            </th>
            <th scope="col" className="pc-eyebrow px-3 py-3">
              Resort
            </th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right">
              % of normal
            </th>
            <th scope="col" className="pc-eyebrow px-3 py-3 text-right sm:px-4">
              SWE
            </th>
            <th scope="col" className="pc-eyebrow hidden px-4 py-3 text-right md:table-cell">
              Measured
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {rows.map((row, i) => {
            const measured = formatMountainTime(row.updatedAt);
            return (
              <tr key={row.slug}>
                <td className={`${num} px-3 py-3 text-right text-bark sm:px-4`}>{i + 1}</td>
                <td className="px-3 py-3">
                  <Link href={`/resorts/${row.slug}`} className="font-bold text-ink underline-offset-2 hover:underline">
                    {row.name}
                  </Link>
                  {measured && (
                    <span className="block text-xs text-bark md:hidden">
                      <time dateTime={row.updatedAt}>{measured}</time>
                    </span>
                  )}
                </td>
                <td className={`${num} px-3 py-3 text-right ${row.pct >= 100 ? "text-forest" : "text-ink"}`}>
                  {row.pct}%
                </td>
                <td className={`${num} px-3 py-3 text-right text-bark-dk sm:px-4`}>{inches(row.sweIn)}</td>
                <td className="hidden px-4 py-3 text-right text-xs text-bark md:table-cell">
                  {measured ? <time dateTime={row.updatedAt}>{measured}</time> : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
