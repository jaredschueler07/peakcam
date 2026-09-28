import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HUB_BASE_PATH,
  REGION_HUB_MIN_COUNT,
  STATE_NAMES,
  slugifyHub,
  stateLabel,
  stateHubKind,
  stateHub,
  stateHubPath,
  regionHubPath,
  hubPath,
  groupByState,
  groupByRegion,
  listHubs,
  regionHubsForState,
  resolveHub,
  hubSlugCollisions,
  hubSummary,
  neighbouringStates,
  neighbouringStateHubs,
  type HubResortLike,
  type HubSummaryResortLike,
} from "./hubs";
import type { ConditionRating } from "./types";

// ── Catalogue values ─────────────────────────────────────────────────────────
// Every distinct `state` and `region` in data/resorts.csv at the time the hubs
// shipped. The CSV-backed tests below check these are still present (so a
// rename shows up here) while letting the catalogue grow without edits.

const CSV_STATE_VALUES = [
  "CA", "CO", "VT", "Chile", "UT", "Argentina", "WA", "NH", "OR", "ID", "NM", "NY", "MT",
  "BC", "MI", "MA", "ME", "MN", "NV", "PA", "WY", "AZ", "MD", "VA", "WI", "WV",
];

const CSV_REGION_VALUES = [
  "Lake Tahoe", "Green Mountains", "White Mountains", "Central Andes", "Southern California",
  "Argentine Lake District", "Cascade Range", "Summit County", "Catskills", "Central Sierra",
  "Elk Mountains", "Mt. Hood", "San Juan Mountains", "Sangre de Cristo", "Wasatch Range",
  "Adirondacks", "Araucanía Andes", "Big Cottonwood Canyon", "Eastern Sierra", "Front Range",
  "Gallatin Range", "Lake District", "Little Cottonwood Canyon", "Neuquén Andes",
  "Northern Michigan", "Northern Vermont", "Northern Wasatch", "Teton Range", "West-Central Idaho",
  "Western Maine", "Andes de Mendoza", "Appalachians", "Beartooth Range", "Berkshires",
  "Bitterroot Mountains", "Blue Mountains", "Blue Ridge Mountains", "Boise Mountains",
  "Central Massachusetts", "Clear Creek County", "Coast Mountains", "Colorado Rockies", "Duluth",
  "Eagle County", "Eastern Cascades", "Glacier Country", "Grand County", "Grand Mesa", "Lake County",
  "Laurel Highlands", "Moreno Valley", "North Cascades", "North Shore", "Northeast Kingdom",
  "Northern California", "Okanagan Highlands", "Park Range", "Patagonia", "Pocono Mountains",
  "Rib Mountain", "Sacramento Mountains", "San Francisco Peaks", "Sawatch Range", "Selkirk Mountains",
  "Southern Utah", "Southern Vermont", "Thompson-Okanagan", "Tierra del Fuego", "Upper Peninsula",
  "Wood River Valley", "Ñuble Andes",
];

interface CsvResort extends HubResortLike {
  state: string;
  region: string;
}

function loadCsvResorts(): CsvResort[] {
  const raw = readFileSync(new URL("../data/resorts.csv", import.meta.url), "utf8");
  // The catalogue has no quoted cells today; a plain split is exact. If a
  // name ever needs quoting, this loader needs a quote-aware splitter.
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
  const iRegion = col("region");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return { name: cells[iName], slug: cells[iSlug], state: cells[iState], region: cells[iRegion] };
  });
}

const CSV = loadCsvResorts();

function r(slug: string, state: string, region: string, name = slug): HubResortLike {
  return { slug, name, state, region };
}

function s(
  slug: string,
  name: string,
  base: number | null,
  new24: number | null,
  rating: ConditionRating | null,
  updated: string | null,
): HubSummaryResortLike {
  return {
    slug,
    name,
    cond_rating: rating,
    snow_report: updated === null && base === null && new24 === null
      ? null
      : { base_depth: base, new_snow_24h: new24, updated_at: updated ?? "" },
  };
}

