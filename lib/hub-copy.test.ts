import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HUB_EDITORIAL,
  META_DESCRIPTION_MAX,
  REGION_OPENING_WINDOWS,
  STATE_OPENING_WINDOWS,
  buildHubFaq,
  buildHubMetaDescription,
  buildHubParagraphs,
  featuredHubCams,
  hubCamStats,
  hubLatitude,
  hubOffSeason,
  hubOpeningWindow,
  hubProvenance,
  hubShareTitle,
  hubSyncLabel,
  hubTitle,
  inHub,
  sortHubTable,
  upcomingHubSeasonLabel,
} from "./hub-copy";
import { REGION_HUB_MIN_COUNT, groupByRegion, groupByState, listHubs, resolveHub, stateHub, type Hub, type RegionHub } from "./hubs";
import type { Cam, ResortWithData, SnowReport } from "./types";

const WINTER = new Date("2026-01-15T12:00:00Z");
const SUMMER = new Date("2026-07-15T12:00:00Z");
const NOVEMBER = new Date("2026-11-15T12:00:00Z");

// ── Fixtures ─────────────────────────────────────────────────────────────────

let nextId = 0;

function makeCam(overrides: Partial<Cam> = {}): Cam {
  nextId += 1;
  return {
    id: `cam-${nextId}`,
    resort_id: "r",
    name: `Cam ${nextId}`,
    elevation: null,
    embed_type: "youtube",
    embed_url: null,
    youtube_id: "abcdefghijk",
    is_active: true,
    consecutive_failures: 0,
    auto_disabled: false,
    last_checked_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeSnow(overrides: Partial<SnowReport> = {}): SnowReport {
  return {
    id: "s",
    resort_id: "r",
    base_depth: 40,
    new_snow_24h: 0,
    new_snow_48h: 0,
    trails_open: null,
    trails_total: null,
    lifts_open: null,
    lifts_total: null,
    conditions: null,
    source: "snotel",
    updated_at: "2026-01-15T06:00:00Z",
    swe_in: null,
    pct_of_normal: null,
    trend_7d: null,
    outlook: null,
    auto_cond_rating: null,
    snowing_now: false,
    ...overrides,
  };
}

function makeResort(overrides: Partial<ResortWithData> = {}): ResortWithData {
  nextId += 1;
  const slug = overrides.slug ?? `resort-${nextId}`;
  return {
    id: overrides.id ?? `id-${slug}`,
    name: overrides.name ?? slug,
    slug,
    state: "CO",
    country: "US",
    region: "Summit County",
    lat: 39.6,
    lng: -106.0,
    website_url: null,
    cam_page_url: null,
    cond_rating: "good",
    snotel_station_id: "505:CO:SNTL",
    x_url: null,
    facebook_url: null,
    instagram_url: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    snow_report: makeSnow(),
    cams: [makeCam()],
    ...overrides,
  };
}

const COLORADO = stateHub("CO");
const CHILE = stateHub("Chile");
const WEST_VIRGINIA = stateHub("WV");
const TAHOE: RegionHub = { key: "Lake Tahoe", slug: "lake-tahoe", label: "Lake Tahoe", kind: "region", stateCodes: ["CA", "NV"] };
const SUMMIT: RegionHub = { key: "Summit County", slug: "summit-county", label: "Summit County", kind: "region", stateCodes: ["CO"] };
const HOOD: RegionHub = { key: "Mt. Hood", slug: "mt-hood", label: "Mt. Hood", kind: "region", stateCodes: ["OR"] };
const GREENS: RegionHub = { key: "Green Mountains", slug: "green-mountains", label: "Green Mountains", kind: "region", stateCodes: ["VT"] };

/** A Colorado hub with a spread of bases, one storm, and one model-fed resort. */
function coloradoResorts(): ResortWithData[] {
  return [
    makeResort({ slug: "vail", name: "Vail Mountain", region: "Colorado Rockies", cond_rating: "good", snow_report: makeSnow({ base_depth: 48, new_snow_24h: 3, updated_at: "2026-01-15T06:00:00Z" }), cams: [makeCam(), makeCam({ embed_type: "image", youtube_id: null, embed_url: "https://cams.example/vail.jpg" })] }),
    makeResort({ slug: "wolf-creek", name: "Wolf Creek Ski Area", region: "San Juan Mountains", cond_rating: "great", snow_report: makeSnow({ base_depth: 62, new_snow_24h: 9, updated_at: "2026-01-15T12:00:00Z" }), cams: [makeCam()] }),
    makeResort({ slug: "breckenridge", name: "Breckenridge", region: "Summit County", cond_rating: "good", snow_report: makeSnow({ base_depth: 44, new_snow_24h: 2 }), cams: [makeCam(), makeCam()] }),
    makeResort({ slug: "keystone", name: "Keystone Resort", region: "Summit County", cond_rating: "fair", snow_report: makeSnow({ base_depth: 30, new_snow_24h: 0 }), cams: [] }),
    makeResort({ slug: "eldora", name: "Eldora Mountain Resort", region: "Front Range", cond_rating: "poor", snotel_station_id: null, snow_report: makeSnow({ base_depth: 14, new_snow_24h: 0, source: "open_meteo" }), cams: [makeCam({ embed_type: "iframe", youtube_id: null, embed_url: "https://player.example/eldora" })] }),
  ];
}

function offSeason(resorts: ResortWithData[]): ResortWithData[] {
  return resorts.map((resort) => ({
    ...resort,
    cond_rating: "poor" as const,
    snow_report: resort.snow_report ? { ...resort.snow_report, base_depth: 0, new_snow_24h: 0, updated_at: "2026-07-20T11:47:00Z" } : null,
  }));
}

// ── Catalogue ────────────────────────────────────────────────────────────────

interface CsvRow {
  name: string;
  slug: string;
  state: string;
  region: string;
  lat: number;
  country: string;
  station: string;
}

function loadCsv(): CsvRow[] {
  const raw = readFileSync(new URL("../data/resorts.csv", import.meta.url), "utf8");
  assert.equal(raw.includes('"'), false, "data/resorts.csv gained quoted cells — upgrade the test's CSV splitter");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const header = lines[0].split(",");
  const col = (name: string) => {
    const index = header.indexOf(name);
    assert.notEqual(index, -1, `data/resorts.csv has no ${name} column`);
    return index;
  };
  const [iName, iSlug, iState, iRegion, iLat, iCountry, iStation] = ["name", "slug", "state", "region", "lat", "country", "snotel_station_id"].map(col);
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return {
      name: cells[iName],
      slug: cells[iSlug],
      state: cells[iState],
      region: cells[iRegion],
      lat: Number(cells[iLat]),
      country: cells[iCountry] || "US",
      station: cells[iStation] ?? "",
    };
  });
}

