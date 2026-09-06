import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { UpdatePassword } from "@/components/auth/UpdatePassword";

export const metadata = { title: "Set your password | PeakCam", robots: { index: false } };
export default async function UpdatePasswordPage() {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/auth?error=auth_failed");
  return <main id="main-content" className="mx-auto max-w-md px-4 py-10"><UpdatePassword /></main>;
}
