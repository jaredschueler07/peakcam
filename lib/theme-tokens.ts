import type { ConditionRating } from "./types";
import { RATING_ORDER } from "./conditions-engine";

/**
 * The bark scale, for code that can't use a Tailwind class.
 *
 * Canvas painting, inline SVG, and MapLibre paint expressions all need a
 * literal hex, so each of those call sites used to carry its own copy of the
 * palette with a `// pc-bark` comment next to it. That drifted: `--pc-bark`
 * was darkened from #7a5a3a to #63482d for WCAG AA, and the copies weren't.
 *
 * These must stay in sync with `--pc-bark*` in `app/globals.css` and the
 * `bark` scale in `tailwind.config.ts`. `lib/theme-tokens.test.ts` reads
 * globals.css and fails the build if they drift again.
 */

/** Muted text / axis labels on light surfaces. Do not use on ink — 1.9:1. */
export const PC_BARK = "#63482d";

/** Muted text on ink and other dark surfaces (6.1:1), and neutral fills. */
export const PC_BARK_50 = "#b59b74";

/** The darkest bark — map labels, subtle text that still needs to read. */
export const PC_BARK_DK = "#4a3620";

// ── Condition rating palette ─────────────────────────────────
//
// The four rating hues had seven independent definitions: Tailwind chip maps
// in ConditionBadge, MapPopupCard, MapBottomSheet, ComparePage,
// SummitResortCard and DashboardWidget; raw hexes in map-utils, MapLegend and
// MapView's MapLibre paint expression. The marker, the legend swatch and the
// chip for one resort were three separate copies of the same four colors.

/**
 * Rating hexes, for code that cannot use a Tailwind class: MapLibre paint
 * expressions, inline SVG, canvas. Must match `--pc-great`/`-good`/`-fair`/
 * `-poor` in `app/globals.css`; `lib/theme-tokens.test.ts` enforces it.
 */
export const RATING_COLORS: Record<ConditionRating, string> = {
  great: "#3c5a3a", // pc-forest
  good: "#6d8a4a", // pc-good (moss)
  fair: "#e2a740", // pc-mustard
  poor: "#a93f20", // pc-alpen-dk
};

/** Neutral fill for off-season / closed markers and chips (hue-neutral bark). */
export const OFF_SEASON_COLOR = PC_BARK_50;

/**
 * Chip styling for a rating: background, foreground and border in one string.
 *
 * The class names are written out literally and completely — Tailwind's JIT
 * scanner reads source text, so a constructed name like `bg-${rating}` would
 * compile to nothing. Foreground is not uniform: mustard "fair" needs ink text
 * (cream on mustard is 1.7:1), the other three take cream.
 */
export const RATING_CHIP_CLASS: Record<ConditionRating, string> = {
  great: "bg-great text-cream-50 border-forest-dk",
  good: "bg-good text-cream-50 border-forest-dk",
  fair: "bg-fair text-ink border-bark-dk",
  poor: "bg-poor text-cream-50 border-bark-dk",
};

/** Dot color inside a condition chip — the chip's own foreground. */
export const RATING_DOT_CLASS: Record<ConditionRating, string> = {
  great: "bg-cream-50",
  good: "bg-cream-50",
  fair: "bg-ink",
  poor: "bg-cream-50",
};

/** "great" → "Great". Display only; the stored value stays lowercase. */
export function ratingLabel(rating: string): string {
  return rating.charAt(0).toUpperCase() + rating.slice(1);
}

/**
 * Sort rank, best first: great 0 … poor 3. Derived from the engine's
 * RATING_ORDER (which runs worst-first, for tier arithmetic) so the two can
 * never disagree about what "better" means.
 */
export const CONDITION_ORDER: Record<ConditionRating, number> = Object.fromEntries(
  RATING_ORDER.map((r, i) => [r, RATING_ORDER.length - 1 - i]),
) as Record<ConditionRating, number>;
