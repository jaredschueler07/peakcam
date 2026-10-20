import Link from "next/link";
import type { QuotableSegment } from "@/lib/quotable";

/**
 * The dated, source-labelled sentence from lib/quotable.ts, rendered as plain
 * server HTML (links on the segments that carry them) so crawlers and answer
 * engines can lift it verbatim. The overview renders the same markup inside
 * ResortDetailPage; the subpages use this.
 */
export function FreshnessSentence({ segments, id }: { segments: readonly QuotableSegment[]; id?: string }) {
  if (!segments.length) return null;
  return (
    <p id={id} className="mt-3 max-w-2xl text-balance text-lg leading-snug text-bark-dk" data-testid="resort-freshness">
      {segments.map((segment, index) =>
        segment.href ? (
          <Link
            key={index}
            href={segment.href}
            prefetch={false}
            className="font-bold text-ink underline decoration-alpen/60 decoration-2 underline-offset-[3px] hover:decoration-alpen"
          >
            {segment.text}
          </Link>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
