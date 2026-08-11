import Link from "next/link";
import { Compass, Map, Snowflake, Columns2, Mountain } from "lucide-react";

/**
 * Global 404.
 *
 * Kept deliberately static and dependency-free: no Supabase call, no client
 * hooks (a `usePathname` in here would deopt the prerendered /_not-found route
 * into client rendering). Everything below is a constant, so this page renders
 * even when the database is down — which is exactly when people get lost.
 */

const DESTINATIONS = [
  { href: "/", label: "Browse resorts", hint: "Every cam, one page", icon: Compass },
  { href: "/map", label: "Map", hint: "Conditions by geography", icon: Map },
  { href: "/snow-report", label: "Snow report", hint: "Base depth & fresh snow", icon: Snowflake },
  { href: "/compare", label: "Compare", hint: "Two mountains, side by side", icon: Columns2 },
  { href: "/drop-in", label: "Drop In", hint: "Arcade ski descent (beta)", icon: Mountain },
];

// A hand-picked subset of the browse page's curated ordering. It can't be
// imported: `POPULAR_SLUGS` lives inside components/browse/BrowsePage.tsx,
// which is a "use client" module and doesn't export it — pulling it in would
// drag the whole Fuse.js browse bundle into the 404. Kept short on purpose so
// the duplication is cheap to eyeball.
const POPULAR_RESORTS = [
  { slug: "vail", name: "Vail" },
  { slug: "breckenridge", name: "Breckenridge" },
  { slug: "park-city", name: "Park City" },
  { slug: "jackson-hole", name: "Jackson Hole" },
  { slug: "palisades-tahoe", name: "Palisades Tahoe" },
  { slug: "ski-portillo", name: "Portillo" },
];

export default function NotFound() {
  return (
    <main id="main-content" className="pc-topo min-h-screen px-6 py-16 md:py-24">
      {/* Next marks the built-in 404 noindex; keep it explicit now that this is
          a custom page (React 19 hoists the tag into <head>). */}
      <meta name="robots" content="noindex, follow" />

      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="font-display text-[26px] font-black italic leading-none tracking-tight
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink
                     focus-visible:ring-offset-2 focus-visible:ring-offset-cream rounded-sm"
        >
          <span className="text-ink">Peak</span>
          <span className="text-alpen">Cam</span>
        </Link>

        <p className="mt-12 font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-bark-dk">
          Error 404
        </p>
        <h1 className="pc-display mt-3 text-5xl text-ink sm:text-6xl">
          This run isn&rsquo;t on the map
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-bark-dk">
          The page you asked for doesn&rsquo;t exist — it may have moved, or the
          URL may have a typo in it. The snow is still falling somewhere; here
          are the ways back.
        </p>

        <nav aria-label="Main sections" className="mt-10">
          <ul className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2">
            {DESTINATIONS.map(({ href, label, hint, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-2xl border-[1.5px] border-ink bg-cream-50
                             px-4 py-3.5 shadow-stamp-sm transition-[transform,box-shadow] duration-100
                             hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink
                             focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
                >
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink bg-ink">
                    <Icon className="h-4 w-4 text-alpen" aria-hidden />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[14px] font-bold text-ink">{label}</span>
                    <span className="text-[12px] text-bark-dk">{hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <h2 className="mt-12 text-[11px] font-bold uppercase tracking-[0.16em] text-bark-dk">
          Popular mountains
        </h2>
        <ul className="mt-4 flex list-none flex-wrap gap-2.5">
          {POPULAR_RESORTS.map(({ slug, name }) => (
            <li key={slug}>
              <Link
                href={`/resorts/${slug}`}
                className="inline-flex rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2
                           text-[13px] font-semibold text-ink shadow-stamp-sm
                           transition-[transform,box-shadow] duration-100
                           hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink
                           focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
              >
                {name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
