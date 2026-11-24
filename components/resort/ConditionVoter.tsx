"use client";

import { useState, useEffect, useCallback } from "react";
import { 
  CloudSnow, 
  CheckCircle2, 
  Activity, 
  IceCream, 
  Sun,
  Flame,
  Smile,
  Thermometer,
  Snowflake
} from "lucide-react";
import type { SnowQuality, ComfortLevel, LiveConditions } from "@/lib/types";
import { track, EVENTS } from "@/lib/analytics-events";

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  resortId: string;
  resortSlug: string;
  liveConditions: LiveConditions | null;
}

// ── Option maps ──────────────────────────────────────────────────────────────

const snowOptions: { value: SnowQuality; label: string; icon: any }[] = [
  { value: "powder", label: "Powder", icon: CloudSnow },
  { value: "packed", label: "Packed", icon: CheckCircle2 },
  { value: "crud",   label: "Crud",   icon: Activity },
  { value: "ice",    label: "Ice",    icon: IceCream },
  { value: "spring", label: "Spring", icon: Sun },
];

const comfortOptions: { value: ComfortLevel; label: string; icon: any }[] = [
  { value: "warm",     label: "Warm",     icon: Flame },
  { value: "perfect",  label: "Perfect",  icon: Smile },
  { value: "cold",     label: "Cold",     icon: Thermometer },
  { value: "freezing", label: "Freezing", icon: Snowflake },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id: string | null = null;
  try {
    id = localStorage.getItem("peakcam_session");
  } catch {
    id = null;
  }
  if (!id) {
    // crypto.randomUUID() is only available in secure contexts (HTTPS or localhost).
    // Fall back to a Math.random-based UUIDv4 for LAN IP testing — this is just
    // an anonymous session id, no crypto guarantees required.
    id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
    try {
      localStorage.setItem("peakcam_session", id);
    } catch {
      /* private browsing / disabled storage — keep in-memory session id */
    }
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
  if (votes >= 20) return "bg-forest";
  if (votes >= 10) return "bg-good";
  if (votes >= 3) return "bg-fair";
  return "bg-bark";
}

// ── Component ────────────────────────────────────────────────────────────────

export function ConditionVoter({ resortId, resortSlug, liveConditions }: Props) {
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
      track(EVENTS.CONDITION_VOTED, {
        resort_slug: resortSlug,
        snow_quality: snow,
        comfort,
      });
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }, [snow, comfort, sessionId, resortId, resortSlug]);

  const hasSelection = snow !== null || comfort !== null;

  return (
    <div className="bg-cream-50 border border-ink/20 rounded-xl p-5">
      {/* Header */}
      <h3 className="font-heading text-lg font-semibold uppercase tracking-wider text-ink mb-0.5">
        Quick Conditions Vote
      </h3>
      <p className="text-bark text-xs mb-3">Anonymous — no sign-in required.</p>

      {/* Live aggregated conditions */}
      {liveConditions && liveConditions.total_votes_12h > 0 && (
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${freshnessColor(liveConditions.total_votes_12h)}`} />
          <span className="text-bark-dk text-xs">
            {liveConditions.total_votes_12h} skier{liveConditions.total_votes_12h !== 1 ? "s" : ""} report
            {liveConditions.total_votes_12h === 1 ? "s" : ""}:
            {liveConditions.top_snow_quality && (
              <span className="text-forest font-semibold ml-1 inline-flex items-center gap-1">
                {(() => {
                  const Icon = snowOptions.find((o) => o.value === liveConditions.top_snow_quality)?.icon;
                  return Icon ? <Icon size={14} /> : null;
                })()}
                {liveConditions.top_snow_quality.charAt(0).toUpperCase() + liveConditions.top_snow_quality.slice(1)}
              </span>
            )}
            {liveConditions.top_snow_quality && liveConditions.top_comfort && " · "}
            {liveConditions.top_comfort && (
              <span className="text-forest font-semibold inline-flex items-center gap-1">
                {(() => {
                  const Icon = comfortOptions.find((o) => o.value === liveConditions.top_comfort)?.icon;
                  return Icon ? <Icon size={14} /> : null;
                })()}
                {liveConditions.top_comfort.charAt(0).toUpperCase() + liveConditions.top_comfort.slice(1)}
              </span>
            )}
          </span>
          <span className="text-bark text-[10px] ml-auto whitespace-nowrap">
            {freshnessLabel(liveConditions.total_votes_12h)}
          </span>
        </div>
      )}

      {/* Success state */}
      {submitted ? (
        <div className="flex items-center gap-2 bg-forest/10 border border-forest/25 rounded-lg px-4 py-3 mt-2">
          <span className="w-2 h-2 rounded-full bg-forest flex-shrink-0" />
          <span className="text-forest text-sm font-medium">Thanks! Your report has been submitted.</span>
        </div>
      ) : (
        <>
          {/* Snow quality row */}
          <div className="mb-3">
            <p className="text-bark text-xs font-medium mb-2">Snow Quality</p>
            <div className="flex flex-wrap gap-1.5">
              {snowOptions.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setSnow(snow === opt.value ? null : opt.value)}
                    className={`
                      inline-flex items-center gap-2 rounded-full px-4 py-2.5 min-h-[44px]
                      text-sm font-semibold border cursor-pointer select-none
                      transition-all duration-[220ms] whitespace-nowrap
                      ${snow === opt.value
                        ? "border-forest/40 bg-forest/10 text-forest"
                        : "border-ink/20 bg-cream-dk text-bark hover:border-ink/40 hover:text-ink"}
                    `}
                  >
                    <Icon size={16} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Comfort row */}
          <div className="mb-4">
            <p className="text-bark text-xs font-medium mb-2">Comfort</p>
            <div className="flex flex-wrap gap-1.5">
              {comfortOptions.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setComfort(comfort === opt.value ? null : opt.value)}
                    className={`
                      inline-flex items-center gap-2 rounded-full px-4 py-2.5 min-h-[44px]
                      text-sm font-semibold border cursor-pointer select-none
                      transition-all duration-[220ms] whitespace-nowrap
                      ${comfort === opt.value
                        ? "border-forest/40 bg-forest/10 text-forest"
                        : "border-ink/20 bg-cream-dk text-bark hover:border-ink/40 hover:text-ink"}
                    `}
                  >
                    <Icon size={16} />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-alpen-dk text-xs font-medium mb-3">{error}</p>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!hasSelection || submitting}
            className={`
              w-full rounded-lg px-4 py-3 min-h-[44px] text-sm font-semibold
              border transition-all duration-[220ms]
              ${hasSelection && !submitting
                ? "bg-forest/10 border-forest/35 text-forest hover:bg-forest/20 cursor-pointer"
                : "bg-cream-dk border-ink/20 text-bark cursor-not-allowed"}
            `}
          >
            {submitting ? "Submitting..." : "Submit Report"}
          </button>
        </>
      )}
    </div>
  );
}
