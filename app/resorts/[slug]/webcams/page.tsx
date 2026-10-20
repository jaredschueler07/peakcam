import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllResortSlugs, getResortBySlug, getResortCamTimelines, getResortTimelapses } from "@/lib/supabase";
import { clipDurationSeconds, pickResortTimelapse } from "@/lib/cam-timelapse";
import { camLive } from "@/lib/public-api/serialize";
import { formatMountainTime } from "@/lib/quotable";
import { stateLabel } from "@/lib/resort-copy";
import { breadcrumbListLd, resortBreadcrumb, resortTabMarkdownPath, resortTabUrl, webcamsTitle } from "@/lib/resort-pages";
import { SITE_URL } from "@/lib/site";
import { Header } from "@/components/layout/Header";
import { PeakFooter } from "@/components/home/PeakFooter";
import { HubBreadcrumb } from "@/components/hubs/HubBreadcrumb";
import { ResortTabs } from "@/components/resort/ResortTabs";
import { WebcamGrid } from "@/components/resort/WebcamGrid";
import { TimelapseStrip } from "@/components/resort/TimelapseClips";

// Same ISR window and static-params contract as the overview
// (app/resorts/[slug]/page.tsx).
export const revalidate = 3600;
export const dynamicParams = false;

export async function generateStaticParams() {
  const slugs = await getAllResortSlugs();
  return slugs.map((slug) => ({ slug }));
}

