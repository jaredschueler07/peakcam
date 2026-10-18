// ─────────────────────────────────────────────────────────────
// MCP server — catalogue helpers shared by the tools and the ask router.
//
// Pure functions over PublicApiCatalog / ResortWithData: slug lookup, the
// typo-tolerant name matcher search_resorts uses, and the serializer options
// mirror. Split out of tools.ts so lib/ask/* can import them without pulling
// in the tool definitions (tools.ts imports lib/ask/answer.ts for the `ask`
// tool, which would otherwise be a cycle). tools.ts re-exports everything
// here, so existing imports keep working.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData } from "@/lib/types";
import type { PublicApiCatalog } from "@/lib/public-api/data";
import type { ResortElevation, SerializeOptions } from "@/lib/public-api/serialize";

/**
 * Mirrors `optionsFor()` in lib/public-api/data.ts, which cannot be imported
 * here because that module pulls in next/cache and the Supabase client at
 * load time (the tests run without either). Keep the two in step.
 */
export function serializeOptionsFor(catalog: PublicApiCatalog, resort: ResortWithData): SerializeOptions {
  const row = catalog.elevations[resort.id];
  const elevation: ResortElevation | null = row ? { baseFt: row.base_ft, summitFt: row.summit_ft } : null;
  return { now: catalog.now, opening: catalog.openings.get(resort.id) ?? null, elevation };
}

/** Lowercase ASCII words: strips accents and punctuation (`Mt. Bachelor` → `mt bachelor`). */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const out = new Map<string, number>();
  const s = value.replace(/\s+/g, "");
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice similarity on character bigrams, 0..1. Cheap typo tolerance. */
export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ga = bigrams(a);
  const gb = bigrams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  const total = [...ga.values()].reduce((s, n) => s + n, 0) + [...gb.values()].reduce((s, n) => s + n, 0);
  return total ? (2 * overlap) / total : 0;
}

/**
 * Optimal-string-alignment edit distance (insert, delete, substitute, swap
 * adjacent). Catches the transpositions bigrams miss (`vial` → `vail`).
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array<number>(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/** 0 = no match; 100 = exact name or slug. */
export function scoreResort(query: string, resort: ResortWithData): number {
  const q = normalizeText(query);
  if (!q) return 0;
  const name = normalizeText(resort.name);
  const slug = resort.slug.replace(/-/g, " ");
  if (q === name || q === slug) return 100;
  if (name.startsWith(q) || slug.startsWith(q)) return 85;
  if (name.includes(q) || slug.includes(q)) return 70;
  const haystack = `${name} ${slug} ${normalizeText(resort.region)} ${normalizeText(resort.state)} ${normalizeText(resort.country)}`;
  if (q.split(" ").every((t) => haystack.includes(t))) return 50;
  const sim = Math.max(diceSimilarity(q, name), diceSimilarity(q, slug));
  if (sim >= 0.45) return Math.round(sim * 40);
  // One edit per four characters, at least one: a typo, not a different resort.
  const budget = Math.max(1, Math.floor(Math.min(q.length, name.length) / 4));
  const distance = Math.min(editDistance(q, name), editDistance(q, slug));
  return distance <= budget ? 30 - distance * 5 : 0;
}

export function sameCode(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeText(a ?? "") === normalizeText(b ?? "");
}

export interface MatchFilters {
  state?: string | null;
  country?: string | null;
  limit?: number;
}

/** Resorts ranked by `scoreResort`, filtered by state/country, zero scores dropped. */
export function matchResorts(resorts: readonly ResortWithData[], query: string, filters: MatchFilters = {}): ResortWithData[] {
  const limit = filters.limit ?? 10;
  return resorts
    .filter((r) => (!filters.state || sameCode(r.state, filters.state)) && (!filters.country || sameCode(r.country, filters.country)))
    .map((r) => ({ r, score: scoreResort(query, r) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.name.localeCompare(b.r.name, "en"))
    .slice(0, limit)
    .map((x) => x.r);
}

/** Up to five resorts whose slug or name is close to a slug that did not resolve. */
export function closeMatches(resorts: readonly ResortWithData[], slug: string, limit = 5): ResortWithData[] {
  return matchResorts(resorts, slug.replace(/-/g, " "), { limit });
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug);
}

export function findResort(catalog: PublicApiCatalog, slug: string): ResortWithData | null {
  if (!isValidSlug(slug)) return null;
  return catalog.resorts.find((r) => r.slug === slug) ?? null;
}
