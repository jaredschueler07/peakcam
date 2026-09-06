import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { Header } from "@/components/layout/Header";
import { UpdatePassword } from "@/components/auth/UpdatePassword";
import { AccountSignOut } from "@/components/auth/AccountSignOut";

export const metadata = { title: "Your account | PeakCam", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/auth?next=%2Faccount");
  return <><Header showSearch={false} /><main id="main-content" className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
    <div><h1 className="font-display text-4xl font-black">Your account.</h1><p className="mt-3 break-all text-base text-bark">{user.email}</p><p className="mt-1 text-sm text-bark">{user.email_confirmed_at ? "Email confirmed" : "Email confirmation pending"}</p></div>
    <UpdatePassword embedded />
    <section className="rounded-2xl border border-ink bg-cream-50 p-5"><h2 className="font-display text-2xl font-bold">Sessions</h2><p className="my-3 text-sm text-bark">Sign out on this device, or end your sessions on other devices too.</p><AccountSignOut /></section>
    <Link href="/dashboard" className="inline-flex min-h-11 items-center text-sm font-bold underline">Back to My Peak</Link>
  </main></>;
}