const CSV = loadCsv();

/**
 * The live catalogue as ResortWithData rows. `withCams` toggles the webcam
 * wording branch; bases are the name length so the deepest base is always the
 * longest name — the worst case for the description budget.
 */
function csvResorts(withCams: boolean): ResortWithData[] {
  return CSV.map((row) =>
    makeResort({
      slug: row.slug,
      name: row.name,
      state: row.state,
      region: row.region,
      lat: row.lat,
      country: row.country,
      snotel_station_id: row.station || null,
      snow_report: makeSnow({ base_depth: row.name.length, new_snow_24h: row.name.length % 5 }),
      cams: withCams ? [makeCam()] : [],
    }),
  );
}

function everyHub(resorts: ResortWithData[]): Array<{ hub: Hub; resorts: ResortWithData[] }> {
  const { states, regions } = listHubs(resorts);
  return [...states, ...regions].map((group) => ({ hub: group.hub, resorts: group.resorts }));
}

// ── Titles & phrasing ────────────────────────────────────────────────────────

test("hubTitle follows the §2.3 templates for state and region hubs, singular when needed", () => {
  assert.equal(hubTitle(COLORADO, 20), "Colorado Ski Resort Webcams & Snow Report — 20 Resorts Live | PeakCam");
  assert.equal(hubTitle(CHILE, 11), "Chile Ski Resort Webcams & Snow Report — 11 Resorts Live | PeakCam");
  assert.equal(hubTitle(WEST_VIRGINIA, 1), "West Virginia Ski Resort Webcams & Snow Report — 1 Resort Live | PeakCam");
  assert.equal(hubTitle(TAHOE, 12), "Lake Tahoe Ski Webcams & Snow Report — 12 Resorts | PeakCam");
  assert.equal(hubShareTitle(COLORADO), "Colorado Ski Resort Webcams & Snow Report");
  assert.equal(hubShareTitle(TAHOE), "Lake Tahoe Ski Webcams & Snow Report");
});

