import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getAllResortSlugs,
  getResortBySlug,
  getResortElevationFt,
  getResortOpenings,
  getSnowpackHistory,
  getUserConditions,
} from "@/lib/supabase";
import { getWeatherForecast } from "@/lib/weather";
import { getOpenMeteoForecast } from "@/lib/open-meteo";
import { formatMountainTime, resortSentence, sourceLabel } from "@/lib/quotable";
import { stationFor } from "@/lib/stations";
import { publishablePctOfNormal, stateLabel } from "@/lib/resort-copy";
import { breadcrumbListLd, resortBreadcrumb, resortTabMarkdownPath, resortTabPath, resortTabUrl, snowReportTitle } from "@/lib/resort-pages";
import { formatFeet } from "@/lib/resort-profile";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";
import { ResortTabs } from "@/components/resort/ResortTabs";
import { FreshnessSentence } from "@/components/resort/FreshnessSentence";
import type { SnowHistoryRow } from "@/lib/mcp/types";
import type { WeatherPeriod } from "@/lib/types";

// Same ISR window and static-params contract as the overview
// (app/resorts/[slug]/page.tsx): the set of slugs is fixed per deploy, a
// listing failure fails the build rather than silently emitting zero pages.
export const revalidate = 3600;
export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await getAllResortSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) return {};
  const pageUrl = resortTabUrl(slug, "snow-report");
  const station = stationFor(resort);
  const description = station
    ? `${resort.name} snow report with base depth, new snow and snow water equivalent measured at the ${station.name} NRCS station, a 7-day history, the forecast and on-mountain reports, each dated to its reading.`
    : `${resort.name} snow report: base depth, new snow and a 7-day history as weather-model estimates (no NRCS station here), with the forecast and on-mountain reports, each dated.`;
  const title = snowReportTitle(resort.name);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: pageUrl, types: { "text/markdown": `${SITE_URL}${resortTabMarkdownPath(slug, "snow-report")}` } },
    openGraph: { type: "website", url: pageUrl, title, description, siteName: "PeakCam" },
    twitter: { card: "summary_large_image", title, description },
  };
}

const UTC_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

function day(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : UTC_DAY.format(d);
}

function inches(value: number | string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Number.isInteger(n) ? n : Math.round(n * 10) / 10}″`;
}

function degrees(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value)}°`;
}

const TH = "px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-bark";
const TD = "px-3 py-2 text-[15px] text-ink";

export default async function ResortSnowReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) return notFound();

  const isUS = resort.country === "US";
  const elevationFt = isUS ? null : await getResortElevationFt(resort.id);
  const [history, forecast, userConditions, openings] = await Promise.all([
    getSnowpackHistory(resort.id, 7),
    isUS ? getWeatherForecast(resort.lat, resort.lng) : getOpenMeteoForecast(resort.lat, resort.lng, elevationFt),
    getUserConditions(resort.id),
    resort.snow_report ? Promise.resolve([]) : getResortOpenings(),
  ]);

  const station = stationFor(resort);
  const now = new Date();
  const freshness = resortSentence(resort, now, {
    station,
    opening: openings.find((row) => row.resort_id === resort.id) ?? null,
  });
  const snow = resort.snow_report;
  const pageUrl = resortTabUrl(resort.slug, "snow-report");
  const breadcrumb = resortBreadcrumb(resort, "snow-report");
  const title = snowReportTitle(resort.name);

  // Freshness for the WebPage node: the report's own timestamp, else the
  // newest history day — never the render time.
  const dateModified = snow?.updated_at ?? (history[0] ? `${history[0].date}T00:00:00Z` : null);
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: pageUrl,
    name: title,
    isPartOf: { "@type": "WebSite", name: "PeakCam", url: SITE_URL },
    about: { "@id": resortTabUrl(resort.slug, "overview") },
    ...(dateModified ? { dateModified } : {}),
  };

  const pct = snow ? publishablePctOfNormal(snow, Boolean(resort.snotel_station_id)) : null;
  const measuredAt = snow ? formatMountainTime(snow.updated_at) : "";
  const source = snow ? sourceLabel(snow.source) : "";
  const rows: Array<{ label: string; value: string }> = snow
    ? [
        { label: "Base depth", value: inches(snow.base_depth) },
        { label: "New snow, 24 h", value: inches(snow.new_snow_24h) },
        { label: "New snow, 48 h", value: inches(snow.new_snow_48h) },
        { label: "Snow water equivalent", value: inches(snow.swe_in) },
        { label: "Percent of normal", value: pct == null ? "—" : `${pct}%` },
      ]
    : [];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbListLd(breadcrumb)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      <Header showSearch={false} />
      <div className="border-b border-bark/30 bg-cream px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-5xl">
          <HubBreadcrumb items={breadcrumb} />
          <p className="pc-eyebrow mb-2 mt-5">
            {station ? `Measured at ${station.name}${station.elevationFt != null ? `, ${formatFeet(station.elevationFt)}` : ""}` : "Weather-model estimates"}
          </p>
          <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">
            {resort.name} snow report
          </h1>
          <FreshnessSentence segments={freshness.segments} />
          <p className="mt-1.5 text-sm text-bark">
            {resort.region} · {stateLabel(resort)}
          </p>
        </div>
      </div>
      <ResortTabs slug={resort.slug} active="snow-report" />

      <main id="main-content" className="mx-auto max-w-5xl space-y-12 px-4 py-10 md:px-8">
        <section aria-labelledby="today-heading">
          <h2 id="today-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            Today&rsquo;s numbers
          </h2>
          {snow ? (
            <>
              <p className="mt-2 text-sm text-bark">
                Source: {source}
                {station && snow.source === "snotel" ? ` (${station.name}${station.elevationFt != null ? `, ${formatFeet(station.elevationFt)}` : ""})` : ""}. Measured{" "}
                <time dateTime={snow.updated_at}>{measuredAt}</time>.
              </p>
              <div className="mt-4 overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp-sm">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-[1.5px] border-ink">
                      <th scope="col" className={TH}>Measure</th>
                      <th scope="col" className={TH}>Value</th>
                      <th scope="col" className={TH}>Source</th>
                      <th scope="col" className={TH}>Measured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label} className="border-b border-dashed border-bark/40 last:border-b-0">
                        <th scope="row" className={`${TD} font-bold`}>{row.label}</th>
                        <td className={`${TD} font-mono`}>{row.value}</td>
                        <td className={`${TD} text-bark`}>{source}</td>
                        <td className={`${TD} text-bark`}><time dateTime={snow.updated_at}>{measuredAt}</time></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="mt-3 text-[15.5px] text-ink">No snow report yet this season. The first station reading or model run appears here within six hours of the sync picking it up.</p>
          )}
        </section>

        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            Last {history.length || 7} days
          </h2>
          <HistoryTable rows={history} />
        </section>

        <section aria-labelledby="forecast-heading">
          <h2 id="forecast-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            Forecast
          </h2>
          <ForecastTable periods={forecast} isUS={isUS} />
        </section>

        <section aria-labelledby="reports-heading">
          <h2 id="reports-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            On-mountain reports
          </h2>
          <p className="mt-3 text-[15.5px] text-ink">
            {userConditions.length === 0
              ? "No user-submitted conditions reports in the last 48 hours."
              : `${userConditions.length} user-submitted conditions report${userConditions.length === 1 ? "" : "s"} in the last 48 hours.`}{" "}
            <Link href={`${resortTabPath(resort.slug, "overview")}#conditions-report`} className="font-bold text-ink underline-offset-2 hover:underline">
              Read or add one on the overview
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="station-heading" className="max-w-3xl">
          <h2 id="station-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            Where these numbers come from
          </h2>
          <p className="mt-3 text-[15.5px] leading-relaxed text-ink">
            {station ? (
              <>
                Depth, new snow and snow water equivalent are read from the {station.name} NRCS station
                {station.elevationFt != null ? ` at ${formatFeet(station.elevationFt)}` : ""}, synced every six hours and run through range and spike checks. A station sits at one elevation, so it can disagree with the resort&rsquo;s own upper-mountain report.
              </>
            ) : (
              <>
                {resort.name} has no NRCS telemetry station, so depth and new-snow figures are weather-model estimates (Open-Meteo), refreshed every six hours. They are a good storm signal, not a ground measurement.
              </>
            )}{" "}
            <Link href="/methodology#snotel" className="font-bold text-ink underline-offset-2 hover:underline">
              How PeakCam reads the sensors
            </Link>
            .
          </p>
        </section>
      </main>
      <PeakFooter />
    </>
  );
}

