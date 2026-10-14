import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 text-center">
      <p className="text-text-muted text-sm font-medium tracking-widest uppercase mb-3">404</p>
      <h1 className="font-heading font-bold uppercase tracking-wider text-3xl md:text-4xl text-text-base mb-3">
        Resort Not Found
      </h1>
      <p className="text-text-muted text-sm max-w-sm mb-8">
        We couldn&apos;t find a resort matching that URL. It may have been moved or the slug might be incorrect.
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
        Browse all resorts
      </Link>
    </div>
  );
}
