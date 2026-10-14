"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { Bell, BellOff, Check, ChevronDown, Loader2, Trash2 } from "lucide-react";
import { track, EVENTS } from "@/lib/analytics-events";

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
}

interface Props {
  token: string;
  email: string;
  preferences: Preference[];
  resorts: Resort[];
}

const THRESHOLD_OPTIONS = [3, 6, 12, 18, 24];

// 16px at every breakpoint keeps iOS Safari from zooming the page on focus, and
// WebKit's default `menulist` select ignores min-height — hence appearance-none
// plus an explicit chevron to reach the 44px touch target.
const SELECT =
  "min-h-11 min-w-16 appearance-none rounded-md border border-bark bg-cream-50 py-2 pl-2 pr-7 text-[16px] text-ink";

export function AlertManagePage({ token, email, preferences, resorts }: Props) {
  // Build initial state from existing prefs
  const initSelected = new Set(preferences.map((p) => p.resort_id));
  const initThresholds = Object.fromEntries(
    preferences.map((p) => [p.resort_id, p.threshold_inches])
  );

  const [selected, setSelected] = useState<Set<string>>(initSelected);
  const [thresholds, setThresholds] = useState<Record<string, number>>(initThresholds);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [unsubscribed, setUnsubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // ALERT_CONFIRMED is the funnel's step 3 and must count each subscription
    // once. Every alert email links here too, so gate it on the `confirmed=1`
    // marker that only the welcome email's link carries, not on mount.
    const params = new URLSearchParams(window.location.search);
    if (params.get("confirmed") === "1") {
      track(EVENTS.ALERT_CONFIRMED, { token: token.slice(0, 8) });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="flex min-h-screen items-center justify-center bg-cream p-8">
        <div className="max-w-md text-center">
          <BellOff size={48} className="mx-auto mb-6 text-bark" />
          <h1 className="mb-3 font-display text-2xl font-bold text-ink">Unsubscribed</h1>
          <p className="mb-6 text-bark-dk">
            You've been removed from all powder alerts. No more emails.
          </p>
          <Link href="/" className="text-sm font-semibold text-forest hover:underline">
            Back to PeakCam
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-ink/15 bg-cream-50/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <Link href="/" className="font-display text-lg font-black tracking-wider text-forest">PEAKCAM</Link>
          <span className="text-sm text-bark">{email}</span>
        </div>
      </div>

      <main id="main-content" className="mx-auto max-w-2xl px-4 py-10">
        {/* Title */}
        <div className="mb-2 flex items-center gap-3">
          <Bell size={24} className="text-forest" />
          <h1 className="font-display text-2xl font-bold text-ink">Powder Alert Settings</h1>
        </div>
        <p className="mb-8 text-sm text-bark-dk">
          You'll get an email when a resort you follow hits your snow threshold,
          including when the forecast reaches it up to a week ahead. Currently tracking <strong className="text-ink">{selected.size}</strong> resort{selected.size !== 1 ? "s" : ""}.
        </p>

        {/* Resort search — 16px so iOS Safari does not zoom the page on focus */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter resorts..."
          aria-label="Filter resorts"
          className="mb-4 min-h-11 w-full rounded-lg border border-bark bg-cream-50 px-4 py-2.5
                     text-[16px] text-ink placeholder:text-bark"
        />

        {/* Resort list */}
        <ul className="mb-8 space-y-2">
          {filteredResorts.map((resort) => {
            const isOn = selected.has(resort.id);
            return (
              <li
                key={resort.id}
                className={`flex items-center gap-2 rounded-lg border py-1 pl-1 pr-3 transition-colors duration-150 ${
                  isOn ? "border-forest bg-forest/5" : "border-ink/15 bg-cream-50 hover:border-ink/30"
                }`}
              >
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
                    <span className="block text-xs text-bark">{resort.region}, {resort.state}</span>
                  </span>
                </button>

                {/* Threshold selector — only visible when selected */}
                {isOn && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span aria-hidden="true" className="text-xs text-bark">Alert at</span>
                    <span className="relative flex items-center">
                      <select
                        value={thresholds[resort.id] ?? 6}
                        onChange={(e) => {
                          setThresholds((t) => ({
                            ...t,
                            [resort.id]: Number(e.target.value),
                          }));
                          setSaved(false);
                        }}
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
            <li className="py-8 text-center text-sm text-bark">No resorts match your search.</li>
          )}
        </ul>

        {error && (
          <p className="mb-4 text-sm text-alpen-dk" role="alert">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleUnsubscribe}
            disabled={unsubscribing}
            className="flex min-h-11 items-center gap-2 px-2 py-2 text-sm text-bark
                       transition-colors hover:text-alpen-dk disabled:opacity-50"
          >
            <Trash2 size={14} />
            {unsubscribing ? "Unsubscribing..." : "Unsubscribe from all alerts"}
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || saved}
            className={`flex min-h-11 items-center gap-2 rounded-full border-[1.5px] px-5 py-2.5 text-sm font-semibold
                        transition-colors disabled:opacity-60 ${
                          saved
                            ? "border-forest bg-forest/10 text-forest"
                            : "border-ink bg-forest text-cream-50 shadow-stamp-sm hover:bg-forest-dk"
                        }`}
          >
            {saving ? (
              <><Loader2 size={14} className="animate-spin" /> Saving...</>
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
