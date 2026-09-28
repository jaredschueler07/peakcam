import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EARTH_RADIUS_MILES,
  NEARBY_DEFAULT_LIMIT,
  NEARBY_DEFAULT_MAX_MILES,
  formatMiles,
  haversineMiles,
  nearbyResorts,
  summarizeNearby,
  type NearbyHit,
  type NearbyResortLike,
  type NearbySummaryResortLike,
} from "./geo";

/** Miles per degree of arc on the sphere `haversineMiles` assumes. */
const MILES_PER_DEGREE = (2 * Math.PI * EARTH_RADIUS_MILES) / 360;

function near(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

// ── haversineMiles ───────────────────────────────────────────────────────────

test("haversineMiles: a point is zero miles from itself", () => {
  assert.equal(haversineMiles({ lat: 39.6433, lng: -106.3781 }, { lat: 39.6433, lng: -106.3781 }), 0);
  assert.equal(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
});

test("haversineMiles: is symmetric", () => {
  const vail = { lat: 39.6433, lng: -106.3781 };
  const portillo = { lat: -32.8353, lng: -70.1289 };
  assert.equal(haversineMiles(vail, portillo), haversineMiles(portillo, vail));
});

test("haversineMiles: one degree of arc is ~69.09 miles, a quarter turn is πR/2, antipodes are πR", () => {
  near(haversineMiles({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }), MILES_PER_DEGREE, 0.001, "1° latitude");
  near(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }), MILES_PER_DEGREE, 0.001, "1° longitude on the equator");
  near(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 90 }), (Math.PI / 2) * EARTH_RADIUS_MILES, 0.01, "quarter turn");
  near(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: 180 }), Math.PI * EARTH_RADIUS_MILES, 0.01, "antipodes");
  near(haversineMiles({ lat: 90, lng: 0 }, { lat: -90, lng: 0 }), Math.PI * EARTH_RADIUS_MILES, 0.01, "pole to pole");
});

test("haversineMiles: matches the textbook New York → London figure (~3,461 mi)", () => {
  const nyc = { lat: 40.7128, lng: -74.006 };
  const london = { lat: 51.5074, lng: -0.1278 };
  near(haversineMiles(nyc, london), 3461, 5, "NYC→London");
});

test("haversineMiles: Vail → Breckenridge is ~20 miles as the crow flies", () => {
  const vail = { lat: 39.6433, lng: -106.3781 };
  const breck = { lat: 39.4817, lng: -106.067 };
  near(haversineMiles(vail, breck), 20, 1, "Vail→Breck");
});

test("haversineMiles: longitude wraps across the antimeridian", () => {
  // 179.5°E and 179.5°W are one degree apart, not 359.
  near(haversineMiles({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 }), MILES_PER_DEGREE, 0.001, "antimeridian");
});

test("haversineMiles: a NaN coordinate yields NaN rather than throwing", () => {
  assert.ok(Number.isNaN(haversineMiles({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 })));
  assert.ok(Number.isNaN(haversineMiles({ lat: 0, lng: 0 }, { lat: 0, lng: NaN })));
});

// ── formatMiles ──────────────────────────────────────────────────────────────

test("formatMiles: whole miles, with anything under half a mile reading '<1 mi'", () => {
  assert.equal(formatMiles(0), "<1 mi");
  assert.equal(formatMiles(0.3), "<1 mi");
  assert.equal(formatMiles(0.49), "<1 mi");
  assert.equal(formatMiles(0.5), "1 mi");
  assert.equal(formatMiles(1), "1 mi");
  assert.equal(formatMiles(13.4), "13 mi");
  assert.equal(formatMiles(13.5), "14 mi");
  assert.equal(formatMiles(149.9), "150 mi");
});

// ── nearbyResorts ────────────────────────────────────────────────────────────

const CAM = [{ is_active: true }];
const NO_CAM: { is_active: boolean }[] = [];

/** A resort on the equator, `lngDeg` degrees east of the origin → `lngDeg * 69.09` miles away. */
function r(
  slug: string,
  lngDeg: number,
  overrides: Partial<NearbyResortLike> = {},
): NearbyResortLike {
  return { slug, name: slug, lat: 0, lng: lngDeg, is_active: true, cams: CAM, ...overrides };
}

const ORIGIN = { slug: "origin", lat: 0, lng: 0 };

const slugs = (hits: readonly NearbyHit[]) => hits.map((hit) => hit.resort.slug);