// ── Slugs, labels, paths ─────────────────────────────────────────────────────

test("slugifyHub folds accents, spells out ampersands, collapses punctuation", () => {
  assert.equal(slugifyHub("Nevados de Chillán"), "nevados-de-chillan");
  assert.equal(slugifyHub("Ñuble Andes"), "nuble-andes");
  assert.equal(slugifyHub("Araucanía Andes"), "araucania-andes");
  assert.equal(slugifyHub("Neuquén Andes"), "neuquen-andes");
  assert.equal(slugifyHub("Alta & Snowbird"), "alta-and-snowbird");
  assert.equal(slugifyHub("Mt. Hood"), "mt-hood");
  assert.equal(slugifyHub("Thompson-Okanagan"), "thompson-okanagan");
  assert.equal(slugifyHub("  West-Central   Idaho "), "west-central-idaho");
  assert.equal(slugifyHub("--Lake--Tahoe--"), "lake-tahoe");
  assert.equal(
    slugifyHub("Volcán Osorno (Centro de Ski y Montaña Volcán Osorno)"),
    "volcan-osorno-centro-de-ski-y-montana-volcan-osorno",
  );
  assert.equal(slugifyHub("British Columbia"), "british-columbia");
  assert.equal(slugifyHub(""), "");
  assert.equal(slugifyHub("   "), "");
  assert.equal(slugifyHub("&"), "and");
});

test("stateLabel and stateHub classify codes, provinces and country names", () => {
  assert.equal(stateLabel("CO"), "Colorado");
  assert.equal(stateLabel("co"), "Colorado");
  assert.equal(stateLabel(" NH "), "New Hampshire");
  assert.equal(stateLabel("BC"), "British Columbia");
  assert.equal(stateLabel("Chile"), "Chile");
  assert.equal(stateLabel("Argentina"), "Argentina");
  assert.equal(stateLabel("XX"), "XX");
  assert.equal(STATE_NAMES.CO, "Colorado");

  assert.deepEqual(stateHub("CO"), { key: "CO", slug: "colorado", label: "Colorado", kind: "state" });
  assert.deepEqual(stateHub("BC"), { key: "BC", slug: "british-columbia", label: "British Columbia", kind: "province" });
  assert.deepEqual(stateHub("Chile"), { key: "Chile", slug: "chile", label: "Chile", kind: "country" });
  assert.deepEqual(stateHub("co"), stateHub("CO"));
  // An unknown two-letter code is still a state, never a "country" called XX.
  assert.equal(stateHubKind("XX"), "state");
  assert.equal(stateHubKind("Andorra"), "country");
});

test("hub paths live under /ski-cams and use the slugified label", () => {
  assert.equal(HUB_BASE_PATH, "/ski-cams");
  assert.equal(REGION_HUB_MIN_COUNT, 3);
  assert.equal(stateHubPath("CO"), "/ski-cams/colorado");
  assert.equal(stateHubPath("NH"), "/ski-cams/new-hampshire");
  assert.equal(stateHubPath("Chile"), "/ski-cams/chile");
  assert.equal(stateHubPath("BC"), "/ski-cams/british-columbia");
  assert.equal(regionHubPath("Lake Tahoe"), "/ski-cams/lake-tahoe");
  assert.equal(regionHubPath("Ñuble Andes"), "/ski-cams/nuble-andes");
  assert.equal(hubPath({ slug: "summit-county" }), "/ski-cams/summit-county");
});

test("every state value in data/resorts.csv has a full-name label and the right kind", () => {
  const distinct = new Set(CSV.map((resort) => resort.state));
  for (const value of CSV_STATE_VALUES) {
    assert.ok(distinct.has(value), `enumerated state ${value} is no longer in data/resorts.csv`);
  }
  for (const value of distinct) {
    const hub = stateHub(value);
    if (value === "Chile" || value === "Argentina") {
      assert.equal(hub.kind, "country");
      assert.equal(hub.label, value);
    } else if (value === "BC") {
      assert.equal(hub.kind, "province");
      assert.equal(hub.label, "British Columbia");
    } else {
      assert.equal(hub.kind, "state", value);
      assert.notEqual(hub.label, value, `no full name for ${value}`);
      assert.ok(hub.label.length > 2, value);
    }
    assert.match(hub.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `bad slug for ${value}: ${hub.slug}`);
  }
});

