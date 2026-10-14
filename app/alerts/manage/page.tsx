import { notFound } from "next/navigation";
import { AlertManagePage } from "@/components/alerts/AlertManagePage";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

async function getManageData(token: string) {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const resp = await fetch(`${baseUrl}/api/alerts/manage?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (!resp.ok) return null;
  return resp.json();
}

export default async function AlertsManagePage({ searchParams }: PageProps) {
  const { token } = await searchParams;

  if (!token) notFound();

  const data = await getManageData(token);
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
