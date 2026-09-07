"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bug, X } from "lucide-react";
import { browserDetails, diagnosticsSchema, reportPath, type ReportDiagnostics } from "@/lib/bug-reports/schema";
import { bugHistory, gameReport, installBugHistory, recordBugAction } from "@/lib/bug-reports/client";

const OpenReport = createContext<(() => void) | null>(null);
type Draft = { id: string; pagePath: string; diagnostics: ReportDiagnostics };

export function BugReportButton({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const open = useContext(OpenReport);
  return <button type="button" onClick={() => open?.()} title="Report a bug" className={className}>
    <Bug size={16} aria-hidden="true" className={compact ? "" : "inline-block mr-2 align-text-bottom"} /><span className={compact ? "sr-only" : ""}>Report a bug</span>
  </button>;
}

export function BugReportProvider({ children, release }: { children: React.ReactNode; release: string }) {
  const pathname = usePathname();
  const [draft, setDraft] = useState<Draft | null>(null);
  const sessionId = useRef<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => installBugHistory(), []);
  useEffect(() => { recordBugAction("page-view"); }, [pathname]);

  const open = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    recordBugAction("report-opened");
    sessionId.current ??= crypto.randomUUID();
    const game = gameReport();
    const diagnostics = diagnosticsSchema.parse({ version: 1, release: /^(?:[a-f0-9]{7,40}|local)$/.test(release) ? release : "unknown",
      ...browserDetails(navigator.userAgent),
      viewport: { width: Math.min(20_000, window.innerWidth), height: Math.min(20_000, window.innerHeight), dpr: Math.min(10, window.devicePixelRatio) },
      online: navigator.onLine, breadcrumbs: bugHistory(), ...(game ? { game } : {}),
    });
    setDraft({ id: crypto.randomUUID(), pagePath: reportPath(window.location.pathname), diagnostics });
  };
  return <OpenReport.Provider value={open}>
    {children}
    {draft && <BugReportDialog key={draft.id} draft={draft} sessionId={sessionId.current!} onClose={() => {
      setDraft(null);
      const trigger = returnFocus.current;
      (trigger?.isConnected ? trigger : document.querySelector<HTMLButtonElement>('button[aria-controls="mobile-navigation"]'))?.focus();
    }} />}
  </OpenReport.Provider>;
}