// ── Grouping ─────────────────────────────────────────────────────────────────

const FIX = [
  r("b-peak", "VT", "Green Mountains", "B Peak"),
  r("a-peak", "VT", "Green Mountains", "A Peak"),
  r("c-mtn", "CO", "Summit County", "C Mountain"),
  r("d-mtn", "CO", "Front Range", "D Mountain"),
  r("e-mtn", "NH", "White Mountains", "E Mountain"),
  r("f-mtn", "NH", "White Mountains", "F Mountain"),
  r("portillo", "Chile", "Central Andes", "Portillo"),
  r("las-lenas", "Argentina", "Andes de Mendoza", "Las Leñas"),
  r("no-state", "", "Nowhere", "Orphan"),
];

test("groupByState orders by count desc then label, members by name, and drops blank states", () => {
  const groups = groupByState(FIX);
  assert.deepEqual(
    groups.map((group) => [group.hub.label, group.count]),
    [["Colorado", 2], ["New Hampshire", 2], ["Vermont", 2], ["Argentina", 1], ["Chile", 1]],
  );
  const vermont = groups.find((group) => group.hub.key === "VT")!;
  assert.deepEqual(vermont.resorts.map((resort) => resort.name), ["A Peak", "B Peak"]);
  assert.equal(vermont.hub.slug, "vermont");
  assert.equal(groups.find((group) => group.hub.key === "Chile")!.hub.kind, "country");
  assert.equal(groups.some((group) => group.hub.key === ""), false);
  assert.equal(groupByState([]).length, 0);
});

const REGIONS = [
  r("heavenly", "CA", "Lake Tahoe", "Heavenly"),
  r("palisades", "CA", "Lake Tahoe", "Palisades Tahoe"),
  r("northstar", "CA", "Lake Tahoe", "Northstar"),
  r("mt-rose", "NV", "Lake Tahoe", "Mt. Rose"),
  r("diamond-peak", "NV", "Lake Tahoe", "Diamond Peak"),
  r("timberline", "OR", "Mt. Hood", "Timberline"),
  r("meadows", "OR", "Mt Hood", "Mt. Hood Meadows"),
  r("skibowl", "OR", "Mt. Hood", "Skibowl"),
  r("big-sky", "MT", "Gallatin Range", "Big Sky"),
  r("bridger", "MT", "Gallatin Range", "Bridger Bowl"),
  r("blank", "MT", "   ", "Blank Region"),
];

test("groupByRegion applies minCount, spans states, and merges spellings by slug", () => {
  const groups = groupByRegion(REGIONS);
  assert.deepEqual(groups.map((group) => [group.hub.slug, group.count]), [["lake-tahoe", 5], ["mt-hood", 3]]);

  const tahoe = groups[0];
  assert.deepEqual(tahoe.hub, { key: "Lake Tahoe", slug: "lake-tahoe", label: "Lake Tahoe", kind: "region", stateCodes: ["CA", "NV"] });
  assert.deepEqual(tahoe.resorts.map((resort) => resort.slug), ["diamond-peak", "heavenly", "mt-rose", "northstar", "palisades"]);

  const hood = groups[1];
  assert.equal(hood.hub.label, "Mt. Hood", "the most common spelling is the label");
  assert.equal(hood.hub.key, "Mt. Hood");
  assert.deepEqual(hood.hub.stateCodes, ["OR"]);

  const all = groupByRegion(REGIONS, 1);
  assert.deepEqual(all.map((group) => group.hub.slug), ["lake-tahoe", "mt-hood", "gallatin-range"]);
  assert.equal(all.some((group) => group.hub.slug === ""), false, "blank regions never form a hub");
  assert.equal(groupByRegion(REGIONS, 6).length, 0);
});

