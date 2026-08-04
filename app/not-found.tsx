import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page Not Found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 text-center">
      <p className="text-text-muted text-sm font-medium tracking-widest uppercase mb-3">404</p>
      <h1 className="font-heading font-bold uppercase tracking-wider text-3xl md:text-4xl text-text-base mb-3">
        Page Not Found
      </h1>
      <p className="text-text-muted text-sm max-w-sm mb-8">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm font-semibold text-cyan
                   border border-cyan/30 bg-cyan-dim rounded-lg px-5 py-2.5
                   hover:bg-cyan-mid transition-all duration-150"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to PeakCam
      </Link>
    </div>
  );
}
