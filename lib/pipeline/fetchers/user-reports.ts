// ─────────────────────────────────────────────────────────────
// PeakCam — User Reports Fetcher
// Queries recent user_conditions from Supabase and converts
// aggregate scores into a SourceReading.
// ─────────────────────────────────────────────────────────────

import { SourceReading, emptyReading, ResortContext } from "../types";
import { getUserConditions } from "../../supabase";
import {
  computeUserScore,
  normalizeVisibility,
  normalizeWind,
  type UserConditionReport,
} from "../../conditions-engine";

export async function fetchUserReports(
  resort: ResortContext,
): Promise<SourceReading | null> {
  try {
    const conditions = await getUserConditions(resort.id, 50);
    if (!conditions || conditions.length === 0) return null;

    // Convert DB rows to the format computeUserScore expects
    const reports: UserConditionReport[] = conditions.map((c) => ({
      snow_quality: c.snow_quality,
      visibility: c.visibility,
      wind: c.wind,
      trail_conditions: c.trail_conditions,
    }));

    const qualityScore = computeUserScore(reports);

    const reading = emptyReading(resort.id, "user_reports");

    reading.quality_score = qualityScore;

    // SourceReading.visibility_score / wind_score are normalized 0.0–1.0
    // (data_source_readings numeric(3,2)), so derive them from the engine's
    // canonical maps via normalizeVisibility / normalizeWind — the same maps
    // computeUserScore builds quality_score from. lib/pipeline/fetchers/
    // user-reports.test.ts fails if a literal score table reappears here.
    if (reports.length > 0) {
      const avgVis = reports.reduce((sum, r) => sum + normalizeVisibility(r.visibility), 0) / reports.length;
      const avgWind = reports.reduce((sum, r) => sum + normalizeWind(r.wind), 0) / reports.length;

      reading.visibility_score = Math.round(avgVis * 100) / 100;
      reading.wind_score = Math.round(avgWind * 100) / 100;
    }

    // Confidence scales with report count — more reports = more reliable
    reading.source_confidence = Math.min(0.3 + conditions.length * 0.05, 0.8);

    reading.raw_json = {
      report_count: conditions.length,
      reports: reports.slice(0, 5), // Store a sample, not all
    };

    return reading;
  } catch (err) {
    console.warn(`[PeakCam] User reports fetch failed for ${resort.slug}:`, err);
    return null;
  }
}
