import Link from "next/link";
import { Header } from "@/components/layout/Header";

export const metadata = {
  title: "About — PeakCam",
  description: "PeakCam is a free, real-time mountain webcam and snow report aggregator for North American ski resorts.",
};

export default function About() {
  return (
    <div className="min-h-screen bg-bg">
      <Header />

      <div className="max-w-2xl mx-auto px-4 py-12 md:px-8">
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-text-base uppercase tracking-wider mb-8">
          About PeakCam
        </h1>

        <div className="space-y-6 text-text-subtle text-base leading-relaxed">
          <p className="text-lg text-text-base font-medium">
            Every mountain. Every cam. One glance.
          </p>

          <p>
            PeakCam is the fastest way to check real-time conditions across
            70+ ski resorts in Colorado, Utah, and beyond. Live webcams, snow
            totals, weather forecasts, and trail counts — all on one page, all
            free, no account required.
          </p>

          <p>
            We built this for the Thursday-night session: you and your crew
            huddled around a phone, trying to figure out which mountain got
            the goods. No more tab-juggling between resort sites, weather
            apps, and cam aggregators that haven&apos;t been updated since 2014.
          </p>

          <h2 className="text-xl font-heading font-semibold text-text-base uppercase tracking-wider pt-4">
            Why PeakCam Exists
          </h2>

          <p>
            Other tools make you choose. Pay a premium for forecast models
            you don&apos;t need, or wade through ad-heavy legacy sites that load
            like it&apos;s dial-up. We wanted something different: a clean,
            data-forward dashboard that respects your time and your data plan.
          </p>

          <p>
            PeakCam is opinionated about simplicity. We show you what matters
            — base depth, fresh snow, a live cam, and a five-day outlook —
            and get out of the way. If a resort is firing, you&apos;ll know in
            two seconds, not two minutes.
          </p>

          <h2 className="text-xl font-heading font-semibold text-text-base uppercase tracking-wider pt-4">
            What You Get
          </h2>

          <ul className="list-disc list-inside space-y-2 text-text-subtle">
            <li><span className="text-text-base font-medium">Live webcams</span> — summit, base, and village cams from every major resort, click-to-play so your bandwidth stays yours</li>
            <li><span className="text-text-base font-medium">Snow conditions</span> — base depth, 24h and 48h snowfall pulled from SNOTEL stations and resort reports</li>
            <li><span className="text-text-base font-medium">Weather forecasts</span> — five-day outlooks straight from the National Weather Service, no paywall</li>
            <li><span className="text-text-base font-medium">Condition ratings</span> — at-a-glance scores so you can compare mountains without opening six tabs</li>
            <li><span className="text-text-base font-medium">Powder alerts</span> — when a storm dumps, we surface the resorts with the most fresh snow front and center</li>
          </ul>

          <h2 className="text-xl font-heading font-semibold text-text-base uppercase tracking-wider pt-4">
            Our Data
          </h2>

          <p>
            Snow data comes from USDA SNOTEL stations — the same federal
            sensor network used by avalanche centers and water managers.
            We cross-reference with resort-reported numbers and flag
            discrepancies. Weather forecasts are sourced from the National
            Weather Service API, the gold standard for mountain weather.
            Webcam feeds are aggregated from resort-operated cameras and
            verified public streams.
          </p>

          <p>
            No proprietary models, no black-box algorithms. Just real data
            from real sensors, presented clearly.
          </p>

          <div className="pt-8 border-t border-border">
            <Link href="/" className="text-cyan hover:underline text-sm">
              ← Back to Browse
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
