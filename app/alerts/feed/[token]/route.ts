import type { NextRequest } from "next/server";
import { findSubscriberByToken } from "@/lib/alerts/manage";
import { loadFeedReports, loadForecastLogs, loadSubscriberResorts } from "@/lib/alerts/feed-data";
import {
  ATOM_CONTENT_TYPE,
  buildAtomFeed,
  buildIcsCalendar,
  ICS_CONTENT_TYPE,
  powderEntries,
  privateFeedHeaders,
  stormWindowEvent,
  type PowderFeedEntry,
  type StormWindowEvent,
} from "@/lib/alerts/feeds";
import { findForecastAlert } from "@/lib/alerts/forecast";
import { isTimeoutError } from "@/lib/alerts/service-fetch";
import { getOpenMeteoForecast } from "@/lib/open-meteo";
import { SITE_URL } from "@/lib/site";

// Per-subscriber powder feed, looked up by the manage_token the alert
// emails carry. Atom by default; `?format=ics` is a calendar of forecast
// storm windows for the subscriber's resorts (one all-day event per storm,
// UID stable per resort + start date, so a re-fetch updates rather than
// duplicates). The token is a bearer capability, so the response is never
// cached or indexed and the URL should be treated like the manage link.
export const dynamic = "force-dynamic";

/** Live forecast lookups per request are capped so a 200-resort subscriber cannot stall the feed. */
const MAX_LIVE_FORECASTS = 25;

function text(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  if (!token) return text(400, "token is required");
  const format = request.nextUrl.searchParams.get("format") === "ics" ? "ics" : "atom";

  try {
    const subscriber = await findSubscriberByToken(token);
    if (!subscriber) return text(404, "Unknown feed");

    const followed = await loadSubscriberResorts(subscriber.id);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (format === "ics") {
      const events = new Map<string, StormWindowEvent>();
      const stamp = now.toISOString();
      await Promise.all(
        followed.slice(0, MAX_LIVE_FORECASTS).map(async ({ resort, threshold }) => {
          // Logged forecast alerts: storms the cron already told this subscriber about.
          const logs = await loadForecastLogs(resort.id, { subscriberId: subscriber.id, now });
          for (const log of logs) {
            if (!log.storm_start_date) continue;
            const event = stormWindowEvent(
              resort,
              { stormStartDate: log.storm_start_date, forecastDays: 3, snowInches: log.new_snow_inches },
              log.sent_at ?? `${log.alert_date}T13:00:00.000Z`,
            );
            events.set(event.uid, event);
          }
          // Live forecast: the next storm window at this subscriber's threshold, if any.
          try {
            const periods = await getOpenMeteoForecast(resort.lat, resort.lng);
            const forecast = periods ? findForecastAlert(periods, threshold) : null;
            if (forecast?.stormStartDate) {
              const event = stormWindowEvent(resort, { ...forecast, stormStartDate: forecast.stormStartDate }, stamp);
              events.set(event.uid, event);
            }
          } catch {
            // Forecast provider trouble drops only this resort's live window.
          }
        }),
      );
      const ics = buildIcsCalendar({
        name: `PeakCam powder forecasts`,
        description: `Forecast storm windows for the resorts you follow on PeakCam (${followed.length} resort${followed.length === 1 ? "" : "s"}). Generated ${today}.`,
        events: [...events.values()],
      });
      return new Response(ics, { status: 200, headers: privateFeedHeaders(ICS_CONTENT_TYPE) });
    }

    const perResort = await Promise.all(
      followed.map(async ({ resort, threshold }) => {
        const [reports, logs] = await Promise.all([
          loadFeedReports(resort.id, now),
          loadForecastLogs(resort.id, { subscriberId: subscriber.id, now }),
        ]);
        return { entries: powderEntries(resort, reports, logs, threshold), latest: reports[0]?.updated_at ?? null };
      }),
    );
    const entries: PowderFeedEntry[] = perResort
      .flatMap((r) => r.entries)
      .sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.id.localeCompare(b.id)));
    const latestReport = perResort.map((r) => r.latest).filter((v): v is string => v !== null).sort().pop() ?? null;
    const updated = entries[0]?.updated ?? latestReport ?? subscriber.created_at;

    const xml = buildAtomFeed({
      id: `tag:peakcam.io,2026:powder:subscriber:${subscriber.id}`,
      title: "Your PeakCam powder alerts",
      subtitle: `Powder days at your thresholds and forecast storms for the ${followed.length} resort${followed.length === 1 ? "" : "s"} you follow.`,
      selfUrl: `${SITE_URL}/alerts/feed/${token}`,
      alternateUrl: `${SITE_URL}/alerts/manage?token=${token}`,
      updated,
      entries,
    });
    return new Response(xml, { status: 200, headers: privateFeedHeaders(ATOM_CONTENT_TYPE) });
  } catch (err) {
    if (isTimeoutError(err)) return text(504, "The alerts database timed out — please try again in a moment");
    console.error("[alerts/feed] failed:", err);
    return text(500, "Feed unavailable");
  }
}
