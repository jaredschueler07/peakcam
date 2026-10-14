"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

interface Props {
  onClose: () => void;
  redirectTo?: string;
}

// Poster auth modal — ink backdrop, cream card, alpen submit button, stamp shadows
export function AuthModal({ onClose, redirectTo }: Props) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const callbackUrl = `${window.location.origin}/auth/callback${redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : ""}`;

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callbackUrl },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 backdrop-blur-sm p-4 animate-fadeIn"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-cream-50 border-[1.5px] border-ink rounded-[18px] shadow-stamp-lg p-6 w-full max-w-sm animate-slideUp">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="pc-eyebrow mb-1" style={{ color: "var(--pc-bark)" }}>
              Sign in
            </div>
            <h2 className="font-display font-black text-ink text-2xl leading-[0.95] tracking-[-0.02em]">
              Got the <em className="text-alpen italic font-bold">goods?</em>
            </h2>
            <p className="text-bark text-xs mt-1">Share the report with your crew.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full
                       bg-cream-50 text-ink border-[1.5px] border-ink shadow-stamp-sm
                       hover:shadow-stamp hover:bg-alpen hover:text-cream-50 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {sent ? (
          // Success state — forest stamp
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-forest text-cream-50 border-[1.5px] border-ink shadow-stamp flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="font-display font-black text-ink text-lg leading-tight">Check your email.</p>
            <p className="text-bark text-[13px] mt-2 leading-relaxed">
              Magic link sent to <span className="font-mono font-bold text-ink">{email}</span>.<br />
              Click it to sign in — no password required.
            </p>
          </div>
        ) : (
          // Email form
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="auth-email" className="pc-eyebrow block mb-2" style={{ color: "var(--pc-bark)", fontSize: 11 }}>
                Email address
              </label>
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                className="w-full bg-snow text-ink placeholder:text-bark
                           border-[1.5px] border-ink rounded-full shadow-stamp-sm
                           px-4 py-2.5 text-[14px] font-medium
                           focus:shadow-[3px_3px_0_#a93f20] focus:border-alpen-dk
                           outline-none transition-shadow duration-100"
              />
            </div>

            {error && (
              <p className="text-poor text-[12px] font-semibold">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className={`
                w-full rounded-full px-4 py-3 min-h-[44px] text-[14px] font-bold
                border-[1.5px] border-ink transition-[transform,box-shadow] duration-100
                ${!loading && email.trim()
                  ? "bg-alpen text-cream-50 shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px] cursor-pointer"
                  : "bg-cream border-bark text-bark cursor-not-allowed shadow-none"}
              `}
            >
              {loading ? "Sending…" : "Send magic link"}
            </button>

            <p className="font-mono text-[10.5px] text-bark text-center uppercase tracking-[0.1em]">
              One-click sign-in · no password
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
