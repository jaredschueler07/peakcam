// ─────────────────────────────────────────────────────────────
// PeakCam — Fetcher Registry
// Re-exports all fetchers for use by the orchestrator.
// ─────────────────────────────────────────────────────────────

export { fetchLiftie } from "./liftie";
export { fetchSnotel } from "./snotel";
export { fetchNws } from "./nws";
export { fetchWeatherUnlocked } from "./weather-unlocked";
export { fetchUserReports } from "./user-reports";
export { fetchSnodas } from "./snodas";

import type { FetcherFn, SourceName } from "../types";
import { fetchLiftie } from "./liftie";
import { fetchSnotel } from "./snotel";
import { fetchNws } from "./nws";
import { fetchWeatherUnlocked } from "./weather-unlocked";
import { fetchUserReports } from "./user-reports";
import { fetchSnodas } from "./snodas";

/** All registered fetchers, keyed by source name. */
export const FETCHERS: Record<SourceName, FetcherFn> = {
  liftie: fetchLiftie,
  snotel: fetchSnotel,
  nws: fetchNws,
  weather_unlocked: fetchWeatherUnlocked,
  user_reports: fetchUserReports,
  snodas: fetchSnodas,
  openskistats: async () => null, // Static data — loaded separately
};
