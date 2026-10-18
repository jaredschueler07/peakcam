import type { ReactNode } from "react";

// Server component: one "set it up in <client>" card. Stamp border, eyebrow
// title, optional "where supported" badge, body supplied by the page.
export function ClientCard({
  id,
  title,
  badge,
  children,
}: {
  id: string;
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  return (
    <article
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-20 rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-5 shadow-stamp"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={`${id}-heading`} className="font-display text-xl font-black tracking-[-0.01em] text-ink">
          {title}
        </h3>
        {badge && (
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-bark">{badge}</span>
        )}
      </div>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink">{children}</div>
    </article>
  );
}
