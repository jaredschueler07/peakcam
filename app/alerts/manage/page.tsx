import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AlertManagePage } from "@/components/alerts/AlertManagePage";
import { loadManageData } from "@/lib/alerts/manage-data";

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

  // Reads Supabase directly rather than fetching this app's own
  // /api/alerts/manage over HTTP. That round trip resolved its base URL from
  // NEXT_PUBLIC_SITE_URL with a localhost:3000 fallback, so on any deployment
  // where that variable is unset every valid manage link 404'd. The route
  // handler stays for the client-side PUT/DELETE.
  const data = await loadManageData(token);
  if (!data) notFound();

  return (
    <AlertManagePage
      token={token}
      email={data.email}
      preferences={data.preferences}
      resorts={data.resorts}
    />
  );
}

export const dynamic = "force-dynamic";
