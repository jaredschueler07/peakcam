"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";

/**
 * Route-level error boundary for /compare.
 *
 * Anything that throws while rendering the compare route (a bad `?resorts=`
 * value, a Supabase hiccup, a partial resort record) lands here instead of on
 * Vercel's bare "Application error" page.
 */
export default function CompareError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[PeakCam] /compare failed to render:", error);
  }, [error]);

  return (
    <div className="min-h-screen pc-paper flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-7 shadow-stamp md:p-9">
        <div className="pc-eyebrow mb-2 flex items-center gap-2" style={{ color: "var(--pc-bark)" }}>
          <AlertTriangle size={14} aria-hidden="true" />
          Compare
        </div>

        <h1 className="font-display font-black text-ink text-3xl leading-[1.02] tracking-[-0.02em] md:text-4xl">
          We couldn&rsquo;t load this <em className="text-alpen italic font-bold">comparison</em>.
        </h1>

        <p className="mt-3 text-[14px] leading-relaxed text-bark">
          Something went sideways fetching those resorts. Snow reports come from live feeds, so
          this is usually temporary — give it another go.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-alpen px-5 py-2.5 text-[13px] font-semibold text-cream-50
                       shadow-stamp-sm transition-[transform,box-shadow] duration-100
                       hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp"
          >
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>

          <Link
            href="/compare"
            className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-cream-50 px-5 py-2.5 text-[13px] font-semibold text-ink
                       shadow-stamp-sm transition-[transform,box-shadow] duration-100
                       hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp"
          >
            Start a new comparison
          </Link>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-bark transition-colors hover:text-ink"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back to resorts
          </Link>
        </div>

        {error.digest && (
          <p className="mt-6 border-t border-dashed border-bark/40 pt-4 font-mono text-[10.5px] uppercase tracking-[0.12em] text-bark">
            Reference {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
