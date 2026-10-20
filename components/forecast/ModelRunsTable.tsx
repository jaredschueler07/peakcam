import type { ForecastRunPublic } from "@/lib/public-api/schema";
import { MODEL_INFO, modelLabel, type ForecastModelId } from "@/lib/forecast/open-meteo-models";
import { cmToInches } from "@/lib/open-meteo";
import { formatMountainTime } from "@/lib/quotable";

/**
 * Every contributing model run for one point, one row per model, one column
 * per day, collapsed in a native <details> so the page opens on the blend.
 * No client JS: the browser owns the toggle and the rows are in the HTML.
 */

const TH = "px-2 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-bark whitespace-nowrap";
const TD = "px-2 py-2 text-[14px] text-ink whitespace-nowrap";

const round1 = (v: number): number => Math.round(v * 10) / 10;

export function ModelRunsTable({ runs, dates, point }: { runs: ForecastRunPublic[]; dates: string[]; point: string }) {
  if (!runs.length) return null;
  return (
    <details className="mt-4 rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp-sm">
      <summary className="cursor-pointer px-4 py-3 font-bold text-ink">
        Every model at the {point} ({runs.length} runs) — snowfall in inches per day
      </summary>
      <div className="overflow-x-auto border-t border-dashed border-bark/40">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-[1.5px] border-ink">
              <th scope="col" className={TH}>Model</th>
              <th scope="col" className={TH}>Issued</th>
              <th scope="col" className={TH}>Horizon</th>
              {dates.map((date) => (
                <th key={date} scope="col" className={`${TH} text-right`}>
                  {date.slice(5)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const byDate = new Map(run.days.map((d) => [d.date, d.snowfallCm]));
              const info = MODEL_INFO[run.model as ForecastModelId];
              return (
                <tr key={run.id} className="border-b border-dashed border-bark/40 last:border-b-0">
                  <th scope="row" className={`${TD} font-bold`}>
                    {modelLabel(run.model)}
                    {info ? <span className="block text-xs font-normal text-bark">{info.provider}</span> : null}
                  </th>
                  <td className={`${TD} text-bark`}>
                    <time dateTime={run.issuedAt}>{formatMountainTime(run.issuedAt)}</time>
                  </td>
                  <td className={`${TD} font-mono text-bark`}>{run.horizonDays} d</td>
                  {dates.map((date) => {
                    const cm = byDate.get(date);
                    const inches = cm == null ? null : round1(cmToInches(cm));
                    return (
                      <td key={date} className={`${TD} text-right font-mono ${inches ? "text-alpen-dk font-bold" : "text-bark"}`}>
                        {inches == null ? "–" : inches > 0 ? inches : "0"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-xs text-bark">A dash means the model does not reach that day. Runs are the newest per model within 36 hours.</p>
    </details>
  );
}
