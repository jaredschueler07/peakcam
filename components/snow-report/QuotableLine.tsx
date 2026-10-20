import Link from "next/link";
import type { Quotable } from "@/lib/quotable";

/** The dated sentence under a hub H1 with its resort links, plain text in the server HTML. */
export function QuotableLine({ sentence, testId }: { sentence: Quotable; testId?: string }) {
  return (
    <p className="mt-5 max-w-2xl text-balance text-lg leading-snug text-bark-dk" data-testid={testId}>
      {sentence.segments.map((segment, index) =>
        segment.href ? (
          <Link key={index} href={segment.href} prefetch={false} className="font-bold text-ink underline decoration-alpen/60 decoration-2 underline-offset-[3px] hover:decoration-alpen">
            {segment.text}
          </Link>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
