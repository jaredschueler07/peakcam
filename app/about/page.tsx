import Link from "next/link";
import { Header } from "@/components/layout/Header";

import { SITE_URL as BASE_URL } from "@/lib/site";

export const metadata = {
  title: "About",
  description:
    "PeakCam is a free, real-time mountain webcam and snow report aggregator for ski resorts across North & South America.",
  alternates: { canonical: `${BASE_URL}/about` },
};

export default function About() {
  return (
    <main id="main-content" className="min-h-screen bg-bg">
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
            150+ ski resorts from the Rockies to the Andes — Colorado, Utah,
            Chile, Argentina, and everywhere in between. Live webcams, snow
            totals, weather forecasts, and trail counts — all on one page, all
            free, no account required.
          </p>

          <p>
            Winter doesn&apos;t clock out. When North America melts out, the
            Andes light up — and PeakCam covers both hemispheres so there&apos;s
            always a season live somewhere.
          </p>

          <p>
            We built this for the Thursday-night session: you and your crew
            huddled around a phone, trying to figure out where it&apos;s actually
            good. No more tab-juggling between resort sites, weather
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

          <section id="privacy" className="scroll-mt-20">
            <h2 className="text-xl font-heading font-semibold text-text-base uppercase tracking-wider pt-4">
              Privacy Policy
            </h2>

            <p className="text-text-muted text-sm mt-2">Last updated: September 2026</p>

            <p className="mt-4">
              Short version: you can use almost all of PeakCam without telling
              us anything. We don&apos;t sell your data, and we don&apos;t want
              more of it than we need.
            </p>

            <p className="mt-4">
              <span className="text-text-base font-medium">What we collect.</span>{" "}
              Browsing resorts, cams, maps, and snow reports requires no account
              and no email. We ask for an email address in exactly two places:
              when you subscribe to powder alerts, and when you create an
              account. Accounts are handled by Supabase Auth; if you make one,
              your favorites and dashboard layouts are stored against it so they
              follow you between devices.
            </p>

            <p className="mt-4">
              <span className="text-text-base font-medium">Analytics.</span>{" "}
              We use PostHog for anonymous product analytics — which pages and
              features get used — and a Meta pixel for advertising measurement.
              Neither is tied to your email address.
            </p>

            <p className="mt-4">
              <span className="text-text-base font-medium">Reports you submit.</span>{" "}
              When you report a broken cam we store a salted, daily-rotating hash
              of your IP address for abuse prevention — not the IP address
              itself. Condition votes are anonymous, keyed to a random ID kept in
              your browser&apos;s local storage.
            </p>

            <p className="mt-4">
              <span className="text-text-base font-medium">Email.</span>{" "}
              Powder alert and account emails are sent through Resend. Every
              alert email carries an unsubscribe link, and you can change or
              cancel your alerts from the manage page linked in each one. We
              don&apos;t sell, rent, or share your email with advertisers.
            </p>

            <p className="mt-4">
              Questions, or want your data deleted? Email{" "}
              <a href="mailto:hello@peakcam.io" className="text-cyan hover:underline">
                hello@peakcam.io
              </a>{" "}
              and we&apos;ll take care of it.
            </p>
          </section>

          <section id="terms" className="scroll-mt-20">
            <h2 className="text-xl font-heading font-semibold text-text-base uppercase tracking-wider pt-4">
              Terms of Service
            </h2>

            <p className="text-text-muted text-sm mt-2">Last updated: September 2026</p>

            <p className="mt-4">
              PeakCam is free to use and provided as-is, with no warranty of any
              kind. By using it you agree to what follows.
            </p>

            <p className="mt-4">
              <span className="text-text-base font-medium">The data can be wrong.</span>{" "}
              Snow totals, base depths, conditions ratings, and forecasts are
              aggregated from third parties — USDA SNOTEL stations, the National
              Weather Service, resort reports, and other users — and can be
              stale, incomplete, or simply incorrect. Nothing here is a safety
              product. Always confirm conditions, openings, and avalanche
              hazard with the resort and the relevant avalanche center before
              you head out. Skiing and riding carry real risk that is yours
              alone.
            </p>

            <p className="mt-4">
              <span className="text-text-base font-medium">Webcams belong to their operators.</span>{" "}
              We embed or link to cameras run by resorts and other operators; we
              don&apos;t rehost or claim ownership of their streams, and a cam
              can go dark or change at any time without notice.
            </p>

            <p className="mt-4">
              <span className="text-text-base font-medium">Don&apos;t abuse the service.</span>{" "}
              No bulk scraping, no automated submissions, no deliberately false
              cam or condition reports, and nothing that degrades the service for
              other people. We may remove submissions or block access if you do.
            </p>

            <p className="mt-4">
              <span className="text-text-base font-medium">Changes.</span>{" "}
              We may add, change, or discontinue any feature at any time,
              including this site as a whole. Continuing to use PeakCam after a
              change means you accept it.
            </p>

            <p className="mt-4">
              Questions about these terms? Email{" "}
              <a href="mailto:hello@peakcam.io" className="text-cyan hover:underline">
                hello@peakcam.io
              </a>.
            </p>
          </section>

          <div className="pt-8 border-t border-border">
            <Link href="/" className="text-cyan hover:underline text-sm">
              ← Back to Browse
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
