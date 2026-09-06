"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthForm } from "@/components/auth/AuthForm";

function SignIn() {
  const params = useSearchParams();
  return <AuthForm redirectTo={params.get("next") ?? "/"} initialError={params.get("error") === "auth_failed" ? "That sign-in link expired or couldn’t be opened in this browser. Please request a new link." : null} />;
}
export default function AuthPage() {
  return <main id="main-content" className="mx-auto min-h-dvh w-full max-w-md px-4 py-8">
    <Link href="/" className="mb-6 inline-flex min-h-11 items-center font-display text-2xl font-black">PeakCam</Link>
    <section className="rounded-2xl border border-ink bg-cream-50 p-5 shadow-stamp">
      <h1 className="mb-5 font-display text-3xl font-black">Your mountains await.</h1>
      <Suspense fallback={<p>Loading sign in…</p>}><SignIn /></Suspense>
    </section>
    <Link href="/" className="mt-5 inline-flex min-h-11 items-center text-sm underline">Back to resorts</Link>
  </main>;
}
