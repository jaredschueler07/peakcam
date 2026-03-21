"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

interface Props {
  onClose: () => void;
  redirectTo?: string;
}

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-text-base">
              Sign In
            </h2>
            <p className="text-text-muted text-xs mt-0.5">to submit a conditions report</p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-base transition-colors p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {sent ? (
          // Success state
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-cyan/10 border border-cyan/30 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-text-base font-semibold text-sm mb-1">Check your email</p>
            <p className="text-text-muted text-xs">
              We sent a magic link to <span className="text-text-subtle">{email}</span>.
              Click it to sign in — no password needed.
            </p>
          </div>
        ) : (
          // Email form
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="auth-email" className="block text-text-muted text-xs font-medium mb-1.5">
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
                className="w-full bg-surface2 border border-border rounded-lg
                  px-3 py-2.5 text-sm text-text-base placeholder:text-text-muted
                  outline-none transition-all duration-[220ms]
                  focus:border-cyan focus:bg-surface3"
              />
            </div>

            {error && (
              <p className="text-poor text-xs font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className={`
                w-full rounded-lg px-4 py-3 min-h-[44px] text-sm font-semibold
                border transition-all duration-[220ms]
                ${!loading && email.trim()
                  ? "bg-cyan-dim border-cyan/30 text-cyan hover:bg-cyan/20 cursor-pointer"
                  : "bg-surface2 border-border text-text-muted cursor-not-allowed"}
              `}
            >
              {loading ? "Sending…" : "Send Magic Link"}
            </button>

            <p className="text-text-muted text-[11px] text-center">
              We&apos;ll email you a one-click sign-in link. No password needed.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