test("CSV: state and region groups reproduce the row counts", () => {
  const expectedStates = new Map<string, number>();
  const expectedRegions = new Map<string, number>();
  for (const resort of CSV) {
    expectedStates.set(resort.state, (expectedStates.get(resort.state) ?? 0) + 1);
    const slug = slugifyHub(resort.region);
    expectedRegions.set(slug, (expectedRegions.get(slug) ?? 0) + 1);
  }

  const states = groupByState(CSV);
  assert.equal(states.length, expectedStates.size);
  for (const group of states) {
    assert.equal(group.count, expectedStates.get(group.hub.key), group.hub.key);
    assert.equal(group.resorts.length, group.count);
  }
  for (let i = 1; i < states.length; i++) {
    assert.ok(states[i - 1].count >= states[i].count, "count desc");
  }
  assert.equal(states[0].hub.key, "CA");
  assert.ok(states[0].count >= 20);

  const regions = groupByRegion(CSV);
  const expectedHubSlugs = [...expectedRegions].filter(([, count]) => count >= REGION_HUB_MIN_COUNT).map(([slug]) => slug).sort();
  assert.deepEqual(regions.map((group) => group.hub.slug).sort(), expectedHubSlugs);
  for (const group of regions) {
    assert.equal(group.count, expectedRegions.get(group.hub.slug), group.hub.slug);
    assert.ok(group.hub.stateCodes.length >= 1, group.hub.slug);
  }

  const tahoe = regions.find((group) => group.hub.slug === "lake-tahoe")!;
  assert.deepEqual(tahoe.hub.stateCodes, ["CA", "NV"]);
  assert.ok(tahoe.count >= 10);
  const cascades = regions.find((group) => group.hub.slug === "cascade-range")!;
  assert.deepEqual(cascades.hub.stateCodes, ["OR", "WA"], "equal counts fall back to code order");

  const { states: listed, regions: listedRegions } = listHubs(CSV);
  assert.deepEqual(listed, states);
  assert.deepEqual(listedRegions, regions);
});

test("regionHubsForState lists the region hubs a state takes part in", () => {
  const nevada = regionHubsForState("NV", CSV);
  assert.ok(nevada.some((group) => group.hub.slug === "lake-tahoe"), "Lake Tahoe counts for NV via its two NV resorts");
  const colorado = regionHubsForState("co", CSV);
  assert.ok(colorado.some((group) => group.hub.slug === "summit-county"));
  for (const group of colorado) {
    assert.ok(group.count >= REGION_HUB_MIN_COUNT);
    assert.ok(group.hub.stateCodes.includes("CO"));
  }
  assert.deepEqual(regionHubsForState("XX", CSV), []);
});

// ── Resolution & collisions ──────────────────────────────────────────────────

test("resolveHub round-trips every generated hub and rejects the rest", () => {
  const { states, regions } = listHubs(CSV);
  assert.ok(states.length > 0 && regions.length > 0);
  for (const group of states) {
    const resolved = resolveHub(group.hub.slug, CSV);
    assert.ok(resolved, group.hub.slug);
    assert.equal(resolved.kind, group.hub.kind);
    assert.deepEqual(resolved.hub, group.hub);
    assert.equal(resolved.count, group.count);
    assert.deepEqual(resolved.resorts, group.resorts);
  }
  for (const group of regions) {
    const resolved = resolveHub(group.hub.slug, CSV);
    assert.ok(resolved, group.hub.slug);
    assert.equal(resolved.kind, "region");
    assert.deepEqual(resolved.hub, group.hub);
    assert.equal(resolved.count, group.count);
  }

  // Route params arrive already slugified, but a label resolves too.
  assert.equal(resolveHub("Colorado", CSV)?.hub.key, "CO");
  assert.equal(resolveHub("chile", CSV)?.kind, "country");
  assert.equal(resolveHub("not-a-place", CSV), null);
  assert.equal(resolveHub("", CSV), null);
  assert.equal(resolveHub("ski-cams", CSV), null);

  // A region below the page threshold has no hub, but is still a region.
  const small = groupByRegion(CSV, 1).find((group) => group.count < REGION_HUB_MIN_COUNT);
  assert.ok(small, "the catalogue has at least one region with fewer than 3 resorts");
  assert.equal(resolveHub(small.hub.slug, CSV), null);
  assert.equal(resolveHub(small.hub.slug, CSV, 1)?.hub.slug, small.hub.slug);
});

