import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { accountProfile, signedInWithGoogle } from "@/lib/auth-profile";
import { Header } from "@/components/layout/Header";
import { UpdatePassword } from "@/components/auth/UpdatePassword";
import { AccountSignOut } from "@/components/auth/AccountSignOut";
import { GoogleMark } from "@/components/auth/GoogleSignInButton";

export const metadata = { title: "Your account | PeakCam", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/auth?next=%2Faccount");
  // Google fills user_metadata with the display name and avatar; email
  // accounts have neither and render exactly as before. The avatar goes
  // through next/image (remotePatterns in next.config.ts allows
  // *.googleusercontent.com) so Google never sees the visitor's request.
  const profile = accountProfile(user);
  const viaGoogle = signedInWithGoogle(profile);
  return <><Header showSearch={false} /><main id="main-content" className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
    <div className="flex items-start gap-4">
      {profile.avatarUrl && <Image src={profile.avatarUrl} alt="" width={64} height={64} className="h-16 w-16 shrink-0 rounded-full border border-ink object-cover" />}
      <div className="min-w-0">
        <h1 className="font-display text-4xl font-black">Your account.</h1>
        {profile.displayName && <p className="mt-3 text-lg font-bold text-ink [overflow-wrap:anywhere]">{profile.displayName}</p>}
        <p className={`${profile.displayName ? "mt-1" : "mt-3"} break-all text-base text-bark`}>{user.email}</p>
        <p className="mt-1 text-sm text-bark">{user.email_confirmed_at ? "Email confirmed" : "Email confirmation pending"}</p>
        {viaGoogle && <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-ink bg-cream-50 px-3 py-1 text-xs font-bold text-ink"><GoogleMark size={14} />Signed in with Google</p>}
      </div>
    </div>
    <UpdatePassword embedded />
    <section className="rounded-2xl border border-ink bg-cream-50 p-5"><h2 className="font-display text-2xl font-bold">Sessions</h2><p className="my-3 text-sm text-bark">Sign out on this device, or end your sessions on other devices too.</p><AccountSignOut /></section>
    <Link href="/dashboard" className="inline-flex min-h-11 items-center text-sm font-bold underline">Back to My Peak</Link>
  </main></>;
}
