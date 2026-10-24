"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { AuthModal } from "@/components/auth/AuthModal";
import { LINEUP_STORAGE_BLOCKED_MESSAGE } from "@/components/auth/lineup-gate";
import { addFavoriteItems } from "@/lib/lineup-favorites";
import {
  MAX_LINEUP_SELECTION,
  lineupEventProperties,
  lineupIntentNote,
  lineupSignupHeading,
  lineupStorage,
  writeLineupIntent,
} from "@/lib/lineup";
import { EVENTS, track } from "@/lib/analytics-events";
import { useAuthUser } from "@/lib/use-auth-user";

/** The slice of a hub resort the chooser renders — real readings only, never placeholder numbers. */
export interface LineupOption {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  baseIn: number | null;
  newSnow24hIn: number | null;
  camCount: number;
}

interface Props {
  hubSlug: string;
  hubLabel: string;
  options: LineupOption[];
}

type SaveState = "idle" | "saving" | "saved" | "error";

const SOURCE = "hub_lineup";

/**
 * The hub's account benefit and pre-signup mountain lineup.
 *
 * The benefit card is compact and server-rendered; the chooser is a native
 * dialog with checkboxes (keyboard + screen reader first) and real base /
 * 24 h / cam counts per row. Nothing is claimed as saved until either the
 * signed-in write succeeds or the browser actually stored the one-shot intent.
 * Changing the selection after an inline result returns the chooser to an
 * actionable save state instead of leaving a stale success message.
 */
