"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Check, Loader2, Search, X } from "lucide-react";
import type { Resort } from "@/lib/types";
import { POPULAR_SLUGS } from "@/lib/popular-resorts";
import { DEFAULT_THRESHOLD, thresholdOptionsFor } from "@/lib/alerts/client";
import { useAlertSubscribe } from "@/lib/alerts/use-alert-subscribe";
import { track, EVENTS } from "@/lib/analytics-events";
import { Button } from "@/components/ui/Button";

// Only reachable from the success state, so the Supabase auth client behind it
// stays out of the /alerts bundle until someone actually asks for an account.
const AuthModal = dynamic(() => import("@/components/auth/AuthModal").then((m) => ({ default: m.AuthModal })), { ssr: false });

/** The slice of a resort the form needs — `ResortWithData` satisfies it. */
export type AlertResort = Pick<Resort, "id" | "name" | "slug" | "state" | "lat">;

export interface PowderAlertSubscription {
  email: string;
  resortIds: string[];
  resortSlugs: string[];
}

export interface PowderAlertFormProps {
  resorts: AlertResort[];
  /** Start on the email step with these resorts already chosen (shown as removable chips). */
  preselectedSlugs?: string[];
  /** Threshold applied to every preselected resort; defaults to DEFAULT_THRESHOLD. */
  preselectedThreshold?: number;
  /** Surface the form is mounted on ("browse", "alerts_page", …) — stamped on every alert event. */
  source: string;
  /** Fires once, when the API has accepted the subscription. */
  onDone?(subscription: PowderAlertSubscription): void;
  /** Rendered inside the success state, between the confirmation and the account nudge. */
  doneExtra?: ReactNode;
  /** When given, the success state ends with a "Done" button that calls it (modal hosts). */
  onClose?(): void;
  /**
   * Start with "email me the morning a selected resort opens" ticked. Off by
   * default; /opening-dates turns it on because that is the alert its visitor
   * came for.
   */
  defaultOpeningAlerts?: boolean;
}

type Step = "pick" | "email" | "done";

const POPULAR_LIMIT = 8;
const TRUST_LINE = "Free · No account · One email per storm day · Unsubscribe in one click";

const inputClass =
  "pc-auth-input min-h-11 w-full rounded-lg border border-bark bg-cream-50 px-3 py-2 text-[16px] text-ink placeholder:text-bark md:text-sm";
const selectClass = "min-h-9 rounded border border-bark bg-cream-50 px-1.5 py-1 text-xs font-bold text-ink";
const chipBase =
  "inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 pointer-coarse:min-h-11 text-[13px] font-bold transition-colors duration-150";
const chipOn = "pc-on-ink border-ink bg-ink text-cream-50";
const chipOff = "border-bark bg-cream-50 text-ink hover:border-ink";

function TrustLine() {
  return <p className="text-center text-xs text-bark">{TRUST_LINE}</p>;
}

function ThresholdSelect({ value, onChange, label }: { value: number; onChange(value: number): void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className={selectClass}>
      {thresholdOptionsFor(value).map((n) => (
        <option key={n} value={n}>
          {n}″
        </option>
      ))}
    </select>
  );
}

