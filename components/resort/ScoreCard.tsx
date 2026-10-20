// ─────────────────────────────────────────────────────────────
// Snow Score card (P7): the 0–100 ring with its rating, the dated tagline,
// the five components behind a native <details>, and the 30-day sparkline
// as inline SVG. Pure presentational, no hooks and no library, so the
// overview (a client component) and any server page share it, and the
// numbers are in the markup for crawlers and screen readers. Reads the same
// document /api/v1/resorts/{slug}/score-components serves, so the page and
// the API cannot disagree.
// ─────────────────────────────────────────────────────────────

import Link from "next/link";
import type { ConditionRating } from "@/lib/types";
import type { ResortScoreHistoryPublic } from "@/lib/public-api/schema";
import { SCORE_COMPONENT_IDS, SCORE_COMPONENT_LABELS } from "@/lib/score";

const RING_STROKE: Record<ConditionRating, string> = {
  great: "text-great",
  good: "text-good",
  fair: "text-fair",
  poor: "text-poor",
};

const CHIP: Record<ConditionRating, string> = {
  great: "bg-great text-cream-50 border-forest-dk",
  good: "bg-good text-cream-50 border-forest-dk",
  fair: "bg-fair text-ink border-bark-dk",
  poor: "bg-poor text-cream-50 border-bark-dk",
};

const SOURCE_WORD: Record<string, string> = {
  snotel: "SNOTEL",
  model: "model",
  operator: "operator",
  profile: "catalogue",
  derived: "derived",
  none: "none",
};

export interface ScoreRingProps {
  score: number;
  rating: ConditionRating;
  size?: number;
}

