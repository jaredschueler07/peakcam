import { DESCRIPTION_SOURCE_LABELS, type ResortDescription as Description } from "@/lib/resort-profile";

/**
 * The stored `resorts.description`, shown under the hero with its provenance
 * label ("Description · operator"). Renders nothing without a description —
 * block 2 of the parity plan generates them; this is the plumbing only.
 */
export function ResortDescription({ description }: { description: Description | null }) {
  if (!description) return null;
  return (
    <section aria-label="About this resort" className="mx-auto max-w-5xl px-4 pt-6 md:px-8">
      <p className="pc-eyebrow">Description · {DESCRIPTION_SOURCE_LABELS[description.source]}</p>
      <p className="mt-2 max-w-3xl text-[15.5px] leading-relaxed text-ink">{description.text}</p>
    </section>
  );
}
