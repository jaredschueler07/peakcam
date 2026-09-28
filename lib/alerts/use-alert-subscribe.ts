"use client";

import { useCallback, useRef, useState } from "react";
import { track, EVENTS } from "@/lib/analytics-events";
import { trackLead } from "@/lib/meta-pixel-events";
import { trackGoogleConversion } from "@/lib/google-tag";
import { trackRedditSignUp } from "@/lib/reddit-pixel";
import {
  buildSubscribePayload,
  isValidEmail,
  markLeadSent,
  readLeadSent,
  subscribeErrorMessage,
  type SubscribeInput,
} from "@/lib/alerts/client";

// The latch lives in lib/alerts/client.ts (node-testable); re-exported so the
// hook module is the one import a form needs.
export { LEAD_SENT_KEY, markLeadSent, readLeadSent } from "@/lib/alerts/client";
export type { SubscribeInput } from "@/lib/alerts/client";

export type SubscribeStatus = "idle" | "submitting" | "ok" | "error";
export type SubscribeOutcome = "ok" | "error";

export interface UseAlertSubscribe {
  /** POSTs the subscription; resolves once the UI state has been updated. */
  submit(input: SubscribeInput): Promise<SubscribeOutcome>;
  status: SubscribeStatus;
  /** Friendly copy for the last failure; null while idle/submitting/ok. */
  errorMessage: string | null;
  /**
   * True once a submit succeeded in a browser that had already reported a
   * subscription (LEAD_SENT_KEY). The API answers the same 200 for an address
   * it already had, so this is the only hint a form gets that "nothing
   * changed" may be the truer message. Cleared by reset() and on a failure.
   */
  repeatInBrowser: boolean;
  /** Back to idle (does not cancel a request in flight). */
  reset(): void;
}

/**
 * Subscribe-and-fire for every powder-alert form (modal, /alerts page, resort
 * page). Owns the POST, the in-flight guard and the analytics/conversion
 * calls so no surface can drift from another.
 *
 * `source` names the surface ("browse", "alerts_page", "resort_page:vail") and
 * is stamped on every event.
 */
export function useAlertSubscribe({ source }: { source: string }): UseAlertSubscribe {
  const [status, setStatus] = useState<SubscribeStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [repeatInBrowser, setRepeatInBrowser] = useState(false);
  // Ref rather than the `status` state: an Enter keypress in the email input
  // calls submit directly, and a second keypress can land before the render
  // that disables the button. Without the latch one subscriber posts twice
  // and fires every conversion pixel twice. A duplicate call gets the same
  // promise back, so both callers see one outcome.
  const inFlight = useRef<Promise<SubscribeOutcome> | null>(null);

  const submit = useCallback(
    (input: SubscribeInput): Promise<SubscribeOutcome> => {
      if (inFlight.current) return inFlight.current;

      const fail = (message: string): SubscribeOutcome => {
        setErrorMessage(message);
        setRepeatInBrowser(false);
        setStatus("error");
        return "error";
      };

      const payload = buildSubscribePayload(input);
      if (!isValidEmail(payload.email)) return Promise.resolve(fail("Enter a valid email address"));
      if (payload.resort_ids.length === 0) return Promise.resolve(fail("Select at least one resort"));

      setStatus("submitting");
      setErrorMessage(null);

      const request = (async (): Promise<SubscribeOutcome> => {
        try {
          const resp = await fetch("/api/alerts/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!resp.ok) return fail(subscribeErrorMessage(resp.status));

          const resort_count = payload.resort_ids.length;
          const resort_slugs = input.resortSlugs;
          track(EVENTS.ALERT_SIGNUP_SUBMITTED, {
            resort_slugs,
            resort_count,
            thresholds: payload.thresholds,
            opening_alerts: payload.opening_alerts ?? false,
            source,
          });
          // The conversion proper: the API accepted the subscription. Mirrored
          // to every ad pixel that is configured (each helper no-ops without
          // its id), but only for the first success in this browser — see
          // LEAD_SENT_KEY in lib/alerts/client.ts.
          const repeat_in_browser = readLeadSent();
          track(EVENTS.ALERT_SIGNUP_SUCCEEDED, {
            resort_count,
            threshold_min: Math.min(...Object.values(payload.thresholds)),
            resort_slugs,
            repeat_in_browser,
            source,
          });
          if (!repeat_in_browser) {
            trackLead();
            trackGoogleConversion();
            trackRedditSignUp();
            markLeadSent();
          }

          setErrorMessage(null);
          setRepeatInBrowser(repeat_in_browser);
          setStatus("ok");
          return "ok";
        } catch {
          // fetch() rejected: offline, DNS, CORS — no status to map.
          return fail(subscribeErrorMessage(0));
        } finally {
          inFlight.current = null;
        }
      })();

      inFlight.current = request;
      return request;
    },
    [source]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setErrorMessage(null);
    setRepeatInBrowser(false);
  }, []);

  return { submit, status, errorMessage, repeatInBrowser, reset };
}
