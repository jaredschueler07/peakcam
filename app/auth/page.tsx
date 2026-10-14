"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { AuthForm } from "@/components/auth/AuthForm";
import { track, EVENTS } from "@/lib/analytics-events";

const ACCOUNT_PERKS = ["Favorites synced across devices", "My Peak dashboard", "Post full condition reports"];

function SignIn() {
  const params = useSearchParams();
  const failed = params?.get("error") === "auth_failed";
  const reason = params?.get("reason") ?? "unknown";
  useEffect(() => {
    // /auth/callback redirects here when the code exchange fails and tags the
    // cause in `reason`. Recording it makes the different-browser cohort —
    // confirmed accounts that never reach the ?welcome=signup landing —
    // visible next to AUTH_SIGNUP_COMPLETED instead of silently missing.
    if (failed) track(EVENTS.AUTH_CALLBACK_FAILED, { reason });
  }, [failed, reason]);
  return <AuthForm redirectTo={params?.get("next") ?? "/"} initialMode={params?.get("mode") === "signup" ? "signup" : "signin"} initialError={failed ? "That sign-in link expired or couldn’t be opened in this browser. Please request a new link." : null} />;
}
export default function AuthPage() {
  return <main id="main-content" className="mx-auto min-h-dvh w-full max-w-md px-4 py-8">
    <Link href="/" className="mb-6 inline-flex min-h-11 items-center font-display text-2xl font-black">PeakCam</Link>
    <section className="rounded-2xl border border-ink bg-cream-50 p-5 shadow-stamp">
      <h1 className="mb-3 font-display text-3xl font-black [overflow-wrap:anywhere]">Keep your mountains in one place.</h1>
      <ul className="mb-5 space-y-1 text-sm text-bark">
        {ACCOUNT_PERKS.map(perk => <li key={perk} className="flex items-start gap-2"><Check size={16} strokeWidth={3} aria-hidden className="mt-0.5 shrink-0 text-forest" /><span>{perk}</span></li>)}
      </ul>
      <Suspense fallback={<p>Loading sign in…</p>}><SignIn /></Suspense>
    </section>
    <p className="mt-5 text-sm text-bark">Just want snow emails? <Link href="/alerts" className="inline-flex min-h-11 items-center font-bold text-ink underline">Powder alerts don’t need an account →</Link></p>
    <Link href="/" className="mt-2 inline-flex min-h-11 items-center text-sm underline">Back to resorts</Link>
  </main>;
}
