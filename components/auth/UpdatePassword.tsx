"use client";
import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function UpdatePassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) { setError("Passwords don’t match."); return; }
    setBusy(true); setError(null);
    try {
      const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (error) throw error;
      setPassword(""); setConfirm(""); setDone(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Couldn’t update your password. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-ink bg-cream-50 p-5 shadow-stamp">
    <h1 className="mb-5 font-display text-3xl font-black">{done ? "Password updated." : "Set your password."}</h1>
    {done ? <p role="status">Your new password is ready to use.</p> : <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-bark">Use at least 8 characters.</p>
      <label className="block text-sm font-bold">New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-bark px-3 text-base" /></label>
      <label className="block text-sm font-bold">Confirm new password<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-bark px-3 text-base" /></label>
      {error && <p role="alert" className="text-sm text-poor">{error}</p>}
      <button disabled={busy} className="min-h-11 w-full rounded-full bg-alpen-dk px-4 text-sm font-bold text-cream-50">{busy ? "Saving…" : "Save password"}</button>
    </form>}
    <Link href="/" className="mt-5 inline-flex min-h-11 items-center text-sm underline">Back to resorts</Link>
  </section>;
}
