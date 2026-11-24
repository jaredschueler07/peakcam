import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Resort Not Found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen pc-paper flex flex-col items-center justify-center px-4 text-center">
      <p className="text-bark text-sm font-mono font-bold tracking-widest uppercase mb-3">404</p>
      <h1 className="font-heading font-bold uppercase tracking-wider text-3xl md:text-4xl text-ink mb-3">
        Resort Not Found
      </h1>
      <p className="text-bark text-sm max-w-sm mb-8">
        We couldn&apos;t find a resort matching that URL. It may have been moved or the slug might be incorrect.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm font-semibold text-cream-50
                   border-[1.5px] border-ink bg-ink rounded-full px-5 py-2.5 shadow-stamp-sm
                   hover:shadow-stamp transition-all duration-150"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Browse all resorts
      </Link>
    </div>
  );
}
