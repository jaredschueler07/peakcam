"use client";

import type { ForecastSummaryPublic, ForecastBlendDayPublic } from "@/lib/public-api/schema";
import WeatherIcon from "@/components/weather/WeatherIcon";

/** What the resort page gets from the server: the blended days and the summary, already serialised. */
export interface ForecastStripData {
  summary: ForecastSummaryPublic;
  daily: ForecastBlendDayPublic[];
  /** Where to read the method and the per-model view. */
  apiUrl: string;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dowOf(date: string, index: number): string {
  if (index === 0) return "Today";
  const d = new Date(`${date}T00:00:00Z`);
  return DAY_NAMES[d.getUTCDay()];
}

function dayNum(date: string): string {
  return String(Number(date.slice(8, 10)));
}

/** "N models agree" when the band is tight, "N models, 2–6 in" when it is not. */
export function agreementCopy(day: ForecastBlendDayPublic): string {
  const n = day.modelCount;
  const spread = day.snowfallHiIn - day.snowfallLoIn;
  if (n <= 1) return "1 model";
  if (spread <= Math.max(1, day.snowfallIn * 0.5)) return `${n} models agree`;
  return `${n} models, ${day.snowfallLoIn}–${day.snowfallHiIn} in`;
}

function headline(summary: ForecastSummaryPublic): string {
  if (summary.total14dIn <= 0) return "No snow in the 14-day blend";
  const peak = summary.peak ? ` · peak ${summary.peak.in} in on ${new Date(`${summary.peak.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}` : "";
  return `${summary.total7dIn} in next 7 days · ${summary.total14dIn} in over 14${peak}`;
}

// Paper-card 14-day strip: the blended median per day with the cross-model
// band, the model count, and the Open-Meteo credit the licence requires.
export function ForecastStrip({ data }: { data: ForecastStripData }) {
  const { summary, daily } = data;
  const maxSnow = Math.max(1, ...daily.map((d) => d.snowfallHiIn));
  const first = daily[0];
  return (
    <div className="bg-cream-50 border-[1.5px] border-ink rounded-[18px] shadow-stamp overflow-hidden">
      <div className="px-4 py-3 border-b-[1.5px] border-dashed border-bark bg-cream flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="font-mono font-bold text-[11px] uppercase tracking-[0.14em] text-bark">14-day snow outlook · {summary.point}</p>
          <p className="font-display font-black text-ink text-[17px] leading-tight">{headline(summary)}</p>
        </div>
        {first && (
          <p className="font-mono text-[11px] text-bark" aria-label="Model agreement for the first day">
            {agreementCopy(first)} today · {summary.models.length} models in the blend
          </p>
        )}
      </div>

      <ol className="grid grid-cols-7 md:grid-cols-[repeat(14,minmax(0,1fr))] divide-x divide-dashed divide-bark/40" aria-label="Blended daily snowfall, next 14 days">
        {daily.map((d, i) => {
          const h = Math.min(100, (d.snowfallHiIn / maxSnow) * 100);
          const med = Math.min(100, (d.snowfallIn / maxSnow) * 100);
          const lo = Math.min(100, (d.snowfallLoIn / maxSnow) * 100);
          return (
            <li key={d.date} className={`px-1.5 py-2 text-center ${i >= 7 ? "border-t border-dashed border-bark/40 md:border-t-0" : ""}`}>
              <p className="font-mono font-bold text-[10px] uppercase tracking-[0.08em] text-bark">{dowOf(d.date, i)}</p>
              <p className="font-mono text-[10px] text-bark/80">{dayNum(d.date)}</p>
              <div className="my-1 flex justify-center">
                <WeatherIcon condition={d.condition} size={18} />
              </div>
              <div
                className="relative mx-auto h-14 w-4 rounded-full border-[1.5px] border-ink bg-cream-dk overflow-hidden"
                role="img"
                aria-label={`${d.snowfallIn} in, ${d.snowfallLoIn} to ${d.snowfallHiIn} in across ${d.modelCount} models`}
                title={agreementCopy(d)}
              >
                <div className="absolute inset-x-0 bottom-0 bg-alpen/35" style={{ height: `${h}%` }} />
                <div className="absolute inset-x-0 bottom-0 bg-alpen" style={{ height: `${med}%` }} />
                <div className="absolute inset-x-0 bottom-0 bg-alpen-dk" style={{ height: `${lo}%` }} />
              </div>
              <p className="mt-1 font-mono font-bold text-[12px] tabular-nums text-alpen-dk">{d.snowfallIn > 0 ? `${d.snowfallIn}"` : "–"}</p>
              <p className="font-mono text-[10px] tabular-nums text-ink">
                {d.tempMaxF != null ? `${d.tempMaxF}°` : "–"}
                <span className="text-bark">{d.tempMinF != null ? `/${d.tempMinF}°` : ""}</span>
              </p>
              <p className="font-mono text-[9px] text-bark/80">{d.modelCount}m</p>
            </li>
          );
        })}
      </ol>

      <p className="px-4 py-2 border-t border-dashed border-bark/40 text-[11px] text-bark">
        Median of the models that reach each day; the pale band is the 25th–75th percentile across models. Updated every 6 hours.{" "}
        <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
          Weather data by Open-Meteo.com
        </a>{" "}
        (CC BY 4.0) ·{" "}
        <a href={data.apiUrl} className="underline underline-offset-2 hover:text-ink">
          every model
        </a>{" "}
        ·{" "}
        <a href="/methodology#forecast" className="underline underline-offset-2 hover:text-ink">
          how it is verified
        </a>
      </p>
    </div>
  );
}
