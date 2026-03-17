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
          <p>
            PeakCam is a free, real-time mountain webcam and snow condition aggregator
            for North American ski resorts. We pull together live webcams, snow reports,
            weather forecasts, and trail status from 70+ resorts into one fast, clean dashboard.
          </p>

          <p>
            No account required. No ads. No subscription wall. Just the information you need
            to decide where to ski this weekend.
          </p>

          <h2 className="text-xl font-heading font-semibold text-text-base uppercase tracking-wider pt-4">
            Why We Built This
          </h2>

          <p>
            Every skier knows the drill: check the resort webcam on one site, pull up the
            snow report on another, cross-reference the weather forecast on a third, then
            repeat for every mountain you&apos;re considering. It&apos;s 2026 and there&apos;s still
            no single place to compare real-time conditions across resorts.
          </p>

          <p>
            PeakCam fixes that. One page, every mountain, every cam — at a glance.
          </p>

          <h2 className="text-xl font-heading font-semibold text-text-base uppercase tracking-wider pt-4">
            What We Show You
          </h2>

          <ul className="list-disc list-inside space-y-2 text-text-subtle">
            <li><span className="text-text-base font-medium">Live webcams</span> — click-to-play streams from summit, base, and village cams</li>
            <li><span className="text-text-base font-medium">Snow conditions</span> — base depth, 24/48hr snowfall, trail and lift counts</li>
            <li><span className="text-text-base font-medium">Weather forecasts</span> — 5-day outlook from the National Weather Service</li>
            <li><span className="text-text-base font-medium">Condition ratings</span> — at-a-glance quality scores so you pick the best mountain</li>
          </ul>

          <h2 className="text-xl font-heading font-semibold text-text-base uppercase tracking-wider pt-4">
            Data Sources
          </h2>

          <p>
            Snow data comes from SNOTEL stations (USDA/NRCS), resort reports, and manual
            verification. Weather forecasts are sourced from the National Weather Service API.
            Webcam feeds are aggregated from resort-operated cameras and public streams.
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
