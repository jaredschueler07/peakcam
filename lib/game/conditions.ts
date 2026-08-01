import type { Resort, SnowReport, WeatherPeriod } from "../types";
import type { SurfaceKind } from "./core/config";

export interface ConditionsSnapshot {
  readonly surface: SurfaceKind;
  readonly weatherDefault: 0 | 1 | 2;
  readonly powderDay: boolean;
  readonly baseDepthIn: number | null;
  readonly snow24In: number | null;
  readonly stamp: string;
}

type NwsForecast = readonly Pick<WeatherPeriod, "condition" | "shortForecast" | "windSpeed" | "windGust">[];
type ConditionsResort = Pick<Resort, "slug" | "cond_rating">;

function isSnowing(forecast: NwsForecast | null | undefined): boolean {
  return Boolean(forecast?.some((period) =>
    /snow|blizzard|flurr|wintry|sleet|freezing|wind/i.test(`${period.condition} ${period.shortForecast}`),
  ));
}

function conditionSurface(resort: ConditionsResort, report: SnowReport): SurfaceKind {
  const ratings = [resort.cond_rating, report.auto_cond_rating]
    .map((rating) => rating?.toLowerCase() ?? "")
    .filter(Boolean);
  if (ratings.includes("icy") || /\bicy|ice\b/i.test(report.conditions ?? "")) return "ice";
  if (ratings.includes("poor")) return "firm";
  return "packed";
}

export function buildConditionsSnapshot(
  resort: ConditionsResort,
  latestSnowReport: SnowReport | null,
  nwsForecast?: NwsForecast | null,
): ConditionsSnapshot {
  if (!latestSnowReport) {
    return {
      surface: "packed", weatherDefault: isSnowing(nwsForecast) ? 1 : 0, powderDay: false,
      baseDepthIn: null, snow24In: null, stamp: "Classic conditions",
    };
  }

  const snow24In = latestSnowReport.new_snow_24h;
  const powderDay = snow24In !== null && snow24In >= 8;
  return {
    surface: powderDay ? "powder" : conditionSurface(resort, latestSnowReport),
    weatherDefault: isSnowing(nwsForecast) || latestSnowReport.snowing_now ? 1 : 0,
    powderDay,
    baseDepthIn: latestSnowReport.base_depth,
    snow24In,
    stamp: powderDay ? "POWDER DAY" : latestSnowReport.conditions?.trim()
      || `${resort.cond_rating[0].toUpperCase()}${resort.cond_rating.slice(1)} conditions`,
  };
}
