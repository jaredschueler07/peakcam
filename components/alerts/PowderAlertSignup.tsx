"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { track, EVENTS } from "@/lib/analytics-events";
import { PowderAlertForm, type AlertResort } from "./PowderAlertForm";

interface Props {
  resorts: AlertResort[];
  /** Surface name for analytics; derived from the current path when omitted. */
  source?: string;
  /** Skip the picker and open on the email step with these resorts chosen. */
  preselectedSlugs?: string[];
  preselectedThreshold?: number;
  label?: string;
}

/** Which surface opened the modal — the component is mounted on / (browse banner) today. */
function alertModalSource(): string {
  const path = window.location.pathname;
  if (path === "/alerts") return "alerts_page";
  if (path === "/") return "browse";
  return path;
}

/**
 * Trigger button + modal around PowderAlertForm. The form owns every step and
 * the subscribe call; this wrapper only opens, titles and closes the dialog.
 * /alerts renders the form inline instead (components/alerts/AlertsPageContent).
 */
export function PowderAlertSignup({ resorts, source, preselectedSlugs, preselectedThreshold, label = "Get powder alerts" }: Props) {
  const [open, setOpen] = useState(false);
  const [activeSource, setActiveSource] = useState(source ?? "");
  const [subscribed, setSubscribed] = useState(false);

  const handleOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Modal restores focus to document.activeElement on close.
    event.currentTarget.focus();
    const resolved = source ?? alertModalSource();
    setActiveSource(resolved);
    setSubscribed(false);
    setOpen(true);
    track(EVENTS.ALERT_MODAL_OPENED, { source: resolved });
  };
  // Unmounting the Modal also unmounts the form, so its steps reset for free.
  const handleClose = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-cream-50 px-4 py-2 pointer-coarse:min-h-11
                   text-sm font-bold text-ink shadow-stamp transition-transform duration-100
                   hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-stamp-hover
                   active:translate-x-[1px] active:translate-y-[1px] active:shadow-stamp-sm"
      >
        <Bell size={15} aria-hidden />
        {label}
      </button>

      {open && (
        <Modal onClose={handleClose} label="Get powder alerts" className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-[18px]">
          <div className="pc-on-ink flex items-center justify-between gap-3 border-b-[1.5px] border-ink bg-ink px-5 py-4 text-cream-50">
            <div className="flex items-center gap-2.5">
              <Bell size={16} aria-hidden className="text-alpen" />
              <span className="font-display text-lg font-bold">{subscribed ? "You’re all set" : "Get powder alerts"}</span>
            </div>
            <button type="button" onClick={handleClose} aria-label="Close" className="h-11 w-11 shrink-0 rounded-full border border-cream-50 text-xl">
              ×
            </button>
          </div>
          <PowderAlertForm
            resorts={resorts}
            source={activeSource}
            preselectedSlugs={preselectedSlugs}
            preselectedThreshold={preselectedThreshold}
            onDone={() => setSubscribed(true)}
            onClose={handleClose}
          />
        </Modal>
      )}
    </>
  );
}
