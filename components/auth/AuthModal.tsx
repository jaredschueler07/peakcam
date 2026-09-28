"use client";

import { useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { track, EVENTS } from "@/lib/analytics-events";
import { AuthForm, type AuthMode } from "./AuthForm";

export function AuthModal({
  onClose,
  redirectTo,
  initialMode = "signup",
  initialEmail,
  source,
  heading = "Save this mountain.",
}: {
  onClose(): void;
  redirectTo?: string;
  /**
   * Defaults to "signup": the modal only ever opens because a signed-out
   * visitor tried to do something (save a favorite, file a full report), and
   * most of them have no account yet. Returning users get the "Sign in" line.
   */
  initialMode?: AuthMode;
  /** Pre-fills the email — the alert form passes the address that just subscribed. */
  initialEmail?: string;
  /** Surface that raised the gate; when given, AUTH_GATE_SHOWN is recorded. */
  source?: string;
  heading?: string;
}) {
  const next = redirectTo ?? (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);
  useEffect(() => {
    // Callers without a `source` have nothing to attribute the gate to, so no
    // event — an unlabeled row would only muddy the per-surface funnel.
    if (source) track(EVENTS.AUTH_GATE_SHOWN, { source, initial_mode: initialMode });
  }, [source, initialMode]);
  return <Modal onClose={onClose} label={initialMode === "signup" ? "Create a free PeakCam account" : "Sign in to PeakCam"} className="m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-[18px]">
    <div className="p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-black">{heading}</h2>
          <p className="mt-1 text-sm text-bark">Free account: favorites on every device, a My Peak dashboard, and full on-mountain reports. Powder alerts never need a login.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 shrink-0 rounded-full border border-ink text-xl">×</button>
      </div>
      <AuthForm redirectTo={next} onSignedIn={onClose} initialMode={initialMode} initialEmail={initialEmail} modeSwitch="link" />
    </div>
  </Modal>;
}
