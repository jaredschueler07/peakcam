import { redirect } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { BugReportInbox } from "@/components/feedback/BugReportInbox";
import { reviewerContext } from "@/lib/bug-reports/review-server";
import { ReviewAccessError } from "@/lib/bug-reports/review-access";
export const dynamic = "force-dynamic";
export const metadata = { title: "Bug reports — PeakCam", robots: { index: false, follow: false } };
export default async function BugReportsPage() {
  let denied = false;
  try { await reviewerContext(); } catch (error) {
    if (error instanceof ReviewAccessError && error.status === 401) redirect("/auth?next=%2Fadmin%2Fbug-reports");
    if (error instanceof ReviewAccessError && error.status === 403) denied = true;
    else throw error;
  }
  return <><Header showSearch={false} /><main id="main-content" className="ph-no-capture mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <p className="pc-eyebrow">PeakCam team</p><h1 className="mt-2 font-display text-4xl font-black">Bug reports</h1>
    {denied ? <p className="mt-6 rounded-xl border border-ink p-5">This inbox is restricted to authorized reviewers. Sign in with your reviewer account.</p> : <BugReportInbox />}
  </main></>;
}
