import Link from "next/link";
import type { ResortWithData } from "@/lib/types";
import { buildAboutParagraphs, buildResortFaq } from "@/lib/resort-copy";
import { RESORT_EDITORIAL } from "@/data/resort-editorial";
import { SITE_URL } from "@/lib/site";

/**
 * Server-rendered "About + FAQ" block for resort pages. All prose is either
 * hand-curated (data/resort-editorial.ts) or synthesized from live DB fields
 * (lib/resort-copy.ts), and the FAQPage JSON-LD mirrors ONLY the Q&A visibly
 * rendered here — invisible-schema mismatch is a Google penalty.
 */
export function ResortAboutSection({ resort }: { resort: ResortWithData }) {
  const now = new Date();
  const editorial = RESORT_EDITORIAL[resort.slug];
  const paragraphs = buildAboutParagraphs(resort, now);
  const faq = buildResortFaq(resort, now);

  const faqLd = faq.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        })),
      }
    : null;

  return (
    <section aria-labelledby="about-heading" className="max-w-3xl mx-auto px-6 py-12">
      {faqLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />
      )}

      <h2
        id="about-heading"
        className="font-display font-black text-[32px] leading-[0.95] tracking-[-0.02em] text-ink mb-5"
      >
        About {resort.name}
      </h2>

      <div className="space-y-4 text-[15.5px] leading-relaxed text-ink">
        {editorial && <p>{editorial.intro}</p>}
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {faq.length > 0 && (
        <div className="mt-10">
          <h3 className="font-mono font-bold text-[11px] text-bark uppercase tracking-[0.18em] mb-4">
            Frequently Asked
          </h3>
          <dl className="space-y-6 border-t border-dashed border-bark/60 pt-6">
            {faq.map((f) => (
              <div key={f.question}>
                <dt className="font-display font-bold text-[19px] text-ink mb-1.5">
                  {f.question}
                </dt>
                <dd className="text-[15px] leading-relaxed text-ink/85">{f.answer}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 text-[13px] text-bark">
            More on how these numbers are measured:{" "}
            <Link href="/methodology" className="underline underline-offset-2 hover:text-ink">
              {SITE_URL.replace("https://", "")}/methodology
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}
