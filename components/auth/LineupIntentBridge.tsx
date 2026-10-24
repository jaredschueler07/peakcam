"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, X } from "lucide-react";
import { addFavoriteItems } from "@/lib/lineup-favorites";
import {
  LINEUP_CLAIM_TTL_MS,
  LINEUP_STORAGE_KEY,
  claimLineupIntent,
  completeLineupIntent,
  lineupEventProperties,
  lineupStorage,
  lineupTabToken,
  readLineupIntent,
  releaseLineupIntentClaim,
  type LineupIntent,
} from "@/lib/lineup";
import { EVENTS, track } from "@/lib/analytics-events";
import { useAuthUser } from "@/lib/use-auth-user";

type Notice =
  | { kind: "success"; items: LineupIntent["items"]; added: number }
  | {
      kind: "error";
      count: number;
      added: number;
      message: string;
      intent: LineupIntent | null;
      retryable: boolean;
      /** A concrete way out of an account mismatch (sign out on /account). */
      action?: { href: string; label: string };
    }
  | { kind: "restoring" };

const SWITCH_ACCOUNT = { href: "/account", label: "Switch account" } as const;

function savedHeadline(items: LineupIntent["items"]): string {
  const resorts = items.filter((item) => item.item_type === "resort").length;
  const cameras = items.length - resorts;
  if (resorts > 0 && cameras === 0) {
    return resorts === 1 ? "Saved 1 mountain to your account." : `Saved ${resorts} mountains to your account.`;
  }
  if (cameras > 0 && resorts === 0) {
    return cameras === 1 ? "Saved 1 camera to your account." : `Saved ${cameras} cameras to your account.`;
  }
  return items.length === 1 ? "Saved 1 favorite to your account." : `Saved ${items.length} favorites to your account.`;
}

/**
 * Finishes a guest lineup after authentication, wherever the auth lands.
 *
 * Why this lives at the provider level: Google OAuth, an email-confirmation
 * link and a plain returning sign-in all end with a fresh session and then a
 * redirect. None of those call sites knows the visitor picked mountains or a
 * camera on another page, so one global effect claims the pending intent,
 * verifies the account, adds only the missing favourites and then confirms on
 * screen.
 *
 * The intent is not deleted before the network call. The tab writes a claim
 * and re-reads it (best effort — localStorage has no compare-and-swap), and
 * only a successful save clears the matching record. A failure releases the
 * claim and keeps the items, so a reload or the Retry button can finish them;
 * the database's unique constraint remains the final idempotency protection.
 * A claim from this tab token (the page reloaded mid-write) is reclaimable
 * immediately; a claim from another tab waits out LINEUP_CLAIM_TTL_MS.
 *
 * Cross-tab caveat: localStorage is shared by tabs of the same browser, so a
 * confirmation link opened in a new tab still works. Another device shares no
 * storage and cannot carry the picks; that is documented in
 * docs/marketing/signup-conversion-2026-10-24.md.
 */