/** The ring alone: a track and an arc whose length is the score; the number sits in the middle. */
export function ScoreRing({ score, rating, size = 112 }: ScoreRingProps) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 112 112"
      role="img"
      aria-label={`Snow Score ${score} of 100, ${rating}`}
      className={`flex-shrink-0 ${RING_STROKE[rating]}`}
      data-testid="score-ring"
      data-score={score}
      data-rating={rating}
    >
      <circle cx="56" cy="56" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="9" />
      <circle
        cx="56"
        cy="56"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${filled.toFixed(2)} ${(c - filled).toFixed(2)}`}
        transform="rotate(-90 56 56)"
      />
      <text x="56" y="56" textAnchor="middle" dominantBaseline="central" className="fill-ink font-display font-black" style={{ fontSize: 36, letterSpacing: "-0.02em" }}>
        {score}
      </text>
    </svg>
  );
}

export interface ScoreSparklineProps {
  points: ResortScoreHistoryPublic["history"];
  days: number;
}

/** Thirty days of scores as one line on a 0–100 axis; gaps (unscored days) break the line rather than being drawn through. */
export function ScoreSparkline({ points, days }: ScoreSparklineProps) {
  if (points.length < 2) return null;
  const W = 320;
  const H = 56;
  const PAD = 4;
  const last = points[points.length - 1].date;
  const dayIndex = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000) + (days - 1);
  const x = (date: string) => PAD + (Math.max(0, Math.min(days - 1, dayIndex(date))) / (days - 1)) * (W - 2 * PAD);
  const y = (score: number) => PAD + (1 - Math.max(0, Math.min(100, score)) / 100) * (H - 2 * PAD);
  // Split into runs of consecutive days so a missing day shows as a gap.
  const segments: string[] = [];
  let current: string[] = [];
  let prevIdx: number | null = null;
  for (const p of points) {
    const idx = dayIndex(p.date);
    const cmd = `${x(p.date).toFixed(1)},${y(p.score).toFixed(1)}`;
    if (prevIdx != null && idx - prevIdx > 1) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    }
    current.push(cmd);
    prevIdx = idx;
  }
  if (current.length) segments.push(current.join(" "));
  const first = points[0];
  const tail = points[points.length - 1];
  const min = points.reduce((m, p) => (p.score < m.score ? p : m), first);
  const max = points.reduce((m, p) => (p.score > m.score ? p : m), first);
  const summary = `${points.length} scored days from ${first.date} to ${tail.date}: ${first.score} to ${tail.score}, low ${min.score} on ${min.date}, high ${max.score} on ${max.date}.`;
  return (
    <figure className="mt-3" data-testid="score-sparkline">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`Snow Score over the last ${days} days`} className="block text-ink">
        <title>{summary}</title>
        <line x1={PAD} x2={W - PAD} y1={y(50)} y2={y(50)} stroke="currentColor" strokeOpacity="0.2" strokeDasharray="3 3" />
        {segments.map((d, i) => (
          <polyline key={i} points={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {segments.length ? <circle cx={x(tail.date)} cy={y(tail.score)} r="3.5" fill="currentColor" /> : null}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

export interface ScoreCardProps {
  doc: ResortScoreHistoryPublic;
  /** The resort name, for the unavailable copy. */
  resortName: string;
}

/** The full card: ring, rating, tagline, components and sparkline. Renders a short note when there is no score yet. */
export function ScoreCard({ doc, resortName }: ScoreCardProps) {
  const today = doc.today;
  if (!today) {
    if (!doc.available) return null;
    return (
      <div className="bg-cream-50 border-[1.5px] border-dashed border-bark rounded-[18px] p-5 text-sm text-bark-dk" data-testid="score-card" data-score="none">
        No current Snow Score for {resortName}: the last scored day is older than three days. {doc.history.length ? `Last scored ${doc.history[doc.history.length - 1].date} at ${doc.history[doc.history.length - 1].score}.` : ""}
      </div>
    );
  }
  return (
    <div className="bg-cream-50 border-[1.5px] border-ink rounded-[18px] shadow-stamp p-5" data-testid="score-card" data-score={today.score} data-rating={today.rating}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <ScoreRing score={today.score} rating={today.rating} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pc-eyebrow" style={{ color: "var(--pc-bark)" }}>
              PeakCam Snow Score
            </span>
            <span className={`inline-flex items-center rounded-full border-[1.5px] px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] ${CHIP[today.rating]}`} data-testid="score-rating">
              {today.rating}
            </span>
            <span className="font-mono text-[11px] text-bark">{today.date}</span>
          </div>
          <p className="mt-2 text-[15px] leading-snug text-ink" data-testid="score-tagline">
            {today.tagline}
          </p>
          <details className="mt-3 group">
            <summary className="cursor-pointer select-none font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink underline decoration-alpen/60 decoration-2 underline-offset-[3px] hover:decoration-alpen">
              Why {today.score}? The five components
            </summary>
            <ul className="mt-3 space-y-2" data-testid="score-components">
              {SCORE_COMPONENT_IDS.map((id) => {
                const c = today.components[id];
                const pct = c.max > 0 ? Math.round((c.points / c.max) * 100) : 0;
                return (
                  <li key={id} className="text-[13px] leading-snug">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-bold text-ink">{SCORE_COMPONENT_LABELS[id]}</span>
                      <span className="font-mono text-[12px] font-bold tabular-nums text-ink">
                        {c.points} <span className="text-bark">/ {c.max}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
                      <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-bark-dk">
                      {c.basis}
                      <span className="text-bark"> · {SOURCE_WORD[c.source] ?? c.source}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[12px] text-bark">
              Algorithmic, formula {today.version}: great ≥ {doc.ladder.great}, good ≥ {doc.ladder.good}, fair ≥ {doc.ladder.fair}.{" "}
              <Link href="/methodology#score" className="underline underline-offset-2 hover:text-ink">
                How the score works
              </Link>
              {" · "}
              <a href={doc.apiUrl} className="underline underline-offset-2 hover:text-ink">
                JSON
              </a>
            </p>
          </details>
          {doc.history.length >= 2 && (
            <>
              <div className="mt-3 pc-eyebrow" style={{ color: "var(--pc-bark)", fontSize: 10 }}>
                Last {doc.days} days
              </div>
              <ScoreSparkline points={doc.history} days={doc.days} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
