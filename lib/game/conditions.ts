import type { Resort, SnowReport, WeatherPeriod } from "../types";
import type { PhysicsModel, SurfaceKind } from "./core/config";
import { physicsModelForRollout } from "./config/physics-rollout";

export interface ConditionsSnapshot {
  readonly surface: SurfaceKind;
  readonly physicsModel: PhysicsModel;
  readonly weatherDefault: 0 | 1 | 2;
  readonly powderDay: boolean;
  readonly baseDepthIn: number | null;
  readonly snow24In: number | null;
  /** Short tag line for the poster stamp. Never contains the `||` separator. */
  readonly stamp: string;
  /** The sentence after `||`, or null when the report carries only tags. */
  readonly narrative: string | null;
}

/**
 * `snow_reports.conditions` is an overloaded column: `"tag1,tag2||narrative"`
 * (see CLAUDE.md — ConditionsStrip, ComparePage and map-utils all unpack it).
 * The Drop In poster was rendering it whole, so Heavenly displayed
 * "BLUEBIRD||EXPECT CLEAR BLUEBIRD SKIES TODAY."
 *
 * Splits on the FIRST separator only, so a narrative containing `||` survives
 * intact rather than being truncated at the second one.
 */
function splitConditions(raw: string | null | undefined): {
  tags: string;
  narrative: string | null;
} {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return { tags: "", narrative: null };

  const separator = trimmed.indexOf("||");
  if (separator === -1) return { tags: trimmed, narrative: null };

  const tags = trimmed
    .slice(0, separator)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(", ");
  const narrative = trimmed.slice(separator + 2).trim();
  return { tags, narrative: narrative === "" ? null : narrative };
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
  physicsModel: PhysicsModel = physicsModelForRollout(),
): ConditionsSnapshot {
  if (!latestSnowReport) {
    return {
      surface: "packed", physicsModel, weatherDefault: isSnowing(nwsForecast) ? 1 : 0, powderDay: false,
      baseDepthIn: null, snow24In: null, stamp: "Classic conditions", narrative: null,
    };
  }

  const snow24In = latestSnowReport.new_snow_24h;
  const powderDay = snow24In !== null && snow24In >= 8;
  const { tags, narrative } = splitConditions(latestSnowReport.conditions);
  return {
    surface: powderDay ? "powder" : conditionSurface(resort, latestSnowReport),
    physicsModel,
    weatherDefault: isSnowing(nwsForecast) || latestSnowReport.snowing_now ? 1 : 0,
    powderDay,
    baseDepthIn: latestSnowReport.base_depth,
    snow24In,
    // Tags only — the narrative is its own field, and a report that carries a
    // narrative but no tags still needs a stamp, so fall back to the rating.
    stamp: powderDay ? "POWDER DAY" : tags
      || `${resort.cond_rating[0].toUpperCase()}${resort.cond_rating.slice(1)} conditions`,
    narrative,
  };
}
