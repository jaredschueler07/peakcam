"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { Bell, BellOff, Check, Loader2, Trash2 } from "lucide-react";
import { track, EVENTS } from "@/lib/analytics-events";
import { thresholdOptionsFor } from "@/lib/alerts/client";
import { AlertDestinations } from "@/components/alerts/AlertDestinations";
import type { DestinationView } from "@/lib/alerts/destinations";
import type { ManageFeeds } from "@/lib/alerts/manage";

const CONFIRMED_LATCH_PREFIX = "peakcam_alert_confirmed:";
const confirmedTokensInMemory = new Set<string>();

function tokenFingerprint(token: string): string {
  // FNV-1a digest so raw management capability tokens never enter web storage keys.
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function shouldTrackConfirmed(token: string): boolean {
  const fp = tokenFingerprint(token);
  if (confirmedTokensInMemory.has(fp)) return false;
  confirmedTokensInMemory.add(fp);
  try {
    const key = `${CONFIRMED_LATCH_PREFIX}${fp}`;
    if (window.sessionStorage.getItem(key) === "1") return false;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Storage disabled — in-memory guard still suppresses StrictMode double-fires.
  }
  return true;
}

interface Resort {
  id: string;
  name: string;
  state: string;
  region: string;
  slug: string;
}

interface Preference {
  resort_id: string;
  threshold_inches: number;
  /** Opening-day email opt-in (migration 020); absent on a pre-migration read. */
  opening_day?: boolean;
}

interface Props {
  token: string;
  email: string;
  preferences: Preference[];
  resorts: Resort[];
  /** Registered webhooks (no secrets) — absent on a pre-migration-023 read. */
  destinations?: DestinationView[];
  /** This subscriber's Atom / iCal feed URLs. */
  feeds?: ManageFeeds;
}

export function AlertManagePage({ token, email, preferences, resorts, destinations = [], feeds }: Props) {
  // Build initial state from existing prefs
  const initSelected = new Set(preferences.map((p) => p.resort_id));
  const initThresholds = Object.fromEntries(
    preferences.map((p) => [p.resort_id, p.threshold_inches])
  );

  const [selected, setSelected] = useState<Set<string>>(initSelected);
  const [thresholds, setThresholds] = useState<Record<string, number>>(initThresholds);
  // Stored per row, offered as one switch: "on" if any followed resort has it.
  const [openingAlerts, setOpeningAlerts] = useState(() => preferences.some((p) => p.opening_day === true));
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [unsubscribed, setUnsubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fire ALERT_CONFIRMED once per session & token — by the time this component
  // renders, the token has already been validated server-side.
  useEffect(() => {
    // No token fragment in the properties: the sanitizer exists to keep the
    // manage_token out of analytics, and a prefix is pointless anyway.
    if (shouldTrackConfirmed(token)) {
      track(EVENTS.ALERT_CONFIRMED);
    }

    // The manage_token is a non-expiring bearer capability (read this
    // subscriber's email, rewrite their alerts, delete the subscription). It
    // has now been consumed — the component holds it in the `token` prop for
    // the rest of the session — so drop it from the address bar before it ends
    // up in a screenshot, a shared link, or browser history. Note the cost:
    // app/alerts/manage/page.tsx redirects to /alerts whenever the token is
    // absent, so ANY revisit of the stripped URL — reload, back-navigation,
    // bookmark — lands on the signup page and the user has to re-open the link
    // from their email. That is
    // the intended trade; exchanging the token for a short-lived cookie on
    // first use is the durable fix.
    if (window.location.search) {
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname
      );
    }
  }, [token]);

  const filteredResorts = resorts.filter(
    (r) =>
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.state.toLowerCase().includes(search.toLowerCase())
  );

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
    setSaved(false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch("/api/alerts/manage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          resort_ids: [...selected],
          thresholds: Object.fromEntries(
            [...selected].map((id) => [id, thresholds[id] ?? 6])
          ),
          opening_alerts: openingAlerts,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error ?? "Failed to save");
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const toggleOpeningAlerts = (checked: boolean) => {
    setOpeningAlerts(checked);
    setSaved(false);
    if (checked) track(EVENTS.OPENING_ALERT_SELECTED, { slugs_count: selected.size, source: "alerts_manage" });
  };

  const handleUnsubscribe = async () => {
    if (!confirm("Unsubscribe from all powder alerts? This can't be undone.")) return;
    setUnsubscribing(true);
    setError(null);
    try {
      const resp = await fetch(`/api/alerts/unsubscribe?token=${encodeURIComponent(token)}`, {
        method: "DELETE",
      });
      if (!resp.ok) throw new Error("Failed to unsubscribe");
      setUnsubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setUnsubscribing(false);
    }
  };

  if (unsubscribed) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-8">
        <div className="max-w-md rounded-[18px] border-[1.5px] border-ink bg-cream-50 p-8 text-center shadow-stamp">
          <BellOff size={48} className="text-bark mx-auto mb-6" />
          <h1 className="font-display text-2xl font-bold text-ink mb-3">Unsubscribed</h1>
          <p className="text-bark-dk mb-6">
            You've been removed from all powder alerts. No more emails.
          </p>
          <Link href="/" className="text-forest font-bold hover:underline text-sm">
            Back to PeakCam
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <div className="border-b-[1.5px] border-ink bg-cream-50/90 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Link href="/" className="font-display italic font-black text-lg tracking-tight text-ink">
            Peak<span className="text-alpen">Cam</span>
          </Link>
          <span className="text-bark text-sm truncate">{email}</span>
        </div>
      </div>

      <main id="main-content" className="max-w-2xl mx-auto px-4 py-10">
        {/* Title */}
        <div className="flex items-center gap-3 mb-2">
          <Bell size={24} className="text-forest" />
          <h1 className="font-display text-2xl font-black text-ink">Powder Alert Settings</h1>
        </div>
        <p className="text-bark-dk text-sm mb-8">
          You'll get an email when a resort you follow hits your snow threshold,
          including when the forecast reaches it up to a week ahead. Currently tracking <strong className="text-ink">{selected.size}</strong> resort{selected.size !== 1 ? "s" : ""}.
        </p>

        {/* Resort search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter resorts..."
          className="w-full px-4 py-2.5 bg-cream-50 border-[1.5px] border-ink rounded-full text-ink
                     placeholder:text-bark outline-none focus:border-alpen-dk mb-4 text-[16px] md:text-sm"
        />

        {/* Resort list */}
        <div className="space-y-2 mb-8">
          {filteredResorts.map((resort) => {
            const isOn = selected.has(resort.id);
            const threshold = thresholds[resort.id] ?? 6;
            return (
              <div
                key={resort.id}
                className={`rounded-[14px] border-[1.5px] transition-colors duration-150 ${
                  isOn
                    ? "bg-forest/10 border-forest"
                    : "bg-cream-50 border-ink/25 hover:border-ink"
                }`}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => toggleResort(resort.id)}
                    className={`w-5 h-5 rounded border-[1.5px] flex-shrink-0 flex items-center justify-center transition-colors ${
                      isOn
                        ? "bg-forest border-ink"
                        : "border-ink/40 hover:border-ink"
                    }`}
                    aria-label={isOn ? `Remove ${resort.name}` : `Add ${resort.name}`}
                  >
                    {isOn && <Check size={12} className="text-cream-50" strokeWidth={3} />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm truncate ${isOn ? "text-ink" : "text-bark-dk"}`}>
                      {resort.name}
                    </p>
                    <p className="text-bark text-xs">{resort.region}, {resort.state}</p>
                  </div>

                  {/* Threshold selector — only visible when selected */}
                  {isOn && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-bark text-xs">Alert at</span>
                      <select
                        value={threshold}
                        onChange={(e) => {
                          setThresholds((t) => ({
                            ...t,
                            [resort.id]: Number(e.target.value),
                          }));
                          setSaved(false);
                        }}
                        className="bg-cream-dk border border-ink/40 rounded px-2 py-1
                                   text-ink text-xs outline-none focus:border-ink"
                      >
                        {/* The shared picker list, plus this subscriber's own value
                            when it came from outside it (the API clamps to 1–48) —
                            a controlled select with no matching option would
                            silently show the first one and "Save" would overwrite
                            the threshold they chose. */}
                        {thresholdOptionsFor(threshold).map((n) => (
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
            <p className="text-bark text-sm text-center py-8">No resorts match your search.</p>
          )}
        </div>

        {/* Opening-day mail — one switch for every followed resort */}
        <label
          htmlFor="manage-opening-alerts"
          className="flex items-start gap-3 rounded-[14px] border-[1.5px] border-ink bg-cream-50 px-4 py-3 mb-8 cursor-pointer shadow-stamp-sm"
        >
          <input
            id="manage-opening-alerts"
            type="checkbox"
            checked={openingAlerts}
            onChange={(e) => toggleOpeningAlerts(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-forest"
          />
          <span className="text-sm text-ink">
            <span className="font-medium">Also email me the morning a selected resort opens</span>
            <span className="block text-xs text-bark mt-0.5">
              One note on opening day, once the resort confirms its date. Applies to every resort you follow.{" "}
              <Link href="/opening-dates" className="text-forest font-semibold hover:underline">See opening dates</Link>
            </span>
          </span>
        </label>

        {/* Webhooks + feeds: saved immediately through their own API calls,
            independent of the resort list's Save button. */}
        <AlertDestinations token={token} initialDestinations={destinations} feeds={feeds} />

        {error && (
          <p className="text-alpen-dk font-medium text-sm mb-4">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={handleUnsubscribe}
            disabled={unsubscribing}
            className="flex items-center gap-2 text-bark hover:text-alpen-dk text-sm
                       px-2 py-2 pointer-coarse:min-h-11 transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} />
            {unsubscribing ? "Unsubscribing..." : "Unsubscribe from all alerts"}
          </button>

          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`flex items-center gap-2 px-5 py-2.5 min-h-11 rounded-full border-[1.5px] border-ink text-sm font-bold shadow-stamp-sm
                        transition-colors disabled:opacity-60 ${
                          saved
                            ? "bg-forest/15 text-forest"
                            : "bg-forest text-cream-50 hover:bg-forest-dk"
                        }`}
          >
            {saving ? (
              <><Loader2 size={14} className="motion-safe:animate-spin" /> Saving...</>
            ) : saved ? (
              <><Check size={14} /> Saved</>
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </main>
    </div>
  );
}