test("inHub picks the right preposition and article", () => {
  assert.equal(inHub(COLORADO), "in Colorado");
  assert.equal(inHub(CHILE), "in Chile");
  assert.equal(inHub(TAHOE), "around Lake Tahoe");
  assert.equal(inHub(HOOD), "on Mt. Hood");
  assert.equal(inHub(GREENS), "in the Green Mountains");
  assert.equal(inHub(SUMMIT), "in Summit County");
  assert.equal(inHub({ key: "Central Andes", slug: "central-andes", label: "Central Andes", kind: "region", stateCodes: ["Chile"] }), "in the Central Andes");
  assert.equal(inHub({ key: "Sangre de Cristo", slug: "sangre-de-cristo", label: "Sangre de Cristo", kind: "region", stateCodes: ["NM"] }), "in the Sangre de Cristo");
});

// ── Season ───────────────────────────────────────────────────────────────────

test("season helpers read the hub's own hemisphere", () => {
  const north = coloradoResorts();
  const south = [makeResort({ lat: -33.3, state: "Chile", country: "CL" }), makeResort({ lat: -41.1, state: "Chile", country: "CL" })];
  assert.ok(hubLatitude(north) > 0);
  assert.ok(hubLatitude(south) < 0);
  assert.equal(hubLatitude([]), 45);
  assert.equal(hubOffSeason(north, WINTER), false);
  assert.equal(hubOffSeason(north, SUMMER), true);
  assert.equal(hubOffSeason(south, WINTER), true);
  assert.equal(hubOffSeason(south, SUMMER), false);
  assert.equal(upcomingHubSeasonLabel(north, SUMMER), "2026–27");
  assert.equal(upcomingHubSeasonLabel(south, WINTER), "2026");
  assert.equal(upcomingHubSeasonLabel(south, NOVEMBER), "2027");
});

// ── Table, cams, provenance ──────────────────────────────────────────────────

