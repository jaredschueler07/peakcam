"use client";

import type { CompetitiveRunMode } from "@/lib/game/config/modes";

/**
 * The three things a player can pick on the start poster. `free_ski` is the
 * default and is purely local — no ticket, no recording, no leaderboard. The
 * other two are the server's `CompetitiveRunMode`s:
 *
 *   - `time_trial`  — Time Trial, seed fixed for the life of the course version
 *   - `score_attack` — Daily Line, seed rotates once per UTC day
 *
 * (See `courseSeed` in lib/game/server/courses.ts: the daily rotation is what
 * `score_attack` *is*, which is why Daily Line maps there and not to a
 * time_trial variant.)
 */
export type DropInModeChoice = "free_ski" | CompetitiveRunMode;

export interface ModeSelectProps {
  selected: DropInModeChoice;
  onSelect(mode: DropInModeChoice): void;
  /** Trail the Daily Line runs today, resolved from the ticket when there is one. */
  dailyCourseName: string;
  /** Mode whose ticket request is in flight, if any. */
  pending?: DropInModeChoice | null;
  /** Set when the sessions API failed; the run still starts, just offline. */
  notice?: string | null;
}

interface ModeCard {
  mode: DropInModeChoice;
  title: string;
  blurb: string;
}

const CARDS: readonly ModeCard[] = [
  { mode: "free_ski", title: "Free Ski", blurb: "No clock, no board. Just the mountain." },
  { mode: "time_trial", title: "Time Trial", blurb: "Fixed line, fixed seed. Chase the record." },
  { mode: "score_attack", title: "Daily Line", blurb: "One course a day, same for everyone." },
];

export default function ModeSelect({
  selected,
  onSelect,
  dailyCourseName,
  pending = null,
  notice = null,
}: ModeSelectProps) {
  return (
    <div className="mt-6" data-testid="drop-in-mode-select">
      <p className="pc-eyebrow text-bark-dk">Choose your run</p>
      <div role="radiogroup" aria-label="Run mode" className="mt-3 grid gap-3 sm:grid-cols-3">
        {CARDS.map((card) => {
          const active = selected === card.mode;
          return (
            <button
              key={card.mode}
              type="button"
              role="radio"
              aria-checked={active}
              data-mode={card.mode}
              onClick={() => onSelect(card.mode)}
              className={[
                "rounded-lg border-[1.5px] border-ink px-4 py-3 text-left transition-transform",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink",
                active
                  ? "-translate-y-0.5 bg-alpen text-cream-50 shadow-stamp"
                  : "bg-cream-50 text-ink shadow-stamp-sm hover:-translate-y-0.5",
              ].join(" ")}
            >
              <span className="pc-display block text-2xl leading-tight">{card.title}</span>
              <span
                className={`mt-1 block text-xs ${active ? "text-cream-50/85" : "text-bark-dk"}`}
              >
                {card.blurb}
              </span>
              {card.mode === "score_attack" && (
                <span
                  className={`mt-2 block font-mono text-[10px] uppercase tracking-[0.12em] ${
                    active ? "text-cream-50/85" : "text-bark"
                  }`}
                  data-testid="daily-line-course"
                >
                  {/* Course name only. The trail is fixed and only the seed
                      rotates daily, so printing the date beside the trail name
                      implied the trail changes too. The card blurb already
                      says "one course a day". */}
                  {dailyCourseName}
                </span>
              )}
              {pending === card.mode && (
                <span
                  role="status"
                  aria-live="polite"
                  data-testid="drop-in-session-pending"
                  className="mt-2 block font-mono text-[10px] uppercase tracking-[0.12em]"
                >
                  Reserving run…
                </span>
              )}
            </button>
          );
        })}
      </div>
      {notice && (
        <p
          role="status"
          data-testid="drop-in-session-notice"
          className="mt-3 inline-block rounded-sm border-[1.5px] border-ink bg-mustard px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
