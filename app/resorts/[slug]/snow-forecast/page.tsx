import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getResortBySlug } from "@/lib/supabase";
import { loadResortAccuracy, loadResortForecast } from "@/lib/public-api/data";
import { FORECAST_CREDITS, serializeForecast, serializeForecastAccuracy } from "@/lib/public-api/forecast";
import { resolveElevation } from "@/lib/resort-profile";
import { stateLabel } from "@/lib/resort-copy";
import { breadcrumbListLd, resortBreadcrumb, resortTabMarkdownPath, resortTabPath, resortTabUrl, snowForecastTitle } from "@/lib/resort-pages";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";
import { ResortTabs } from "@/components/resort/ResortTabs";
import { BlendDailyTable } from "@/components/forecast/BlendDailyTable";
import { ModelRunsTable } from "@/components/forecast/ModelRunsTable";
import { AccuracyTable } from "@/components/forecast/AccuracyTable";

// /resorts/{slug}/snow-forecast — the P4 multi-model blend at the summit and
// base points, every model run (collapsed), and how the models have verified
// here (parity plan P2 block 2). Rendered on demand with hourly ISR like the
// history page rather than prerendered: the stored runs change every 6 h and
// 148 cold reads at build time is what starves Supabase. A slug the
// catalogue does not know is a 404.
export const revalidate = 3600;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) return {};
  const pageUrl = resortTabUrl(slug, "snow-forecast");
  const title = snowForecastTitle(resort.name);
  const description = `${resort.name} 14-day snow forecast: the median across up to ${resort.country === "US" ? "nine" : "seven"} weather models at the summit and base with the cross-model spread, every model run, and how each model has verified against measured snow here.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: pageUrl, types: { "text/markdown": `${SITE_URL}${resortTabMarkdownPath(slug, "snow-forecast")}` } },
    keywords: [`${resort.name} snow forecast`, `${resort.name} 14 day forecast`, `${resort.name} powder forecast`, "ski resort snow forecast", "multi-model snow forecast"],
    openGraph: { type: "website", url: pageUrl, title, description, siteName: "PeakCam" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ResortSnowForecastPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) return notFound();

  const now = new Date();
  const [stored, accuracyInput] = await Promise.all([loadResortForecast(resort.id), loadResortAccuracy(resort)]);
  const summit = serializeForecast(resort, stored, { now, point: "summit" });
  const hasBase = summit.points.includes("base") && summit.point !== "base";
  const base = hasBase ? serializeForecast(resort, stored, { now, point: "base" }) : null;
  const accuracy = serializeForecastAccuracy(resort, accuracyInput, { now });
  const elevation = resolveElevation(resort);

  const pageUrl = resortTabUrl(resort.slug, "snow-forecast");
  const apiUrl = `/api/v1/resorts/${resort.slug}/forecast`;
  const breadcrumb = resortBreadcrumb(resort, "snow-forecast");
  const title = snowForecastTitle(resort.name);
  // Freshness: the newest run the blend used, never the render time.
  const dateModified = summit.summary?.issuedAt ?? null;
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: pageUrl,
    name: title,
    isPartOf: { "@type": "WebSite", name: "PeakCam", url: SITE_URL },
    about: { "@id": resortTabUrl(resort.slug, "overview") },
    ...(dateModified ? { dateModified } : {}),
  };
  const datasetLd = summit.available
    ? {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: `${resort.name} 14-day blended snow forecast`,
        description: summit.method,
        url: pageUrl,
        license: `${SITE_URL}/about#terms`,
        creator: { "@type": "Organization", name: "PeakCam", url: SITE_URL },
        isBasedOn: FORECAST_CREDITS.map((c) => c.url),
        distribution: [
          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE_URL}${apiUrl}` },
          { "@type": "DataDownload", encodingFormat: "text/markdown", contentUrl: `${SITE_URL}${resortTabMarkdownPath(resort.slug, "snow-forecast")}` },
        ],
        ...(dateModified ? { dateModified } : {}),
      }
    : null;

  const headline = summit.summary
    ? summit.summary.total14dIn <= 0
      ? `No snow in the 14-day blend for ${resort.name}.`
      : `${summit.summary.total7dIn}″ in the next 7 days and ${summit.summary.total14dIn}″ over 14 at the ${summit.point}${summit.summary.peak ? `, the biggest day ${summit.summary.peak.in}″` : ""}, the median of ${summit.summary.models.length} models.`
    : `No current model run is stored for ${resort.name}; the forecast job writes one every 6 hours.`;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbListLd(breadcrumb)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      {datasetLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetLd) }} />}
      <Header showSearch={false} />
      <div className="border-b border-bark/30 bg-cream px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-5xl">
          <HubBreadcrumb items={breadcrumb} />
          <p className="pc-eyebrow mb-2 mt-5">14-day multi-model blend{summit.summary ? ` · ${summit.summary.models.length} models` : ""}</p>
          <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">
            {resort.name} snow forecast
          </h1>
          <p className="mt-4 max-w-2xl text-balance text-lg leading-snug text-bark-dk" id="forecast-headline">
            {summit.summary?.issuedAt ? `As of the ${new Date(summit.summary.issuedAt).toISOString().slice(0, 10)} runs: ` : ""}
            {headline}
          </p>
          <p className="mt-1.5 text-sm text-bark">
            {resort.region} · {stateLabel(resort)}
          </p>
        </div>
      </div>
      <ResortTabs slug={resort.slug} active="snow-forecast" />

      <main id="main-content" className="mx-auto max-w-5xl space-y-12 px-4 py-10 md:px-8">
        <section aria-labelledby="summit-heading">
          <h2 id="summit-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            {summit.point === "summit" ? "Summit" : "Base"} blend, next 14 days
          </h2>
          {summit.available && summit.summary ? (
            <>
              <BlendDailyTable summary={summit.summary} daily={summit.daily} elevationFt={summit.point === "summit" ? elevation.summitFt : elevation.baseFt} />
              <ModelRunsTable runs={summit.byModel} dates={summit.daily.map((d) => d.date)} point={summit.point} />
            </>
          ) : (
            <p className="mt-3 text-[15.5px] text-ink">{summit.note}</p>
          )}
        </section>

        {base && base.available && base.summary && (
          <section aria-labelledby="base-heading">
            <h2 id="base-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              Base blend, next 14 days
            </h2>
            <BlendDailyTable summary={base.summary} daily={base.daily} elevationFt={elevation.baseFt} />
            <ModelRunsTable runs={base.byModel} dates={base.daily.map((d) => d.date)} point="base" />
          </section>
        )}

        {accuracy.models.length > 0 && (
          <section aria-labelledby="accuracy-heading">
            <h2 id="accuracy-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
              How the models have verified here
            </h2>
            <AccuracyTable accuracy={accuracy} />
          </section>
        )}

        <section aria-labelledby="method-heading" className="max-w-3xl">
          <h2 id="method-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            How to read this page
          </h2>
          <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-ink">
            <p>{summit.method}</p>
            <p>
              {accuracy.models.length
                ? "The verification table grades each model's newest run issued 1, 3 and 7 days before each measured day against the station's 24 h depth change; a lower mean absolute error is better and a bias above 1 means the model forecast more snow than fell."
                : accuracy.truthBasis === "none"
                  ? `${resort.name} has no measured daily snow series, so the models cannot be verified here; the ranking on resorts with a SNOTEL station is the best guide.`
                  : "Verification scores appear once the daily scorer has graded a run against a measured day."}{" "}
              <Link href="/methodology#forecast" className="font-bold text-ink underline-offset-2 hover:underline">
                How the blend is built and verified
              </Link>
              .
            </p>
            <p className="text-sm text-bark">
              <a href={FORECAST_CREDITS[0].url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
                {FORECAST_CREDITS[0].text}
              </a>{" "}
              ({FORECAST_CREDITS[0].license}). Updated every 6 hours.
            </p>
          </div>
        </section>

        <nav aria-label="Related pages" className="flex flex-wrap gap-3 text-sm">
          <Link href={resortTabPath(resort.slug, "overview")} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            {resort.name} today
          </Link>
          <Link href={resortTabPath(resort.slug, "snow-report")} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Snow report
          </Link>
          <Link href="/snow-report/best-powder-this-week" className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Best powder this week
          </Link>
          <a href={apiUrl} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            JSON
          </a>
          <a href={`${apiUrl}-accuracy`} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Accuracy JSON
          </a>
          <a href={resortTabMarkdownPath(resort.slug, "snow-forecast")} className="rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 font-bold text-ink shadow-stamp-sm hover:bg-cream">
            Markdown
          </a>
        </nav>
      </main>
      <PeakFooter />
    </>
  );
}
