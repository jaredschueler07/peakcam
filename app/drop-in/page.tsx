import type { Metadata } from "next";
import Link from "next/link";
import { Gamepad2, MountainSnow, Timer } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import DropInRoster, { dropInResortCount } from "@/components/drop-in/DropInRoster";
import { getDropInRoster } from "@/lib/drop-in";

const BASE_URL = "https://peakcam.io";
const PAGE_URL = `${BASE_URL}/drop-in`;
const OG_IMAGE = `${BASE_URL}/opengraph-image`;
const OG_IMAGE_ALT = "PeakCam — live ski resort webcams and snow reports";

// Nothing here touches the database — the roster is a compile-time constant, so
// this page is fully static and can never be taken down by a Supabase outage.
export const dynamic = "force-static";

const roster = getDropInRoster();
const RESORT_COUNT = dropInResortCount();
const RESORT_NAMES = roster.map((p) => p.name).join(", ");

export const metadata: Metadata = {
  title: "Drop In — Arcade Ski Descents",
  description:
    `Drop In is PeakCam's arcade ski descent: a procedurally built run down a real mountain, ` +
    `in your browser, no download and no account. Live in beta at ${RESORT_COUNT} resorts — ${RESORT_NAMES}.`,
  keywords: [
    "ski game browser",
    "arcade ski descent",
    "downhill ski game",
    "free skiing game no download",
    "ski resort game",
  ],
  alternates: { canonical: PAGE_URL },
  openGraph: {
    type: "website",
    url: PAGE_URL,
    siteName: "PeakCam",
    title: "Drop In — Arcade Ski Descents | PeakCam",
    description:
      `Ski a procedurally built descent of a real mountain in your browser. ` +
      `Beta at ${RESORT_COUNT} resorts: ${RESORT_NAMES}.`,
    // Declared explicitly: a route that exports its own `openGraph` object
    // replaces the parent's wholesale, so the root app/opengraph-image.tsx is
    // NOT inherited here (verified — /map and /snow-report have the same gap).
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_IMAGE_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Drop In — Arcade Ski Descents | PeakCam",
    description: `Ski ${RESORT_NAMES} in your browser. No download, no account.`,
    images: [OG_IMAGE],
  },
  // The playable routes are noindex (a canvas is not a search result); this hub
  // is the indexable front door for all of them.
  robots: { index: true, follow: true },
};

const HOW_IT_WORKS = [
  {
    icon: MountainSnow,
    title: "A real mountain, roughly",
    body:
      "Each descent is seeded from the resort's own numbers — summit elevation, lift-served vertical, and six runs named after the real ones. Same seed every time, so the hill you learn is the hill you get.",
  },
  {
    icon: Gamepad2,
    title: "Carve, tuck, send",
    body:
      "Mouse or A/D to carve, W to tuck, S to brake, Space to jump. T switches trail, G rides the lift back up, 1–3 changes the weather, Esc releases the cursor. On a phone, the same controls sit under your thumbs.",
  },
  {
    icon: Timer,
    title: "Nothing to install",
    body:
      "It runs in the browser on a WebGL canvas — no download, no plugin, no account. Close the tab when the storm clears and go check the cams instead.",
  },
];

export default function DropInHubPage() {
  return (
    <>
      <Header showSearch={false} />

      <main id="main-content">
        {/* Hero */}
        <section className="pc-topo border-b-[1.5px] border-ink px-6 py-16 md:py-24">
          <div className="mx-auto max-w-4xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-bark-dk">
              PeakCam Labs · Beta
            </p>
            <h1 className="pc-display mt-3 text-5xl text-ink sm:text-7xl">
              Drop In
            </h1>
            <p className="mt-5 max-w-2xl font-display text-xl italic text-bark-dk sm:text-2xl">
              An arcade ski descent, built from the mountain&rsquo;s real numbers.
            </p>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink/85">
              Between storms there&rsquo;s nothing to watch on a webcam. So we
              built a run you can ski instead: a procedural descent of a real
              resort — its vertical, its summit, its trail names — rendered in
              your browser on a WebGL canvas. No download, no account, no score
              to defend. It&rsquo;s live at{" "}
              <strong className="font-bold">{RESORT_COUNT} resorts</strong> while
              we build more.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#pilot-resorts"
                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-alpen
                           px-6 py-3 text-[13px] font-bold uppercase tracking-[0.06em] text-cream-50
                           shadow-stamp transition-[transform,box-shadow] duration-100
                           hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp-lg
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink
                           focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
              >
                Pick a mountain
              </a>
              <Link
                href="/"
                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-cream-50
                           px-6 py-3 text-[13px] font-bold uppercase tracking-[0.06em] text-ink
                           shadow-stamp-sm transition-[transform,box-shadow] duration-100
                           hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink
                           focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
              >
                Back to live cams
              </Link>
            </div>
          </div>
        </section>

        {/* Roster */}
        <section
          id="pilot-resorts"
          aria-labelledby="pilot-resorts-heading"
          className="pc-paper scroll-mt-20 border-b-[1.5px] border-ink px-6 py-16"
        >
          <div className="mx-auto max-w-6xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-bark-dk">
              {RESORT_COUNT} mountains, hand-built
            </p>
            <h2
              id="pilot-resorts-heading"
              className="pc-display mt-2 text-3xl text-ink sm:text-4xl"
            >
              Where you can drop in
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-bark-dk">
              Every descent is tuned by hand, so the roster grows slowly. Each
              one plays differently — Andean fall line, above-treeline bowls,
              Sierra pines.
            </p>
            <DropInRoster className="mt-8" />
          </div>
        </section>

        {/* How it works */}
        <section
          aria-labelledby="how-it-works-heading"
          className="pc-paper px-6 py-16"
        >
          <div className="mx-auto max-w-6xl">
            <h2
              id="how-it-works-heading"
              className="pc-display text-3xl text-ink sm:text-4xl"
            >
              How it works
            </h2>
            <ul className="mt-8 grid list-none grid-cols-1 gap-5 md:grid-cols-3">
              {HOW_IT_WORKS.map(({ icon: Icon, title, body }) => (
                <li
                  key={title}
                  className="rounded-2xl border-[1.5px] border-ink bg-cream-50 p-5 shadow-stamp-sm"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-ink bg-ink">
                    <Icon className="h-5 w-5 text-alpen" aria-hidden />
                  </span>
                  <h3 className="pc-display mt-4 text-[22px] text-ink">{title}</h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-bark-dk">
                    {body}
                  </p>
                </li>
              ))}
            </ul>

            <p className="mt-10 max-w-2xl text-[13px] leading-relaxed text-bark-dk">
              Drop In is a beta. It needs a browser with WebGL, it will happily
              eat a laptop battery, and it is emphatically not a substitute for
              checking the{" "}
              <Link
                href="/snow-report"
                className="font-bold text-alpen-dk underline underline-offset-2 hover:text-alpen"
              >
                actual snow report
              </Link>
              .
            </p>
          </div>
        </section>
      </main>

      <PeakFooter />
    </>
  );
}