test("nearbyResorts: nearest first, self and inactive rows excluded, radius inclusive of the default 150 mi", () => {
  const all = [
    r("c", 1.0), // ~69 mi
    r("origin", 0), // self
    r("a", 0.1), // ~7 mi
    r("d", 2.5), // ~173 mi — outside the radius
    r("inactive", 0.05, { is_active: false }),
    r("b", 0.5), // ~35 mi
  ];
  const hits = nearbyResorts(ORIGIN, all);
  assert.deepEqual(slugs(hits), ["a", "b", "c"]);
  near(hits[0].miles, 0.1 * MILES_PER_DEGREE, 0.001, "a");
  near(hits[1].miles, 0.5 * MILES_PER_DEGREE, 0.001, "b");
  near(hits[2].miles, 1.0 * MILES_PER_DEGREE, 0.001, "c");
  for (const hit of hits) assert.ok(hit.miles <= NEARBY_DEFAULT_MAX_MILES);
});

test("nearbyResorts: honours limit and maxMiles", () => {
  const all = [r("a", 0.1), r("b", 0.5), r("c", 1.0), r("d", 1.5), r("e", 2.0), r("f", 2.1)];
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, all)), ["a", "b", "c", "d", "e"], "default limit is 5");
  assert.equal(NEARBY_DEFAULT_LIMIT, 5);
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, all, { limit: 2 })), ["a", "b"]);
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, all, { maxMiles: 50 })), ["a", "b"]);
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, all, { limit: 1, maxMiles: 50 })), ["a"]);
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, all, { limit: 0 })), []);
  // maxMiles is inclusive: a resort exactly on the boundary stays in.
  const boundary = [r("edge", 0.5)];
  const edgeMiles = nearbyResorts(ORIGIN, boundary)[0].miles;
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, boundary, { maxMiles: edgeMiles })), ["edge"]);
});

test("nearbyResorts: skips rows without finite coordinates and returns [] for an origin without them", () => {
  const all = [r("nan-lat", 0.1, { lat: NaN }), r("nan-lng", 0.2, { lng: NaN }), r("ok", 0.3)];
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, all)), ["ok"]);
  assert.deepEqual(nearbyResorts({ slug: "x", lat: NaN, lng: 0 }, all), []);
  assert.deepEqual(nearbyResorts({ slug: "x", lat: 0, lng: Infinity }, all), []);
  assert.deepEqual(nearbyResorts(ORIGIN, []), []);
});

test("nearbyResorts: a tie in displayed (whole-mile) distance goes to the resort with a live cam", () => {
  const all = [
    r("near-no-cam", 0.1995, { cams: NO_CAM }), // ~13.78 mi → "14 mi"
    r("far-with-cam", 0.2005), // ~13.85 mi → "14 mi"
    r("disabled-cam", 0.2, { cams: [{ is_active: false }] }), // ~13.82 mi → "14 mi"; a disabled cam is no cam
  ];
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, all)), ["far-with-cam", "near-no-cam", "disabled-cam"]);
});

test("nearbyResorts: a closer whole-mile distance beats a cam", () => {
  const all = [r("with-cam", 0.2005), r("closer-no-cam", 0.19, { cams: NO_CAM })]; // ~13 mi vs ~14 mi
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, all)), ["closer-no-cam", "with-cam"]);
});

test("nearbyResorts: identical distance and cam status falls back to accent-folded name, so the order never flips", () => {
  const all = [
    r("z", 0.2, { name: "Zermatt" }),
    r("l", 0.2, { name: "Las Leñas" }),
    r("a", 0.2, { name: "alta" }),
  ];
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, all)), ["a", "l", "z"]);
  assert.deepEqual(slugs(nearbyResorts(ORIGIN, [...all].reverse())), ["a", "l", "z"]);
});

test("nearbyResorts: does not mutate the input list", () => {
  const all = [r("b", 0.5), r("a", 0.1)];
  const before = all.map((x) => x.slug);
  nearbyResorts(ORIGIN, all);
  assert.deepEqual(all.map((x) => x.slug), before);
});

// ── summarizeNearby ──────────────────────────────────────────────────────────

function full(
  slug: string,
  overrides: Partial<NearbySummaryResortLike> = {},
): NearbySummaryResortLike {
  return {
    slug,
    name: slug,
    lat: 0,
    lng: 0,
    is_active: true,
    cams: [{ is_active: true }, { is_active: false }, { is_active: true }],
    cond_rating: "good",
    snow_report: { base_depth: 42, new_snow_24h: 6 },
    ...overrides,
  };
}

test("summarizeNearby: flattens each hit to the card fields, counting active cams only", () => {
  const hits: NearbyHit<NearbySummaryResortLike>[] = [
    { resort: full("copper-mountain", { name: "Copper Mountain" }), miles: 4.6 },
    { resort: full("keystone", { name: "Keystone Resort", cams: [], cond_rating: "great" }), miles: 10.6 },
  ];
  assert.deepEqual(summarizeNearby(hits), [
    { slug: "copper-mountain", name: "Copper Mountain", miles: 4.6, baseDepth: 42, newSnow24h: 6, camCount: 2, rating: "good" },
    { slug: "keystone", name: "Keystone Resort", miles: 10.6, baseDepth: 42, newSnow24h: 6, camCount: 0, rating: "great" },
  ]);
});

