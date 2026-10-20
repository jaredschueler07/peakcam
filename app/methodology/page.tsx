import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/site";

const PAGE_URL = `${SITE_URL}/methodology`;

export const metadata: Metadata = {
  title: "How PeakCam Measures Snow — Data & Methodology",
  description:
    "Where PeakCam's snow numbers come from: NRCS SNOTEL/SCAN telemetry synced every six hours, quality-control checks, 30-year normals, weather-model estimates where no sensor exists, and how user reports are weighted.",
  alternates: { canonical: PAGE_URL },
  openGraph: {
    type: "article",
    url: PAGE_URL,
    title: "How PeakCam Measures Snow",
    description:
      "SNOTEL telemetry, quality control, 30-year normals, and honest limits — the full data pipeline behind every snow number on PeakCam.",
    siteName: "PeakCam",
  },
};

const articleLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "How PeakCam Measures Snow",
  url: PAGE_URL,
  author: { "@type": "Organization", name: "PeakCam", url: SITE_URL },
  publisher: { "@type": "Organization", name: "PeakCam", url: SITE_URL },
  about: [
    { "@type": "Thing", name: "SNOTEL" },
    { "@type": "Thing", name: "Snow telemetry" },
    { "@type": "Thing", name: "Snow water equivalent" },
  ],
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="font-display font-black text-[26px] leading-tight tracking-[-0.02em] text-ink mt-12 mb-4"
    >
      {children}
    </h2>
  );
}

