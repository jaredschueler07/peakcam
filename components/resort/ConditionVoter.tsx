"use client";

import { useState, useEffect, useCallback } from "react";
import type { SnowQuality, ComfortLevel, LiveConditions } from "@/lib/types";

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  resortId: string;
  liveConditions: LiveConditions | null;
}

// ── Option maps ──────────────────────────────────────────────────────────────

const snowOptions: { value: SnowQuality; label: string; icon: string }[] = [
  { value: "powder", label: "Powder", icon: "🤩" },
  { value: "packed", label: "Packed", icon: "👍" },
  { value: "crud",   label: "Crud",   icon: "😬" },
  { value: "ice",    label: "Ice",    icon: "🧊" },
  { value: "spring", label: "Spring", icon: "🌞" },
];

const comfortOptions: { value: ComfortLevel; label: string; icon: string }[] = [
  { value: "warm",     label: "Warm",     icon: "☀️" },
  { value: "perfect",  label: "Perfect",  icon: "😎" },
  { value: "cold",     label: "Cold",     icon: "🥶" },
  { value: "freezing", label: "Freezing", icon: "❄️" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("peakcam_session");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("peakcam_session", id);
  }
  return id;
}

function freshnessLabel(votes: number): string {
  if (votes >= 20) return "Very active";
  if (votes >= 10) return "Active";
  if (votes >= 3) return "Some reports";
  return "Few reports";
}

function freshnessColor(votes: number): string {
  if (votes >= 20) return "bg-cyan";
  if (votes >= 10) return "bg-good";
  if (votes >= 3) return "bg-fair";
  return "bg-text-muted";
}

// ── Component ────────────────────────────────────────────────────────────────

export function ConditionVoter({ resortId, liveConditions }: Props) {
  const [snow, setSnow] = useState<SnowQuality | null>(null);
  const [comfort, setComfort] = useState<ComfortLevel | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    setSessionId(getSessionId());
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!snow && !comfort) return;
    if (!sessionId) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/conditions/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resort_id: resortId,
          session_id: sessionId,
          snow_quality: snow,
          comfort,
        }),
      });

      if (res.status === 429) {
        setError("Easy there — you already submitted a report recently. Try again later.");
        return;
      }

      if (!res.ok) {
        setError("Something went wrong. Try again in a moment.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }, [snow, comfort, sessionId, resortId]);

  const hasSelection = snow !== null || comfort !== null;

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {/* Header */}
      <h3 className="font-heading text-lg font-semibold uppercase tracking-wider text-text-base mb-1">
        How&apos;s it skiing?
      </h3>

      {/* Live aggregated conditions */}
      {liveConditions && liveConditions.total_votes_12h > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${freshnessColor(liveConditions.total_votes_12h)}`} />
          <span className="text-text-subtle text-xs">
            {liveConditions.total_votes_12h} skier{liveConditions.total_votes_12h !== 1 ? "s" : ""} report
            {liveConditions.total_votes_12h === 1 ? "s" : ""}:
            {liveConditions.top_snow_quality && (
              <span className="text-cyan font-semibold ml-1">
                {snowOptions.find((o) => o.value === liveConditions.top_snow_quality)?.icon}{" "}
                {liveConditions.top_snow_quality.charAt(0).toUpperCase() + liveConditions.top_snow_quality.slice(1)}
              </span>
            )}
            {liveConditions.top_snow_quality && liveConditions.top_comfort && " · "}
            {liveConditions.top_comfort && (
              <span className="text-powder font-semibold">
                {comfortOptions.find((o) => o.value === liveConditions.top_comfort)?.icon}{" "}
                {liveConditions.top_comfort.charAt(0).toUpperCase() + liveConditions.top_comfort.slice(1)}
              </span>
            )}
          </span>
          <span className="text-text-muted text-[10px] ml-auto whitespace-nowrap">
            {freshnessLabel(liveConditions.total_votes_12h)}
          </span>
        </div>
      )}

      {/* Success state */}
      {submitted ? (
        <div className="flex items-center gap-2 bg-cyan-dim border border-cyan/20 rounded-lg px-4 py-3 mt-2">
          <span className="w-2 h-2 rounded-full bg-cyan flex-shrink-0" />
          <span className="text-cyan text-sm font-medium">Thanks! Your report has been submitted.</span>
        </div>
      ) : (
        <>
          {/* Snow quality row */}
          <div className="mb-3">
            <p className="text-text-muted text-xs font-medium mb-2">Snow Quality</p>
            <div className="flex flex-wrap gap-1.5">
              {snowOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSnow(snow === opt.value ? null : opt.value)}
                  className={`
                    inline-flex items-center gap-1.5 rounded-full px-3 py-1
                    text-xs font-semibold border cursor-pointer select-none
                    transition-all duration-[220ms] whitespace-nowrap
                    ${snow === opt.value
                      ? "border-cyan/30 bg-cyan-dim text-cyan"
                      : "border-border bg-surface2 text-text-muted hover:border-border-hi hover:text-text-subtle"}
                  `}
                >
                  <span className="text-sm leading-none">{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Comfort row */}
          <div className="mb-4">
            <p className="text-text-muted text-xs font-medium mb-2">Comfort</p>
            <div className="flex flex-wrap gap-1.5">
              {comfortOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setComfort(comfort === opt.value ? null : opt.value)}
                  className={`
                    inline-flex items-center gap-1.5 rounded-full px-3 py-1
                    text-xs font-semibold border cursor-pointer select-none
                    transition-all duration-[220ms] whitespace-nowrap
                    ${comfort === opt.value
                      ? "border-cyan/30 bg-cyan-dim text-cyan"
                      : "border-border bg-surface2 text-text-muted hover:border-border-hi hover:text-text-subtle"}
                  `}
                >
                  <span className="text-sm leading-none">{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-poor text-xs font-medium mb-3">{error}</p>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!hasSelection || submitting}
            className={`
              w-full rounded-lg px-4 py-2.5 text-sm font-semibold
              border transition-all duration-[220ms]
              ${hasSelection && !submitting
                ? "bg-cyan-dim border-cyan/30 text-cyan hover:bg-cyan/20 cursor-pointer"
                : "bg-surface2 border-border text-text-muted cursor-not-allowed"}
            `}
          >
            {submitting ? "Submitting..." : "Submit Report"}
          </button>
        </>
      )}
    </div>
  );
}