function activeCams<T extends { is_active: boolean; auto_disabled: boolean }>(cams: T[]): T[] {
  return cams.filter((c) => c.is_active && !c.auto_disabled);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) return {};
  const cams = activeCams(resort.cams);
  const pageUrl = resortTabUrl(slug, "webcams");
  const title = webcamsTitle(resort.name, cams.length);
  const description =
    cams.length > 0
      ? `Every live webcam at ${resort.name} (${cams.length}), click to play, with each cam's last health check and PeakCam's archived frames from the last 24 hours where the operator allows.`
      : `PeakCam lists no active webcams at ${resort.name} yet; the snow report and forecast are on the resort page.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: pageUrl, types: { "text/markdown": `${SITE_URL}${resortTabMarkdownPath(slug, "webcams")}` } },
    openGraph: { type: "website", url: pageUrl, title, description, siteName: "PeakCam" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ResortWebcamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resort = await getResortBySlug(slug);
  if (!resort) return notFound();

  const cams = activeCams(resort.cams);
  const camIds = cams.map((c) => c.id);
  const [timelinesRaw, timelapses] = await Promise.all([getResortCamTimelines(resort.id, camIds, 24), getResortTimelapses(resort.id, camIds)]);
  const timelines = timelinesRaw ?? new Map();
  const pageUrl = resortTabUrl(resort.slug, "webcams");
  const breadcrumb = resortBreadcrumb(resort, "webcams");
  const title = webcamsTitle(resort.name, cams.length);

  const live = cams.filter((c) => camLive(c) === true).length;
  const offline = cams.filter((c) => camLive(c) === false).length;
  const unchecked = cams.length - live - offline;
  // dateModified: the newest health check or capture across the cams — the
  // moment this page's data last changed — never render time.
  let newestMs = 0;
  for (const cam of cams) {
    for (const iso of [cam.last_checked_at, cam.still_captured_at]) {
      const ms = iso ? Date.parse(iso) : NaN;
      if (!Number.isNaN(ms) && ms > newestMs) newestMs = ms;
    }
  }
  for (const t of timelines.values()) {
    for (const f of [...t.frames, ...(t.lastStorm ? [t.lastStorm] : [])]) {
      const ms = Date.parse(f.capturedAt);
      if (!Number.isNaN(ms) && ms > newestMs) newestMs = ms;
    }
  }
  for (const t of timelapses ?? []) {
    for (const c of [...(t.current ? [t.current] : []), ...t.storms]) {
      const ms = Date.parse(c.renderedAt);
      if (!Number.isNaN(ms) && ms > newestMs) newestMs = ms;
    }
  }
  const dateModified = newestMs > 0 ? new Date(newestMs).toISOString() : null;
  // VideoObject per clip (P8): the 24 h clip and the newest storm reel, so
  // the clips are discoverable without a player.
  const picked = pickResortTimelapse(timelapses ?? []);
  const videoLd = [picked.current, picked.storm].filter((c): c is NonNullable<typeof c> => Boolean(c)).map((clip) => {
    const cam = cams.find((c) => c.id === clip.camId);
    const secs = clipDurationSeconds(clip.frames);
    return {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: `${resort.name}${cam ? ` ${cam.name}` : ""} ${clip.stormDate ? `storm timelapse, ${clip.stormDate}` : "24-hour timelapse"}`,
      description: clip.stormDate
        ? `PeakCam timelapse of the ${clip.stormDate} storm at ${resort.name}, rendered from archived webcam frames.`
        : `PeakCam timelapse of the last 24 hours at ${resort.name}, rendered from archived webcam frames.`,
      contentUrl: clip.url,
      ...(clip.posterUrl ? { thumbnailUrl: clip.posterUrl } : {}),
      uploadDate: clip.renderedAt,
      ...(secs != null ? { duration: `PT${Math.max(1, Math.round(secs))}S` } : {}),
      isPartOf: { "@id": pageUrl },
    };
  });
  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: pageUrl,
    name: title,
    isPartOf: { "@type": "WebSite", name: "PeakCam", url: SITE_URL },
    about: { "@id": resortTabUrl(resort.slug, "overview") },
    ...(dateModified ? { dateModified } : {}),
  };
  const latestCheck = cams
    .map((c) => c.last_checked_at)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbListLd(breadcrumb)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageLd) }} />
      {videoLd.map((ld, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      ))}
      <Header showSearch={false} />
      <div className="border-b border-bark/30 bg-cream px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-5xl">
          <HubBreadcrumb items={breadcrumb} />
          <p className="pc-eyebrow mb-2 mt-5">
            {cams.length} live cam{cams.length === 1 ? "" : "s"}
          </p>
          <h1 className="font-display text-4xl font-black leading-[0.95] tracking-[-0.02em] text-ink md:text-5xl [overflow-wrap:anywhere]">
            {resort.name} webcams
          </h1>
          <p className="mt-3 max-w-2xl text-balance text-lg leading-snug text-bark-dk" data-testid="webcams-summary">
            {cams.length === 0
              ? `PeakCam lists no active webcams for ${resort.name} yet.`
              : `${cams.length} webcam${cams.length === 1 ? "" : "s"} at ${resort.name}: ${live} live, ${offline} offline, ${unchecked} not yet checked${latestCheck ? ` as of the last health check at ${formatMountainTime(latestCheck)}` : ""}.`}
          </p>
          <p className="mt-1.5 text-sm text-bark">
            {resort.region} · {stateLabel(resort)}
          </p>
        </div>
      </div>
      <ResortTabs slug={resort.slug} active="webcams" />

      <main id="main-content" className="mx-auto max-w-5xl space-y-10 px-4 py-10 md:px-8">
        {cams.length === 0 ? (
          <section className="rounded-[18px] border-[1.5px] border-dashed border-ink/40 bg-cream-50 px-5 py-8 text-center">
            <p className="text-[15.5px] text-ink">No cams indexed yet for this resort.</p>
            {resort.cam_page_url && (
              <p className="mt-3 text-sm text-bark">
                <a href={resort.cam_page_url} target="_blank" rel="noopener noreferrer" className="font-bold text-ink underline-offset-2 hover:underline">
                  The resort&rsquo;s own cam page ↗
                </a>
              </p>
            )}
          </section>
        ) : (
          <>
          {/* Timelapse clips (P8 block 2): renders nothing until the renderer has stored a clip for this resort. */}
          <TimelapseStrip timelapses={timelapses} cams={cams} />
          <section aria-labelledby="cams-heading">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="cams-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
                All cams
              </h2>
              {resort.cam_page_url && (
                <a href={resort.cam_page_url} target="_blank" rel="noopener noreferrer" className="text-sm text-bark hover:text-ink">
                  View all on resort site ↗
                </a>
              )}
            </div>
            <WebcamGrid
              cams={cams}
              resortSlug={resort.slug}
              resortName={resort.name}
              resortUrl={resort.cam_page_url || resort.website_url}
              timelines={Object.fromEntries(timelines)}
            />
          </section>
          </>
        )}

        <section aria-labelledby="about-cams-heading" className="max-w-3xl">
          <h2 id="about-cams-heading" className="font-display text-2xl font-black tracking-[-0.01em] text-ink">
            About these cams
          </h2>
          <p className="mt-3 text-[15.5px] leading-relaxed text-ink">
            Every feed belongs to its operator and plays only when you tap it. &ldquo;Live&rdquo; is the result of PeakCam&rsquo;s last
            health check, not proof of a live broadcast. Frames on tape are PeakCam&rsquo;s own captures, every 15 minutes, of cams
            whose operators allow archiving; a frame taken while the resort&rsquo;s 24-hour number was 6&Prime; or more is kept as the
            &ldquo;last storm on tape&rdquo;. Timelapse clips are rendered from those frames every six hours (the last 24 hours, and a
            storm reel once the resort&rsquo;s measured 24-hour snowfall reaches 8&Prime;); rights stay with the operator.{" "}
            <Link href="/methodology#freshness" className="font-bold text-ink underline-offset-2 hover:underline">
              How freshness is measured
            </Link>
            .
          </p>
        </section>
      </main>
      <PeakFooter />
    </>
  );
}