function BugReportDialog({ draft, sessionId, onClose }: { draft: Draft; sessionId: string; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [description, setDescription] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [status, setStatus] = useState<"idle" | "sending" | "success">("idle");
  const [error, setError] = useState("");
  const [reportId, setReportId] = useState("");
  const pending = useRef<AbortController | null>(null);
  const previousPayload = useRef("");
  const submissionId = useRef(draft.id);
  const doneButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (status === "success") doneButton.current?.focus(); }, [status]);
  useEffect(() => {
    dialog.current?.showModal(); descriptionRef.current?.focus();
    return () => { pending.current?.abort(); };
  }, []);

  function closeReport() { dialog.current?.close(); onClose(); }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (status === "sending" || pending.current) return;
    setStatus("sending"); setError("");
    const controller = new AbortController(); pending.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    const payload = JSON.stringify({ sessionId, description, pagePath: draft.pagePath, diagnostics: includeDiagnostics ? draft.diagnostics : null });
    if (previousPayload.current && previousPayload.current !== payload) submissionId.current = crypto.randomUUID();
    previousPayload.current = payload;
    try {
      const response = await fetch("/api/bug-reports", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: submissionId.current, ...JSON.parse(payload) }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok || typeof result.id !== "string") throw new Error(response.status === 429
        ? "You’ve sent a few reports recently. Please try again in an hour."
        : "Your report wasn’t confirmed. Please try again; your description is still here.");
      setReportId(result.id); setStatus("success");
    } catch (caught) {
      setStatus("idle");
      setError(caught instanceof Error && caught.name !== "AbortError" ? caught.message : "We couldn’t confirm the report. Check your connection and try again.");
    } finally { clearTimeout(timer); pending.current = null; }
  }

  return <dialog ref={dialog} aria-labelledby="bug-report-title" data-bug-report-form
    onCancel={event => { event.preventDefault(); if (status !== "sending") closeReport(); }}
    className="pc-paper fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border-2 border-ink bg-cream-50 p-5 text-ink shadow-stamp-lg backdrop:bg-ink/60 sm:p-7">
    <div className="flex items-start justify-between gap-3">
      <div><p className="pc-eyebrow text-bark">Help keep PeakCam running</p>
        <h2 id="bug-report-title" className="font-display text-3xl font-bold mt-1">{status === "success" ? "Report received" : "Report a bug"}</h2></div>
      <button type="button" onClick={closeReport} disabled={status === "sending"} aria-label="Close bug report" className="min-h-11 min-w-11 rounded-full border border-ink flex items-center justify-center disabled:opacity-50"><X size={20} /></button>
    </div>
    {status === "success" ? <div role="status" className="mt-5 space-y-4">
      <p>Thanks for helping us improve the mountain. Your report is saved for the PeakCam team.</p>
      <p className="text-sm text-bark break-all">Report ID: <span className="font-mono">{reportId}</span></p>
      <button ref={doneButton} type="button" onClick={closeReport} className="min-h-11 rounded-full border-2 border-ink bg-forest px-6 py-2 font-bold text-cream-50 shadow-stamp-sm">Done</button>
    </div> : <form onSubmit={submit} className="mt-5 space-y-4">
      <p className="text-sm text-bark">Something not working? Tell us what you expected and what happened instead. No account needed.</p>
      <label className="block font-bold" htmlFor="bug-description">What went wrong?</label>
      <textarea ref={descriptionRef} id="bug-description" required minLength={10} maxLength={4000} rows={4}
        value={description} onChange={event => setDescription(event.target.value)} disabled={status === "sending"}
        aria-describedby="bug-description-help" className="w-full resize-y rounded-xl border-2 border-ink bg-white/50 p-3 text-base font-normal"
        placeholder="I was checking a camera, but the player stayed blank…" />
      <p id="bug-description-help" className="text-xs text-bark">At least 10 characters. Please leave out passwords and other private information.</p>
      <label className="flex min-h-11 items-start gap-3 rounded-xl border border-bark/30 p-3 text-sm">
        <input type="checkbox" checked={includeDiagnostics} onChange={event => setIncludeDiagnostics(event.target.checked)} disabled={status === "sending"} className="mt-1 size-5 shrink-0 accent-forest" />
        <span><strong>Include troubleshooting details</strong><span className="block mt-1 text-bark">Recent actions, error types, device details and game state. No typed input, cookies or screen recording. Sent only with this report.</span></span>
      </label>
      <details className="text-sm"><summary className="cursor-pointer min-h-11 flex items-center underline">Review attached details</summary>
        <p className="mb-2">Page: {draft.pagePath}</p>
        {includeDiagnostics ? <pre className="max-h-48 overflow-auto rounded-lg border border-bark/30 p-3 text-xs whitespace-pre-wrap break-words">{JSON.stringify(draft.diagnostics, null, 2)}</pre>
          : <p>Only your description and the page will be sent. A temporary identifier limits repeat submissions.</p>}
      </details>
      {error && <p role="alert" className="rounded-lg border border-alpen-dk p-3 text-sm text-alpen-dk">{error}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" onClick={closeReport} disabled={status === "sending"} className="min-h-11 rounded-full border border-ink px-5 py-2 font-semibold disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={status === "sending" || description.trim().length < 10} className="min-h-11 rounded-full border-2 border-ink bg-alpen-dk px-6 py-2 font-bold text-cream-50 shadow-stamp-sm disabled:opacity-50">{status === "sending" ? "Sending…" : "Send report"}</button>
      </div>
    </form>}
  </dialog>;
}
