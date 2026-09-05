/** Server-only immutable morning capture. No afternoon fallback to a different challenge. */
import { getWeatherForecast } from "../../weather";
import { buildConditionsSnapshot } from "../conditions";
import { createSupabaseAdminClient } from "./supabase-admin";
import { resortMorning, lockMorningConditions, type RankedConditions } from "./ranked-conditions";
import type { Resort, SnowReport } from "../../types";

export async function dailyMorningConditions(slug: string, now: number): Promise<RankedConditions> {
  const db = createSupabaseAdminClient();
  const morning = resortMorning(now, slug);
  const read = () => db.from("drop_in_morning_conditions").select("snapshot")
    .eq("resort_slug", slug).eq("conditions_date", morning.date).single();
  let snowReportId: string | undefined;
  let weatherAvailable = false;
  return lockMorningConditions(slug, now, {
    async read() {
      const result = await read();
      if (result.error && result.error.code !== "PGRST116") throw new Error("Morning snapshot storage unavailable");
      return (result.data?.snapshot as RankedConditions | null) ?? null;
    },
    async insertOnce(_slug, _date, snapshot) {
      const inserted = await db.from("drop_in_morning_conditions").upsert({
        resort_slug: slug, conditions_date: morning.date, snapshot,
        captured_at: new Date(now).toISOString(), snow_report_id: snowReportId,
        weather_available: weatherAvailable,
      }, { onConflict: "resort_slug,conditions_date", ignoreDuplicates: true });
      if (inserted.error) throw new Error("Could not lock morning conditions");
    },
  }, async () => {
    const resortResult = await db.from("resorts").select("*").eq("slug", slug).single();
    if (resortResult.error || !resortResult.data) throw new Error("Unknown resort");
    const resort = resortResult.data as Resort;
    const snow = await db.from("snow_reports").select("*").eq("resort_id", resort.id)
      .lte("updated_at", new Date(now).toISOString()).order("updated_at", { ascending: false }).limit(1).single();
    if (snow.error || !snow.data) throw new Error("Morning snow report unavailable");
    const forecast = resort.country === "US" ? await getWeatherForecast(resort.lat, resort.lng) : null;
    if (resort.country === "US" && !forecast) throw new Error("Morning weather unavailable");
    const built = buildConditionsSnapshot(resort, snow.data as SnowReport, forecast, "v2", 7);
    const snapshot: RankedConditions = { surface: built.surface, environment: built.environment!, conditionsDate: morning.date };
    snowReportId = snow.data.id;
    weatherAvailable = forecast !== null;
    return snapshot;
  });
}
