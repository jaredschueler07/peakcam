import type { ForecastBlendDayPublic, ForecastSummaryPublic } from "@/lib/public-api/schema";
import { modelLabel } from "@/lib/forecast/open-meteo-models";
import { formatMountainTime } from "@/lib/quotable";
import WeatherIcon from "@/components/weather/WeatherIcon";

/**
 * One point's 14-day blend as a table: the per-day median with the
 * 25th–75th band, temperatures, precipitation chance, gust and how many
 * models reached the day. Server markup only, so every number is in the
 * HTML for crawlers and assistants; the resort overview's ForecastStrip is
 * the compact client version of the same data.
 */

const TH = "px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-bark whitespace-nowrap";
const TD = "px-3 py-2 text-[15px] text-ink whitespace-nowrap";
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

export function dayLabel(date: string, index: number): string {
  if (index === 0) return "Today";
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : DAY.format(d);
}

export function inchesCell(value: number): string {
  return value > 0 ? `${value}″` : "–";
}

export function BlendDailyTable({ summary, daily, elevationFt }: { summary: ForecastSummaryPublic; daily: ForecastBlendDayPublic[]; elevationFt: number | null }) {
  return (
    <>
      <p className="mt-2 text-sm text-bark">
        {summary.point === "summit" ? "Summit" : "Base"} point{elevationFt != null ? ` at ${Math.round(elevationFt).toLocaleString("en-US")} ft` : ""} · issued{" "}
        <time dateTime={summary.issuedAt}>{formatMountainTime(summary.issuedAt)}</time> · {summary.models.length} models:{" "}
        {summary.models.map(modelLabel).join(", ")}.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Next 48 h", `${summary.next48hIn}″`],
          ["Next 7 days", `${summary.total7dIn}″`],
          ["Next 14 days", `${summary.total14dIn}″`],
          ["Biggest day", summary.peak ? `${summary.peak.in}″ on ${dayLabel(summary.peak.date, 1)}` : "none"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[14px] border-[1.5px] border-ink bg-cream-50 px-3 py-2 shadow-stamp-sm">
            <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-bark">{label}</dt>
            <dd className="font-display text-xl font-black text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-[1.5px] border-ink">
              <th scope="col" className={TH}>Day</th>
              <th scope="col" className={TH}>Sky</th>
              <th scope="col" className={TH}>Snow (median)</th>
              <th scope="col" className={TH}>Low – high</th>
              <th scope="col" className={TH}>High / low</th>
              <th scope="col" className={TH}>Precip</th>
              <th scope="col" className={TH}>Gust</th>
              <th scope="col" className={TH}>Models</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d, i) => (
              <tr key={d.date} className="border-b border-dashed border-bark/40 last:border-b-0">
                <th scope="row" className={`${TD} font-bold`}>
                  <time dateTime={d.date}>{dayLabel(d.date, i)}</time>
                </th>
                <td className={TD}>
                  <WeatherIcon condition={d.condition} size={18} />
                </td>
                <td className={`${TD} font-mono font-bold text-alpen-dk`}>{inchesCell(d.snowfallIn)}</td>
                <td className={`${TD} font-mono text-bark-dk`}>{d.snowfallHiIn > 0 ? `${d.snowfallLoIn}″ – ${d.snowfallHiIn}″` : "–"}</td>
                <td className={`${TD} font-mono`}>
                  {d.tempMaxF ?? "–"}° / {d.tempMinF ?? "–"}°
                </td>
                <td className={`${TD} font-mono`}>{d.precipProb == null ? "–" : `${d.precipProb}%`}</td>
                <td className={`${TD} font-mono`}>{d.windGustMph == null ? "–" : `${d.windGustMph} mph`}</td>
                <td className={`${TD} font-mono text-bark`}>{d.modelCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
