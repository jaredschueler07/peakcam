"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import type { HudState } from "@/lib/game/runtime/UiBridge";
import type { CompetitiveRunMode } from "@/lib/game/config/modes";
import {
  resultsOutcome,
  takeRecordingOnce,
  type FinishedRunRecording,
  type RecordingCache,
  type SubmittableRunSession,
  type SubmittedRun,
} from "@/lib/game/competition/run-client";
import type { DecodedGhost } from "@/lib/game/replay/codec";
import LeaderboardPanel from "./LeaderboardPanel";
import SubmitRunCard from "./SubmitRunCard";

/**
 * What the dialog needs to talk to the leaderboard. `null` for Free Ski, and
 * that is load-bearing: a local run has no board, no submission, and no ghost —
 * the whole section is absent rather than disabled.
 */
export interface ResultsCompetition {
  session: SubmittableRunSession;
  mode: CompetitiveRunMode;
  resortSlug: string;
  trailId: string;
  /** Consumes the runtime's recording; called once per results screen. */
  takeRecording(): FinishedRunRecording | null;
  onRaceGhost(ghost: DecodedGhost, runId: string): void;
  /** The ghost currently loaded into the renderer, if any. */
  racedRunId: string | null;
  onClearGhost(): void;
}

interface OpenRun {
  recording: FinishedRunRecording | null;
  /**
   * Snapshotted when the dialog opened. A submission clears the frozen ticket,
   * so `session.offline` reads true again afterwards — asking it later would
   * label a run that just made the board as offline.
   */
  offline: boolean;
  /** Frozen so a player who reads the board before submitting still reports an
   * honest wall clock (the validator compares it against the run duration). */
  finishedAtMs: number;
}

export default function ResultsDialog({
  store,
  onRestart,
  competition = null,
}: {
  store: StoreApi<HudState>;
  onRestart(): void;
  competition?: ResultsCompetition | null;
}) {
  const show = useStore(store, (state) => state.status === "results");
  const score = useStore(store, (state) => state.score);
  const time = useStore(store, (state) => state.elapsedSeconds);
  const [open, setOpen] = useState<OpenRun | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedRun | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // `undefined` until this results screen has taken its recording. The runtime
  // hands it over destructively, and StrictMode runs the effect below twice.
  const takenRef = useRef<RecordingCache["current"]>(undefined);

  // `useLayoutEffect`, not `useEffect`: the first render after the run ends has
  // no snapshot yet and therefore reads as "offline". Committing the snapshot
  // before paint is what stops a one-frame "Played offline" flash on a run that
  // is about to offer a submit button.
  //
  // Deliberately keyed on `show` alone: everything read here is a snapshot of
  // the moment the run ended, and re-running it when the session object changes
  // identity (which a submission causes) would reset the dialog under the
  // player.
  useLayoutEffect(() => {
    if (!show) {
      setOpen(null);
      setSubmitted(null);
      setDismissed(false);
      // The next results screen is a different run and takes its own recording.
      takenRef.current = undefined;
      return;
    }
    setOpen({
      // Idempotent: StrictMode invokes this twice, and the second raw take
      // would return null and mislabel a submittable run as offline.
      recording: competition
        ? takeRecordingOnce(() => competition.takeRecording(), takenRef)
        : null,
      offline: competition ? competition.session.offline : true,
      finishedAtMs: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const dialogRef = useDialogFocus(show && !dismissed);

  if (!show || dismissed) return null;

  const outcome = resultsOutcome({
    competitive: competition !== null,
    // Before the open effect has run there is no recording to submit, so the
    // conservative reading is the right one.
    offlineAtOpen: open?.offline ?? true,
    hasRecording: open?.recording != null,
    submitted: submitted !== null,
  });

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="absolute inset-0 z-30 flex items-center justify-center bg-ink/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="results-title"
      data-testid="drop-in-results"
    >
      <div className="pc-paper max-h-full w-full max-w-md overflow-y-auto rounded-lg border-[1.5px] border-ink p-6 text-center shadow-stamp-lg">
        <p className="pc-eyebrow">Run complete</p>
        <h2 id="results-title" className="pc-display text-4xl">Your line</h2>
        <p className="mt-3 font-mono">{score.toLocaleString()} pts · {time.toFixed(1)}s</p>

        {/* Outcome 1 — submitted. Rendered from the response we hold, never
            from the session, which reads offline again once the ticket is spent. */}
        {outcome === "submitted" && submitted && (
          <p
            role="status"
            data-testid="drop-in-submit-result"
            data-accepted={submitted.accepted ? "true" : "false"}
            className="mt-4 inline-block rounded-sm border-[1.5px] border-ink bg-cream-50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink"
          >
            {submitted.accepted
              ? `Submitted as ${submitted.displayName ?? "Anonymous"}`
              : `Not ranked — ${submitted.rejectionCode ?? "rejected"}`}
          </p>
        )}

        {/* Outcome 2 — the run was never submittable: Free Ski aside, this is a
            competitive run that started without a live ticket. */}
        {outcome === "offline" && (
          <p
            role="status"
            data-testid="drop-in-offline-notice"
            className="mt-4 inline-block rounded-sm border-[1.5px] border-ink bg-mustard px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink"
          >
            Played offline — not submitted to the leaderboard
          </p>
        )}

        {outcome === "submittable" && competition && open?.recording && (
          <SubmitRunCard
            session={competition.session}
            mode={competition.mode}
            resortSlug={competition.resortSlug}
            recording={open.recording}
            score={score}
            finishedAtMs={open.finishedAtMs}
            onSubmitted={setSubmitted}
          />
        )}

        {/* Free Ski (`outcome === "free_ski"`) reaches none of the above and
            none of this: no submission, no board, no ghost. */}
        {outcome !== "free_ski" && competition && (
          <LeaderboardPanel
            resortSlug={competition.resortSlug}
            mode={competition.mode}
            trailId={competition.trailId}
            highlightRunId={submitted?.accepted ? submitted.runId : null}
            onRaceGhost={competition.onRaceGhost}
            racedRunId={competition.racedRunId}
            onClearGhost={competition.onClearGhost}
          />
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            className="rounded-full border-[1.5px] border-ink bg-alpen px-5 py-2 font-bold text-cream-50 shadow-stamp-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            onClick={onRestart}
          >
            Drop again
          </button>
          {/* Always available, whatever the network is doing: a failed fetch
              must never leave the player stuck behind this dialog. */}
          <button
            className="rounded-full border-[1.5px] border-ink bg-cream-50 px-5 py-2 font-bold text-ink shadow-stamp-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            onClick={() => setDismissed(true)}
            data-testid="drop-in-results-dismiss"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
