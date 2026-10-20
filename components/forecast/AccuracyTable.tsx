import type { ForecastAccuracyPublic } from "@/lib/public-api/schema";
import { modelLabel } from "@/lib/forecast/open-meteo-models";
import { formatMountainTime } from "@/lib/quotable";

/** The per-model verification block, rendered only when the scorer has rows for this resort. */

const TH = "px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-bark whitespace-nowrap";
const TD = "px-3 py-2 text-[15px] text-ink whitespace-nowrap";

const fmt = (v: number | null): string => (v == null ? "–" : String(Math.round(v * 10) / 10));

export function AccuracyTable({ accuracy }: { accuracy: ForecastAccuracyPublic }) {
  if (!accuracy.models.length) return null;
  const station = accuracy.station;
  return (
    <>
      <p className="mt-2 text-sm text-bark">
        Truth: {accuracy.truthBasis === "snotel" ? `24 h depth change at ${station?.name ?? station?.id ?? "the resort's SNOTEL station"}${station?.elevationFt ? ` (${Math.round(station.elevationFt).toLocaleString("en-US")} ft)` : ""}` : "no measured series"}
        {" · "}
        {accuracy.measuredDays} measured days in the last {accuracy.periodDays}
        {accuracy.scoredPoint ? ` · graded at the ${accuracy.scoredPoint} point` : ""}
        {accuracy.computedAt ? (
          <>
            {" · scored "}
            <time dateTime={accuracy.computedAt}>{formatMountainTime(accuracy.computedAt)}</time>
          </>
        ) : null}
        .
      </p>
      <div className="mt-4 overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-[1.5px] border-ink">
              <th scope="col" className={`${TH} text-right`}>#</th>
              <th scope="col" className={TH}>Model</th>
              <th scope="col" className={`${TH} text-right`}>Day-1 MAE</th>
              <th scope="col" className={`${TH} text-right`}>Day-3 MAE</th>
              <th scope="col" className={`${TH} text-right`}>Day-7 MAE</th>
              <th scope="col" className={`${TH} text-right`}>Bias</th>
              <th scope="col" className={`${TH} text-right`}>Samples</th>
            </tr>
          </thead>
          <tbody>
            {accuracy.models.map((m) => (
              <tr key={m.model} className={`border-b border-dashed border-bark/40 last:border-b-0 ${m.model === "blend" ? "bg-cream" : ""}`}>
                <td className={`${TD} text-right font-mono text-bark`}>{m.rank ?? "–"}</td>
                <th scope="row" className={`${TD} font-bold`}>{modelLabel(m.model)}</th>
                <td className={`${TD} text-right font-mono`}>{fmt(m.day1Mae)} cm</td>
                <td className={`${TD} text-right font-mono`}>{fmt(m.day3Mae)} cm</td>
                <td className={`${TD} text-right font-mono`}>{fmt(m.day7Mae)} cm</td>
                <td className={`${TD} text-right font-mono`}>{m.biasRatio == null ? "–" : `${Math.round(m.biasRatio * 100) / 100}×`}</td>
                <td className={`${TD} text-right font-mono text-bark`}>{m.samples ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-bark">{accuracy.method}</p>
    </>
  );
}
