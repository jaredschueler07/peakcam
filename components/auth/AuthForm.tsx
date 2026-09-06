"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { safeNext } from "@/lib/safe-redirect";
import { track, EVENTS } from "@/lib/analytics-events";

type Mode = "signin" | "signup" | "link" | "reset";
export function AuthForm({ redirectTo = "/", initialError, onSignedIn }: { redirectTo?: string; initialError?: string | null; onSignedIn?: () => void }) {
  const id = useId();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [sent, setSent] = useState(false);
  const needsPassword = mode === "signin" || mode === "signup";
  const next = safeNext(redirectTo);
  const changeMode = (value: Mode) => { setMode(value); setError(null); setSent(false); setPassword(""); };
  const finish = () => { onSignedIn?.(); router.push(next); router.refresh(); };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true); setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", mode === "reset" ? "/auth/update-password" : next);
      if (mode === "signin") {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        finish();
      } else if (mode === "signup") {
        const email_domain = email.trim().split("@")[1] ?? "";
        track(EVENTS.AUTH_SIGNUP_STARTED, { email_domain });
        const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callback.href } });
        if (error) throw error;
        track(EVENTS.AUTH_SIGNUP_COMPLETED, { email_domain });
        if (data.session) finish(); else setSent(true);
      } else if (mode === "reset") {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: callback.href });
        if (error) throw error;
        setSent(true);
      } else {
        const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback.href, shouldCreateUser: false } });
        if (error) throw error;
        setSent(true);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t complete that request. Please try again.");
    } finally { setLoading(false); }
  }
  const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-bark bg-cream-50 px-3 py-2 text-base text-ink";
  const labels: Record<Mode, string> = { signin: "Sign in", signup: "Create account", link: "Email sign-in link", reset: "Send reset link" };
  if (sent) return <div role="status" className="space-y-4 py-4 text-sm text-bark">
    <h3 className="text-lg font-bold text-ink">Check your email</h3>
    <p className="break-words">{mode === "signup" ? `Check ${email} for a link to confirm your account.` : `If ${email} has a PeakCam account, we’ll send a ${mode === "reset" ? "password reset" : "sign-in"} link.`}</p>
    <p>Open the link in this browser to finish. Check your junk folder if it doesn’t arrive.</p>
    <button type="button" className="min-h-11 underline" onClick={() => changeMode("signin")}>Back to sign in</button>
  </div>;
  return <>
    <div className="mb-5 grid grid-cols-2 gap-2" aria-label="Account options">
      {(["signin", "signup"] as const).map(value => <button key={value} type="button" disabled={loading} aria-pressed={mode === value} onClick={() => changeMode(value)} className={`min-h-11 rounded-full border border-ink px-3 text-sm font-bold ${mode === value ? "bg-ink text-cream-50" : "bg-cream-50 text-ink"}`}>{value === "signin" ? "Sign in" : "Sign up"}</button>)}
    </div>
    {(mode === "reset" || mode === "link") && <p className="mb-4 text-sm text-bark">{mode === "reset" ? "We’ll send a link to choose a new password." : "Sign in to your existing account with an email link."}</p>}
    <form onSubmit={submit} className="space-y-4">
      <label htmlFor={`${id}-email`} className="block text-sm font-bold">Email address<input id={`${id}-email`} type="email" autoComplete="email" required value={email} disabled={loading} onChange={event => setEmail(event.target.value)} className={inputClass} /></label>
      {needsPassword && <label htmlFor={`${id}-password`} className="block text-sm font-bold">Password<input id={`${id}-password`} type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 8 : undefined} value={password} disabled={loading} onChange={event => setPassword(event.target.value)} className={inputClass} />{mode === "signup" && <span className="mt-1 block text-xs font-normal text-bark">Use at least 8 characters.</span>}</label>}
      {error && <p role="alert" className="text-sm text-poor">{error}</p>}
      <button type="submit" disabled={loading || !email.trim() || (needsPassword && !password)} className="min-h-11 w-full rounded-full border border-ink bg-alpen-dk px-4 py-3 text-sm font-bold text-cream-50 disabled:bg-cream disabled:text-bark">{loading ? "Please wait…" : labels[mode]}</button>
    </form>
    <div className="mt-3 flex flex-col items-start">
      {mode === "signin" && <><button type="button" disabled={loading} className="min-h-11 text-sm underline" onClick={() => changeMode("reset")}>Forgot password?</button><button type="button" disabled={loading} className="min-h-11 text-sm underline" onClick={() => changeMode("link")}>Email me a sign-in link instead</button></>}
      {(mode === "reset" || mode === "link") && <button type="button" disabled={loading} className="min-h-11 text-sm underline" onClick={() => changeMode("signin")}>Use a password instead</button>}
    </div>
  </>;
}
