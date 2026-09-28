"use client";

import { useId, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { Resort } from "@/lib/types";
import { isOffSeason } from "@/lib/map-utils";
import { useHydrated } from "@/lib/use-hydrated";
import { track, EVENTS } from "@/lib/analytics-events";
import { DEFAULT_THRESHOLD, THRESHOLD_OPTIONS } from "@/lib/alerts/client";
import { useAlertSubscribe } from "@/lib/alerts/use-alert-subscribe";
import { Button } from "@/components/ui/Button";

/** The slice of a resort the capture needs — `ResortWithData` satisfies it. */
export type CaptureResort = Pick<Resort, "id" | "name" | "slug" | "lat">;

export interface ResortAlertCaptureProps {
  resort: CaptureResort;
  /** Fires once, when the API has accepted the subscription. */
  onSubscribed?(): void;
  /**
   * Hosts that mount the capture more than once on a page (the resort page
   * repeats it under the cams) pass the flag back in so every copy flips to
   * the success state together instead of asking for the email again.
   */
  subscribed?: boolean;
  className?: string;
}

/**
 * Inches of new snow the visitor can pick from: the shared list up to 12″
 * (18″/24″ are left off a one-line form). Derived rather than retyped so every
 * value this capture can save is one AlertManagePage can display.
 */
const CAPTURE_MAX_INCHES = 12;
export const CAPTURE_THRESHOLDS: readonly number[] = THRESHOLD_OPTIONS.filter((n) => n <= CAPTURE_MAX_INCHES);

const TRUST_LINE = "No account. One email per storm day. Unsubscribe in one click.";

const cardClass = "rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-5 shadow-stamp";
// 16px on phones so iOS Safari does not zoom the page when the field focuses.
const fieldClass =
  "min-h-11 rounded-lg border border-bark bg-cream-50 px-3 py-2 text-[16px] text-ink md:text-sm";

/**
 * One-field powder-alert signup for a single resort: email + threshold,
 * resort pre-selected. This is the conversion every /resorts/[slug] landing
 * page was missing — the only alert entry points were the homepage banner and
 * the footer.
 */
export function ResortAlertCapture({ resort, onSubscribed, subscribed = false, className = "" }: ResortAlertCaptureProps) {
  const id = useId();
  const source = `resort_page:${resort.slug}`;
  const hydrated = useHydrated();
  // Server HTML and the hydrating client must agree byte-for-byte, and the
  // ISR'd server render has no idea what "now" is for the visitor relative to
  // this hemisphere's season. Render the in-season line first, switch once
  // hydrated — same pattern as UpdatedStamp on the resort page.
  const offSeason = hydrated && isOffSeason(resort.lat, new Date());
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [email, setEmail] = useState("");
  const opened = useRef(false);
  const doneFired = useRef(false);
  const { submit, status, errorMessage, reset } = useAlertSubscribe({ source });
  const submitting = status === "submitting";
  const done = subscribed || status === "ok";

  const handleEmailFocus = () => {
    if (opened.current) return;
    opened.current = true;
    // The inline form has no "open" moment, so the first focus on the email
    // field stands in for it. Reusing the modal's event keeps the funnel
    // readable across surfaces (source tells them apart) without a new name.
    track(EVENTS.ALERT_MODAL_OPENED, { source });
  };

  const handleSubmit = async () => {
    const outcome = await submit({
      email,
      resortIds: [resort.id],
      thresholds: { [resort.id]: threshold },
      resortSlugs: [resort.slug],
    });
    // A duplicate submit (Enter twice) resolves to the same outcome; only the
    // first one notifies the host.
    if (outcome !== "ok" || doneFired.current) return;
    doneFired.current = true;
    onSubscribed?.();
  };

  if (done) {
    return (
      <section role="status" className={`${cardClass} ${className}`}>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink bg-forest text-cream-50 shadow-stamp-sm"
          >
            <Check size={18} strokeWidth={3} />
          </span>
          <div className="min-w-0">
            {/* Same wording whether or not this address was already subscribed —
                the endpoint cannot tell the caller which without leaking who
                has an account. Either way the email carries the manage link. */}
            <p className="font-display text-lg font-black leading-tight text-ink">
              You’re subscribed — we emailed you a manage link.
            </p>
            {/* No link back into a signup form: the subscribe endpoint never
                edits an address it already has (lib/alerts/subscribe-core.ts),
                so sending this visitor through /alerts with more mountains
                would only re-send the manage link and change nothing while
                the form said "You're subscribed". Additions go through the
                link in the email. */}
            <p className="mt-1 text-sm text-bark">
              Want more mountains? The link in that email adds them in one click.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const headline = offSeason
    ? `Be first to know when ${resort.name} starts snowing.`
    : `Get an email when ${resort.name} gets ${threshold}″+`;

  return (
    <section aria-labelledby={`${id}-headline`} className={`${cardClass} ${className}`}>
      <p className="pc-eyebrow mb-1">Powder alerts</p>
      <h3 id={`${id}-headline`} className="font-display text-xl font-black leading-tight text-ink md:text-2xl">
        {headline}
      </h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="mt-4"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-email`} className="sr-only">
              Email address
            </label>
            <input
              id={`${id}-email`}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errorMessage) reset();
              }}
              onFocus={handleEmailFocus}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
              required
              aria-invalid={errorMessage ? true : undefined}
              aria-describedby={errorMessage ? `${id}-error` : undefined}
              className={`pc-auth-input w-full placeholder:text-bark ${fieldClass}`}
            />
          </div>
          <div className="flex gap-2">
            <select
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              aria-label={`Fresh-snow threshold for ${resort.name}`}
              className={`font-bold ${fieldClass}`}
            >
              {CAPTURE_THRESHOLDS.map((n) => (
                <option key={n} value={n}>
                  {n}″
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" disabled={submitting} className="flex-1 whitespace-nowrap sm:flex-none">
              {submitting ? (
                <>
                  <Loader2 size={14} aria-hidden className="motion-safe:animate-spin" /> Subscribing…
                </>
              ) : (
                "Alert me"
              )}
            </Button>
          </div>
        </div>
        {errorMessage && (
          <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-poor">
            {errorMessage}
          </p>
        )}
        <p className="mt-3 text-xs text-bark">
          {offSeason && `Emails start at ${threshold}″ of new snow. `}
          {TRUST_LINE}
        </p>
      </form>
    </section>
  );
}
