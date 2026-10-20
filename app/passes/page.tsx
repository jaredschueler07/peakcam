import type { Metadata } from "next";
import Link from "next/link";
import { getAllResorts } from "@/lib/supabase";
import { SEASON_PASSES } from "@/lib/resort-profile";
import { PASS_BASE_PATH, PASS_INFO, buildPassPage, passPath } from "@/lib/passes";
import { inches } from "@/lib/quotable";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";

// /passes — the five season-pass pages (parity plan P10), each a ranked
// snow report for the resorts whose profile names the pass. Hourly ISR like
// every data-bearing page.
export const revalidate = 3600;

const PAGE_URL = `${SITE_URL}${PASS_BASE_PATH}`;
const TITLE = "Ski Resort Snow Report by Season Pass — Ikon, Epic, Mountain Collective, Indy, Power | PeakCam";
const DESCRIPTION = "Today's measured snow at every PeakCam resort on the Ikon Pass, Epic Pass, Mountain Collective, Indy Pass and Power Pass: base depth, new snow and live webcams, dated to the reading.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: PAGE_URL },
  keywords: ["ikon pass snow report", "epic pass snow report", "mountain collective resorts snow", "indy pass resorts snow report", "which pass resort has the most snow"],
  openGraph: { type: "website", url: PAGE_URL, title: TITLE, description: DESCRIPTION, siteName: "PeakCam" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function PassesIndexPage() {
  const resorts = await getAllResorts();
  const pages = SEASON_PASSES.map((pass) => buildPassPage(pass, resorts));
  const listLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Season passes on PeakCam",
    url: PAGE_URL,
    numberOfItems: pages.length,
    itemListElement: pages.map((p, i) => ({ "@type": "ListItem", position: i + 1, name: p.info.label, url: p.pageUrl })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(listLd) }} />
      <Header showSearch={false} />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-5 md:py-12">
        <HubBreadcrumb items={[{ label: "Home", href: "/" }, { label: "Season passes" }]} />
        <p className="pc-eyebrow mb-3 mt-6">Five passes · measured snow</p>
        <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl">Snow report by season pass</h1>
        <p className="mt-5 max-w-2xl text-lg text-bark">
          Every resort PeakCam tracks, grouped by the pass that covers it, ranked by what the station measures today. Membership comes from each operator&rsquo;s published resort list; PeakCam sells nothing.
        </p>
        <ol className="mt-10 space-y-4" aria-label="Season passes">
          {pages.map((p) => {
            const lead = p.rows.find((r) => r.baseIn != null && r.baseIn > 0);
            return (
              <li key={p.info.pass} className="rounded-[18px] border-[1.5px] border-ink bg-cream-50 px-5 py-4 shadow-stamp">
                <h2 className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
                  <Link href={passPath(p.info.pass)} prefetch={false} className="underline-offset-2 hover:underline">
                    {p.info.label}
                  </Link>{" "}
                  <span className="font-mono text-sm font-bold text-bark">{p.count} {p.count === 1 ? "resort" : "resorts"}</span>
                </h2>
                <p className="mt-1 text-[15px] leading-relaxed text-ink/85">{PASS_INFO[p.info.pass].blurb}</p>
                <p className="mt-2 text-sm text-bark">
                  {lead ? `Deepest base: ${lead.name}, ${inches(lead.baseIn!)}.` : p.count ? "No resort on this pass has a report yet." : "No resort on PeakCam names this pass yet."}
                </p>
              </li>
            );
          })}
        </ol>
      </main>
      <PeakFooter />
    </>
  );
}
