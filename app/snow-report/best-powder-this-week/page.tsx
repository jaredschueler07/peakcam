import { LeaderboardPage, leaderboardMetadata } from "@/components/snow-report/LeaderboardPage";

// /snow-report/best-powder-this-week — see components/snow-report/LeaderboardPage.tsx
// (lib/leaderboards.ts). Hourly ISR like every data-bearing page.
export const revalidate = 3600;

export const metadata = leaderboardMetadata("best-powder-this-week");

export default function Page() {
  return <LeaderboardPage kind="best-powder-this-week" />;
}
