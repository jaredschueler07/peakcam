"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { InboxReport, ReviewReport } from "@/lib/bug-reports/review-schema";

const button = "min-h-11 rounded-full border border-ink px-4 py-2 text-sm font-bold disabled:opacity-40";
async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load the inbox.");
  return body;
}
export function BugReportInbox() {
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [group, setGroup] = useState<string | null>(null);
  const [listResult, setListResult] = useState<{ key: string; reports: InboxReport[]; total: number; error: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailResult, setDetailResult] = useState<{ key: string; report: ReviewReport | null; error: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const dirty = useRef(false);
  const detailPanel = useRef<HTMLElement>(null);
  const listKey = `${status}:${page}:${group}:${revision}`;
  const detailKey = `${selected}:${revision}`;
  const loading = listResult?.key !== listKey;
  const reports = loading ? [] : listResult!.reports;
  const total = loading ? 0 : listResult!.total;
  const error = loading ? "" : listResult!.error;
  const detail = detailResult?.key === detailKey ? detailResult.report : null;
  const detailError = detailResult?.key === detailKey ? detailResult.error : "";
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), status }); if (group) params.set("group", group);
    jsonRequest(`/api/admin/bug-reports?${params}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setListResult({ key: listKey, reports: data.reports, total: data.total, error: "" });
    }).catch(caught => { if (!controller.signal.aborted) setListResult({ key: listKey, reports: [], total: 0, error: caught.message }); });
    return () => controller.abort();
  }, [page, status, group, listKey]);
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    jsonRequest(`/api/admin/bug-reports/${selected}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) {
        setDetailResult({ key: detailKey, report: data.report, error: "" });
        requestAnimationFrame(() => {
          if (controller.signal.aborted) return;
          detailPanel.current?.focus({ preventScroll: true });
          if (window.matchMedia("(max-width: 1023px)").matches) detailPanel.current?.scrollIntoView({ block: "start" });
        });
      }
    }).catch(caught => { if (!controller.signal.aborted) setDetailResult({ key: detailKey, report: null, error: caught.message }); });
    return () => controller.abort();
  }, [selected, detailKey]);
  const discard = () => !dirty.current || window.confirm("Discard unsaved review changes?");
  const selectReport = (id: string) => { if (id !== selected && discard()) { dirty.current = false; setSelected(id); setNotice(""); } };
  const reload = () => { if (discard()) { dirty.current = false; setRevision(value => value + 1); } };
  return <div className="ph-no-capture mt-6" data-bug-report-form>
    <p className="max-w-2xl text-sm text-bark">Private reports from visitors. Review the context, record your findings and link repeat reports to an original. Nothing here is published to GitHub automatically.</p>
    <div className="my-5 flex flex-wrap items-end gap-3">
      <label className="text-sm font-bold">Status<select value={status} disabled={Boolean(group)} onChange={event => { setStatus(event.target.value); setPage(1); }} className="ml-2 min-h-11 rounded-lg border border-ink bg-cream-50 px-3"><option value="open">Open</option><option value="triaged">Triaged</option><option value="resolved">Resolved</option><option value="all">All reports</option></select></label>
      <button className={button} onClick={reload}>Refresh</button>
      {group && <button className={button} onClick={() => { setGroup(null); setPage(1); }}>Exit duplicate group</button>}
      <p role="status" className="py-2 text-sm text-bark">{loading ? "Loading reports…" : `${total} ${total === 1 ? "report" : "reports"}${group ? " in this group" : ""}`}</p>
    </div>
    {notice && <p role="status" className="mb-4 rounded-xl border border-forest bg-forest/5 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="mb-4 rounded-xl border border-alpen-dk p-4">{error} <Link href="/auth?next=%2Fadmin%2Fbug-reports" className="underline">Sign in</Link></p>}
    <div className="grid gap-6 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.3fr)]">
      <section aria-label="Report list">
        {!loading && !error && reports.length === 0 && <p className="rounded-xl border border-bark/30 p-6 text-bark">No reports in this view.</p>}
        <ul className="space-y-3">{reports.map(report => <li key={report.id} className={`overflow-hidden rounded-xl border ${selected === report.id ? "border-forest bg-forest/5" : "border-bark/30 bg-cream-50"}`}>
          <button onClick={() => selectReport(report.id)} aria-pressed={selected === report.id} className="w-full p-4 text-left">
            <span className="flex justify-between gap-2 text-xs font-bold uppercase text-bark"><span>{report.duplicate_of ? "Duplicate" : report.status}</span><time dateTime={report.created_at}>{new Date(report.created_at).toLocaleDateString()}</time></span>
            <span className="mt-2 block line-clamp-3 text-sm">{report.description}</span>
            <span className="mt-2 block break-all font-mono text-xs text-bark">{report.page_path}</span>
            <span className="mt-1 block font-mono text-[10px] text-bark">{report.id}</span>
          </button>
          {(report.duplicate_count > 0 || report.duplicate_of) && <button className="min-h-11 w-full border-t border-bark/20 px-4 text-left text-sm font-bold text-forest" onClick={() => { setGroup(report.duplicate_of || report.id); setPage(1); }}>View duplicate group{report.duplicate_count > 0 ? ` (${report.duplicate_count + 1} reports)` : ""}</button>}
        </li>)}</ul>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button className={button} disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</button>
          <span className="text-sm">Page {page}</span>
          <button className={button} disabled={page * 25 >= total || loading} onClick={() => setPage(value => value + 1)}>Next</button>
        </div>
      </section>
      <section ref={detailPanel} tabIndex={-1} aria-label="Report details" className="min-w-0 scroll-mt-20">
        {!selected ? <p className="rounded-xl border border-dashed border-bark/40 p-6 text-bark">Choose a report to see what happened.</p> : detailError ? <p role="alert">{detailError} <button onClick={reload} className={button}>Reload report</button></p> : !detail ? <p role="status">Loading report…</p> : <ReviewForm key={`${detail.id}:${detail.revision}`} report={detail} onDirty={() => { dirty.current = true; }} onSaved={() => { dirty.current = false; setNotice("Review saved."); setRevision(value => value + 1); }} onReload={reload} onOriginal={selectReport} />}
      </section>
    </div>
  </div>;
}
function ReviewForm({ report, onDirty, onSaved, onReload, onOriginal }: { report: ReviewReport; onDirty(): void; onSaved(): void; onReload(): void; onOriginal(id: string): void }) {
  const [status, setStatus] = useState(report.status);
  const [note, setNote] = useState(report.admin_note ?? "");
  const [duplicateOf, setDuplicateOf] = useState(report.duplicate_of ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy || abort.current) return;
    setBusy(true); setError(""); const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      await jsonRequest(`/api/admin/bug-reports/${report.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ revision: report.revision, status: duplicateOf.trim() ? "resolved" : status, note, duplicateOf: duplicateOf.trim() || null }) });
      onSaved();
    } catch (caught) { setError(caught instanceof Error && caught.name !== "AbortError" ? caught.message : "Save wasn’t confirmed. Reload the report to check before trying again."); }
    finally { clearTimeout(timer); abort.current = null; setBusy(false); }
  }
  return <article className="rounded-2xl border border-ink bg-cream-50 p-5">
    <h2 className="font-display text-2xl font-bold">Report details</h2>
    <p className="mt-2 break-all font-mono text-xs text-bark">{report.id}</p>
    <p className="mt-1 text-xs text-bark">{new Date(report.created_at).toLocaleString()} · {report.page_path}</p>
    <p className="mt-5 whitespace-pre-wrap break-words text-sm">{report.description}</p>
    <details className="my-5 rounded-xl border border-bark/30 p-3"><summary className="cursor-pointer py-2 text-sm font-bold">Troubleshooting details</summary>
      <p className="mb-2 break-all text-xs text-bark">Server release: {report.server_release}</p>
      {report.diagnostics ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(report.diagnostics, null, 2)}</pre> : <p className="text-sm text-bark">The visitor did not attach diagnostics.</p>}
    </details>
    {report.duplicate_of && <button className={`${button} mb-4`} onClick={() => onOriginal(report.duplicate_of!)}>Open original report</button>}
    <form onSubmit={save} className="space-y-4">
      <label className="block text-sm font-bold">Status<select value={duplicateOf.trim() ? "resolved" : status} disabled={busy || Boolean(duplicateOf.trim())} onChange={event => { setStatus(event.target.value as ReviewReport["status"]); onDirty(); }} className="mt-2 block min-h-11 w-full rounded-lg border border-ink bg-white/50 px-3"><option value="open">Open</option><option value="triaged">Triaged</option><option value="resolved">Resolved</option></select></label>
      <label className="block text-sm font-bold">Review notes<textarea rows={4} maxLength={4000} value={note} disabled={busy} onChange={event => { setNote(event.target.value); onDirty(); }} className="mt-2 block w-full rounded-lg border border-ink bg-white/50 p-3 text-base font-normal" /></label>
      <label className="block text-sm font-bold">Duplicate of report ID <span className="font-normal">(optional)</span><input value={duplicateOf} disabled={busy} onChange={event => { setDuplicateOf(event.target.value); onDirty(); }} placeholder="Paste the original report’s full ID" className="mt-2 min-h-11 w-full rounded-lg border border-ink bg-white/50 px-3 text-sm font-normal" /></label>
      <p className="text-xs text-bark">Linking a duplicate resolves this report and groups it with the original. Clear the ID to unlink it. Reports and their diagnostics are preserved.</p>
      {error && <p role="alert" className="text-sm text-alpen-dk">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={`${button} bg-forest text-cream-50`}>{busy ? "Saving…" : "Save review"}</button><button type="button" disabled={busy} onClick={onReload} className={button}>Reload report</button></div>
    </form>
  </article>;
}
