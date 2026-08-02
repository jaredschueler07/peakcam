"use client";

import { useEffect, useRef, useState } from "react";

import { whenPostHogReady } from "@/lib/analytics-events";
import { trackDropIn } from "@/lib/game/analytics/events";
import type { CompetitiveRunMode } from "@/lib/game/config/modes";
import {
  clampNickname,
  MAX_NICKNAME_INPUT_LENGTH,
  submitRun,
  type FinishedRunRecording,
  type SubmittableRunSession,
  type SubmittedRun,
} from "@/lib/game/competition/run-client";

/**
 * The submit half of the results dialog: name the run, send it, and report what
 * the server said.
 *
 * This card never reads `session.ticket` — `submitRun` is the single owner of
 * that field and of `markSubmitted()` (see `lib/game/competition/run-client.ts`).
 * The card only decides whether to *offer* submission, and it makes that call
 * from `session.offline`, snapshotted when the dialog opens: a successful
 * submission clears the frozen ticket, so reading the live value afterwards
 * would report an offline session for a run that just made the board.
 */
export interface SubmitRunCardProps {
  session: SubmittableRunSession;
  mode: CompetitiveRunMode;
  resortSlug: string;
  recording: FinishedRunRecording;
  score: number;
  /** Wall clock at which the descent ended, frozen when the dialog opened. */
  finishedAtMs: number;
  onSubmitted(run: SubmittedRun): void;
}

type CardState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "failed"; error: string }
  /** The ticket was already gone (spent or never issued); nothing was sent. */
  | { phase: "skipped" };

export default function SubmitRunCard({
  session,
  mode,
  resortSlug,
  recording,
  score,
  finishedAtMs,
  onSubmitted,
}: SubmitRunCardProps) {
  const [nickname, setNickname] = useState("");
  const [state, setState] = useState<CardState>({ phase: "idle" });
  const cancelPendingTrackRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelPendingTrackRef.current?.(), []);

  const submit = () => {
    if (state.phase === "submitting") return;
    setState({ phase: "submitting" });
    void submitRun(session, recording, {
      score,
      nickname,
      finishedAtMs,
    }).then((outcome) => {
      if (outcome.status === "failed") {
        setState({ phase: "failed", error: outcome.error });
        return;
      }
      if (outcome.status === "skipped") {
        setState({ phase: "skipped" });
        return;
      }
      cancelPendingTrackRef.current?.();
      cancelPendingTrackRef.current = whenPostHogReady(() =>
        trackDropIn({
          name: "drop_in_run_submitted",
          properties: {
            resort_slug: resortSlug,
            mode,
            accepted: outcome.run.accepted,
            ...(outcome.run.rejectionCode ? { rejection_code: outcome.run.rejectionCode } : {}),
          },
        }),
      );
      onSubmitted(outcome.run);
    });
  };

  const submitting = state.phase === "submitting";

  return (
    <div className="mt-5 text-left" data-testid="drop-in-submit-card">
      <label className="pc-eyebrow block text-bark-dk" htmlFor="drop-in-nickname">
        Name this run
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="drop-in-nickname"
          value={nickname}
          onChange={(event) => setNickname(clampNickname(event.target.value))}
          maxLength={MAX_NICKNAME_INPUT_LENGTH}
          placeholder="Anonymous"
          autoComplete="off"
          disabled={submitting}
          className="min-w-0 flex-1 rounded-sm border-[1.5px] border-ink bg-cream-50 px-3 py-1.5 font-mono text-sm text-ink placeholder:text-bark-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        />
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          data-testid="drop-in-submit"
          className="rounded-full border-[1.5px] border-ink bg-alpen px-5 py-2 font-bold uppercase tracking-wide text-cream-50 shadow-stamp-sm disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          {submitting ? "Submitting…" : "Submit run"}
        </button>
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-bark">
        Leave it blank to post anonymously.
      </p>

      {state.phase === "failed" && (
        <div role="status" className="mt-3 rounded-sm border-[1.5px] border-ink bg-mustard px-3 py-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">{state.error}</p>
          <button
            type="button"
            onClick={submit}
            className="mt-2 rounded-full border-[1.5px] border-ink bg-cream-50 px-3 py-1 text-xs font-bold uppercase text-ink shadow-stamp-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            Try again
          </button>
        </div>
      )}

      {state.phase === "skipped" && (
        <p role="status" className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-bark-dk">
          This run is no longer submittable — drop again for a fresh one.
        </p>
      )}
    </div>
  );
}
