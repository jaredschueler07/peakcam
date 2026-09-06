"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { authErrorMessage } from "@/lib/auth-errors";

export function AccountSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function signOut(scope: "local" | "global") {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const { error } = await createSupabaseBrowserClient().auth.signOut({ scope });
      if (error) throw error;
      router.replace("/auth"); router.refresh();
    } catch (caught) { setError(authErrorMessage(caught)); setBusy(false); }
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-3">{(["local", "global"] as const).map(scope => <button key={scope} disabled={busy} type="button" onClick={() => signOut(scope)} className="min-h-11 rounded-full border border-ink px-4 text-sm font-bold disabled:opacity-50">{scope === "local" ? "Sign out here" : "Sign out all devices"}</button>)}</div>
    <p className="text-xs text-bark">Other devices may stay signed in until their current access token expires.</p>
    {error && <p role="alert" className="text-sm text-poor">{error}</p>}
  </div>;
}
