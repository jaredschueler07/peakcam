"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { whenPostHogReady } from "@/lib/analytics-events";
import { trackDropIn } from "@/lib/game/analytics/events";
import type { CompetitiveRunMode } from "@/lib/game/config/modes";
import {
  fetchGhost,
  fetchLeaderboard,
  isRunClientFailure,
  LEADERBOARD_LIMIT,
  type LeaderboardBoard,
  type LeaderboardRow,
} from "@/lib/game/competition/run-client";
import type { DecodedGhost } from "@/lib/game/replay/codec";

/**
 * The top {@link LEADERBOARD_LIMIT} of one course's board, plus the two actions
 * that make it more than a list: finding your own row, and pulling another
 * player's ghost down to race.
 *
 * Every fetch here is optional to the game. The board is read after the run is
 * already recorded and (if it was going to be) submitted, so a leaderboard that
 * is down costs the player nothing but a notice — the panel renders an error
 * with a retry and the results dialog stays dismissible.
 */
export interface LeaderboardPanelProps {
  resortSlug: string;
  mode: CompetitiveRunMode;
  trailId: string;
  /**
   * The run just submitted, if any. Highlighted and used to report placement —
   * the submission route answers before the board is re-read, so a rank only
   * exists once the row shows up here.
   */
  highlightRunId?: string | null;
  /** Hand a decoded replay to the runtime. Omitted when there is no live game. */
  onRaceGhost?(ghost: DecodedGhost, runId: string): void;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; error: string }
  | { phase: "ready"; board: LeaderboardBoard };

function formatTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

export default function LeaderboardPanel({
  resortSlug,
  mode,
  trailId,
  highlightRunId = null,
  onRaceGhost,
}: LeaderboardPanelProps) {
  // One state, not three: the fetch has exactly one outcome, and a single
  // transition set from the callback keeps the effect free of synchronous
  // setState (and the panel free of a "loading with a stale error" render).
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [racingId, setRacingId] = useState<string | null>(null);
  const [ghostError, setGhostError] = useState<string | null>(null);
  // One canceller per event: a pending "viewed" capture (PostHog not yet
  // initialised) must not be thrown away by a ghost race, and vice versa.
  const cancelViewTrackRef = useRef<(() => void) | null>(null);
  const cancelGhostTrackRef = useRef<(() => void) | null>(null);
  const viewedRef = useRef(false);

  // `highlightRunId` is a dependency on purpose: it arrives when a submission
  // succeeds, and the board read at the end of the run predates that row.
  useEffect(() => {
    const controller = new AbortController();
    void fetchLeaderboard({ resortSlug, courseId: trailId, mode }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (isRunClientFailure(result)) {
          // Our own cancellation is not worth telling anyone about.
          if (!result.aborted) setLoad({ phase: "error", error: result.error });
          return;
        }
        setLoad({ phase: "ready", board: result });
        // One view per panel, not one per fetch: the post-submission refresh
        // and a retry are the same look at the same board.
        if (viewedRef.current) return;
        viewedRef.current = true;
        // Post-init only: a capture made before posthog.init() is dropped.
        cancelViewTrackRef.current = whenPostHogReady(() =>
          trackDropIn({
            name: "drop_in_leaderboard_viewed",
            properties: { resort_slug: resortSlug, mode },
          }),
        );
      });
    return () => controller.abort();
  }, [resortSlug, trailId, mode, reloadKey, highlightRunId]);

  useEffect(() => () => {
    cancelViewTrackRef.current?.();
    cancelGhostTrackRef.current?.();
  }, []);

  const raceGhost = useCallback(
    (runId: string) => {
      if (!onRaceGhost) return;
      setRacingId(runId);
      setGhostError(null);
      void fetchGhost(runId).then((result) => {
        setRacingId(null);
        if (isRunClientFailure(result)) {
          if (!result.aborted) setGhostError(result.error);
          return;
        }
        cancelGhostTrackRef.current?.();
        cancelGhostTrackRef.current = whenPostHogReady(() =>
          trackDropIn({
            name: "drop_in_ghost_raced",
            properties: { resort_slug: resortSlug, ghost_run_id: runId },
          }),
        );
        onRaceGhost(result, runId);
      });
    },
    [onRaceGhost, resortSlug],
  );

  const rows: readonly LeaderboardRow[] = load.phase === "ready" ? load.board.rows : [];
  const ownRow = highlightRunId ? rows.find((row) => row.id === highlightRunId) ?? null : null;
  const isOwn = (row: LeaderboardRow) => row.isSelf || row.id === highlightRunId;

  return (
    <section className="mt-5 text-left" data-testid="drop-in-leaderboard" data-mode={mode}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="pc-eyebrow text-bark-dk">
          {mode === "time_trial" ? "Time Trial" : "Daily Line"} · Top {LEADERBOARD_LIMIT}
        </p>
        {ownRow && (
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-alpen" data-testid="drop-in-placement">
            You placed #{ownRow.rank}
          </p>
        )}
      </div>

      {load.phase === "loading" && (
        <p role="status" aria-live="polite" className="mt-3 font-mono text-xs text-bark-dk">
          Reading the board…
        </p>
      )}

      {load.phase === "error" && (
        <div role="status" className="mt-3 rounded-sm border-[1.5px] border-ink bg-mustard px-3 py-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">{load.error}</p>
          <button
            type="button"
            onClick={() => {
              setLoad({ phase: "loading" });
              setReloadKey((key) => key + 1);
            }}
            className="mt-2 rounded-full border-[1.5px] border-ink bg-cream-50 px-3 py-1 text-xs font-bold uppercase text-ink shadow-stamp-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            Try again
          </button>
        </div>
      )}

      {load.phase === "ready" && rows.length === 0 && (
        <p className="mt-3 text-sm text-bark-dk" data-testid="drop-in-leaderboard-empty">
          No runs on this line yet. Yours could be the first.
        </p>
      )}

      {load.phase === "ready" && rows.length > 0 && (
        <ol className="mt-3 max-h-56 overflow-y-auto">
          {rows.map((row) => (
            <li
              key={row.id}
              data-own={isOwn(row) ? "true" : undefined}
              className={[
                "flex items-center gap-3 border-b border-ink/15 py-1.5 text-sm last:border-b-0",
                isOwn(row) ? "bg-mustard/40 font-bold" : "",
              ].join(" ")}
            >
              <span className="w-7 shrink-0 font-mono text-xs text-bark-dk">#{row.rank}</span>
              <span className="min-w-0 flex-1 truncate">{row.displayName ?? "Anonymous"}</span>
              <span className="shrink-0 font-mono text-xs">
                {mode === "time_trial" ? formatTime(row.timeMs) : `${row.score.toLocaleString()} pts`}
              </span>
              {onRaceGhost && row.hasGhost && (
                <button
                  type="button"
                  onClick={() => raceGhost(row.id)}
                  disabled={racingId !== null}
                  className="shrink-0 rounded-full border-[1.5px] border-ink bg-cream-50 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink shadow-stamp-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  {racingId === row.id ? "Loading…" : "Race"}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {ghostError && (
        <p role="status" className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-alpen-dk">
          {ghostError}
        </p>
      )}
    </section>
  );
}
