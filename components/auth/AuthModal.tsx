"use client";

import { Modal } from "@/components/ui/Modal";
import { AuthForm } from "./AuthForm";

export function AuthModal({ onClose, redirectTo }: { onClose(): void; redirectTo?: string }) {
  const next = redirectTo ?? (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);
  return <Modal onClose={onClose} label="Sign in to PeakCam" className="m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-[18px]">
    <div className="p-5">
      <div className="mb-5 flex items-start justify-between gap-3"><div><h2 className="font-display text-2xl font-black">Save your mountains.</h2><p className="mt-1 text-sm text-bark">Your PeakCam account, everywhere.</p></div><button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 shrink-0 rounded-full border border-ink text-xl">×</button></div>
      <AuthForm redirectTo={next} onSignedIn={onClose} />
    </div>
  </Modal>;
}
