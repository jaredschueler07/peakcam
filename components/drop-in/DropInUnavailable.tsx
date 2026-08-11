import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import DropInRoster, { dropInResortCount } from "./DropInRoster";

interface DropInUnavailableProps {
  /**
   * The resort's display name, when we know it. Omitted on the 404 boundary,
   * which gets no params — the copy stays true either way.
   */
  resortName?: string;
  /** Link back to the resort's conditions page, when the resort really exists. */
  resortSlug?: string;
}

/**
 * "Drop In isn't built here." Rendered for a real resort that isn't in the
 * pilot (named, 200) and by the route's 404 boundary for slugs we can't resolve
 * (unnamed). Never says "resort not found" — most people who land here typed a
 * perfectly real resort into a perfectly real URL shape.
 */
export default function DropInUnavailable({
  resortName,
  resortSlug,
}: DropInUnavailableProps) {
  const count = dropInResortCount();
  // Only send people to a resort page when we actually resolved the resort —
  // otherwise the back link would point at a slug we couldn't verify.
  const backHref = resortName && resortSlug ? `/resorts/${resortSlug}` : "/";

  return (
    <div className="pc-topo min-h-[calc(100vh-64px)] px-6 py-14 md:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-bark-dk">
          PeakCam Drop In · Beta
        </p>

        <h1 className="pc-display mt-3 text-4xl text-ink sm:text-5xl">
          {resortName ? (
            <>
              No descent built for
              <br />
              {resortName} yet
            </>
          ) : (
            <>There&rsquo;s no Drop In at this address</>
          )}
        </h1>

        <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-bark-dk">
          {resortName ? (
            <>
              Drop In is an arcade ski descent we hand-build one mountain at a
              time — terrain seed, vertical, and six named runs each.{" "}
              {resortName} isn&rsquo;t one of the {count} in the beta yet.
            </>
          ) : (
            <>
              Drop In is an arcade ski descent we hand-build one mountain at a
              time, and it&rsquo;s live at {count} resorts so far. This
              isn&rsquo;t one of them — the resort may not be on PeakCam, or it
              may simply not have a descent built yet.
            </>
          )}
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-forest
                       px-5 py-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-cream-50
                       shadow-stamp transition-[transform,box-shadow] duration-100
                       hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp-lg
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink
                       focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            {backHref === "/" ? "Browse all resorts" : `${resortName} conditions`}
          </Link>
          <Link
            href="/drop-in"
            className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-cream-50
                       px-5 py-2.5 text-[13px] font-bold uppercase tracking-[0.06em] text-ink
                       shadow-stamp-sm transition-[transform,box-shadow] duration-100
                       hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink
                       focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            What is Drop In?
          </Link>
        </div>

        <h2 className="pc-display mt-14 text-2xl text-ink">
          Mountains you can ski right now
        </h2>
        <DropInRoster className="mt-6" exclude={resortSlug} />
      </div>
    </div>
  );
}
