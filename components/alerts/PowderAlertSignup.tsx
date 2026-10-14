"use client";

import { useState, useCallback, useEffect, useId, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { Bell, Check, ChevronDown, Loader2, Search } from "lucide-react";
import type { ResortWithData } from "@/lib/types";
import { track, EVENTS } from "@/lib/analytics-events";

interface Props {
  resorts: ResortWithData[];
}

const THRESHOLD_OPTIONS = [3, 6, 12, 18, 24];

type Step = "pick" | "email" | "done";

// 16px on every control at every breakpoint: iOS Safari zooms the page when a
// smaller field takes focus and does not zoom back out.
const FIELD = "border border-bark bg-cream-50 text-[16px] text-ink placeholder:text-bark";
// WebKit's default `menulist` select ignores min-height, so the threshold pickers
// need appearance-none (and their own chevron) to reach the 44px touch target.
const SELECT = `${FIELD} min-h-11 min-w-16 appearance-none rounded-md py-2 pl-2 pr-7`;
const ACTION = "flex min-h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-ink px-4 py-3 text-[16px] font-semibold shadow-stamp-sm transition-colors";
const PRIMARY = `${ACTION} bg-forest text-cream-50 hover:bg-forest-dk disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none`;
const SECONDARY = `${ACTION} bg-cream-50 text-ink hover:bg-cream`;
const BODY = "min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3";
const FOOTER = "shrink-0 border-t border-bark bg-cream-50 px-4 py-3 pb-[max(0.75rem,var(--pc-safe-bottom,0px))]";

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
  const hintId = useId();

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

  const plural = selected.size !== 1 ? "s" : "";

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={event => { event.currentTarget.focus(); setOpen(true); }}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2
                   text-sm font-bold text-ink shadow-stamp-sm transition-colors hover:bg-cream"
      >
        <Bell size={15} />
        Get powder alerts
      </button>

      {open && (
        <Modal
          onClose={handleClose}
          layout="panel"
          title={step === "done" ? "You're all set!" : "Get powder alerts"}
          className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-[18px]"
        >
          {/* Step: Pick resorts */}
          {step === "pick" && (
            <>
              <div className={BODY}>
                <p className="mb-3 text-sm text-bark-dk">
                  Choose resorts to follow. We&apos;ll email you when fresh snow hits your threshold.
                </p>
                <div className="relative mb-3">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bark" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search resorts..."
                    aria-label="Search resorts"
                    className={`${FIELD} min-h-11 w-full rounded-lg py-2 pl-9 pr-3`}
                  />
                </div>

                <ul className="space-y-1.5">
                  {filteredResorts.map((resort) => {
                    const isOn = selected.has(resort.id);
                    return (
                      <li key={resort.id}
                          className={`flex items-center gap-2 rounded-lg border py-1 pl-1 pr-2 transition-colors duration-100 ${
                            isOn ? "border-forest bg-forest/5" : "border-ink/15 bg-cream-50 hover:border-ink/30"
                          }`}>
                        <button
                          type="button"
                          onClick={() => toggleResort(resort.id)}
                          aria-pressed={isOn}
                          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md text-left"
                        >
                          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center">
                            <span className={`flex h-5 w-5 items-center justify-center rounded border-[1.5px] ${
                              isOn ? "border-forest bg-forest" : "border-bark"
                            }`}>
                              {isOn && <Check size={12} className="text-cream-50" strokeWidth={3} />}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-sm font-medium ${isOn ? "text-ink" : "text-bark-dk"}`}>
                              {resort.name}
                            </span>
                            <span className="block text-xs text-bark">{resort.state}</span>
                          </span>
                        </button>

                        {isOn && (
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span aria-hidden="true" className="text-[11px] text-bark">≥</span>
                            <span className="relative flex items-center">
                              <select
                                value={thresholds[resort.id] ?? 6}
                                onChange={(e) =>
                                  setThresholds((t) => ({
                                    ...t,
                                    [resort.id]: Number(e.target.value),
                                  }))
                                }
                                aria-label={`Snow threshold for ${resort.name}`}
                                className={SELECT}
                              >
                                {THRESHOLD_OPTIONS.map((n) => (
                                  <option key={n} value={n}>{n}&quot;</option>
                                ))}
                              </select>
                              <ChevronDown size={14} aria-hidden="true"
                                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-bark" />
                            </span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                  {filteredResorts.length === 0 && (
                    <li className="py-6 text-center text-sm text-bark">No resorts found.</li>
                  )}
                </ul>
              </div>

              <div className={FOOTER}>
                <p id={hintId} aria-live="polite" className="mb-2 text-sm text-bark-dk">
                  {selected.size === 0
                    ? "Pick at least one resort to continue"
                    : `${selected.size} resort${plural} selected`}
                </p>
                <button
                  type="button"
                  onClick={() => { if (selected.size > 0) { setStep("email"); setError(null); } }}
                  disabled={selected.size === 0}
                  aria-describedby={hintId}
                  className={`${PRIMARY} w-full`}
                >
                  Continue →
                </button>
              </div>
            </>
          )}

          {/* Step: Email */}
          {step === "email" && (
            <>
              <div className={`${BODY} space-y-4`}>
                <p className="text-sm text-bark-dk">
                  Alerts set up for <strong className="text-ink">{selected.size}</strong> resort{plural}.
                  Where should we send them?
                </p>

                <input
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  placeholder="your@email.com"
                  aria-label="Email address"
                  autoComplete="email"
                  inputMode="email"
                  className={`${FIELD} min-h-12 w-full rounded-lg px-4 py-3`}
                />

                {error && <p className="text-sm text-alpen-dk" role="alert">{error}</p>}

                <p className="text-center text-xs text-bark">
                  No passwords. Manage or unsubscribe anytime via your email.
                </p>
              </div>

              <div className={`${FOOTER} flex gap-3`}>
                <button type="button" onClick={() => setStep("pick")} className={`${SECONDARY} flex-1`}>
                  Back
                </button>
                <button type="button" onClick={handleSubmit} disabled={submitting} className={`${PRIMARY} flex-1`}>
                  {submitting ? (
                    <><Loader2 size={14} className="animate-spin" /> Activating...</>
                  ) : (
                    "Activate alerts"
                  )}
                </button>
              </div>
            </>
          )}

          {/* Step: Done */}
          {step === "done" && (
            <>
              <div className={`${BODY} space-y-4 py-8 text-center`}>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-[1.5px] border-forest bg-forest/10">
                  <Check size={24} className="text-forest" />
                </div>
                {/* Wording is deliberately the same whether or not this address
                    was already subscribed — the endpoint cannot tell the caller
                    which it was without leaking who has an account. */}
                <h3 className="font-display text-lg font-bold text-ink">Check your inbox</h3>
                <p className="text-sm leading-relaxed text-bark-dk">
                  We&apos;ve emailed <strong className="text-ink">{email}</strong> a link to
                  confirm and manage your powder alerts. If that address is already subscribed,
                  the link lets you change what you follow.
                </p>
              </div>
              <div className={FOOTER}>
                <button type="button" onClick={handleClose} className={`${SECONDARY} w-full`}>
                  Close
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