test("summarizeNearby: missing report, non-finite numbers and unknown ratings become null", () => {
  const [noReport, badNumbers, badRating] = summarizeNearby([
    { resort: full("no-report", { snow_report: null }), miles: 1 },
    { resort: full("bad-numbers", { snow_report: { base_depth: NaN, new_snow_24h: null } }), miles: 2 },
    { resort: full("bad-rating", { cond_rating: "epic" as unknown as NearbySummaryResortLike["cond_rating"] }), miles: 3 },
  ]);
  assert.equal(noReport.baseDepth, null);
  assert.equal(noReport.newSnow24h, null);
  assert.equal(badNumbers.baseDepth, null);
  assert.equal(badNumbers.newSnow24h, null);
  assert.equal(badRating.rating, null);
  assert.equal(summarizeNearby([]).length, 0);
});

// ── Against the real catalogue ───────────────────────────────────────────────

interface CsvResort extends NearbyResortLike {
  state: string;
}

function loadCsvResorts(): CsvResort[] {
  const raw = readFileSync(new URL("../data/resorts.csv", import.meta.url), "utf8");
  // Same plain splitter as lib/hubs.test.ts — the catalogue has no quoted cells.
  assert.equal(raw.includes('"'), false, "data/resorts.csv gained quoted cells — upgrade the test's CSV splitter");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const header = lines[0].split(",");
  const col = (name: string) => {
    const index = header.indexOf(name);
    assert.notEqual(index, -1, `data/resorts.csv has no ${name} column`);
    return index;
  };
  const iName = col("name");
  const iSlug = col("slug");
  const iState = col("state");
  const iLat = col("lat");
  const iLng = col("lng");
  const iActive = col("is_active");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return {
      slug: cells[iSlug],
      name: cells[iName],
      state: cells[iState],
      lat: Number(cells[iLat]),
      lng: Number(cells[iLng]),
      is_active: cells[iActive].trim() === "true",
      cams: NO_CAM,
    };
  });
}

const CSV = loadCsvResorts();

test("catalogue: every resort has finite coordinates, so no page loses its neighbours to a bad cell", () => {
  for (const resort of CSV) {
    assert.ok(Number.isFinite(resort.lat) && Math.abs(resort.lat) <= 90, `${resort.slug} lat ${resort.lat}`);
    assert.ok(Number.isFinite(resort.lng) && Math.abs(resort.lng) <= 180, `${resort.slug} lng ${resort.lng}`);
  }
});

test("catalogue: every resort's list is ≤5, within 150 mi, self-free and in non-decreasing displayed distance", () => {
  for (const origin of CSV) {
    const hits = nearbyResorts(origin, CSV);
    assert.ok(hits.length <= NEARBY_DEFAULT_LIMIT, origin.slug);
    let last = -1;
    for (const hit of hits) {
      assert.notEqual(hit.resort.slug, origin.slug, `${origin.slug} lists itself`);
      assert.ok(hit.miles <= NEARBY_DEFAULT_MAX_MILES, `${origin.slug} → ${hit.resort.slug} is ${hit.miles} mi`);
      const shown = Math.round(hit.miles);
      assert.ok(shown >= last, `${origin.slug}: ${hit.resort.slug} out of order`);
      last = shown;
    }
  }
});

test("catalogue: Breckenridge's nearest neighbour is Copper Mountain, with Keystone in the top five", () => {
  const breck = CSV.find((resort) => resort.slug === "breckenridge");
  assert.ok(breck, "breckenridge missing from data/resorts.csv");
  const hits = nearbyResorts(breck, CSV);
  assert.equal(hits[0].resort.slug, "copper-mountain");
  assert.ok(hits[0].miles < 6, `Copper is ${hits[0].miles} mi from Breck`);
  assert.ok(slugs(hits).includes("keystone"));
});

// Exercises the empty state on a real page. Nearest catalogue resort is Cerro
// Mirador (Punta Arenas) at ~163 mi, so a widened radius would need a new case.
test("catalogue: Cerro Castor at the tip of South America has no neighbour within 150 mi", () => {
  const castor = CSV.find((resort) => resort.slug === "cerro-castor");
  assert.ok(castor, "cerro-castor missing from data/resorts.csv");
  assert.deepEqual(nearbyResorts(castor, CSV), []);
});

test("catalogue: the Andes resorts never list a North American neighbour", () => {
  for (const origin of CSV.filter((resort) => resort.lat < 0)) {
    for (const hit of nearbyResorts(origin, CSV)) {
      assert.ok(hit.resort.lat < 0, `${origin.slug} → ${hit.resort.slug}`);
    }
  }
});
