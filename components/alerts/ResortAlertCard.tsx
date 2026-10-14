"use client";

// Single-resort powder-alert signup for the resort detail page.
//
// The multi-resort picker lives on /alerts, but most readers land on
// /resorts/<slug> from search and never see it. Here the resort is already
// chosen, so this collects a threshold and an address and nothing else, and
// posts to the same /api/alerts/subscribe the picker uses.

import { useId, useState } from "react";
import Link from "next/link";
import { Bell, Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { track, EVENTS } from "@/lib/analytics-events";

interface Props {
  resortId: string;
  resortName: string;
  resortSlug: string;
}

const THRESHOLD_OPTIONS = [3, 6, 12, 18, 24];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const card =
  "bg-cream-50 border-[1.5px] border-ink rounded-[18px] shadow-stamp p-5 md:p-6";
const control =
  "w-full min-h-11 px-3 py-2 bg-snow text-ink border-[1.5px] border-ink rounded-[10px] " +
  "text-[16px] md:text-sm placeholder:text-bark";

function ManageLink() {
  return (
    <Link
      href="/alerts"
      className="inline-flex items-center py-2 pointer-coarse:min-h-11 text-sm font-semibold text-forest underline"
    >
      Manage all alerts
    </Link>
  );
}

export function ResortAlertCard({ resortId, resortName, resortSlug }: Props) {
  const ids = useId();
  const [email, setEmail] = useState("");
  const [threshold, setThreshold] = useState(6);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!EMAIL_RE.test(address)) {
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
          email: address,
          resort_ids: [resortId],
          thresholds: { [resortId]: threshold },
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((data as { error?: string }).error ?? "Something went wrong");

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
      <div role="status" className={`${card} flex items-start gap-3`}>
        <span className="shrink-0 w-9 h-9 rounded-full bg-forest text-cream-50 border-[1.5px] border-ink flex items-center justify-center">
          <Check size={18} strokeWidth={3} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          {/* Wording is deliberately the same whether or not this address was
              already subscribed — the endpoint cannot tell the caller which it
              was without leaking who has an account. */}
          <h2 className="font-display font-black text-xl leading-tight text-ink">Check your inbox</h2>
          <p className="text-bark text-sm mt-1 leading-relaxed">
            We&apos;ve emailed <strong className="text-ink break-all">{email.trim()}</strong> a link to
            confirm and manage your powder alerts. If that address is already subscribed,
            the link lets you change what you follow.
          </p>
          <ManageLink />
        </div>
      </div>
    );
  }

  return (
    <div className={card}>
      <div className="flex items-start gap-3">
        <span className="shrink-0 mt-0.5 w-9 h-9 rounded-full bg-forest text-cream-50 border-[1.5px] border-ink flex items-center justify-center">
          <Bell size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display font-black text-xl leading-tight text-ink">
            Powder alerts for {resortName}
          </h2>
          <p className="text-bark text-sm mt-1">
            One email when new snow clears your threshold. No account needed.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="mt-4 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end"
      >
        <div>
          <label htmlFor={`${ids}-threshold`} className="pc-eyebrow block mb-1.5">
            New snow threshold
          </label>
          {/* WebKit's default `menulist` select ignores min-height, so the
              picker needs appearance-none (and its own chevron) to reach 44px. */}
          <div className="relative sm:w-auto">
            <select
              id={`${ids}-threshold`}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className={`${control} appearance-none pr-9 font-mono font-semibold`}
            >
              {THRESHOLD_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}&quot;</option>
              ))}
            </select>
            <ChevronDown
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink"
            />
          </div>
        </div>

        <div className="min-w-0">
          <label htmlFor={`${ids}-email`} className="pc-eyebrow block mb-1.5">
            Email
          </label>
          <input
            id={`${ids}-email`}
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); }}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
            className={control}
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={submitting}
          className="min-h-11 w-full sm:w-auto"
        >
          {submitting ? (
            <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Setting up…</>
          ) : (
            "Alert me"
          )}
        </Button>
      </form>

      {error && (
        <p id={`${ids}-error`} role="alert" className="text-alpen-dk text-sm font-medium mt-3">
          {error}
        </p>
      )}

      <p className="text-bark text-xs mt-3">
        No passwords — unsubscribe anytime from the link in every email.
      </p>
      <ManageLink />
    </div>
  );
}
