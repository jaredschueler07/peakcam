"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { safeNext } from "@/lib/safe-redirect";
import { track, EVENTS } from "@/lib/analytics-events";
import { authErrorMessage } from "@/lib/auth-errors";

type Mode = "signin" | "signup" | "link" | "reset" | "confirm";
const EMAIL_CODE_ENABLED = process.env.NEXT_PUBLIC_AUTH_EMAIL_CODE_ENABLED === "true";
export function AuthForm({ redirectTo = "/", initialError, onSignedIn }: { redirectTo?: string; initialError?: string | null; onSignedIn?: () => void }) {
  const id = useId();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    if (!resendIn) return;
    const timer = setTimeout(() => setResendIn(value => Math.max(0, value - 1)), 1_000);
    return () => clearTimeout(timer);
  }, [resendIn]);
  const needsPassword = mode === "signin" || mode === "signup";
  const next = safeNext(redirectTo);
  const changeMode = (value: Mode) => { setMode(value); setError(null); setSent(false); setPassword(""); setToken(""); };
  const finish = () => { onSignedIn?.(); router.push(next); router.refresh(); };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const requestMode = sent && mode === "signup" ? "confirm" : mode;
    if (submitting.current || (requestMode !== "signin" && resendIn > 0)) return;
    submitting.current = true;
    setLoading(true); setError(null);
    try {
      const client = createSupabaseBrowserClient();
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", requestMode === "reset" ? "/auth/update-password" : next);
      if (requestMode === "signin") {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        finish();
      } else if (requestMode === "signup") {
        const email_domain = email.trim().split("@")[1] ?? "";
        track(EVENTS.AUTH_SIGNUP_STARTED, { email_domain });
        const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: callback.href } });
        if (error) throw error;
        track(EVENTS.AUTH_SIGNUP_COMPLETED, { email_domain });
        if (data.session) finish(); else setSent(true);
      } else if (requestMode === "confirm") {
        const { error } = await client.auth.resend({ type: "signup", email: email.trim(), options: { emailRedirectTo: callback.href } });
        if (error) throw error;
        setSent(true);
      } else if (requestMode === "reset") {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: callback.href });
        if (error) throw error;
        setSent(true);
      } else {
        const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback.href, shouldCreateUser: false } });
        if (error) throw error;
        setSent(true);
      }
      if (requestMode !== "signin") { setResendIn(60); setPassword(""); }
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally { submitting.current = false; setLoading(false); }
  }
  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current || !/^\d{6,10}$/.test(token)) return;
    submitting.current = true; setLoading(true); setError(null);
    try {
      const { error } = await createSupabaseBrowserClient().auth.verifyOtp({ email: email.trim(), token, type: "email" });
      if (error) throw error;
      setToken(""); finish();
    } catch (caught) { setError(authErrorMessage(caught)); }
    finally { submitting.current = false; setLoading(false); }
  }
  const inputClass = "mt-1 min-h-11 w-full rounded-lg border border-bark bg-cream-50 px-3 py-2 text-base text-ink";
  const labels: Record<Mode, string> = { signin: "Sign in", signup: "Create account", link: EMAIL_CODE_ENABLED ? "Email sign-in code" : "Email sign-in link", reset: "Send reset link", confirm: "Resend confirmation" };
  const codeForm = <form onSubmit={verifyCode} className="space-y-3"><label className="block font-bold text-ink">Sign-in code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required disabled={loading} value={token} onChange={event => setToken(event.target.value.replace(/\D/g, ""))} className={inputClass} /></label><button disabled={loading || token.length < 6} className="min-h-11 w-full rounded-full border border-ink bg-alpen-dk px-4 text-sm font-bold text-cream-50 disabled:opacity-50">{loading ? "Checking…" : "Verify code"}</button></form>;
  if (sent) return <div className="space-y-4 py-4 text-sm text-bark">
    <h3 className="text-lg font-bold text-ink">Check your email</h3>
    <p role="status" className="break-words">{mode === "signup" || mode === "confirm" ? `If ${email} needs confirmation, we’ll send an email to finish setting up your account.` : `If ${email} has a PeakCam account, we’ll send a ${mode === "reset" ? "password reset link" : EMAIL_CODE_ENABLED ? "sign-in code" : "sign-in link"}.`}</p>
    {mode !== "link" || !EMAIL_CODE_ENABLED ? <p>Open the link in this browser to finish.</p> : null}
    {mode === "link" && (EMAIL_CODE_ENABLED ? codeForm : <details><summary className="min-h-11 cursor-pointer py-3 font-bold">Enter a code instead</summary>{codeForm}</details>)}
    <p>Check your junk folder if it doesn’t arrive.</p>
    {error && <p role="alert" className="text-sm text-poor">{error}</p>}
    <form onSubmit={submit}><button disabled={loading || resendIn > 0} type="submit" className="min-h-11 underline disabled:opacity-50">{resendIn > 0 ? `Resend in ${resendIn}s` : "Resend email"}</button></form>
    <button disabled={loading} type="button" className="min-h-11 underline" onClick={() => changeMode("signin")}>Back to sign in</button>
  </div>;
  return <>
    <div className="mb-5 grid grid-cols-2 gap-2" aria-label="Account options">
      {(["signin", "signup"] as const).map(value => <button key={value} type="button" disabled={loading} aria-pressed={mode === value} onClick={() => changeMode(value)} className={`min-h-11 rounded-full border border-ink px-3 text-sm font-bold ${mode === value ? "bg-ink text-cream-50" : "bg-cream-50 text-ink"}`}>{value === "signin" ? "Sign in" : "Sign up"}</button>)}
    </div>
    {(mode === "reset" || mode === "link" || mode === "confirm") && <p className="mb-4 text-sm text-bark">{mode === "reset" ? "We’ll send a link to choose a new password." : mode === "confirm" ? "Request another confirmation for your existing signup." : `Sign in to your existing account with an email ${EMAIL_CODE_ENABLED ? "code" : "link"}.`}</p>}
    <form onSubmit={submit} className="space-y-4">
      <label htmlFor={`${id}-email`} className="block text-sm font-bold">Email address<input id={`${id}-email`} type="email" autoComplete="email" required value={email} disabled={loading} onChange={event => setEmail(event.target.value)} className={inputClass} /></label>
      {needsPassword && <div><label htmlFor={`${id}-password`} className="block text-sm font-bold">Password<input id={`${id}-password`} aria-describedby={mode === "signup" ? `${id}-password-hint` : undefined} type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signup" ? 8 : undefined} value={password} disabled={loading} onChange={event => setPassword(event.target.value)} className={inputClass} /></label>{mode === "signup" && <p id={`${id}-password-hint`} className="mt-1 text-xs text-bark">Use at least 8 characters.</p>}</div>}
      {error && <p role="alert" className="text-sm text-poor">{error}</p>}
      <button type="submit" disabled={loading || !email.trim() || (needsPassword && !password) || (mode !== "signin" && resendIn > 0)} className="min-h-11 w-full rounded-full border border-ink bg-alpen-dk px-4 py-3 text-sm font-bold text-cream-50 disabled:bg-cream disabled:text-bark">{loading ? "Please wait…" : mode !== "signin" && resendIn > 0 ? `Try again in ${resendIn}s` : labels[mode]}</button>
    </form>
    <div className="mt-3 flex flex-col items-start">
      {mode === "signin" && <><button type="button" disabled={loading} className="min-h-11 text-sm underline" onClick={() => changeMode("reset")}>Forgot password?</button><button type="button" disabled={loading} className="min-h-11 text-sm underline" onClick={() => changeMode("link")}>Email me a sign-in {EMAIL_CODE_ENABLED ? "code" : "link"} instead</button><button type="button" disabled={loading} className="min-h-11 text-sm underline" onClick={() => changeMode("confirm")}>Resend account confirmation</button></>}
      {(mode === "reset" || mode === "link" || mode === "confirm") && <button type="button" disabled={loading} className="min-h-11 text-sm underline" onClick={() => changeMode("signin")}>Use a password instead</button>}
    </div>
  </>;
}
