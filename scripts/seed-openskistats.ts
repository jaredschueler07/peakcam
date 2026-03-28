/**
 * seed-openskistats.ts
 * ────────────────────
 * Downloads the OpenSkiData GeoJSON (daily-updated, ODbL licensed)
 * and enriches our resort_metadata table with elevation, run/lift
 * counts, and the OpenSkiStats ID for each matched resort.
 *
 * Matching strategy (in priority order):
 *   1. Website URL overlap
 *   2. Name similarity + coordinate proximity (<10 km)
 *   3. Manual overrides (MANUAL_OVERRIDES below)
 *
 * Usage:
 *   npx tsx scripts/seed-openskistats.ts
 *   npx tsx scripts/seed-openskistats.ts --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Config ──────────────────────────────────────────────────

const GEOJSON_URL =
  "https://tiles.openskimap.org/geojson/ski_areas.geojson";

const DRY_RUN = process.argv.includes("--dry-run");

// Manual slug → OpenSkiData name overrides for tricky matches
const MANUAL_OVERRIDES: Record<string, string> = {
  "aspen-snowmass": "Aspen Snowmass",
  "beaver-creek": "Beaver Creek",
  "crested-butte": "Crested Butte Mountain Resort",
  "arapahoe-basin": "Arapahoe Basin",
  "winter-park": "Winter Park Resort",
  "steamboat": "Steamboat",
  "purgatory": "Purgatory Resort",
  "monarch": "Monarch Mountain",
  "mt-bachelor": "Mt. Bachelor",
  "stevens-pass": "Stevens Pass",
  "crystal-mountain-wa": "Crystal Mountain",
  "big-sky": "Big Sky Resort",
  "jackson-hole": "Jackson Hole Mountain Resort",
  "deer-valley": "Deer Valley Resort",
  "park-city": "Park City Mountain",
  "alta": "Alta Ski Area",
  "snowbird": "Snowbird",
  "mammoth": "Mammoth Mountain",
  "squaw-valley": "Palisades Tahoe",
  "palisades-tahoe": "Palisades Tahoe",
  "heavenly": "Heavenly Mountain Resort",
  "northstar": "Northstar California",
  "kirkwood": "Kirkwood Mountain Resort",
  "sugar-bowl": "Sugar Bowl",
  "diamond-peak": "Diamond Peak",
  "mt-rose": "Mount Rose",
  "sun-valley": "Sun Valley",
  "schweitzer": "Schweitzer Mountain",
  "taos": "Taos Ski Valley",
  "angel-fire": "Angel Fire Resort",
  "stowe": "Stowe Mountain Resort",
  "killington": "Killington",
  "sugarbush": "Sugarbush Resort",
  "sunday-river": "Sunday River",
  "sugarloaf": "Sugarloaf",
  "whiteface": "Whiteface Mountain",
  "gore-mountain": "Gore Mountain",
  "mount-snow": "Mount Snow",
  "stratton": "Stratton Mountain",
  "jay-peak": "Jay Peak",
  "loon": "Loon Mountain",
  "bretton-woods": "Bretton Woods",
  "cannon": "Cannon Mountain",
};

// ─── Load env ────────────────────────────────────────────────

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

loadEnv(path.join(ROOT, ".env.local"));
loadEnv(path.join(ROOT, ".env"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}

// ─── Types ───────────────────────────────────────────────────

interface SkiAreaFeature {
  type: "Feature";
  properties: {
    id: string;
    name: string | null;
    status: string;
    activities: string[];
    websites: string[];
    places: Array<{
      iso3166_2: string;
      iso3166_1Alpha2: string;
      localized?: { en?: { region?: string; country?: string; locality?: string } };
    }>;
    statistics?: {
      runs?: {
        byActivity?: {
          downhill?: {
            byDifficulty?: Record<
              string,
              { count: number; lengthInKm: number; maxElevation?: number; minElevation?: number }
            >;
          };
        };
      };
      lifts?: {
        byType?: Record<string, { count: number }>;
      };
      maxElevation?: number;
      minElevation?: number;
    };
  };
  geometry: { type: string; coordinates: unknown };
}

interface PeakCamResort {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  website_url: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────

function metersToFeet(m: number): number {
  return Math.round(m * 3.28084);
}

/** Haversine distance in km */
function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Normalize name for fuzzy comparison */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ski\s*(area|resort|mountain|center|valley)/gi, "")
    .replace(/mountain/gi, "")
    .replace(/resort/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/** Normalize URL for comparison */
function normalizeUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/** Get centroid from GeoJSON geometry */
function getCentroid(geometry: { type: string; coordinates: unknown }): [number, number] | null {
  if (geometry.type === "Point") {
    const coords = geometry.coordinates as [number, number];
    return [coords[1], coords[0]]; // [lat, lng]
  }
  if (geometry.type === "Polygon") {
    const ring = (geometry.coordinates as number[][][])[0];
    const sumLat = ring.reduce((s, c) => s + c[1], 0);
    const sumLng = ring.reduce((s, c) => s + c[0], 0);
    return [sumLat / ring.length, sumLng / ring.length];
  }
  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates as number[][][][];
    const ring = polys[0][0];
    const sumLat = ring.reduce((s, c) => s + c[1], 0);
    const sumLng = ring.reduce((s, c) => s + c[0], 0);
    return [sumLat / ring.length, sumLng / ring.length];
  }
  return null;
}