test("sortHubTable orders by base desc, then name, with no-report rows last", () => {
  const rows = sortHubTable([
    makeResort({ name: "Zed", snow_report: makeSnow({ base_depth: 40 }) }),
    makeResort({ name: "Alpha", snow_report: makeSnow({ base_depth: 40 }) }),
    makeResort({ name: "No Report", snow_report: null }),
    makeResort({ name: "Deep", snow_report: makeSnow({ base_depth: 70 }) }),
    makeResort({ name: "Zero", snow_report: makeSnow({ base_depth: 0 }) }),
    makeResort({ name: "Null Base", snow_report: makeSnow({ base_depth: null }) }),
    makeResort({ name: "Las Leñas", snow_report: makeSnow({ base_depth: 40 }) }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Deep", "Alpha", "Las Leñas", "Zed", "Zero", "No Report", "Null Base"],
  );
});

test("featuredHubCams takes the first playable YouTube cam of the best-rated resorts", () => {
  const resorts = coloradoResorts();
  const featured = featuredHubCams(resorts);
  // great (Wolf Creek) > good by base (Vail 48, Breckenridge 44); Keystone has no cams, Eldora is iframe-only.
  assert.deepEqual(featured.map((item) => item.resort.slug), ["wolf-creek", "vail", "breckenridge"]);
  for (const item of featured) assert.equal(item.cam.embed_type, "youtube");
  assert.equal(featuredHubCams(resorts, 1).length, 1);

  // Inactive, health-disabled and malformed YouTube cams are never featured; a
  // later valid cam on the same resort is.
  const picky = makeResort({
    slug: "picky",
    cond_rating: "great",
    cams: [
      makeCam({ is_active: false }),
      makeCam({ auto_disabled: true }),
      makeCam({ youtube_id: "short" }),
      makeCam({ embed_type: "image", youtube_id: null, embed_url: "https://cams.example/a.jpg" }),
      makeCam({ id: "the-one" }),
    ],
  });
  assert.equal(featuredHubCams([picky])[0]?.cam.id, "the-one");
  assert.deepEqual(featuredHubCams([makeResort({ cams: [] })]), []);

  // Off-season every resort is "poor" with a 0″ base: the curated popular
  // order breaks the tie, not the alphabet.
  const flat = offSeason([
    makeResort({ slug: "arapahoe-basin", name: "Arapahoe Basin" }),
    makeResort({ slug: "vail", name: "Vail Mountain" }),
    makeResort({ slug: "breckenridge", name: "Breckenridge" }),
    makeResort({ slug: "zzz", name: "Aardvark Hill" }),
  ]);
  assert.deepEqual(featuredHubCams(flat).map((item) => item.resort.slug), ["vail", "breckenridge", "zzz"]);
});

test("hubCamStats, hubProvenance and hubSyncLabel count what the data says", () => {
  const resorts = coloradoResorts();
  assert.deepEqual(hubCamStats(resorts), { withCams: 4, total: 6, liveVideo: 5 });
  assert.deepEqual(hubCamStats([makeResort({ cams: [makeCam(), makeCam({ is_active: false })] })]), { withCams: 1, total: 1, liveVideo: 1 });
  assert.deepEqual(hubProvenance(resorts), { sensor: 4, model: 1, outsideUs: false });
  assert.equal(hubSyncLabel(resorts), "Last data sync");
  assert.equal(hubSyncLabel(resorts.filter((resort) => resort.snotel_station_id)), "Last sensor sync");
  const andes = [makeResort({ snotel_station_id: null, country: "CL", state: "Chile" })];
  assert.deepEqual(hubProvenance(andes), { sensor: 0, model: 1, outsideUs: true });
  assert.equal(hubSyncLabel(andes), "Last model sync");
  assert.equal(hubSyncLabel([]), "Last data sync");
});

// ── Meta description ─────────────────────────────────────────────────────────

test("meta description: off-season names the popular resorts and the coming season", () => {
  const desc = buildHubMetaDescription(COLORADO, coloradoResorts(), SUMMER);
  // Popular order (Vail, Breckenridge) first; the third name would push past
  // 160, so the clause closes with "and more" rather than cutting a name.
  assert.equal(
    desc,
    "Colorado ski resort webcams and snow report — 5 resorts: Vail Mountain, Breckenridge and more. Opens 2026–27 — first snow and forecasts on PeakCam.",
  );
  assert.ok(desc.length <= META_DESCRIPTION_MAX, `${desc.length} chars`);
  assert.doesNotMatch(desc, /0″|base/);
});

test("meta description: in season leads with the deepest base and free alerts", () => {
  const desc = buildHubMetaDescription(COLORADO, coloradoResorts(), WINTER);
  // The number outranks the name list: with the deepest-base sentence in, no
  // resort name fits, so the lead closes on its own.
  assert.equal(
    desc,
    "Live webcams and snow conditions for 5 Colorado ski resorts. Deepest base 62″ at Wolf Creek Ski Area. Base depth, new snow, forecasts, free powder alerts.",
  );
  assert.ok(desc.length <= META_DESCRIPTION_MAX, `${desc.length} chars: ${desc}`);

  // Shorter names leave room for the list as well.
  const short = coloradoResorts().map((resort) => ({ ...resort, name: resort.name.split(" ")[0] }));
  const roomy = buildHubMetaDescription(COLORADO, short, WINTER);
  assert.match(roomy, /^Live webcams and snow conditions for 5 Colorado ski resorts: Vail and more\. Deepest base 62″ at Wolf\./);
  assert.ok(roomy.length <= META_DESCRIPTION_MAX, `${roomy.length} chars: ${roomy}`);
});

test("meta description: no cams drops the webcam claim; one resort has no 'and more'", () => {
  const noCams = coloradoResorts().map((resort) => ({ ...resort, cams: [] }));
  assert.match(buildHubMetaDescription(COLORADO, noCams, SUMMER), /^Colorado ski resort snow report and conditions — 5 resorts: Vail Mountain/);
  const winter = buildHubMetaDescription(COLORADO, noCams, WINTER);
  assert.match(winter, /^Snow conditions for 5 Colorado ski resorts[.:]/);
  assert.doesNotMatch(winter, /webcam/);

  const only = [makeResort({ slug: "snowshoe", name: "Snowshoe Mountain Resort", state: "WV", region: "Appalachians", lat: 38.4 })];
  const one = buildHubMetaDescription(WEST_VIRGINIA, only, SUMMER);
  assert.equal(one, "West Virginia ski resort webcams and snow report — 1 resort: Snowshoe Mountain Resort. Opens 2026–27 — first snow and forecasts on PeakCam.");
  assert.doesNotMatch(buildHubMetaDescription(WEST_VIRGINIA, only, WINTER), /and more|resorts:/);
});

test("meta description: every catalogue hub fits the SERP budget in every season", () => {
  for (const withCams of [true, false]) {
    const resorts = csvResorts(withCams);
    for (const { hub, resorts: members } of everyHub(resorts)) {
      for (const now of [WINTER, SUMMER, NOVEMBER]) {
        const desc = buildHubMetaDescription(hub, members, now);
        assert.ok(desc.length <= META_DESCRIPTION_MAX, `${hub.slug} (${now.toISOString()}, cams=${withCams}): ${desc.length} chars: ${desc}`);
        assert.match(desc, /\.$/, `${hub.slug}: ends with a period`);
        assert.doesNotMatch(desc, /\.\./, `${hub.slug}: double period`);
        assert.doesNotMatch(desc, /: \./, `${hub.slug}: empty name clause`);
        assert.doesNotMatch(desc, /\b1 resorts\b/, `${hub.slug}: plural on one`);
      }
    }
  }
  // The name clause is never cut mid-name: the longest catalogue name either
  // appears whole or not at all.
  const chile = resolveHub("chile", csvResorts(true))!;
  const desc = buildHubMetaDescription(chile.hub, chile.resorts, SUMMER);
  const osorno = "Volcán Osorno (Centro de Ski y Montaña Volcán Osorno)";
  assert.ok(!desc.includes("Volcán Osorno") || desc.includes(osorno), desc);
});

// ── Paragraphs ───────────────────────────────────────────────────────────────

test("paragraphs: a state hub in season covers regions, cams, provenance and the live numbers", () => {
  const [p1, p2, p3] = buildHubParagraphs(COLORADO, coloradoResorts(), WINTER);
  assert.equal(p1, "PeakCam tracks 5 ski resorts in Colorado across 4 regions: Summit County (2), Colorado Rockies (1), Front Range (1) and San Juan Mountains (1). 4 of them have live webcams on PeakCam — 6 cams in all.");
  assert.equal(p2, "4 of the 5 have an assigned NRCS SNOTEL or SCAN station, so their base depth and new snow are sensor readings synced every six hours; the other 1 has no station nearby and uses weather-model estimates (Open-Meteo) instead — each resort page says which.");
  assert.equal(p3, "Right now the deepest base in Colorado is 62 inches at Wolf Creek Ski Area; the shallowest reporting resort is Eldora Mountain Resort at 14 inches. Wolf Creek Ski Area also picked up 9 inches in the last 24 hours, the most in Colorado. Conditions rate great at 1 resort and good at 2 resorts.");

  // More regions than the sentence shows: the list is truncated with "and others".
  const spread = coloradoResorts().map((resort, i) => ({ ...resort, region: `Region ${i}` }));
  assert.match(buildHubParagraphs(COLORADO, spread, WINTER)[0], /across 5 regions: Region 0 \(1\), Region 1 \(1\), Region 2 \(1\), Region 3 \(1\) and others\./);
});

test("paragraphs: provenance branches for all-sensor, all-model and outside-US hubs", () => {
  const sensor = coloradoResorts().filter((resort) => resort.snotel_station_id);
  assert.match(buildHubParagraphs(COLORADO, sensor, WINTER)[1], /^All 4 have an assigned NRCS SNOTEL or SCAN station/);

  const andes = [
    makeResort({ slug: "portillo", name: "Portillo", state: "Chile", country: "CL", region: "Central Andes", lat: -32.8, snotel_station_id: null, cams: [makeCam()] }),
    makeResort({ slug: "corralco", name: "Corralco", state: "Chile", country: "CL", region: "Araucanía Andes", lat: -38.4, snotel_station_id: null, cams: [] }),
  ];
  const [p1, p2] = buildHubParagraphs(CHILE, andes, SUMMER);
  assert.match(p1, /^PeakCam tracks 2 ski resorts in Chile across 2 regions: Araucanía Andes \(1\) and Central Andes \(1\)\. 1 of them has a live webcam on PeakCam\.$/);
  assert.match(p2, /^None of the 2 Chile ski resorts has an NRCS telemetry station — the network only covers the United States, so every snow figure on this page is a weather-model estimate \(Open-Meteo\)/);
  assert.doesNotMatch(p2, /SNOTEL/);

  const eastern = [makeResort({ state: "VT", region: "Green Mountains", snotel_station_id: null, country: "US" })];
  assert.doesNotMatch(buildHubParagraphs(stateHub("VT"), eastern, WINTER)[1], /only covers the United States/);
});

test("paragraphs: region hubs name the states they span; single-state and single-resort hubs read naturally", () => {
  const tahoe = [
    makeResort({ name: "Heavenly", state: "CA", region: "Lake Tahoe" }),
    makeResort({ name: "Palisades Tahoe", state: "CA", region: "Lake Tahoe" }),
    makeResort({ name: "Mt. Rose", state: "NV", region: "Lake Tahoe" }),
  ];
  assert.match(buildHubParagraphs(TAHOE, tahoe, WINTER)[0], /^PeakCam tracks 3 ski resorts around Lake Tahoe, spanning 2 in California and 1 in Nevada\. Every one of them has live webcams on PeakCam — 3 cams in all\./);

  const summit = coloradoResorts().filter((resort) => resort.region === "Summit County");
  assert.match(buildHubParagraphs(SUMMIT, summit, WINTER)[0], /^PeakCam tracks 2 ski resorts in Summit County, Colorado\./);

  const nh = [makeResort({ state: "NH", region: "White Mountains" }), makeResort({ state: "NH", region: "White Mountains" })];
  assert.match(buildHubParagraphs(stateHub("NH"), nh, WINTER)[0], /in New Hampshire, all of them in the White Mountains\./);

  const only = [makeResort({ name: "Snowshoe Mountain Resort", state: "WV", region: "Appalachians", cams: [makeCam(), makeCam()] })];
  const [p1, p2] = buildHubParagraphs(WEST_VIRGINIA, only, WINTER);
  assert.equal(p1, "PeakCam tracks one ski resort in West Virginia: Snowshoe Mountain Resort, in the Appalachians. It has 2 live webcams on PeakCam.");
  assert.match(p2, /^It has an assigned NRCS/);
  // Places keep their bare name; only ranges and features take "the".
  const wisconsin = [makeResort({ name: "Granite Peak Ski Area", state: "WI", region: "Rib Mountain" })];
  assert.match(buildHubParagraphs(stateHub("WI"), wisconsin, WINTER)[0], /Granite Peak Ski Area, in Rib Mountain\./);
  const canyon = [makeResort({ name: "Alta Ski Area", state: "UT", region: "Little Cottonwood Canyon" })];
  assert.match(buildHubParagraphs(stateHub("UT"), canyon, WINTER)[0], /Alta Ski Area, in Little Cottonwood Canyon\./);
  assert.deepEqual(buildHubParagraphs(COLORADO, [], WINTER), []);
});

test("paragraphs: off-season replaces the numbers with an honest note and keeps a real late-season base", () => {
  const quiet = buildHubParagraphs(COLORADO, offSeason(coloradoResorts()), SUMMER);
  const p3 = quiet[quiet.length - 1];
  assert.equal(p3, "PeakCam treats this as the off-season in Colorado: every resort reports no base, and the 2026–27 season is next. Cams, snow reports and powder alerts keep running year-round.");
  assert.doesNotMatch(quiet.join(" "), /deepest base|Conditions rate/);

  const lateSeason = offSeason(coloradoResorts());
  lateSeason[1] = { ...lateSeason[1], snow_report: { ...lateSeason[1].snow_report!, base_depth: 35 } };
  const late = buildHubParagraphs(COLORADO, lateSeason, SUMMER);
  assert.match(late[late.length - 1], /4 of 5 resorts report no base.*still shows 35 inches at Wolf Creek Ski Area/);
});

test("paragraphs: 1-inch values and missing numbers never read wrong", () => {
  const thin = [makeResort({ name: "Thin", snow_report: makeSnow({ base_depth: 1, new_snow_24h: 1 }), cond_rating: "fair" })];
  const p3 = buildHubParagraphs(COLORADO, thin, WINTER)[2];
  assert.match(p3, /1 inch at Thin\./);
  assert.match(p3, /Thin also picked up 1 inch in the last 24 hours\./);
  assert.doesNotMatch(p3, /1 inches|, the most|shallowest/);

  const nothing = [makeResort({ snow_report: null, cond_rating: "poor" })];
  assert.equal(buildHubParagraphs(COLORADO, nothing, WINTER)[2], "No Colorado ski resort is reporting a measurable base right now; readings refresh every six hours.");
});

// ── FAQ ──────────────────────────────────────────────────────────────────────

test("faq: three questions, answered from the data in season", () => {
  const faq = buildHubFaq(COLORADO, coloradoResorts(), WINTER);
  assert.deepEqual(
    faq.map((item) => item.question),
    ["Which Colorado ski resort has the most snow right now?", "How many ski resorts in Colorado have live webcams?", "When do Colorado ski resorts open?"],
  );
  assert.equal(
    faq[0].answer,
    "Wolf Creek Ski Area has the deepest base in Colorado right now at 62 inches. It also picked up 9 inches in the last 24 hours. That reading comes from the resort's assigned NRCS station and updates every six hours. PeakCam ranks all 5 Colorado ski resorts by base depth on this page.",
  );
  assert.equal(
    faq[1].answer,
    "4 of the 5 Colorado ski resorts on PeakCam have live webcams — 6 cams in total, a mix of live video and refreshing stills. All of them are free to watch and need no account.",
  );
  assert.match(faq[2].answer, /^Colorado resorts usually open between mid-October and late November/);
  assert.match(faq[2].answer, /opening dates page.*opening-day alert/);
  for (const item of faq) assert.doesNotMatch(item.answer, /^(It|They|This|That)\b/);
});

test("faq: model-fed deepest base says so; a different storm resort is named", () => {
  const resorts = coloradoResorts().map((resort) =>
    resort.slug === "eldora" ? { ...resort, snow_report: makeSnow({ base_depth: 90, new_snow_24h: 0 }) } : resort,
  );
  const [q1] = buildHubFaq(COLORADO, resorts, WINTER);
  assert.match(q1.answer, /^Eldora Mountain Resort has the deepest base in Colorado right now at 90 inches\. Wolf Creek Ski Area picked up 9 inches in the last 24 hours, the most in Colorado\. That figure is a weather-model estimate/);
});

test("faq: off-season is honest, and a late-season base is surfaced instead of denied", () => {
  const [q1] = buildHubFaq(COLORADO, offSeason(coloradoResorts()), SUMMER);
  assert.equal(
    q1.answer,
    "Colorado is in the off-season, so current readings show little or no snow at any resort. The 2026–27 season is next — PeakCam's free powder alerts email you the morning a resort you follow gets fresh snow.",
  );
  assert.doesNotMatch(q1.answer, /^(It|They|This|That)\b/);
  const lateSeason = offSeason(coloradoResorts());
  lateSeason[0] = { ...lateSeason[0], snow_report: { ...lateSeason[0].snow_report!, base_depth: 28 } };
  assert.match(buildHubFaq(COLORADO, lateSeason, SUMMER)[0].answer, /still shows 28 inches at Vail Mountain/);
});

test("faq: webcam counts skip inactive cams and cover the no-cam and one-resort cases", () => {
  const stills = [
    makeResort({ cams: [makeCam({ embed_type: "image", youtube_id: null, embed_url: "https://c.example/a.jpg" }), makeCam({ is_active: false })] }),
    makeResort({ cams: [] }),
  ];
  assert.match(
    buildHubFaq(COLORADO, stills, WINTER)[1].answer,
    /^1 of the 2 Colorado ski resorts on PeakCam has a live webcam — 1 cam in total, regularly refreshing stills\./,
  );

  const video = coloradoResorts().filter((resort) => resort.slug === "wolf-creek" || resort.slug === "breckenridge");
  assert.match(buildHubFaq(COLORADO, video, WINTER)[1].answer, /2 of the 2 Colorado ski resorts on PeakCam have live webcams — 3 cams in total, all live video/);

  const none = [makeResort({ cams: [] }), makeResort({ cams: [] })];
  assert.equal(buildHubFaq(COLORADO, none, WINTER)[1].answer, "None of the 2 Colorado ski resorts on PeakCam has a working webcam feed right now; their snow reports still update every six hours.");

  const only = [makeResort({ name: "Snowshoe Mountain Resort", state: "WV", cams: [makeCam()] })];
  assert.equal(buildHubFaq(WEST_VIRGINIA, only, WINTER)[1].answer, "Snowshoe Mountain Resort, the one West Virginia ski resort on PeakCam, has 1 live webcam (all live video). It is free to watch and needs no account.");
  const pair = [makeResort({ name: "Snowshoe Mountain Resort", state: "WV", cams: [makeCam(), makeCam()] })];
  assert.match(buildHubFaq(WEST_VIRGINIA, pair, WINTER)[1].answer, /has 2 live webcams \(all live video\)\. They are free to watch and need no account\.$/);
});

test("faq: no measurable base in season says so instead of inventing a leader", () => {
  const dry = coloradoResorts().map((resort) => ({ ...resort, snow_report: makeSnow({ base_depth: 0, new_snow_24h: 0 }) }));
  assert.match(buildHubFaq(COLORADO, dry, WINTER)[0].answer, /^No Colorado ski resort is reporting a measurable base right now\./);
});

test("faq: region hubs phrase the questions with the right preposition", () => {
  const tahoe = [makeResort({ state: "CA", region: "Lake Tahoe" }), makeResort({ state: "NV", region: "Lake Tahoe" })];
  const questions = buildHubFaq(TAHOE, tahoe, WINTER).map((item) => item.question);
  assert.deepEqual(questions, [
    "Which Lake Tahoe ski resort has the most snow right now?",
    "How many ski resorts around Lake Tahoe have live webcams?",
    "When do Lake Tahoe ski resorts open?",
  ]);
});

// ── Opening windows & editorial ──────────────────────────────────────────────

test("hubOpeningWindow: region override, then primary state, then hemisphere default", () => {
  const resorts = csvResorts(true);
  assert.equal(hubOpeningWindow(SUMMIT, resorts), REGION_OPENING_WINDOWS["summit-county"]);
  assert.equal(hubOpeningWindow(COLORADO, resorts), STATE_OPENING_WINDOWS.CO);
  assert.equal(hubOpeningWindow(CHILE, resorts), STATE_OPENING_WINDOWS.Chile);
  assert.match(STATE_OPENING_WINDOWS.Chile, /June/);
  assert.match(STATE_OPENING_WINDOWS.CO, /October/);

  // A region hub with no override borrows its primary state's window.
  const gallatin: RegionHub = { key: "Gallatin Range", slug: "gallatin-range", label: "Gallatin Range", kind: "region", stateCodes: ["MT"] };
  assert.equal(hubOpeningWindow(gallatin, resorts), STATE_OPENING_WINDOWS.MT);

  // Unknown states fall back by hemisphere, never to an empty answer.
  const alaska = stateHub("AK");
  assert.match(hubOpeningWindow(alaska, [makeResort({ lat: 61 })]), /^Alaska resorts typically open between late November and mid-December/);
  assert.match(hubOpeningWindow({ ...stateHub("Peru"), kind: "country" }, [makeResort({ lat: -12 })]), /^Peru resorts typically open between mid-June and early July/);
});

test("opening windows and editorial keys all point at real catalogue hubs", () => {
  const states = new Set(groupByState(CSV).map((group) => group.hub.key));
  for (const key of Object.keys(STATE_OPENING_WINDOWS)) {
    assert.ok(states.has(key), `STATE_OPENING_WINDOWS.${key} is not a state in data/resorts.csv`);
  }
  const regionHubs = new Set(groupByRegion(CSV, REGION_HUB_MIN_COUNT).map((group) => group.hub.slug));
  for (const slug of Object.keys(REGION_OPENING_WINDOWS)) {
    assert.ok(regionHubs.has(slug), `REGION_OPENING_WINDOWS["${slug}"] is not a region hub (≥${REGION_HUB_MIN_COUNT} resorts) in data/resorts.csv`);
  }
  for (const slug of Object.keys(HUB_EDITORIAL)) {
    assert.ok(resolveHub(slug, CSV), `HUB_EDITORIAL["${slug}"] does not resolve to a hub`);
  }
  assert.deepEqual(Object.keys(HUB_EDITORIAL).sort(), ["argentina", "california", "chile", "colorado", "utah", "vermont"]);
  // Evergreen: no digits that read as a date or a snow total in the intros.
  for (const [slug, intro] of Object.entries(HUB_EDITORIAL)) {
    assert.doesNotMatch(intro, /\b20\d\d\b|″|inches of new/, `${slug} intro carries a date or snow number`);
    assert.ok(intro.length > 200, `${slug} intro is too short to be worth rendering`);
  }
});
