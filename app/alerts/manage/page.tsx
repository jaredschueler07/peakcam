import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertManagePage } from "@/components/alerts/AlertManagePage";
import { getManageState } from "@/lib/alerts/manage";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

// Capability-token URL for a specific subscriber — never indexable.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AlertsManagePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  // No capability token means the visitor followed a nav/footer link rather than
  // an alert email — send them to the public signup page instead of a 404.
  if (!token) redirect("/alerts");

  // Read the subscriber directly rather than fetching our own API over HTTP:
  // the self-fetch depended on NEXT_PUBLIC_SITE_URL (localhost fallback), so a
  // missing or apex-valued env var broke the most-clicked link in every email.
  // A token that matches no subscriber (revoked, or already unsubscribed)
  // lands on the signup page too, where a fresh subscription is one form away.
  const state = await getManageState(token);
  if (!state) redirect("/alerts");

  return (
    <AlertManagePage
      token={token}
      email={state.subscriber.email}
      preferences={state.preferences}
      resorts={state.resorts}
    />
  );
}

// Every render reads live subscriber state with a per-request token; never cache.
export const dynamic = "force-dynamic";
