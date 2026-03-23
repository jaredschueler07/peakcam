"use client";

import { useState, useEffect } from "react";
import { 
  CloudSnow, 
  CheckCircle2, 
  IceCream, 
  Droplets, 
  Sun, 
  CloudFog, 
  EyeOff, 
  Wind, 
  WindArrowDown, 
  Tornado, 
  Navigation,
  Check,
  Mountain,
  Zap,
  Split
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { AuthModal } from "@/components/auth/AuthModal";
import type { User } from "@supabase/supabase-js";
import type { UserSnowQuality, UserVisibility, UserWind, UserTrailConditions } from "@/lib/types";

// ── Option definitions ───────────────────────────────────────

const snowOptions: { value: UserSnowQuality; label: string; icon: any }[] = [
  { value: "powder",  label: "Powder",  icon: CloudSnow },
  { value: "packed",  label: "Packed",  icon: CheckCircle2 },
  { value: "icy",     label: "Icy",     icon: IceCream },
  { value: "slush",   label: "Slush",   icon: Droplets },
];

const visibilityOptions: { value: UserVisibility; label: string; icon: any }[] = [
  { value: "clear",     label: "Clear",     icon: Sun },
  { value: "foggy",     label: "Foggy",     icon: CloudFog },
  { value: "whiteout",  label: "Whiteout",  icon: EyeOff },
];

const windOptions: { value: UserWind; label: string; icon: any }[] = [
  { value: "calm",    label: "Calm",    icon: Navigation },
  { value: "breezy",  label: "Breezy",  icon: Wind },
  { value: "gusty",   label: "Gusty",   icon: WindArrowDown },
  { value: "high",    label: "High",    icon: Tornado },
];

const trailOptions: { value: UserTrailConditions; label: string; icon: any }[] = [
  { value: "groomed",    label: "Groomed",    icon: Check },
  { value: "ungroomed",  label: "Ungroomed",  icon: Mountain },
  { value: "moguls",     label: "Moguls",     icon: Zap },
  { value: "variable",   label: "Variable",   icon: Split },
];

// ── Sub-components ───────────────────────────────────────────

function OptionRow<T extends string>({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { value: T; label: string; icon: any }[];
  selected: T | null;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="mb-3">
      <p className="text-text-muted text-xs font-medium mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(selected === opt.value ? (null as unknown as T) : opt.value)}
              className={`
                inline-flex items-center gap-2 rounded-full px-4 py-2.5 min-h-[44px]
                text-sm font-semibold border cursor-pointer select-none
                transition-all duration-[220ms] whitespace-nowrap
                ${selected === opt.value
                  ? "border-cyan/30 bg-cyan-dim text-cyan"
                  : "border-border bg-surface2 text-text-muted hover:border-border-hi hover:text-text-subtle"}
              `}
            >
              <Icon size={16} />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

interface Props {
  resortId: string;
  resortSlug: string;
  onSubmitted?: () => void;
}

export function UserConditionsForm({ resortId, resortSlug, onSubmitted }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [snow, setSnow] = useState<UserSnowQuality | null>(null);
  const [visibility, setVisibility] = useState<UserVisibility | null>(null);
  const [wind, setWind] = useState<UserWind | null>(null);
  const [trail, setTrail] = useState<UserTrailConditions | null>(null);
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load auth state
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      setLoadingUser(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoadingUser(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!snow || !visibility || !wind || !trail) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/user-conditions/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resort_id: resortId,
          snow_quality: snow,
          visibility,
          wind,
          trail_conditions: trail,
          notes: notes.trim() || null,
        }),
      });

      if (res.status === 401) {
        setShowAuthModal(true);
        return;
      }
      if (res.status === 429) {
        setError("You already submitted a report here recently. Try again in an hour.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Something went wrong. Try again.");
        return;
      }

      setSubmitted(true);
      onSubmitted?.();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const isReady = snow !== null && visibility !== null && wind !== null && trail !== null;

  return (
    <>
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          redirectTo={`/resorts/${resortSlug}`}
        />
      )}

      <div className="bg-surface border border-border rounded-xl p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-heading text-lg font-semibold uppercase tracking-wider text-text-base">
            Submit a Report
          </h3>
          {!loadingUser && user && (
            <div className="flex items-center gap-2">
              <span className="text-text-muted text-[11px] truncate max-w-[140px]">{user.email}</span>
              <button
                onClick={handleSignOut}
                className="text-text-muted hover:text-text-subtle text-[11px] transition-colors underline"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
        <p className="text-text-muted text-xs mb-4">Tell other skiers what it&apos;s like out there today.</p>

        {submitted ? (
          // Success
          <div className="flex items-center gap-2 bg-cyan-dim border border-cyan/20 rounded-lg px-4 py-3">
            <span className="w-2 h-2 rounded-full bg-cyan flex-shrink-0" />
            <span className="text-cyan text-sm font-medium">Thanks! Your report has been submitted.</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-0">
            <OptionRow label="Snow Quality" options={snowOptions} selected={snow} onSelect={(v) => setSnow(v as UserSnowQuality | null)} />
            <OptionRow label="Visibility" options={visibilityOptions} selected={visibility} onSelect={(v) => setVisibility(v as UserVisibility | null)} />
            <OptionRow label="Wind" options={windOptions} selected={wind} onSelect={(v) => setWind(v as UserWind | null)} />
            <OptionRow label="Trail Conditions" options={trailOptions} selected={trail} onSelect={(v) => setTrail(v as UserTrailConditions | null)} />

            {/* Notes */}
            <div className="mb-4 mt-1">
              <p className="text-text-muted text-xs font-medium mb-2">Notes <span className="text-text-muted/60">(optional)</span></p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                placeholder="Anything else riders should know? (e.g. grooming quality, hazards, lift lines)"
                rows={2}
                className="w-full bg-surface2 border border-border rounded-lg
                  px-3 py-2.5 text-sm text-text-base placeholder:text-text-muted
                  outline-none resize-none transition-all duration-[220ms]
                  focus:border-cyan focus:bg-surface3"
              />
              {notes.length > 400 && (
                <p className="text-text-muted text-[11px] mt-1 text-right">{500 - notes.length} chars left</p>
              )}
            </div>

            {error && (
              <p className="text-poor text-xs font-medium mb-3">{error}</p>
            )}

            {/* CTA — prompts auth if not signed in */}
            {!loadingUser && !user ? (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="w-full rounded-lg px-4 py-3 min-h-[44px] text-sm font-semibold
                  bg-cyan-dim border border-cyan/30 text-cyan hover:bg-cyan/20 cursor-pointer
                  transition-all duration-[220ms]"
              >
                Sign in to Submit Report
              </button>
            ) : (
              <button
                type="submit"
                disabled={!isReady || submitting}
                className={`
                  w-full rounded-lg px-4 py-3 min-h-[44px] text-sm font-semibold
                  border transition-all duration-[220ms]
                  ${isReady && !submitting
                    ? "bg-cyan-dim border-cyan/30 text-cyan hover:bg-cyan/20 cursor-pointer"
                    : "bg-surface2 border-border text-text-muted cursor-not-allowed"}
                `}
              >
                {submitting ? "Submitting…" : "Submit Report"}
              </button>
            )}
          </form>
        )}
      </div>
    </>
  );
}
