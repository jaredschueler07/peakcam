// ─────────────────────────────────────────────────────────────
// PeakCam — User Reports Fetcher
// Queries recent user_conditions from Supabase and converts
// aggregate scores into a SourceReading.
// ─────────────────────────────────────────────────────────────

import { SourceReading, emptyReading, ResortContext } from "../types";
import { getUserConditions } from "../../supabase";
import { computeUserScore, type UserConditionReport } from "../../conditions-engine";

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

    // Compute individual dimension scores
    if (reports.length > 0) {
      const visScores: Record<string, number> = { clear: 1.0, foggy: 0.5, whiteout: 0.0 };
      const windScores: Record<string, number> = { calm: 1.0, breezy: 0.66, gusty: 0.33, high: 0.0 };

      const avgVis = reports.reduce((sum, r) => sum + (visScores[r.visibility] ?? 0.5), 0) / reports.length;
      const avgWind = reports.reduce((sum, r) => sum + (windScores[r.wind] ?? 0.5), 0) / reports.length;

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