export default function MethodologyPage() {
  return (
    <main id="main-content" className="bg-cream-50 min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <article className="max-w-3xl mx-auto px-6 py-16 text-[15.5px] leading-relaxed text-ink">
        <p className="font-mono font-bold text-[11px] text-bark uppercase tracking-[0.18em] mb-3">
          Data &amp; Methodology
        </p>
        <h1 className="font-display font-black text-[40px] leading-[0.95] tracking-[-0.02em] text-ink mb-6">
          How PeakCam Measures Snow
        </h1>

        <p className="mb-4">
          Most snow reports online repeat what a resort&apos;s marketing department publishes.
          PeakCam reads from government sensors where they exist, uses a weather model where
          they don&apos;t, and tells you which is which. This page documents each step,
          including the parts that are imperfect, so you can judge the numbers yourself.
        </p>

        <H2 id="snotel">The sensors: NRCS SNOTEL and SCAN</H2>
        <p className="mb-4">
          SNOTEL (&ldquo;snow telemetry&rdquo;) is a network of over 900 automated stations
          run by the USDA&apos;s Natural Resources Conservation Service across the western
          United States, with sister SCAN stations elsewhere. Each station weighs the
          snowpack sitting on a fluid-filled pillow to derive{" "}
          <strong>snow water equivalent (SWE)</strong> — how much water the snow would melt
          into — and measures depth with an ultrasonic sensor, plus temperature and
          precipitation. Where a resort has an NRCS station assigned, PeakCam pulls that
          station through the AWDB API every six hours. Resorts without one are covered in
          the &ldquo;limits&rdquo; section below.
        </p>
        <p className="mb-4">
          A sensor is honest but literal: it reports one fixed patch of ground at one
          elevation, all winter. When PeakCam and a resort disagree, the usual reasons are
          location (one pillow versus the most flattering slope on the mountain),
          snowmaking the sensor cannot see, and resorts quoting storm totals rather than a
          change in settled depth.
        </p>

        <H2 id="qc">Quality control</H2>
        <p className="mb-4">
          Raw telemetry misbehaves: sensors drift, ice fools the ultrasonic reading, and a
          snow-laden branch falling on the pillow can report as a ten-inch storm. PeakCam
          runs range checks (values a mountain cannot physically produce) and spike checks
          (jumps too large for the elapsed time). A reading that fails is replaced with the
          previous valid value and flagged in the internal record; a silent station carries
          its last good reading forward. One honest caveat: the public page does not yet
          label carried-forward values — a depth that has not moved in days deserves your
          suspicion.
        </p>

        <H2 id="normals">Thirty-year normals</H2>
        <p className="mb-4">
          A 60-inch base means one thing in Vermont and another in Utah. For context,
          PeakCam compares each station&apos;s current SWE against that same station&apos;s
          1991&ndash;2020 median for the exact day of the water year (which begins October
          1). That is the &ldquo;% of normal&rdquo; figure — 100% means the snowpack sits at
          its own historical median, not a regional average. Early and late in the season
          the median approaches zero and the percentage becomes meaningless, so PeakCam
          suppresses it rather than print &ldquo;400% of nothing.&rdquo;
        </p>

        <H2 id="conditions">Ratings, trends, and outlook</H2>
        <p className="mb-4">
          The condition rating is a fixed function of the measured data, not editorial
          judgment: <strong>Great</strong> is 6 inches of new snow in 24 hours or 12 in 48;
          <strong> Good</strong> is 2 inches new, or a 24-inch base at 100% of normal or
          better; <strong>Fair</strong> is a 20-inch base at 70% of normal;
          otherwise <strong>Poor</strong>. Temperature does not move the rating. The 7-day
          trend arrow tracks whether the station&apos;s SWE is building or shrinking. The
          outlook label combines that trend with the next 48 hours of forecast snowfall and
          high temperature — National Weather Service forecasts in the U.S., Open-Meteo
          elsewhere.
        </p>

        <H2 id="user-reports">On-mountain reports</H2>
        <p className="mb-4">
          Skiers standing on the snow see what a pillow cannot: wind effect, crust, how the
          groomers held up. Signed-in users can file condition reports. Once a resort has
          at least two unflagged reports within 24 hours, they are blended into the rating
          at 30% weight against the sensor&apos;s 70%, capped at moving it one tier. A lone
          report never moves the number, and no report ever changes a measured depth.
        </p>

        <H2 id="freshness">Freshness</H2>
        <p className="mb-4">
          Sensor syncs run every six hours. Pages rebuild on a rolling hourly window, so
          what you see can be up to an hour older than the database; forecasts are fetched
          when a page regenerates, not on every visit. Each resort page&apos;s structured
          data carries the timestamp of its latest reading. A dead feed currently pages the
          operators — it does not yet put a warning banner on the resort page.
        </p>

        <H2 id="forecast">Forecast models and verification</H2>
        <p className="mb-4">
          The snow forecast on every resort page is a blend, not one model&apos;s opinion. Every six
          hours PeakCam asks Open-Meteo for the same fourteen days from up to nine numerical weather
          models at two elevations per resort, summit and base: ECMWF IFS, NOAA GFS, Environment
          Canada GEM, DWD ICON, JMA, Météo-France ARPEGE/AROME and the UK Met Office, plus NOAA&apos;s
          NBM and HRRR for U.S. resorts. Each day&apos;s snowfall is the median across the models that
          reach that day; the band around it is the 25th to 75th percentile, so a wide band means
          the models disagree. The model count is shown per day because it falls with lead time:
          HRRR covers two days, Météo-France four, ICON and UKMO seven, GEM ten, JMA and NBM eleven,
          and only ECMWF and GFS reach day fourteen. A far-out day with two models deserves less
          trust than tomorrow with nine, and the page says so.
        </p>
        <p className="mb-4">
          The models are graded, every day, against what actually fell. For each resort with a SNOTEL
          station, the 24-hour new snow is the day-over-day change in measured depth, clipped at
          zero (a pillow settles, so this is a floor, not an exact total). For every measured day in
          the trailing 90 days, the forecast each model issued one, three and seven days earlier is
          compared with that value; the mean absolute error at each lead, a bias ratio (total forecast
          over total measured; above one means the model over-forecasts snow) and a rank are
          published per model and per resort, and the blend itself is graded by the same rule. Where
          a resort has no measured series the accuracy page says so rather than scoring against a
          model. The whole thing is in the open API:{" "}
          <code className="font-mono text-[13px]">/api/v1/resorts/&#123;slug&#125;/forecast</code> and{" "}
          <code className="font-mono text-[13px]">/forecast-accuracy</code>, and the{" "}
          <code className="font-mono text-[13px]">compare_models</code> MCP tool. Weather data by{" "}
          <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
            Open-Meteo.com
          </a>{" "}
          (CC BY 4.0). The U.S. National Weather Service text forecast still supplies the narrative,
          temperatures and wind on U.S. resort pages; only its snow amounts are replaced by the blend.
        </p>

        <H2 id="limits">What PeakCam does not measure</H2>
        <p className="mb-4">
          Resorts outside the NRCS network — Canada, most of the eastern U.S., and the
          South American mountains — have no pillow telemetry. Their depth and new-snow
          figures are weather-model estimates (Open-Meteo) updated every six hours, and
          those pages show no percent-of-normal figure because there is no station history
          to compare against. Lift and trail counts, where shown, are resort-reported, not
          sensed. Webcams are the resorts&apos; own cameras: some live video, some stills on
          a refresh timer, some links out to the resort&apos;s page.
        </p>

        <p className="mt-10 pt-6 border-t border-dashed border-bark/60 text-[14px] text-bark">
          Questions about the data? Start at the{" "}
          <Link href="/about" className="underline underline-offset-2 hover:text-ink">
            about page
          </Link>{" "}
          or the live{" "}
          <Link href="/snow-report" className="underline underline-offset-2 hover:text-ink">
            snow report
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