export function PowderAlertForm({
  resorts,
  preselectedSlugs,
  preselectedThreshold,
  source,
  onDone,
  doneExtra,
  onClose,
  defaultOpeningAlerts = false,
}: PowderAlertFormProps) {
  const id = useId();
  const bySlug = useMemo(() => new Map(resorts.map((r) => [r.slug, r])), [resorts]);
  const preselectedIds = useMemo(
    () => (preselectedSlugs ?? []).map((slug) => bySlug.get(slug)?.id).filter((rid): rid is string => rid !== undefined),
    [bySlug, preselectedSlugs]
  );

  // Known context (a resort page, ?resort= on /alerts) skips the picker: the
  // flow is then one field. Hosts remount with a `key` when the preselection
  // changes, so reading it in initializers only is deliberate.
  const [step, setStep] = useState<Step>(() => (preselectedIds.length > 0 ? "email" : "pick"));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselectedIds));
  const [thresholds, setThresholds] = useState<Record<string, number>>(() =>
    Object.fromEntries(preselectedIds.map((rid) => [rid, preselectedThreshold ?? DEFAULT_THRESHOLD]))
  );
  const [email, setEmail] = useState("");
  const [openingAlerts, setOpeningAlerts] = useState(defaultOpeningAlerts);
  const [showAuth, setShowAuth] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  // Focus the email field only when the visitor moved to that step themselves;
  // a preselected form starting on it must not yank focus on page load.
  const focusEmail = useRef(false);
  const doneFired = useRef(false);
  const { submit, status, errorMessage, repeatInBrowser, reset } = useAlertSubscribe({ source });
  const submitting = status === "submitting";

  useEffect(() => {
    if (step === "email" && focusEmail.current) {
      focusEmail.current = false;
      emailRef.current?.focus();
    }
  }, [step]);

  const toggleResort = useCallback((rid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid);
      else next.add(rid);
      return next;
    });
    // Keep a threshold the visitor already chose if they toggle a resort off and on.
    setThresholds((t) => (rid in t ? t : { ...t, [rid]: DEFAULT_THRESHOLD }));
  }, []);

  const goToEmail = () => {
    focusEmail.current = true;
    setStep("email");
  };

  const query = search.trim().toLowerCase();
  const filteredResorts = query
    ? resorts.filter((r) => r.name.toLowerCase().includes(query) || r.state.toLowerCase().includes(query))
    : resorts;
  const popular = useMemo(
    () =>
      POPULAR_SLUGS.map((slug) => bySlug.get(slug))
        .filter((r): r is AlertResort => r !== undefined)
        .slice(0, POPULAR_LIMIT),
    [bySlug]
  );
  const selectedResorts = resorts.filter((r) => selected.has(r.id));
  const thresholdValues = selectedResorts.map((r) => thresholds[r.id] ?? DEFAULT_THRESHOLD);
  // One shared <select> on the email step while every mountain agrees; per-
  // mountain choices made in the picker are left alone.
  const uniformThreshold =
    thresholdValues.length > 0 && thresholdValues.every((v) => v === thresholdValues[0]) ? thresholdValues[0] : null;

  const setAllThresholds = (value: number) => {
    setThresholds((t) => {
      const next = { ...t };
      for (const r of selectedResorts) next[r.id] = value;
      return next;
    });
  };

  const toggleOpeningAlerts = (checked: boolean) => {
    setOpeningAlerts(checked);
    // Only the opt-in is an event: it is the signal that the opening-day
    // promise landed with this visitor (the count says for how many mountains).
    if (checked) track(EVENTS.OPENING_ALERT_SELECTED, { slugs_count: selectedResorts.length, source });
  };

  const handleSubmit = async () => {
    const resortIds = selectedResorts.map((r) => r.id);
    const resortSlugs = selectedResorts.map((r) => r.slug);
    const outcome = await submit({ email, resortIds, thresholds, resortSlugs, openingAlerts });
    // A duplicate submit (Enter twice) resolves to the same outcome; only the
    // first one advances the form and notifies the host.
    if (outcome !== "ok" || doneFired.current) return;
    doneFired.current = true;
    setStep("done");
    onDone?.({ email: email.trim(), resortIds, resortSlugs });
  };

  if (step === "done") {
    return (
      <div className="px-5 py-8 text-center">
        <div
          aria-hidden
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-[1.5px] border-ink bg-forest text-cream-50 shadow-stamp-sm"
        >
          <Check size={26} strokeWidth={3} />
        </div>
        {/* The endpoint answers the same 200 whether it created the subscription
            or only re-sent the manage link to an address it already had — it
            cannot tell the caller which without leaking who has an account, so
            the headline is the same either way. A browser that has subscribed
            before is the one hint we get that this may be a repeat: say so,
            because re-posting the same address with more mountains changes
            nothing (lib/alerts/subscribe-core.ts). The opening-day opt-in is
            discarded on that path too — it is only written with a brand-new
            subscriber's preference rows — so when it was ticked the copy must
            not promise the email outright: point at the manage page, where
            the toggle lives, in case this address already had a subscription. */}
        <h2 className="mt-4 font-display text-2xl font-black text-ink">You’re subscribed.</h2>
        <p className="mt-2 text-sm leading-relaxed text-bark">
          We just emailed <strong className="break-all font-bold text-ink">{email.trim()}</strong> a link to manage your
          mountains.
          {openingAlerts && " You’ll also hear from us the morning any of them opens for the season."}
        </p>
        {(openingAlerts || repeatInBrowser) && (
          <p className="mt-2 text-sm leading-relaxed text-bark">
            If this address was already subscribed, nothing changed —{" "}
            {openingAlerts
              ? "turn on opening-day emails, and add or remove mountains, from the manage link in that email."
              : "add or remove mountains from the manage link in that email."}
          </p>
        )}
        {doneExtra}
        <div className="mt-6 border-t border-ink/15 pt-5">
          <p className="text-sm text-bark">Want them as favorites too?</p>
          <button
            type="button"
            onClick={() => setShowAuth(true)}
            className="mt-1 min-h-11 text-sm font-bold text-forest underline"
          >
            Create a free account →
          </button>
        </div>
        {onClose && (
          <Button type="button" variant="outline" size="sm" className="mt-5" onClick={onClose}>
            Done
          </Button>
        )}
        {showAuth && (
          <AuthModal
            onClose={() => setShowAuth(false)}
            initialMode="signup"
            initialEmail={email.trim()}
            source="alert_done"
            heading={selectedResorts.length === 1 ? "Save this mountain." : "Save these mountains."}
          />
        )}
      </div>
    );
  }

  if (step === "pick") {
    return (
      <div className="flex flex-col">
        <div className="px-5 pt-4">
          <p className="mb-3 text-sm text-bark">
            Choose the mountains to follow. We’ll email you when fresh snow hits your threshold.
          </p>
          <div className="relative mb-3">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bark" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search resorts or states…"
              aria-label="Search resorts"
              className={`${inputClass} pl-9`}
            />
          </div>
          {!query && popular.length > 0 && (
            <div className="mb-3">
              <p className="pc-eyebrow mb-1.5">Popular</p>
              <ul className="flex flex-wrap gap-1.5">
                {popular.map((r) => {
                  const on = selected.has(r.id);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => toggleResort(r.id)}
                        aria-pressed={on}
                        className={`${chipBase} ${on ? chipOn : chipOff}`}
                      >
                        {on && <Check size={12} strokeWidth={3} aria-hidden />}
                        {r.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <p className="mb-2 min-h-4 text-xs font-bold text-forest" aria-live="polite">
            {selected.size > 0 && `${selected.size} resort${selected.size === 1 ? "" : "s"} selected`}
          </p>
        </div>

        <div className="max-h-[min(50dvh,24rem)] overflow-y-auto overscroll-contain px-5 pb-2">
          <ul className="space-y-1.5">
            {filteredResorts.map((resort) => {
              const isOn = selected.has(resort.id);
              return (
                <li
                  key={resort.id}
                  className={`flex items-center gap-3 rounded-lg border-[1.5px] px-3 py-1.5 transition-colors duration-100 ${
                    isOn ? "border-ink bg-cream-dk" : "border-ink/15 bg-cream-50 hover:border-bark"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleResort(resort.id)}
                    aria-pressed={isOn}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-[1.5px] ${
                        isOn ? "border-ink bg-forest text-cream-50" : "border-bark bg-cream-50"
                      }`}
                    >
                      {isOn && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-ink">{resort.name}</span>
                      <span className="block text-xs text-bark">{resort.state}</span>
                    </span>
                  </button>
                  {isOn && (
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-bark">
                      <span aria-hidden>≥</span>
                      <ThresholdSelect
                        value={thresholds[resort.id] ?? DEFAULT_THRESHOLD}
                        onChange={(value) => setThresholds((t) => ({ ...t, [resort.id]: value }))}
                        label={`Fresh-snow threshold for ${resort.name}`}
                      />
                    </div>
                  )}
                </li>
              );
            })}
            {filteredResorts.length === 0 && <li className="py-6 text-center text-sm text-bark">No resorts found.</li>}
          </ul>
        </div>

        <div className="space-y-3 border-t border-ink/15 px-5 py-4">
          <Button type="button" variant="primary" className="w-full" disabled={selected.size === 0} onClick={goToEmail}>
            Continue →
          </Button>
          <TrustLine />
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
      className="space-y-4 px-5 py-5"
    >
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-sm font-bold text-ink">
            {selectedResorts.length === 0
              ? "No mountains picked yet"
              : `Alerts for ${selectedResorts.length} mountain${selectedResorts.length === 1 ? "" : "s"}`}
          </p>
          <button type="button" onClick={() => setStep("pick")} className="min-h-11 text-sm font-bold text-forest underline">
            {selectedResorts.length === 0 ? "Pick mountains" : "Change"}
          </button>
        </div>
        {selectedResorts.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Selected mountains">
            {selectedResorts.map((r) => (
              <li key={r.id} className={`${chipBase} ${chipOn} pr-1`}>
                {r.name}
                <button
                  type="button"
                  onClick={() => toggleResort(r.id)}
                  aria-label={`Remove ${r.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-cream-50/20"
                >
                  <X size={12} strokeWidth={3} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {uniformThreshold !== null && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-bark">
          Email me at
          <ThresholdSelect value={uniformThreshold} onChange={setAllThresholds} label="Fresh-snow threshold for every selected mountain" />
          or more of new snow
        </p>
      )}
      {uniformThreshold === null && selectedResorts.length > 0 && (
        <p className="text-sm text-bark">
          Thresholds are set per mountain —{" "}
          <button type="button" onClick={() => setStep("pick")} className="font-bold text-ink underline">
            edit
          </button>
          .
        </p>
      )}

      {/* Opening-day mail is a second, separate promise (one note when the
          resort's confirmed date arrives), so it is an explicit checkbox
          rather than folded into the threshold sentence. */}
      <label
        htmlFor={`${id}-opening`}
        className="flex cursor-pointer items-start gap-3 rounded-lg border-[1.5px] border-ink/15 bg-cream px-3 py-2.5"
      >
        <input
          id={`${id}-opening`}
          type="checkbox"
          checked={openingAlerts}
          onChange={(e) => toggleOpeningAlerts(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-forest"
        />
        <span className="text-sm leading-snug text-ink">
          <span className="font-bold">Also email me the morning a selected resort opens</span>
          <span className="mt-0.5 block text-xs text-bark">
            One note on opening day, once the resort confirms the date. Same unsubscribe link.
          </span>
        </span>
      </label>

      <div>
        <label htmlFor={`${id}-email`} className="block text-sm font-bold text-ink">
          Email address
        </label>
        <input
          id={`${id}-email`}
          ref={emailRef}
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errorMessage) reset();
          }}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          required
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorMessage ? `${id}-error` : undefined}
          className={`${inputClass} mt-1`}
        />
      </div>

      {errorMessage && (
        <p id={`${id}-error`} role="alert" className="text-sm text-poor">
          {errorMessage}
        </p>
      )}

      <Button type="submit" variant="primary" className="w-full" disabled={submitting || selectedResorts.length === 0}>
        {submitting ? (
          <>
            <Loader2 size={14} aria-hidden className="motion-safe:animate-spin" /> Activating…
          </>
        ) : (
          "Activate alerts"
        )}
      </Button>
      <TrustLine />
    </form>
  );
}
