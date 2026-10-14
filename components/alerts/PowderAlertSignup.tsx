"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useBodyScrollLock } from "@/lib/useBodyScrollLock";
import { Bell, Check, Loader2, X, Search } from "lucide-react";
import type { ResortWithData } from "@/lib/types";
import { track, EVENTS } from "@/lib/analytics-events";

interface Props {
  resorts: ResortWithData[];
  /** Open the dialog on mount — used by the dedicated /alerts page. */
  defaultOpen?: boolean;
}

const THRESHOLD_OPTIONS = [3, 6, 12, 18, 24];

type Step = "pick" | "email" | "done";

export function PowderAlertSignup({ resorts, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [step, setStep] = useState<Step>("pick");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  useBodyScrollLock(open);

  // The native top layer keeps the picker above sticky headers and contains focus.
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
  }, [open]);

  // Focus email input when step changes
  useEffect(() => {
    if (step === "email") emailRef.current?.focus();
  }, [step]);

  const handleClose = useCallback(() => {
    setOpen(false);
    // Reset after fade
    setTimeout(() => {
      setStep("pick");
      setSearch("");
      setSelected(new Set());
      setThresholds({});
      setEmail("");
      setError(null);
    }, 200);
  }, []);

  const toggleResort = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        setThresholds((t) => ({ ...t, [id]: t[id] ?? 6 }));
      }
      return next;
    });
  }, []);

  const filteredResorts = resorts.filter(
    (r) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.state.toLowerCase().includes(search.toLowerCase())
  );

  const handleSubmit = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address");
      return;
    }
    if (selected.size === 0) {
      setError("Select at least one resort");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const resp = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          resort_ids: [...selected],
          thresholds: Object.fromEntries(
            [...selected].map((id) => [id, thresholds[id] ?? 6])
          ),
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Something went wrong");
      const resort_slugs = resorts
        .filter((r) => selected.has(r.id))
        .map((r) => r.slug);
      track(EVENTS.ALERT_SIGNUP_SUBMITTED, {
        resort_slugs,
        resort_count: selected.size,
        thresholds: Object.fromEntries(
          [...selected].map((id) => [id, thresholds[id] ?? 6])
        ),
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 pointer-coarse:min-h-11 rounded-lg border border-border
                   bg-surface hover:bg-surface2 hover:border-cyan/40 text-text-subtle
                   hover:text-cyan text-sm font-medium transition-colors duration-150"
      >
        <Bell size={15} />
        Get powder alerts
      </button>

      {/* Modal backdrop */}
      {open && (
        <dialog
          ref={dialogRef}
          onCancel={(event) => { event.preventDefault(); handleClose(); }}
          className="fixed inset-0 m-auto h-dvh max-h-none w-full max-w-none items-center justify-center bg-transparent p-2 text-text-base open:flex sm:p-4 backdrop:bg-black/80 backdrop:backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && handleClose()}
          aria-modal="true"
          role="dialog"
          aria-label="Powder alert signup"
        >
          <div className="w-full max-w-lg bg-surface border border-border rounded-xl
                          overflow-hidden shadow-2xl flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[90dvh]">

            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2.5">
                <Bell size={16} className="text-cyan" />
                <span className="font-semibold text-text-base">
                  {step === "done" ? "You're all set!" : "Get powder alerts"}
                </span>
              </div>
              <button
                onClick={handleClose}
                className="w-7 h-7 pointer-coarse:w-11 pointer-coarse:h-11 flex items-center justify-center rounded-md border border-border
                           text-text-muted hover:text-text-base transition-colors"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {/* Step: Pick resorts */}
            {step === "pick" && (
              <>
                <div className="px-5 pt-4 shrink-0">
                  <p className="text-text-subtle text-sm mb-3">
                    Choose resorts to follow. We'll email you when fresh snow hits your threshold.
                  </p>
                  <div className="relative mb-3">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="Search resorts"
                      placeholder="Search resorts..."
                      className="w-full pl-9 pr-3 py-2 bg-bg border border-border rounded-lg
                                 text-text-base text-[16px] md:text-sm placeholder:text-text-muted outline-none focus:border-cyan/50"
                    />
                  </div>
                  {selected.size > 0 && (
                    <p className="text-cyan text-xs mb-2 font-medium">
                      {selected.size} resort{selected.size !== 1 ? "s" : ""} selected
                    </p>
                  )}
                </div>

                <button type="button" className="sr-only focus:not-sr-only focus:px-5 focus:py-3"
                  onClick={() => continueRef.current?.focus()}>Skip to Continue</button>

                {/* Scrollable resort list */}
                <div className="min-h-0 overflow-y-auto overscroll-contain flex-1 px-5 pb-2">
                  <div className="space-y-1.5">
                    {filteredResorts.map((resort) => {
                      const isOn = selected.has(resort.id);
                      return (
                        <div key={resort.id}
                             className={`rounded-lg border transition-colors duration-100 ${
                               isOn ? "bg-cyan/5 border-cyan/30" : "bg-bg border-border hover:border-border-hi"
                             }`}>
                          <div className="flex items-center gap-3 px-3 py-2.5 pointer-coarse:min-h-11">
                            <button
                              type="button"
                              onClick={() => toggleResort(resort.id)}
                              aria-pressed={isOn}
                              className="flex min-h-11 flex-1 min-w-0 items-center gap-3 text-left"
                            >
                              <span aria-hidden className={`h-[18px] w-[18px] shrink-0 rounded border flex items-center justify-center ${isOn ? "bg-cyan border-cyan" : "border-border"}`}>
                                {isOn && <Check size={10} className="text-bg" strokeWidth={3} />}
                              </span>
                              <span className="min-w-0">
                                <span className={`block font-medium text-sm truncate ${isOn ? "text-text-base" : "text-text-subtle"}`}>{resort.name}</span>
                                <span className="block text-text-muted text-xs">{resort.state}</span>
                              </span>
                            </button>

                            {isOn && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-text-muted text-[11px]">≥</span>
                                <select
                                  aria-label={`Snow threshold for ${resort.name}`}
                                  value={thresholds[resort.id] ?? 6}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    setThresholds((t) => ({
                                      ...t,
                                      [resort.id]: Number(e.target.value),
                                    }));
                                  }}
                                  className="bg-surface2 border border-border rounded px-1.5 py-1 min-h-11
                                             text-text-base text-xs outline-none focus:border-cyan/50"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {THRESHOLD_OPTIONS.map((n) => (
                                    <option key={n} value={n}>{n}&quot;</option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {filteredResorts.length === 0 && (
                      <p className="text-text-muted text-sm text-center py-6">No resorts found.</p>
                    )}
                  </div>
                </div>

                <div className="px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border shrink-0 bg-surface">
                  <p id="powder-selection-help" className="text-text-subtle text-xs mb-2" aria-live="polite">
                    {selected.size === 0 ? "Select at least one resort to continue." : `${selected.size} resort${selected.size === 1 ? "" : "s"} selected. Ready to continue.`}
                  </p>
                  <button
                    onClick={() => { if (selected.size > 0) { setStep("email"); setError(null); } }}
                    ref={continueRef}
                    aria-describedby="powder-selection-help"
                    aria-disabled={selected.size === 0}
                    className="w-full py-3 min-h-12 rounded-lg bg-cyan text-bg font-semibold text-sm
                               hover:bg-cyan/90 transition-colors aria-disabled:opacity-40 aria-disabled:cursor-not-allowed"
                  >
                    Continue →
                  </button>
                </div>
              </>
            )}

            {/* Step: Email */}
            {step === "email" && (
              <div className="min-h-0 overflow-y-auto px-5 py-6 space-y-4">
                <p className="text-text-subtle text-sm">
                  Alerts set up for <strong className="text-text-base">{selected.size}</strong> resort{selected.size !== 1 ? "s" : ""}.
                  Where should we send them?
                </p>

                <div>
                  <label
                    htmlFor="powder-alert-email"
                    className="block text-text-muted text-xs font-medium mb-1.5"
                  >
                    Email address
                  </label>
                  <input
                    id="powder-alert-email"
                    ref={emailRef}
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                    placeholder="your@email.com"
                    autoComplete="email"
                    inputMode="email"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "powder-alert-email-error" : undefined}
                    className="w-full px-4 py-3 bg-bg border border-border rounded-lg text-text-base
                               placeholder:text-text-muted outline-none focus:border-cyan/50 text-[16px] md:text-sm"
                  />
                </div>

                {error && (
                  <p id="powder-alert-email-error" className="text-red-400 text-sm">
                    {error}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep("pick")}
                    className="flex-1 py-2.5 pointer-coarse:min-h-11 rounded-lg border border-border text-text-subtle
                               hover:text-text-base text-sm transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 pointer-coarse:min-h-11 rounded-lg
                               bg-cyan text-bg font-semibold text-sm hover:bg-cyan/90
                               transition-colors disabled:opacity-60"
                  >
                    {submitting ? (
                      <><Loader2 size={14} className="animate-spin" /> Activating...</>
                    ) : (
                      "Activate alerts"
                    )}
                  </button>
                </div>

                <p className="text-text-muted text-xs text-center">
                  No passwords. Manage or unsubscribe anytime via your email.
                </p>
              </div>
            )}

            {/* Step: Done */}
            {step === "done" && (
              <div className="min-h-0 overflow-y-auto px-5 py-10 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-cyan/10 border border-cyan/30 flex items-center
                                justify-center mx-auto">
                  <Check size={24} className="text-cyan" />
                </div>
                {/* Wording is deliberately the same whether or not this address
                    was already subscribed — the endpoint cannot tell the caller
                    which it was without leaking who has an account. */}
                <h2 className="text-text-base font-semibold text-lg">Check your inbox</h2>
                <p className="text-text-subtle text-sm leading-relaxed">
                  We&apos;ve emailed <strong className="text-text-base">{email}</strong> a link to
                  confirm and manage your powder alerts. If that address is already subscribed,
                  the link lets you change what you follow.
                </p>
                <button
                  onClick={handleClose}
                  className="mt-2 px-6 py-2.5 pointer-coarse:min-h-11 bg-surface2 border border-border rounded-lg
                             text-text-subtle hover:text-text-base text-sm transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
