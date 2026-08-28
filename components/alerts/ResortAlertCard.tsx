"use client";

// Single-resort powder-alert signup, for the resort detail page.
//
// The only way to subscribe used to be the multi-resort modal on the browse
// page, so a reader who arrived on /resorts/<slug> from search — the way most
// of this page's traffic arrives — had no way to ask for alerts about the
// mountain they were actually looking at. This is that entry point: the resort
// is already chosen, so it collects a threshold and an address and nothing
// else, and posts to the same /api/alerts/subscribe the modal uses.
//
// Built on the pc-*/poster tokens rather than the legacy alias layer.

import { useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { track, EVENTS } from "@/lib/analytics-events";

interface Props {
  resortId: string;
  resortName: string;
  resortSlug: string;
}

const THRESHOLD_OPTIONS = [3, 6, 12, 18, 24];

export function ResortAlertCard({ resortId, resortName, resortSlug }: Props) {
  const [email, setEmail] = useState("");
  const [threshold, setThreshold] = useState(6);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/alerts/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          resort_ids: [resortId],
          thresholds: { [resortId]: threshold },
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Something went wrong");

      track(EVENTS.ALERT_SIGNUP_SUBMITTED, {
        resort_slugs: [resortSlug],
        resort_count: 1,
        thresholds: { [resortId]: threshold },
        source: "resort_page",
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="pc-on-ink flex items-start gap-4 px-6 py-5 bg-forest text-cream-50
                      border-[1.5px] border-ink rounded-[18px] shadow-stamp">
        <div className="w-9 h-9 shrink-0 rounded-full bg-cream-50/15 border border-cream-50/30
                        flex items-center justify-center">
          <Check size={18} strokeWidth={3} />
        </div>
        <div>
          <p className="font-display font-black text-lg leading-tight">Check your inbox.</p>
          {/* Same wording whether or not this address was already subscribed —
              the endpoint deliberately will not say which, and neither can we. */}
          <p className="text-cream-50/80 text-sm mt-1">
            We&apos;ve emailed <strong className="text-cream-50">{email}</strong> a link to confirm
            and manage your alerts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="pc-on-ink px-6 py-5 bg-forest text-cream-50 border-[1.5px] border-ink
                 rounded-[18px] shadow-stamp"
    >
      <div className="flex items-center gap-2 mb-1">
        <Bell size={16} className="text-mustard" />
        <p className="font-display font-black text-lg leading-tight">
          Get a heads-up when <em className="text-mustard italic">{resortName}</em> scores.
        </p>
      </div>
      <p className="text-cream-50/80 text-sm mb-4">
        One email when new snow clears your threshold. No account, no passwords.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        <label className="flex items-center gap-2 text-sm shrink-0">
          <span className="text-cream-50/80">Alert me at</span>
          <select
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            aria-label={`Snow threshold for ${resortName}`}
            className="bg-cream-50 text-ink border-[1.5px] border-ink rounded-[10px]
                       px-2.5 py-2 pointer-coarse:min-h-11 font-mono text-sm font-semibold outline-none"
          >
            {THRESHOLD_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}&quot;</option>
            ))}
          </select>
        </label>

        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          placeholder="your@email.com"
          autoComplete="email"
          inputMode="email"
          aria-label="Email address"
          className="flex-1 min-w-0 px-4 py-2 pointer-coarse:min-h-11 bg-cream-50 text-ink
                     border-[1.5px] border-ink rounded-[10px] text-[16px] sm:text-sm
                     placeholder:text-bark outline-none"
        />

        <button
          type="submit"
          disabled={submitting}
          className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2
                     pointer-coarse:min-h-11 bg-mustard text-ink border-[1.5px] border-ink
                     rounded-[10px] font-semibold text-sm shadow-stamp-sm
                     hover:shadow-stamp hover:-translate-x-[1px] hover:-translate-y-[1px]
                     transition-[transform,box-shadow] duration-100
                     disabled:opacity-60 disabled:translate-x-0 disabled:translate-y-0"
        >
          {submitting ? (
            <><Loader2 size={14} className="animate-spin" /> Setting up…</>
          ) : (
            "Alert me"
          )}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-mustard text-sm mt-3 font-medium">{error}</p>
      )}
    </form>
  );
}
