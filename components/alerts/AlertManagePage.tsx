"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { Bell, BellOff, Check, Loader2, Trash2 } from "lucide-react";
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

  // Fire ALERT_CONFIRMED once on mount — by the time this component renders,
  // the token has already been validated server-side and preferences loaded.
  useEffect(() => {
    track(EVENTS.ALERT_CONFIRMED, { token: token.slice(0, 8) });
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
      <div className="min-h-screen bg-bg flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <BellOff size={48} className="text-text-muted mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-text-base mb-3">Unsubscribed</h1>
          <p className="text-text-subtle mb-6">
            You've been removed from all powder alerts. No more emails.
          </p>
          <Link href="/" className="text-cyan hover:underline text-sm">
            Back to PeakCam
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div className="border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-cyan font-bold text-lg tracking-wider">PEAKCAM</Link>
          <span className="text-text-muted text-sm">{email}</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        {/* Title */}
        <div className="flex items-center gap-3 mb-2">
          <Bell size={24} className="text-cyan" />
          <h1 className="text-2xl font-bold text-text-base">Powder Alert Settings</h1>
        </div>
        <p className="text-text-subtle text-sm mb-8">
          You'll get an email when a resort you follow hits your snow threshold.
          Currently tracking <strong className="text-text-base">{selected.size}</strong> resort{selected.size !== 1 ? "s" : ""}.
        </p>

        {/* Resort search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter resorts..."
          className="w-full px-4 py-2.5 bg-surface border border-border rounded-lg text-text-base
                     placeholder:text-text-muted outline-none focus:border-cyan/50 mb-4 text-sm"
        />

        {/* Resort list */}
        <div className="space-y-2 mb-8">
          {filteredResorts.map((resort) => {
            const isOn = selected.has(resort.id);
            return (
              <div
                key={resort.id}
                className={`rounded-lg border transition-colors duration-150 ${
                  isOn
                    ? "bg-cyan/5 border-cyan/30"
                    : "bg-surface border-border hover:border-border-hi"
                }`}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => toggleResort(resort.id)}
                    className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      isOn
                        ? "bg-cyan border-cyan"
                        : "border-border hover:border-text-muted"
                    }`}
                    aria-label={isOn ? `Remove ${resort.name}` : `Add ${resort.name}`}
                  >
                    {isOn && <Check size={12} className="text-bg" strokeWidth={3} />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm truncate ${isOn ? "text-text-base" : "text-text-subtle"}`}>
                      {resort.name}
                    </p>
                    <p className="text-text-muted text-xs">{resort.region}, {resort.state}</p>
                  </div>

                  {/* Threshold selector — only visible when selected */}
                  {isOn && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-text-muted text-xs">Alert at</span>
                      <select
                        value={thresholds[resort.id] ?? 6}
                        onChange={(e) => {
                          setThresholds((t) => ({
                            ...t,
                            [resort.id]: Number(e.target.value),
                          }));
                          setSaved(false);
                        }}
                        className="bg-surface2 border border-border rounded px-2 py-1
                                   text-text-base text-xs outline-none focus:border-cyan/50"
                      >
                        {THRESHOLD_OPTIONS.map((n) => (
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
            <p className="text-text-muted text-sm text-center py-8">No resorts match your search.</p>
          )}
        </div>

        {error && (
          <p className="text-red-400 text-sm mb-4">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={handleUnsubscribe}
            disabled={unsubscribing}
            className="flex items-center gap-2 text-text-muted hover:text-red-400 text-sm
                       transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} />
            {unsubscribing ? "Unsubscribing..." : "Unsubscribe from all alerts"}
          </button>

          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold
                        transition-colors disabled:opacity-60 ${
                          saved
                            ? "bg-green-500/20 border border-green-500/40 text-green-400"
                            : "bg-cyan text-bg hover:bg-cyan/90"
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
      </div>
    </div>
  );
}
