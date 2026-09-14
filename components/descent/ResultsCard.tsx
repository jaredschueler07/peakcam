"use client";

import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/components/drop-in/hud/useDialogFocus";
import LeaderboardPanel from "@/components/drop-in/hud/LeaderboardPanel";
import SubmitRunCard from "@/components/drop-in/hud/SubmitRunCard";
import type { CompetitiveRunMode } from "@/lib/game/config/modes";
import {
  resultsOutcome, takeRecordingOnce,
  type FinishedRunRecording, type RecordingCache, type SubmittableRunSession, type SubmittedRun,
} from "@/lib/game/competition/run-client";
import type { DecodedGhost } from "@/lib/game/replay/codec";
import type { TrickEvent } from "@/lib/descent/types";
import { formatRunTime } from "./runtime-types";

export interface ResultsCompetition {
  session: SubmittableRunSession;
  mode: CompetitiveRunMode;
  resortSlug: string;
  trailId: string;
  conditionsDate?: string;
  takeRecording(): FinishedRunRecording | null;
  onRaceGhost(ghost: DecodedGhost, runId: string): void;
  racedRunId: string | null;
  onClearGhost(): void;
}

export interface RunSummary {
  courseName: string;
  runTimeMs: number;
  style: number;
  bestTrick: TrickEvent | null;
  crashes: number;
  verticalFt: number;
}

const BTN = "border border-[#e8edf2] px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.16em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e8edf2]";

export default function ResultsCard({ summary, competition = null, onSkiOn, onRestart, onMenu }: {
  summary: RunSummary;
  competition?: ResultsCompetition | null;
  onSkiOn(): void;
  onRestart(): void;
  onMenu(): void;
}) {
  const [recording, setRecording] = useState<FinishedRunRecording | null>(null);
  const [offlineAtOpen, setOfflineAtOpen] = useState(true);
  const [submitted, setSubmitted] = useState<SubmittedRun | null>(null);
  const finishedAtRef = useRef(Date.now());
  const takenRef = useRef<RecordingCache["current"]>(undefined);

  useEffect(() => {
    if (!competition) return;
    // Consuming read, made idempotent for StrictMode's double effect.
    setRecording(takeRecordingOnce(() => competition.takeRecording(), takenRef));
    setOfflineAtOpen(competition.session.offline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ref = useDialogFocus(true);
  const outcome = resultsOutcome({ competitive: competition !== null, offlineAtOpen, hasRecording: recording != null, submitted: submitted !== null });

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/55 p-3 pt-[6vh]">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="descent-results-title" tabIndex={-1} data-descent-results="" className="w-full max-w-xl border border-[#1b222b] bg-[#0b0e13] p-5 font-mono text-[#e8edf2] shadow-[0_24px_60px_-20px_rgba(0,0,0,.8)] sm:p-6">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[#7f8b99]">Run complete</p>
        <h2 id="descent-results-title" className="mt-1 text-2xl font-bold uppercase tracking-[0.08em]">{summary.courseName}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-[#1b222b] py-3 text-sm sm:grid-cols-4">
          <div><dt className="text-[9px] uppercase tracking-[0.16em] text-[#7f8b99]">Time</dt><dd className="text-xl font-bold tabular-nums">{formatRunTime(summary.runTimeMs / 1000)}</dd></div>
          <div><dt className="text-[9px] uppercase tracking-[0.16em] text-[#7f8b99]">Style</dt><dd className="text-xl font-bold tabular-nums">{summary.style.toLocaleString()}</dd></div>
          <div><dt className="text-[9px] uppercase tracking-[0.16em] text-[#7f8b99]">Vertical</dt><dd className="text-xl font-bold tabular-nums">{Math.round(summary.verticalFt).toLocaleString()}<span className="text-xs text-[#7f8b99]"> ft</span></dd></div>
          <div><dt className="text-[9px] uppercase tracking-[0.16em] text-[#7f8b99]">Crashes</dt><dd className="text-xl font-bold tabular-nums">{summary.crashes}</dd></div>
        </dl>
        <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-[#7f8b99]">
          Best trick: <span className="text-[#ffe08a]">{summary.bestTrick ? `${summary.bestTrick.label} +${summary.bestTrick.points}` : "—"}</span>
        </p>

        {competition && (
          <div className="mt-4 border border-[#1b222b] bg-[#faf4e6] p-3 text-[#2a1f14]">
            {outcome === "submittable" && recording && (
              <SubmitRunCard
                session={competition.session}
                mode={competition.mode}
                resortSlug={competition.resortSlug}
                recording={recording}
                score={summary.style}
                finishedAtMs={finishedAtRef.current}
                onSubmitted={setSubmitted}
              />
            )}
            {outcome === "offline" && (
              <p role="status" className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#63482d]">Played offline — this run can’t be posted to the board.</p>
            )}
            {outcome === "submitted" && submitted && (
              <p role="status" className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#3c5a3a]">
                {submitted.accepted ? "Posted to the board." : `Not ranked: ${submitted.rejectionCode ?? "rejected"}`}
              </p>
            )}
            <div className="mt-3">
              <LeaderboardPanel
                resortSlug={competition.resortSlug}
                mode={competition.mode}
                trailId={competition.trailId}
                conditionsDate={competition.conditionsDate}
                highlightRunId={submitted?.runId ?? null}
                onRaceGhost={competition.onRaceGhost}
                racedRunId={competition.racedRunId}
                onClearGhost={competition.onClearGhost}
              />
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={onSkiOn} className={`${BTN} bg-[#e8edf2] text-[#06080b]`}>Ski on</button>
          <button type="button" onClick={onRestart} className={`${BTN} text-[#e8edf2] hover:bg-[#e8edf2]/10`}>Restart</button>
          <button type="button" onClick={onMenu} className={`${BTN} border-[#2a323d] text-[#7f8b99] hover:text-[#e8edf2]`}>Menu</button>
        </div>
      </div>
    </div>
  );
}