export function LineupIntentBridge() {
  const { user, loaded } = useAuthUser();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recheck, setRecheck] = useState(0);
  const running = useRef(false);
  /**
   * The last record this mounted bridge attempted, keyed by the account that
   * attempted it. It is deliberately an intent id, not a per-user latch: a
   * newer selection (a different id) must still be consumed without a
   * remount, while a failed write for the same record must not spin. Signing
   * out clears it, so the next sign-in may retry that record.
   */
  const lastAttempt = useRef<{ userId: string; intentId: string } | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTarget = useRef<string | null>(null);
  const tabToken = useMemo(() => lineupTabToken(), []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    retryTarget.current = null;
  }, []);

  /**
   * Another tab claimed the record. Wake when that lease has actually
   * expired (not a full fresh TTL later), so an abandoned claim is reclaimed
   * promptly. Re-arming for the same intent+claim is a no-op; a renewed claim
   * replaces the timer. The timeout is cleared on unmount and on sign-out.
   */
  const scheduleRetry = useCallback(
    (intent: LineupIntent) => {
      const target = `${intent.id}:${intent.claim?.started_at ?? 0}`;
      if (retryTimer.current !== null && retryTarget.current === target) return;
      clearRetryTimer();
      const startedAt = intent.claim?.started_at ?? Date.now();
      const elapsed = Math.max(0, Date.now() - startedAt);
      const delay = Math.max(250, LINEUP_CLAIM_TTL_MS - elapsed + 250);
      retryTarget.current = target;
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        retryTarget.current = null;
        setRecheck((value) => value + 1);
      }, delay);
    },
    [clearRetryTimer],
  );

  const save = useCallback(
    async (intent: LineupIntent, token: string) => {
      if (running.current) return;
      running.current = true;
      const count = intent.items.length;
      const props = lineupEventProperties(intent.source, "auth_restore", count);
      try {
        const result = await addFavoriteItems(intent.items, {
          source: intent.source,
          // The claim stamped the account; a different session must not adopt
          // this selection if the user changed while the call was in flight.
          expectedUserId: intent.user_id ?? undefined,
        });
        if (result.ok) {
          // Clear only this exact record. A newer selection created while the
          // write was in flight has a different id and is left untouched.
          completeLineupIntent(lineupStorage(), intent.id, token);
          setNotice({ kind: "success", items: intent.items, added: result.added.length });
          // A selection / prompt view is not a save. Only a real insert reaches
          // LINEUP_SAVED, and the ads pixels only listen to AUTH_SIGNUP_COMPLETED.
          if (result.added.length > 0) {
            track(EVENTS.LINEUP_SAVED, {
              ...props,
              added_count: result.added.length,
              first_save: result.firstSave,
            });
          }
          return;
        }

        // Keep the intent recoverable for a retry or reload. Releasing the
        // claim (rather than deleting/replacing the record) means a newer
        // selection is never overwritten by an old failure.
        const kept = releaseLineupIntentClaim(lineupStorage(), intent.id, token);
        track(EVENTS.LINEUP_SAVE_FAILED, {
          ...props,
          reason: result.reason ?? "unknown",
          added_count: result.added.length,
        });
        const partial = result.added.length > 0;
        const userChanged = result.reason === "user_changed";
        setNotice({
          kind: "error",
          count,
          added: result.added.length,
          intent,
          retryable: result.reason !== "invalid" && !userChanged,
          ...(userChanged ? { action: SWITCH_ACCOUNT } : {}),
          message: userChanged
            ? "The signed-in account changed while we were saving. Your picks are still here — sign in with the account that started the save, then try again."
            : kept
              ? partial
                ? `We saved ${result.added.length} of ${count} to your account, then hit an error. Your selection is still in this browser — try again to finish; the saved ones will not be duplicated.`
                : "We couldn’t save your selection yet. Your picks are still in this browser — try again when you’re back online."
              : "We couldn’t save your selection, and this browser wouldn’t keep it for a retry. Sign in again and pick the mountains once more.",
        });
      } catch {
        // addFavoriteItems already converts provider failures, but a thrown
        // render/import/runtime error must not leave "Saving…" on screen —
        // and its raw provider/runtime text must never be shown to a visitor.
        releaseLineupIntentClaim(lineupStorage(), intent.id, token);
        track(EVENTS.LINEUP_SAVE_FAILED, { ...props, reason: "threw" });
        setNotice({
          kind: "error",
          count,
          added: 0,
          intent,
          retryable: true,
          message:
            "We couldn’t save your selection yet. Your picks are still in this browser — try again when you’re back online.",
        });
      } finally {
        running.current = false;
        // A newer intent may have been written while this save was in flight
        // (it kept its own id). Re-run the effect so it is consumed now, not
        // on the next mount. The same failed intent is latched by id above.
        setRecheck((value) => value + 1);
      }
    },
    [],
  );

  useEffect(() => {
    if (!loaded) return;
    if (!user) {
      // A new session starts a new attempt; do not let the previous session's
      // failed record or a busy timer stick to the next sign-in.
      lastAttempt.current = null;
      clearRetryTimer();
      return;
    }
    if (running.current) return;

    const storage = lineupStorage();
    const current = readLineupIntent(storage);
    if (!current) {
      clearRetryTimer();
      // `claimLineupIntent` also removes an expired or malformed payload as a
      // one-time cleanup; it returns `none` without writing when no record is
      // pending. Do not pre-read and return here without that cleanup.
      claimLineupIntent(storage, user.id, { token: tabToken });
      return;
    }
    // Same account, same record: it was already attempted and either failed
    // or completed. Never auto-loop on a failed write. A new selection has a
    // different id and is still eligible.
    if (lastAttempt.current?.userId === user.id && lastAttempt.current.intentId === current.id) {
      return;
    }

    const claim = claimLineupIntent(storage, user.id, { token: tabToken });
    if (!claim.ok) {
      if (claim.reason === "busy") {
        // Another tab is saving. Check again when its lease could have
        // expired; if it succeeded the record is gone and this is a no-op.
        scheduleRetry(claim.intent ?? current);
        return;
      }
      clearRetryTimer();
      if (claim.reason === "user_mismatch") {
        lastAttempt.current = { userId: user.id, intentId: claim.intent?.id ?? current.id };
        setNotice({
          kind: "error",
          count: claim.intent?.items.length ?? 0,
          added: 0,
          intent: claim.intent,
          retryable: false,
          action: SWITCH_ACCOUNT,
          message:
            "This browser has mountains saved for a different account. Sign in with that account to finish saving them.",
        });
      }
      // `none` / blocked / signed_out: nothing has been written, so there is
      // nothing to promise or recover here.
      return;
    }

    clearRetryTimer();
    lastAttempt.current = { userId: user.id, intentId: claim.intent.id };
    setNotice({ kind: "restoring" });
    void save(claim.intent, claim.token);
  }, [loaded, user, save, recheck, tabToken, scheduleRetry, clearRetryTimer]);

  // Another tab may claim, release, replace or clear the shared record. Re-read
  // it then, so a completed save or a newer selection is picked up without a
  // reload. (A same-tab write during a save is covered by the recheck above.)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== LINEUP_STORAGE_KEY) return;
      setRecheck((value) => value + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => () => clearRetryTimer(), [clearRetryTimer]);

  const retry = useCallback(async () => {
    if (running.current || !user || !notice || notice.kind !== "error" || !notice.intent) return;
    const claim = claimLineupIntent(lineupStorage(), user.id, { token: tabToken });
    if (!claim.ok) {
      if (claim.reason === "user_mismatch") {
        setNotice({
          ...notice,
          intent: claim.intent ?? notice.intent,
          retryable: false,
          action: SWITCH_ACCOUNT,
          message: "Those mountains were picked for a different account. Sign in with that account, or choose again.",
        });
        return;
      }
      if (claim.reason === "busy") {
        setNotice({ ...notice, message: "Another tab is already saving these. Give it a moment, then try again." });
        return;
      }
      if (claim.reason === "blocked") {
        setNotice({ ...notice, message: "This browser is blocking storage, so the selection cannot be retried here." });
        return;
      }
      if (claim.reason === "signed_out") {
        setNotice({ ...notice, message: "Sign in again to finish saving this selection." });
        return;
      }
      if (claim.reason === "none") {
        // Another tab finished it (or it expired) while this notice was up.
        setNotice(null);
        return;
      }
      return;
    }
    clearRetryTimer();
    lastAttempt.current = { userId: user.id, intentId: claim.intent.id };
    setNotice({ kind: "restoring" });
    void save(claim.intent, claim.token);
  }, [notice, save, tabToken, user, clearRetryTimer]);

  if (!notice) return null;

  if (notice.kind === "restoring") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 items-center gap-2 rounded-[18px] border-[1.5px] border-ink bg-cream-50 px-4 py-3 text-sm font-bold text-ink shadow-stamp"
      >
        <Loader2 size={16} aria-hidden className="shrink-0 motion-safe:animate-spin" />
        Saving your mountains…
      </div>
    );
  }

  if (notice.kind === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="lineup-saved-toast"
        className="fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-4 text-ink shadow-stamp"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink bg-forest text-cream-50">
            <Check size={15} strokeWidth={3} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-black leading-tight">
              {savedHeadline(notice.items)}
            </p>
            <p className="mt-1 text-sm text-bark">
              {notice.added === 0 ? "They were already in your favorites." : "They’re on your My Peak dashboard now."}
            </p>
            <Link href="/dashboard" className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-forest underline">
              Open My Peak →
            </Link>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss saved-mountains message"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink text-lg"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid="lineup-save-error"
      className="fixed bottom-4 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-4 text-ink shadow-stamp"
    >
      <p className="font-display text-lg font-black leading-tight">
        {notice.added > 0 ? "Part of your selection is saved." : "We couldn’t save your selection yet."}
      </p>
      <p className="mt-1 text-sm text-bark">{notice.message}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {notice.action && (
          <Link
            href={notice.action.href}
            onClick={() => setNotice(null)}
            className="inline-flex min-h-11 items-center text-sm font-bold text-forest underline"
          >
            {notice.action.label} →
          </Link>
        )}
        {notice.retryable && (
          <button
            type="button"
            onClick={() => void retry()}
            className="min-h-11 rounded-full border-[1.5px] border-ink bg-forest px-4 text-sm font-bold text-cream-50 shadow-stamp-sm"
          >
            Try again
          </button>
        )}
        <button type="button" onClick={() => setNotice(null)} className="min-h-11 text-sm font-bold underline">
          Dismiss
        </button>
      </div>
    </div>
  );
}
