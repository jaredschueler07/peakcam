import Link from "next/link";
import { getAllResorts } from "@/lib/supabase";

export default async function ResortNotFound() {
  let suggestions: { name: string; slug: string; state: string }[] = [];

  try {
    const resorts = await getAllResorts();
    // Pick up to 6 popular resorts (those with the most cams)
    suggestions = resorts
      .sort((a, b) => b.cams.length - a.cams.length)
      .slice(0, 6)
      .map((r) => ({ name: r.name, slug: r.slug, state: r.state }));
  } catch {
    // Supabase unavailable — show page without suggestions
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-5xl mb-4">⛷️</div>
        <h1 className="text-2xl font-bold text-text-base mb-2">Resort Not Found</h1>
        <p className="text-text-muted text-sm mb-8">
          We couldn&apos;t find that resort. It may not be in our system yet, or the URL might be incorrect.
        </p>

        {suggestions.length > 0 && (
          <div className="mb-8">
            <h2 className="text-text-subtle text-xs font-semibold uppercase tracking-wide mb-3">
              Popular Resorts
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {suggestions.map((r) => (
                <Link
                  key={r.slug}
                  href={`/resorts/${r.slug}`}
                  className="bg-surface border border-border rounded-lg px-3 py-2.5 text-left
                             hover:border-border-hi hover:text-cyan transition-all duration-150"
                >
                  <div className="text-text-base text-sm font-medium">{r.name}</div>
                  <div className="text-text-muted text-xs">{r.state}</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-cyan text-sm font-medium hover:underline"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Browse all resorts
        </Link>
      </div>
    </div>
  );
}
