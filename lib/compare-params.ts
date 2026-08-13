/**
 * Parsing helpers for the `?resorts=` query parameter on /compare.
 *
 * Next.js hands `searchParams` values back as `string | string[] | undefined`:
 * a repeated key (`?resorts=vail&resorts=bear-mountain`) arrives as an ARRAY,
 * while a single key (`?resorts=vail,bear-mountain`) arrives as a string. Both
 * shapes are legal URLs people share, so both have to be handled — calling
 * `.split()` on the array form throws a TypeError and takes the whole Server
 * Component (and `generateMetadata`) down with a 500.
 *
 * Pure module: no imports, no env, safe to unit test.
 */

/** Maximum number of resorts that can be compared side by side. */
export const MAX_COMPARE_RESORTS = 4;

/**
 * Normalise the raw `resorts` search param into a clean, capped slug list.
 *
 * Handles: undefined/null, a single slug, a comma list, a repeated param
 * (array), an array of comma lists, stray whitespace, empty segments,
 * duplicates and over-long lists. Never throws.
 */
export function parseCompareSlugs(
  input: string | string[] | undefined | null,
  max: number = MAX_COMPARE_RESORTS,
): string[] {
  if (input == null || max <= 0) return [];

  const entries = Array.isArray(input) ? input : [input];
  const slugs: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    for (const part of entry.split(",")) {
      const slug = part.trim().toLowerCase();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      slugs.push(slug);
      if (slugs.length >= max) return slugs;
    }
  }

  return slugs;
}

/** Build the canonical shareable /compare URL for a set of slugs. */
export function buildCompareHref(slugs: string[]): string {
  const clean = parseCompareSlugs(slugs);
  if (clean.length === 0) return "/compare";
  return `/compare?resorts=${clean.map(encodeURIComponent).join(",")}`;
}
