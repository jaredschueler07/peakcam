"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const urlError = searchParams.get("error");

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    urlError === "auth_failed" ? "Sign-in link expired or invalid. Please try again." : null
  );
  const [signupDone, setSignupDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setLoading(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        router.push(next);
        router.refresh();
      }
    } else {
      const callbackUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: callbackUrl },
      });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        setSignupDone(true);
        setLoading(false);
      }
    }
  }

  if (signupDone) {
    return (
      <div className="text-center py-4">
        <div className="w-14 h-14 rounded-full bg-cyan/10 border border-cyan/30 flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-text-base font-semibold mb-1">Check your email</p>
        <p className="text-text-muted text-sm leading-relaxed">
          We sent a confirmation link to{" "}
          <span className="text-text-subtle">{email}</span>.
          Click it to activate your account.
        </p>
        <button
          onClick={() => { setSignupDone(false); setMode("signin"); }}
          className="mt-5 text-cyan text-sm font-medium hover:underline transition-colors"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Mode tabs */}
      <div className="flex mb-6 bg-surface2 rounded-xl p-1 gap-1">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError(null); }}
            className={`
              flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-[220ms]
              ${mode === m
                ? "bg-surface text-text-base border border-border shadow-sm"
                : "text-text-muted hover:text-text-subtle"}
            `}
          >
            {m === "signin" ? "Sign in" : "Sign up"}
          </button>
        ))}
      </div>

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
            autoComplete="email"
            className="w-full bg-surface2 border border-border rounded-lg
              px-3 py-2.5 text-sm text-text-base placeholder:text-text-muted
              outline-none transition-all duration-[220ms]
              focus:border-cyan focus:bg-surface3"
          />
        </div>

        <div>
          <label htmlFor="auth-password" className="block text-text-muted text-xs font-medium mb-1.5">
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "Min. 6 characters" : "Your password"}
            required
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
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
          disabled={loading || !email.trim() || !password}
          className={`
            w-full rounded-lg px-4 py-3 min-h-[44px] text-sm font-semibold
            border transition-all duration-[220ms]
            ${!loading && email.trim() && password
              ? "bg-cyan-dim border-cyan/30 text-cyan hover:bg-cyan/20 cursor-pointer"
              : "bg-surface2 border-border text-text-muted cursor-not-allowed"}
          `}
        >
          {loading
            ? (mode === "signin" ? "Signing in..." : "Creating account...")
            : (mode === "signin" ? "Sign in" : "Create account")}
        </button>
      </form>
    </>
  );
}

export default function AuthPage() {
  return (
    <div className="min-h-[calc(100vh-60px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <Link href="/" className="flex justify-center mb-8">
          <span className="font-heading font-bold tracking-wider text-xl text-text-base">
            PEAK<span className="text-cyan">CAM</span>
          </span>
        </Link>

        <div className="bg-surface border border-border rounded-2xl p-6 shadow-2xl">
          <Suspense>
            <AuthForm />
          </Suspense>
        </div>

        <p className="text-text-muted text-xs text-center mt-4">
          By signing in, you agree to our{" "}
          <Link href="/about" className="text-text-subtle hover:text-cyan transition-colors">
            terms of use
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