/** Count total runs from byDifficulty */
function countRuns(
  byDifficulty?: Record<string, { count: number }>
): number {
  if (!byDifficulty) return 0;
  return Object.values(byDifficulty).reduce((sum, d) => sum + d.count, 0);
}

/** Count total lifts from byType */
function countLifts(byType?: Record<string, { count: number }>): number {
  if (!byType) return 0;
  return Object.values(byType).reduce((sum, t) => sum + t.count, 0);
}

// ─── Supabase helpers ────────────────────────────────────────

async function fetchResorts(): Promise<PeakCamResort[]> {
  const url = `${SUPABASE_URL}/rest/v1/resorts?select=id,slug,name,lat,lng,website_url&is_active=eq.true`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch resorts: ${res.status}`);
  return res.json();
}

async function upsertMetadata(
  records: Array<{
    resort_id: string;
    openskistats_id: string;
    elevation_base_ft: number | null;
    elevation_summit_ft: number | null;
    vertical_drop_ft: number | null;
    run_count: number | null;
    lift_count: number | null;
  }>
) {
  if (records.length === 0) return;

  // Batch in groups of 50
  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    const url = `${SUPABASE_URL}/rest/v1/resort_metadata?on_conflict=resort_id`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Upsert failed (${res.status}): ${body}`);
    }
  }
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log("Downloading OpenSkiData GeoJSON...");
  const resp = await fetch(GEOJSON_URL);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const geojson = (await resp.json()) as { features: SkiAreaFeature[] };
  console.log(`  ${geojson.features.length} ski areas downloaded`);

  // Filter to US, operating, downhill areas with names
  const usAreas = geojson.features.filter((f) => {
    const props = f.properties;
    if (!props.name) return false;
    if (props.status !== "operating") return false;
    if (!props.activities?.includes("downhill")) return false;
    const isUS = (props.places || []).some(
      (p) => p.iso3166_1Alpha2 === "US"
    );
    return isUS;
  });
  console.log(`  ${usAreas.length} US operating downhill areas`);

  // Build lookup indexes
  const byNormalizedName = new Map<string, SkiAreaFeature[]>();
  const byUrl = new Map<string, SkiAreaFeature>();
  for (const area of usAreas) {
    const norm = normalizeName(area.properties.name!);
    if (!byNormalizedName.has(norm)) byNormalizedName.set(norm, []);
    byNormalizedName.get(norm)!.push(area);
    for (const url of area.properties.websites || []) {
      byUrl.set(normalizeUrl(url), area);
    }
  }

  // Fetch our resorts
  console.log("Fetching PeakCam resorts...");
  const resorts = await fetchResorts();
  console.log(`  ${resorts.length} active resorts`);

  const matched: Array<{
    resort: PeakCamResort;
    area: SkiAreaFeature;
    method: string;
  }> = [];
  const unmatched: PeakCamResort[] = [];

  for (const resort of resorts) {
    let found: SkiAreaFeature | null = null;
    let method = "";

    // 1. Manual override
    if (MANUAL_OVERRIDES[resort.slug]) {
      const overrideName = MANUAL_OVERRIDES[resort.slug];
      found =
        usAreas.find(
          (a) =>
            a.properties.name?.toLowerCase() === overrideName.toLowerCase()
        ) ?? null;
      if (found) method = "manual_override";
    }

    // 2. Website URL match
    if (!found && resort.website_url) {
      const normUrl = normalizeUrl(resort.website_url);
      const urlMatch = byUrl.get(normUrl);
      if (urlMatch) {
        found = urlMatch;
        method = "website_url";
      }
    }

    // 3. Normalized name + proximity
    if (!found) {
      const normSlug = normalizeName(resort.name);
      const candidates = byNormalizedName.get(normSlug);
      if (candidates) {
        // If only one candidate, take it
        if (candidates.length === 1) {
          found = candidates[0];
          method = "name_exact";
        } else {
          // Pick closest by distance
          let bestDist = Infinity;
          for (const c of candidates) {
            const centroid = getCentroid(c.geometry);
            if (!centroid) continue;
            const dist = haversineKm(resort.lat, resort.lng, centroid[0], centroid[1]);
            if (dist < bestDist && dist < 50) {
              bestDist = dist;
              found = c;
              method = `name_proximity(${dist.toFixed(1)}km)`;
            }
          }
        }
      }
    }

    // 4. Fuzzy: try slug-based name match
    if (!found) {
      const slugWords = resort.slug.replace(/-/g, "");
      const candidates = usAreas.filter((a) => {
        const norm = normalizeName(a.properties.name!);
        return norm === slugWords || norm.includes(slugWords) || slugWords.includes(norm);
      });
      if (candidates.length === 1) {
        found = candidates[0];
        method = "slug_fuzzy";
      } else if (candidates.length > 1) {
        // Pick closest
        let bestDist = Infinity;
        for (const c of candidates) {
          const centroid = getCentroid(c.geometry);
          if (!centroid) continue;
          const dist = haversineKm(resort.lat, resort.lng, centroid[0], centroid[1]);
          if (dist < bestDist && dist < 50) {
            bestDist = dist;
            found = c;
            method = `slug_proximity(${dist.toFixed(1)}km)`;
          }
        }
      }
    }

    // 5. Last resort: closest area within 10 km
    if (!found) {
      let bestDist = 10;
      for (const area of usAreas) {
        const centroid = getCentroid(area.geometry);
        if (!centroid) continue;
        const dist = haversineKm(resort.lat, resort.lng, centroid[0], centroid[1]);
        if (dist < bestDist) {
          bestDist = dist;
          found = area;
          method = `geo_nearest(${dist.toFixed(1)}km)`;
        }
      }
    }

    if (found) {
      matched.push({ resort, area: found, method });
    } else {
      unmatched.push(resort);
    }
  }

  console.log(`\nMatched: ${matched.length}/${resorts.length}`);
  if (unmatched.length > 0) {
    console.log(`Unmatched resorts:`);
    for (const r of unmatched) {
      console.log(`  - ${r.name} (${r.slug})`);
    }
  }

  // Build upsert records
  const records = matched.map(({ resort, area, method }) => {
    const stats = area.properties.statistics;
    const downhillRuns = stats?.runs?.byActivity?.downhill?.byDifficulty;
    const maxElev = stats?.maxElevation ?? null;
    const minElev = stats?.minElevation ?? null;

    const row = {
      resort_id: resort.id,
      openskistats_id: area.properties.id,
      elevation_base_ft: minElev != null ? metersToFeet(minElev) : null,
      elevation_summit_ft: maxElev != null ? metersToFeet(maxElev) : null,
      vertical_drop_ft:
        maxElev != null && minElev != null
          ? metersToFeet(maxElev - minElev)
          : null,
      run_count: downhillRuns ? countRuns(downhillRuns) : null,
      lift_count: stats?.lifts?.byType ? countLifts(stats.lifts.byType) : null,
    };

    console.log(
      `  ${resort.name.padEnd(35)} → ${(area.properties.name ?? "?").padEnd(35)} [${method}]` +
        (row.elevation_summit_ft
          ? ` ${row.elevation_summit_ft}ft summit`
          : "") +
        (row.run_count ? ` ${row.run_count} runs` : "")
    );

    return row;
  });

  if (DRY_RUN) {
    console.log("\n[DRY RUN] Would upsert:", records.length, "records");
    return;
  }

  console.log(`\nUpserting ${records.length} resort_metadata rows...`);
  await upsertMetadata(records);
  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