function HistoryTable({ rows }: { rows: SnowHistoryRow[] }) {
  if (!rows.length) {
    return <p className="mt-3 text-[15.5px] text-ink">No daily station history stored for this resort yet.</p>;
  }
  const station = rows[0].station_id;
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-[1.5px] border-ink">
              <th scope="col" className={TH}>Date</th>
              <th scope="col" className={TH}>Snow depth</th>
              <th scope="col" className={TH}>SWE</th>
              <th scope="col" className={TH}>Precip (accum.)</th>
              <th scope="col" className={TH}>High / low</th>
              <th scope="col" className={TH}>QC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-b border-dashed border-bark/40 last:border-b-0">
                <th scope="row" className={`${TD} font-bold`}><time dateTime={r.date}>{day(r.date)}</time></th>
                <td className={`${TD} font-mono`}>{inches(r.snow_depth_in)}</td>
                <td className={`${TD} font-mono`}>{inches(r.swe_in)}</td>
                <td className={`${TD} font-mono`}>{inches(r.precip_accum_in)}</td>
                <td className={`${TD} font-mono`}>{degrees(r.temp_max_f)} / {degrees(r.temp_min_f)}</td>
                <td className={`${TD} text-bark`}>{r.qc_flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-bark">
        {station === "open-meteo"
          ? "Weather-model estimates (Open-Meteo), one row per day."
          : `Daily readings from NRCS station ${station}; suspect rows are kept and flagged.`}
      </p>
    </>
  );
}

function ForecastTable({ periods, isUS }: { periods: WeatherPeriod[] | null; isUS: boolean }) {
  if (!periods || !periods.length) {
    return <p className="mt-3 text-[15.5px] text-ink">Forecast unavailable right now; it returns on the next hourly refresh.</p>;
  }
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-[1.5px] border-ink">
              <th scope="col" className={TH}>Day</th>
              <th scope="col" className={TH}>Forecast</th>
              <th scope="col" className={TH}>High / low</th>
              <th scope="col" className={TH}>Est. snow</th>
              <th scope="col" className={TH}>Precip chance</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={`${p.dow}-${i}`} className="border-b border-dashed border-bark/40 last:border-b-0">
                <th scope="row" className={`${TD} font-bold`}>{p.dow}</th>
                <td className={TD}>{p.shortForecast}</td>
                <td className={`${TD} font-mono`}>{degrees(p.high)} / {degrees(p.low)}</td>
                <td className={`${TD} font-mono`}>{inches(p.snowInches)}</td>
                <td className={`${TD} font-mono`}>{p.precipProbability == null ? "—" : `${Math.round(p.precipProbability)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-bark">
        {isUS
          ? "National Weather Service point forecast. Snow amounts are keyword estimates from the forecast text, not a quantitative precipitation forecast."
          : "Open-Meteo model forecast for the resort's coordinates. Snow amounts are model estimates."}
      </p>
    </>
  );
}