test("a state wins a slug collision and hubSlugCollisions reports it", () => {
  const clashing = [
    r("a", "CO", "Colorado", "A"),
    r("b", "CO", "Colorado", "B"),
    r("c", "CO", "Colorado", "C"),
    r("d", "UT", "Wasatch Range", "D"),
  ];
  const resolved = resolveHub("colorado", clashing);
  assert.equal(resolved?.kind, "state");
  assert.equal(resolved?.hub.key, "CO");

  const collisions = hubSlugCollisions(clashing);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].slug, "colorado");
  assert.equal(collisions[0].state.key, "CO");
  assert.equal(collisions[0].region.kind, "region");
  assert.deepEqual(collisions[0].region.stateCodes, ["CO"]);

  // Default minCount is 1 so a two-resort region still counts as a collision.
  assert.equal(hubSlugCollisions(clashing.slice(1)).length, 1);
  assert.equal(hubSlugCollisions(clashing, REGION_HUB_MIN_COUNT).length, 1);
  assert.equal(hubSlugCollisions(clashing.slice(1), REGION_HUB_MIN_COUNT).length, 0);
});

test("no state/region slug collisions for the catalogue values", () => {
  // Enumerated values: one synthetic resort per state and per region.
  const synthetic: HubResortLike[] = [
    ...CSV_STATE_VALUES.map((state, i) => r(`state-${i}`, state, "")),
    ...CSV_REGION_VALUES.map((region, i) => r(`region-${i}`, "CO", region)),
  ];
  assert.deepEqual(hubSlugCollisions(synthetic), []);

  // The live file, in case it has moved on from the enumeration above.
  assert.deepEqual(hubSlugCollisions(CSV), []);

  // Every enumerated region is still in the file (a rename must be reflected here).
  const csvRegions = new Set(CSV.map((resort) => resort.region));
  for (const region of CSV_REGION_VALUES) {
    assert.ok(csvRegions.has(region), `enumerated region "${region}" is no longer in data/resorts.csv`);
  }

  // Region slugs are unique per raw spelling in the file — no accidental merges today.
  const bySlug = new Map<string, Set<string>>();
  for (const region of csvRegions) {
    const slug = slugifyHub(region);
    bySlug.set(slug, (bySlug.get(slug) ?? new Set()).add(region));
  }
  for (const [slug, spellings] of bySlug) {
    assert.equal(spellings.size, 1, `region slug ${slug} has several spellings: ${[...spellings].join(" / ")}`);
    assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────

test("hubSummary picks the maxima, ignores zero and null, ranks ratings, keeps the newest ISO", () => {
  const summary = hubSummary([
    s("vail", "Vail Mountain", 62, 7, "good", "2026-01-15T06:00:00Z"),
    s("breckenridge", "Breckenridge", 70, 7, "great", "2026-01-15T12:00:00Z"),
    s("keystone", "Keystone Resort", null, 12, "fair", "2026-01-14T06:00:00Z"),
    s("arapahoe-basin", "Arapahoe Basin", 0, 0, "poor", "not a date"),
    s("loveland", "Loveland", null, null, null, null),
  ]);
  assert.equal(summary.count, 5);
  assert.deepEqual(summary.deepestBase, { slug: "breckenridge", name: "Breckenridge", value: 70 });
  assert.deepEqual(summary.mostNewSnow24h, { slug: "keystone", name: "Keystone Resort", value: 12 });
  assert.equal(summary.bestRating, "great");
  assert.equal(summary.newestReportAt, "2026-01-15T12:00:00Z");
});

test("hubSummary ties go to the alphabetically-first resort", () => {
  const summary = hubSummary([
    s("vail", "Vail Mountain", 40, 7, "good", "2026-01-15T06:00:00Z"),
    s("breckenridge", "Breckenridge", 40, 7, "good", "2026-01-15T06:00:00Z"),
  ]);
  assert.equal(summary.deepestBase?.slug, "breckenridge");
  assert.equal(summary.mostNewSnow24h?.slug, "breckenridge");
  assert.equal(summary.bestRating, "good");
});

test("hubSummary off-season and empty inputs report nothing rather than 0″ at Vail", () => {
  const offSeason = hubSummary([
    s("vail", "Vail Mountain", 0, 0, "poor", "2026-07-20T11:47:00Z"),
    s("breckenridge", "Breckenridge", 0, null, "poor", "2026-07-20T12:00:00Z"),
  ]);
  assert.equal(offSeason.count, 2);
  assert.equal(offSeason.deepestBase, null);
  assert.equal(offSeason.mostNewSnow24h, null);
  assert.equal(offSeason.bestRating, "poor");
  assert.equal(offSeason.newestReportAt, "2026-07-20T12:00:00Z");

  assert.deepEqual(hubSummary([]), {
    count: 0,
    deepestBase: null,
    mostNewSnow24h: null,
    bestRating: null,
    newestReportAt: null,
  });

  // Whatever the text column holds that is not a known rating is ignored.
  const weird = hubSummary([s("x", "X", null, null, "excellent" as unknown as ConditionRating, null)]);
  assert.equal(weird.bestRating, null);
});

// ── Neighbours ───────────────────────────────────────────────────────────────

test("neighbouringStates is symmetric, self-free, and only names catalogue states", () => {
  const catalogue = new Set(CSV_STATE_VALUES);
  for (const code of CSV_STATE_VALUES) {
    const neighbours = neighbouringStates(code);
    assert.ok(neighbours.length > 0, `${code} has no neighbours`);
    assert.equal(new Set(neighbours).size, neighbours.length, `${code} lists a neighbour twice`);
    for (const neighbour of neighbours) {
      assert.notEqual(neighbour, code, `${code} neighbours itself`);
      assert.ok(catalogue.has(neighbour), `${code} → ${neighbour} is not a catalogue state`);
      assert.ok(neighbouringStates(neighbour).includes(code), `${code} → ${neighbour} is not symmetric`);
    }
  }
  const includesAll = (code: string, expected: string[]) =>
    assert.deepEqual(expected.filter((e) => !neighbouringStates(code).includes(e)), [], code);
  includesAll("CO", ["UT", "WY", "NM"]);
  includesAll("CA", ["NV", "OR"]);
  includesAll("VT", ["NH", "NY", "ME", "MA"]);
  includesAll("WA", ["OR", "ID", "BC"]);
  includesAll("UT", ["CO", "ID", "WY"]);
  assert.deepEqual(neighbouringStates("Chile"), ["Argentina"]);
  assert.deepEqual(neighbouringStates("co"), neighbouringStates("CO"));
  assert.deepEqual(neighbouringStates("XX"), []);
  assert.deepEqual(neighbouringStates("AK"), []);
});

test("neighbouringStateHubs drops neighbours with no resorts in the list", () => {
  const hubs = neighbouringStateHubs("WA", [
    r("timberline", "OR", "Mt. Hood", "Timberline"),
    r("schweitzer", "ID", "Selkirk Mountains", "Schweitzer"),
  ]);
  assert.deepEqual(hubs.map((hub) => hub.label), ["Oregon", "Idaho"]);
  assert.deepEqual(hubs.map((hub) => hub.slug), ["oregon", "idaho"]);

  const csvHubs = neighbouringStateHubs("WA", CSV);
  assert.deepEqual(csvHubs.map((hub) => hub.key), ["OR", "ID", "BC"]);
  assert.equal(csvHubs[2].kind, "province");
  assert.deepEqual(neighbouringStateHubs("XX", CSV), []);
});
