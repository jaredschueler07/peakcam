"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";

/**
 * Root error boundary. Anything a page throws while rendering under the root
 * layout (a Supabase timeout is the usual suspect) lands on this card instead
 * of Vercel's bare "Application error" page. Routes with their own error.tsx
 * (/compare) take precedence.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("[PeakCam] page failed to render:", error);
  }, [error]);

  // `reset` alone only clears the boundary's state and re-renders the same
  // errored server payload; refreshing in the same transition re-fetches it.
  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <main
      id="main-content"
      className="min-h-screen pc-paper flex items-center justify-center px-4 py-16"
    >
      <div className="w-full max-w-lg rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-7 shadow-stamp md:p-9">
        <div className="pc-eyebrow mb-2 flex items-center gap-2" style={{ color: "var(--pc-bark)" }}>
          <AlertTriangle size={14} aria-hidden="true" />
          PeakCam
        </div>

        <h1 className="font-display font-black text-ink text-3xl leading-[1.02] tracking-[-0.02em] md:text-4xl">
          We couldn&rsquo;t load this <em className="text-alpen italic font-bold">page</em>.
        </h1>

        <p className="mt-3 text-[14px] leading-relaxed text-bark">
          Something went sideways fetching it. Cams and snow reports come from live feeds, so this
          is usually temporary — give it another go.
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-ink bg-alpen-dk px-5 py-2.5 text-[13px] font-semibold text-cream-50
                       shadow-stamp-sm transition-[transform,box-shadow] duration-100
                       hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp"
          >
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>

          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-ink bg-cream-50 px-5 py-2.5 text-[13px] font-semibold text-ink
                       shadow-stamp-sm transition-[transform,box-shadow] duration-100
                       hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp"
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
    </main>
  );
}