export function HubLineup({ hubLabel, options }: Props) {
  const { user, loaded } = useAuthUser();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [intentStored, setIntentStored] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [authWarning, setAuthWarning] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAdded, setSavedAdded] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedOptions = useMemo(
    () => options.filter((option) => selected.has(option.id)),
    [options, selected],
  );
  const count = selectedOptions.length;
  const atLimit = count >= MAX_LINEUP_SELECTION;
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? options.filter(
        (option) =>
          option.name.toLowerCase().includes(normalizedQuery) ||
          (option.region ?? "").toLowerCase().includes(normalizedQuery),
      )
    : options;

  const resetResult = () => {
    setSaveState("idle");
    setSavedAdded(0);
    setSaveError(null);
  };

  const openChooser = () => {
    track(EVENTS.ACCOUNT_CTA_CLICKED, lineupEventProperties(SOURCE, "hub_account_benefit", count));
    setStorageError(null);
    setAuthWarning(null);
    resetResult();
    setChooserOpen(true);
  };

  const toggle = (id: string) => {
    // A result describes the selection that produced it; editing the
    // selection must bring back the save control, not leave a stale success.
    if (saveState === "saving") return;
    resetResult();
    setStorageError(null);
    setAuthWarning(null);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= MAX_LINEUP_SELECTION) return previous;
      next.add(id);
      return next;
    });
  };

  const commit = async () => {
    if (count === 0 || saveState === "saving" || !loaded) return;
    const props = lineupEventProperties(SOURCE, "hub_lineup", count);
    track(EVENTS.LINEUP_SELECTED, props);
    setSaveError(null);
    setStorageError(null);

    if (user) {
      setSaveState("saving");
      try {
        const result = await addFavoriteItems(
          selectedOptions.map((option) => ({ item_type: "resort" as const, item_id: option.id })),
          { source: SOURCE, expectedUserId: user.id },
        );
        if (result.ok) {
          setSaveState("saved");
          setSavedAdded(result.added.length);
          if (result.added.length > 0) {
            track(EVENTS.LINEUP_SAVED, {
              ...props,
              added_count: result.added.length,
              first_save: result.firstSave,
            });
          }
          return;
        }
        setSaveState("error");
        setSaveError(
          result.added.length > 0
            ? `We saved ${result.added.length} of ${count} mountains, then hit an error. Try again to finish — the saved ones won’t be duplicated.`
            : "We couldn’t save your mountains. Nothing was saved — please try again.",
        );
        track(EVENTS.LINEUP_SAVE_FAILED, {
          ...props,
          reason: result.reason ?? "unknown",
          added_count: result.added.length,
        });
      } catch {
        // A thrown auth/network call is still a recoverable failure; never
        // leave the button stuck on "Saving…" or claim nothing changed.
        setSaveState("error");
        setSaveError("We couldn’t save your mountains. Nothing was saved — please try again.");
        track(EVENTS.LINEUP_SAVE_FAILED, { ...props, reason: "threw" });
      }
      return;
    }

    const written = writeLineupIntent(lineupStorage(), selectedOptions.map((option) => option.id), SOURCE);
    if (!written.ok) {
      // Storage being unavailable is not an empty selection. Say which it is
      // and keep a working path to create the account anyway.
      setStorageError(
        written.reason === "blocked"
          ? LINEUP_STORAGE_BLOCKED_MESSAGE
          : "Pick at least one mountain before continuing.",
      );
      setSaveState("error");
      track(EVENTS.LINEUP_SAVE_FAILED, { ...props, reason: `intent_${written.reason}` });
      return;
    }
    setIntentStored(true);
    setAuthWarning(null);
    setChooserOpen(false);
    setAuthOpen(true);
  };

  const openAuthAnyway = () => {
    setIntentStored(false);
    setStorageError(null);
    setAuthWarning(LINEUP_STORAGE_BLOCKED_MESSAGE);
    setChooserOpen(false);
    setAuthOpen(true);
  };

  const heading = lineupSignupHeading(count, count === 1 ? selectedOptions[0]?.name : null);
  const intentNote = intentStored && count > 0 ? lineupIntentNote(count) : undefined;

  return (
    <>
      <section
        aria-labelledby="hub-account-heading"
        className="rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-4 shadow-stamp sm:p-5 md:flex md:items-center md:justify-between md:gap-8"
      >
        <div className="min-w-0">
          <p className="pc-eyebrow">Free PeakCam account</p>
          <h2
            id="hub-account-heading"
            className="mt-1 font-display text-xl font-black leading-[0.98] tracking-[-0.02em] text-ink sm:text-3xl [overflow-wrap:anywhere]"
          >
            Your mountains. One quick morning check.
          </h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink sm:text-[15.5px]">
            Keep your favorite {hubLabel} webcams and snow reports together in a free dashboard.
          </p>
          <p className="mt-2 hidden text-sm text-bark sm:block">Favorites on every device · My Peak dashboard · Full on-mountain reports</p>
        </div>
        <div className="mt-3 shrink-0 md:mt-0 md:text-right">
          <Button type="button" variant="primary" size="lg" onClick={openChooser} className="w-full sm:w-auto">
            Choose my mountains
          </Button>
          <p className="mt-2 text-xs text-bark">Free account. No credit card.</p>
          <a href="#hub-alerts-heading" className="mt-1 inline-flex min-h-11 items-center text-sm font-bold text-forest underline">
            Powder alerts don’t need an account →
          </a>
        </div>
      </section>

      {chooserOpen && (
        <Modal
          onClose={() => setChooserOpen(false)}
          title="Choose your mountains"
          className="m-auto w-[calc(100%_-_2rem)] max-w-2xl rounded-[18px] open:flex open:flex-col"
        >
          <div className="flex min-h-0 flex-col p-5">
            <p className="shrink-0 text-sm text-bark">
              Pick any number from 1 to {MAX_LINEUP_SELECTION}. These become favorites on your free account, and you can change
              them any time.
            </p>
            <div className="relative mt-3 shrink-0">
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bark" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search mountains or regions…"
                aria-label="Search mountains"
                className="pc-auth-input min-h-11 w-full rounded-lg border border-bark bg-cream-50 py-2 pl-9 pr-3 text-[16px] text-ink placeholder:text-bark md:text-sm"
              />
            </div>

            <ul className="mt-3 min-h-24 max-h-[min(42dvh,22rem)] space-y-1.5 overflow-y-auto overscroll-contain pr-1" aria-label="Mountains to save">
              {visible.map((option) => {
                const isSelected = selected.has(option.id);
                const disabled = !isSelected && atLimit;
                const base = option.baseIn == null ? "No base reading" : `${option.baseIn}″ base`;
                const fresh = option.newSnow24hIn == null ? "No 24h reading" : `${option.newSnow24hIn}″ in 24h`;
                const cams = option.camCount === 1 ? "1 cam" : `${option.camCount} cams`;
                return (
                  <li key={option.id}>
                    <label
                      className={`relative grid cursor-pointer grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg border-[1.5px] px-3 py-2 transition-colors duration-100 ${
                        isSelected
                          ? "border-ink bg-cream-dk"
                          : disabled
                            ? "cursor-not-allowed border-ink/10 bg-cream-50 opacity-60"
                            : "border-ink/15 bg-cream-50 hover:border-bark"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled || saveState === "saving"}
                        onChange={() => toggle(option.id)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden
                        className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border-[1.5px] border-bark bg-cream-50 peer-checked:border-ink peer-checked:bg-forest peer-checked:text-cream-50 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-alpen ${
                          disabled ? "opacity-50" : ""
                        }`}
                      >
                        {isSelected && <Check size={12} strokeWidth={3} aria-hidden />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-ink">{option.name}</span>
                        <span className="block truncate text-xs text-bark">{option.region || "Mountain region not listed"}</span>
                      </span>
                      <span className="col-start-2 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px] text-bark-dk">
                        <span>{base}</span>
                        <span aria-hidden>·</span>
                        <span>{fresh}</span>
                        <span aria-hidden>·</span>
                        <span>{cams}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
              {visible.length === 0 && <li className="py-6 text-center text-sm text-bark">No mountains match that search.</li>}
            </ul>

            <div className="mt-3 shrink-0 rounded-lg border border-ink/15 bg-cream px-3 py-2" aria-live="polite">
              <p className="text-xs font-bold text-forest">
                {count} of {MAX_LINEUP_SELECTION} selected
              </p>
              <p className="mt-0.5 max-h-10 min-h-4 overflow-y-auto text-xs text-bark [overflow-wrap:anywhere]">
                {count > 0 ? selectedOptions.map((option) => option.name).join(" · ") : "Pick at least one mountain to continue."}
              </p>
              {atLimit && <p className="mt-1 text-xs font-bold text-bark-dk">That’s the maximum — deselect one to swap it.</p>}
            </div>

            {storageError && (
              <div role="alert" className="mt-3 shrink-0 rounded-lg border-[1.5px] border-alpen-dk bg-alpen/10 px-3 py-2 text-sm text-ink">
                <p>{storageError}</p>
                <button type="button" onClick={openAuthAnyway} className="mt-1 min-h-11 text-sm font-bold underline">
                  Create a free account anyway →
                </button>
              </div>
            )}

            {saveState === "saved" ? (
              <div role="status" data-testid="lineup-saved-inline" className="mt-4 shrink-0 rounded-lg border-[1.5px] border-forest bg-forest/10 px-3 py-3">
                <p className="text-sm font-bold text-forest">
                  {savedAdded === 0
                    ? "Those mountains are already in your favorites."
                    : `Saved ${savedAdded} ${savedAdded === 1 ? "mountain" : "mountains"} to your account.`}
                </p>
                <Link href="/dashboard" className="mt-1 inline-flex min-h-11 items-center text-sm font-bold text-forest underline">
                  Open My Peak →
                </Link>
                <button type="button" onClick={() => setChooserOpen(false)} className="ml-4 min-h-11 text-sm font-bold underline">
                  Done
                </button>
                <p className="mt-1 text-xs text-bark">Change a tick above to save a different selection.</p>
              </div>
            ) : (
              <div className="mt-4 shrink-0 border-t border-ink/15 pt-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={count === 0 || !loaded || saveState === "saving"}
                    onClick={() => void commit()}
                  >
                    {saveState === "saving" && <Loader2 size={14} aria-hidden className="motion-safe:animate-spin" />}
                    {saveState === "saving" ? "Saving…" : !loaded ? "Checking account…" : "Save my mountains"}
                  </Button>
                  <p className="text-xs text-bark">Free account. No credit card. Powder alerts stay account-free.</p>
                </div>

                {saveState === "error" && saveError && (
                  <div role="alert" className="mt-3 rounded-lg border-[1.5px] border-poor/40 bg-poor/10 px-3 py-2 text-sm text-ink">
                    <p>{saveError}</p>
                    {user && (
                      <button type="button" onClick={() => void commit()} className="mt-1 min-h-11 text-sm font-bold underline">
                        Try saving again →
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {authOpen && !user && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          initialMode="signup"
          source={SOURCE}
          heading={heading}
          intentNote={intentNote}
          intentWarning={authWarning ?? undefined}
          lineup={intentStored && count > 0 ? { lineup_source: SOURCE, lineup_count: count } : null}
        />
      )}
    </>
  );
}
