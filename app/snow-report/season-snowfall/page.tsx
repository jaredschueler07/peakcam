import { LeaderboardPage, leaderboardMetadata } from "@/components/snow-report/LeaderboardPage";

// /snow-report/season-snowfall — see components/snow-report/LeaderboardPage.tsx
// (lib/leaderboards.ts). Hourly ISR like every data-bearing page.
export const revalidate = 3600;

export const metadata = leaderboardMetadata("season-snowfall");

export default function Page() {
  return <LeaderboardPage kind="season-snowfall" />;
}
