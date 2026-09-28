import Link from "next/link";
import type { HubFaqItem } from "@/lib/hub-copy";

/**
 * Visible FAQ for a hub page. The page emits FAQPage JSON-LD from the SAME
 * `faq` array, so the structured data can only ever describe questions that
 * are actually on the page (invisible-schema mismatch is a Google penalty).
 */
export function HubFaq({ faq, label }: { faq: HubFaqItem[]; label: string }) {
  if (faq.length === 0) return null;
  return (
    <section aria-labelledby="hub-faq-heading" className="mt-14">
      <h2 id="hub-faq-heading" className="font-display text-2xl font-black text-ink">
        {label} snow and webcam questions
      </h2>
      <dl className="mt-4 divide-y divide-ink/10 rounded-[18px] border-[1.5px] border-ink bg-cream-50 shadow-stamp">
        {faq.map((item) => (
          <div key={item.question} className="px-5 py-4">
            <dt className="font-display text-lg font-bold text-ink">{item.question}</dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-bark">{item.answer}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-bark">
        How the numbers are measured:{" "}
        <Link href="/methodology" className="font-bold text-ink underline underline-offset-2">
          SNOTEL telemetry, quality control and the model fallback
        </Link>
        . Opening dates for every resort:{" "}
        <Link href="/opening-dates" className="font-bold text-ink underline underline-offset-2">
          projected and confirmed dates
        </Link>
        .
      </p>
    </section>
  );
}
