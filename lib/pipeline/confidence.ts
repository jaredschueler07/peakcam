// ─────────────────────────────────────────────────────────────
// PeakCam — Confidence Scoring
// Computes per-dimension and overall confidence scores based on
// source count, agreement, and source reliability weights.
// ─────────────────────────────────────────────────────────────

// ── Dimension Confidence ────────────────────────────────────

/**
 * Compute confidence for a single dimension (e.g. snow depth)
 * given the numeric values from each source and their weights.
 *
 * - 0 sources → 0
 * - 1 source  → weight × 0.6  (single-source penalty)
 * - 2+ sources → agreement × avg(weights) × count_bonus
 *   where agreement = 1 - (stddev / mean), clamped [0, 1]
 *   and count_bonus = min(1.5, 1 + 0.1 × count)
 *
 * Result is clamped to [0, 1].
 */
export function computeDimensionConfidence(
  values: number[],
  weights: number[],
): number {
  if (values.length === 0) return 0;

  if (values.length === 1) {
    return Math.min(1, (weights[0] ?? 0.5) * 0.6);
  }

  // Average weight
  const avgWeight =
    weights.reduce((sum, w) => sum + w, 0) / weights.length;

  // Mean of values
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

  // Agreement: 1 - (stddev / |mean|), clamped to [0, 1]
  let agreement: number;
  if (mean === 0) {
    // All zeros → perfect agreement
    const allZero = values.every((v) => v === 0);
    agreement = allZero ? 1 : 0;
  } else {
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    agreement = Math.max(0, Math.min(1, 1 - stddev / Math.abs(mean)));
  }

  // Count bonus: more sources = more confident, up to 1.5×
  const countBonus = Math.min(1.5, 1 + 0.1 * values.length);

  return Math.min(1, agreement * avgWeight * countBonus);
}

// ── Dimension Weights for Overall Score ─────────────────────

const DIMENSION_WEIGHTS = {
  snow: 0.35,
  forecast: 0.25,
  ops: 0.2,
  qualitative: 0.2,
} as const;

export interface DimensionConfidences {
  snow: number;
  forecast: number;
  ops: number;
  qualitative: number;
}

/**
 * Weighted average of per-dimension confidence scores.
 */
export function computeOverallConfidence(
  dimensions: DimensionConfidences,
): number {
  return (
    dimensions.snow * DIMENSION_WEIGHTS.snow +
    dimensions.forecast * DIMENSION_WEIGHTS.forecast +
    dimensions.ops * DIMENSION_WEIGHTS.ops +
    dimensions.qualitative * DIMENSION_WEIGHTS.qualitative
  );
}
