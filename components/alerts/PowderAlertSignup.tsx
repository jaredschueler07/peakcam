"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Bell, Check, Loader2, X, Search } from "lucide-react";
import type { ResortWithData } from "@/lib/types";

interface Props {
  resorts: ResortWithData[];
}

const THRESHOLD_OPTIONS = [3, 6, 12, 18, 24];

type Step = "pick" | "email" | "done";

export function PowderAlertSignup({ resorts }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("pick");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
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
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border
                   bg-surface hover:bg-surface2 hover:border-cyan/40 text-text-subtle
                   hover:text-cyan text-sm font-medium transition-colors duration-150"
      >
        <Bell size={15} />
        Get powder alerts
      </button>

      {/* Modal backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4
                     bg-black/80 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && handleClose()}
          aria-modal="true"
          role="dialog"
          aria-label="Powder alert signup"
        >
          <div className="w-full max-w-lg bg-surface border border-border rounded-xl
                          overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">

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
                className="w-7 h-7 flex items-center justify-center rounded-md border border-border
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
                      placeholder="Search resorts..."
                      className="w-full pl-9 pr-3 py-2 bg-bg border border-border rounded-lg
                                 text-text-base text-sm placeholder:text-text-muted outline-none focus:border-cyan/50"
                    />
                  </div>
                  {selected.size > 0 && (
                    <p className="text-cyan text-xs mb-2 font-medium">
                      {selected.size} resort{selected.size !== 1 ? "s" : ""} selected
                    </p>
                  )}
                </div>

                {/* Scrollable resort list */}
                <div className="overflow-y-auto flex-1 px-5 pb-2">
                  <div className="space-y-1.5">
                    {filteredResorts.map((resort) => {
                      const isOn = selected.has(resort.id);
                      return (
                        <div key={resort.id}
                             className={`rounded-lg border transition-colors duration-100 ${
                               isOn ? "bg-cyan/5 border-cyan/30" : "bg-bg border-border hover:border-border-hi"
                             }`}>
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <button
                              onClick={() => toggleResort(resort.id)}
                              className={`w-4.5 h-4.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                                isOn ? "bg-cyan border-cyan" : "border-border"
                              }`}
                              style={{ width: 18, height: 18 }}
                              aria-label={isOn ? `Remove ${resort.name}` : `Add ${resort.name}`}
                            >
                              {isOn && <Check size={10} className="text-bg" strokeWidth={3} />}
                            </button>

                            <button
                              onClick={() => toggleResort(resort.id)}
                              className="flex-1 min-w-0 text-left"
                            >
                              <p className={`font-medium text-sm truncate ${isOn ? "text-text-base" : "text-text-subtle"}`}>
                                {resort.name}
                              </p>
                              <p className="text-text-muted text-xs">{resort.state}</p>
                            </button>

                            {isOn && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-text-muted text-[11px]">≥</span>
                                <select
                                  value={thresholds[resort.id] ?? 6}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    setThresholds((t) => ({
                                      ...t,
                                      [resort.id]: Number(e.target.value),
                                    }));
                                  }}
                                  className="bg-surface2 border border-border rounded px-1.5 py-1
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

                <div className="px-5 py-4 border-t border-border shrink-0">
                  <button
                    onClick={() => { if (selected.size > 0) { setStep("email"); setError(null); } }}
                    disabled={selected.size === 0}
                    className="w-full py-2.5 rounded-lg bg-cyan text-bg font-semibold text-sm
                               hover:bg-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Continue →
                  </button>
                </div>
              </>
            )}

            {/* Step: Email */}
            {step === "email" && (
              <div className="px-5 py-6 space-y-4">
                <p className="text-text-subtle text-sm">
                  Alerts set up for <strong className="text-text-base">{selected.size}</strong> resort{selected.size !== 1 ? "s" : ""}.
                  Where should we send them?
                </p>

                <input
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="your@email.com"
                  className="w-full px-4 py-3 bg-bg border border-border rounded-lg text-text-base
                             placeholder:text-text-muted outline-none focus:border-cyan/50 text-sm"
                />

                {error && <p className="text-red-400 text-sm">{error}</p>}

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep("pick")}
                    className="flex-1 py-2.5 rounded-lg border border-border text-text-subtle
                               hover:text-text-base text-sm transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg
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
              <div className="px-5 py-10 text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-cyan/10 border border-cyan/30 flex items-center
                                justify-center mx-auto">
                  <Check size={24} className="text-cyan" />
                </div>
                <h2 className="text-text-base font-semibold text-lg">Powder alerts activated</h2>
                <p className="text-text-subtle text-sm leading-relaxed">
                  We'll email <strong className="text-text-base">{email}</strong> when your resorts
                  get fresh snow. Check your inbox for a welcome message.
                </p>
                <button
                  onClick={handleClose}
                  className="mt-2 px-6 py-2.5 bg-surface2 border border-border rounded-lg
                             text-text-subtle hover:text-text-base text-sm transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
