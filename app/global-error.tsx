"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Fraunces, DM_Sans, JetBrains_Mono } from "next/font/google";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import "./globals.css";

// This boundary replaces the root layout wholesale when the layout itself
// throws, so nothing from app/layout.tsx is on the page: the stylesheet and
// fonts are re-declared here, and no app providers (auth, analytics) are
// mounted — the fewer moving parts, the more likely this card renders.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["700", "900"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-dm-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("[PeakCam] root layout failed to render:", error);
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
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}>
      <body className={`${dmSans.className} antialiased`}>
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
              PeakCam hit a <em className="text-alpen italic font-bold">rough patch</em>.
            </h1>

            <p className="mt-3 text-[14px] leading-relaxed text-bark">
              The whole page failed to load. That is usually a live-feed hiccup that clears on its
              own — give it another go, or head back to the resort list.
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

              {/* A plain anchor, deliberately: after a root-level failure a
                  full document load is the surest way back (fresh layout,
                  providers and fonts), and there is no router state to keep. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-ink bg-cream-50 px-5 py-2.5 text-[13px] font-semibold text-ink
                           shadow-stamp-sm transition-[transform,box-shadow] duration-100
                           hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp"
              >
                <ArrowLeft size={14} aria-hidden="true" />
                Back to resorts
              </a>
            </div>

            {error.digest && (
              <p className="mt-6 border-t border-dashed border-bark/40 pt-4 font-mono text-[10.5px] uppercase tracking-[0.12em] text-bark">
                Reference {error.digest}
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
