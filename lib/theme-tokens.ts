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
