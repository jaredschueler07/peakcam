import { test } from "node:test";
import assert from "node:assert/strict";
import type { ResortWithData } from "@/lib/types";
import { detectPlace, publishedAliases, resortAliases } from "./aliases";
import { findMentions, planQuestion } from "./router";

// Fixture catalogue: names chosen to exercise suffix stripping ("Alta Ski
// Area" → alta), Mt/Mount variants, nicknames (breck, a-basin, jackson),
// an Andes row whose state is a country name, and a name that contains an
// intent word ("Snowbird", "Powder Mountain", "Winter Park").

function resort(slug: string, name: string, over: Partial<ResortWithData> = {}): ResortWithData {
  return {
    id: `id-${slug}`,
    name,
    slug,
    state: "CO",
    country: "US",
    region: "Colorado Rockies",
    lat: 39.5,
    lng: -106,
    website_url: null,
    cam_page_url: null,
    cond_rating: "good",
    snotel_station_id: "842:CO:SNTL",
    x_url: null,
    facebook_url: null,
    instagram_url: null,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    snow_report: null,
    cams: [],
    ...over,
  };
}

const RESORTS: ResortWithData[] = [
  resort("vail", "Vail Mountain"),
  resort("breckenridge", "Breckenridge"),
  resort("keystone", "Keystone"),
  resort("arapahoe-basin", "Arapahoe Basin"),
  resort("winter-park", "Winter Park"),
  resort("alta", "Alta Ski Area", { state: "UT", region: "Wasatch" }),
  resort("snowbird", "Snowbird", { state: "UT", region: "Wasatch" }),
  resort("powder-mountain", "Powder Mountain", { state: "UT", region: "Wasatch" }),
  resort("jackson-hole", "Jackson Hole Mountain Resort", { state: "WY", region: "Tetons" }),
  resort("mt-bachelor", "Mt. Bachelor", { state: "OR", region: "Cascades" }),
  resort("mammoth", "Mammoth Mountain", { state: "CA", region: "Eastern Sierra" }),
  resort("big-sky", "Big Sky", { state: "MT", region: "Montana" }),
  resort("ski-portillo", "Ski Portillo", { state: "Chile", country: "CL", region: "Andes", snotel_station_id: null }),
  resort("whistler-blackcomb", "Whistler Blackcomb", { state: "BC", country: "CA", region: "Coast Mountains", snotel_station_id: null }),
  resort("mount-snow", "Mount Snow", { state: "VT", region: "Green Mountains" }),
  resort("el-colorado", "El Colorado", { state: "Chile", country: "CL", region: "Andes", snotel_station_id: null }),
];

function plan(question: string) {
  return planQuestion(question, RESORTS);
}

test("aliases: generic suffixes, Mt/Mount variants and nicknames", () => {
  assert.ok(resortAliases(RESORTS[5]).includes("alta"), "Alta Ski Area → alta");
  assert.ok(resortAliases(RESORTS[0]).includes("vail"), "Vail Mountain → vail");
  const bachelor = resortAliases(RESORTS[9]);
  for (const a of ["mt bachelor", "mount bachelor", "bachelor"]) assert.ok(bachelor.includes(a), a);
  assert.ok(resortAliases(RESORTS[8]).includes("jackson hole"));
  assert.ok(resortAliases(RESORTS[8]).includes("jackson"));
  assert.ok(publishedAliases(RESORTS[1]).includes("breck"));
  assert.equal(publishedAliases(RESORTS[1]).includes("breckenridge"), false, "the name itself is not an alias");
  assert.ok(resortAliases(RESORTS[7]).every((a) => a.length >= 3));
});

test("places: state names, place words, countries and uppercase codes only", () => {
  assert.equal(detectPlace("where did it snow in colorado")?.state, "CO");
  assert.equal(detectPlace("best snow in Utah right now")?.state, "UT");
  assert.equal(detectPlace("anything good in Tahoe")?.state, "CA");
  assert.deepEqual(detectPlace("what is open in Chile"), { state: "Chile", country: "CL", phrase: "chile" });
  assert.equal(detectPlace("top CO resorts")?.state, "CO");
  assert.equal(detectPlace("co-workers want to ski"), null, "lowercase co is not Colorado");
  assert.equal(detectPlace("is it open or not"), null, "the word or is not Oregon");
});

// ── The questions ────────────────────────────────────────────

test("conditions: how much snow at a resort", () => {
  const p = plan("How much snow did Alta get in the last 24 hours?");
  assert.equal(p.intent, "conditions");
  assert.equal(p.tool, "get_resort_conditions");
  assert.deepEqual(p.args, { slug: "alta" });
  assert.deepEqual(p.resorts.map((r) => r.slug), ["alta"]);
});

test("conditions: a bare resort name defaults to the snow report", () => {
  const p = plan("Breckenridge");
  assert.equal(p.intent, "conditions");
  assert.equal(p.tool, "get_resort_conditions");
});

test("conditions: nickname and typo tolerance", () => {
  assert.equal(plan("what's the base at breck").resorts[0]?.slug, "breckenridge");
  assert.equal(plan("conditions at a-basin today").resorts[0]?.slug, "arapahoe-basin");
  const typo = plan("how deep is the base at breckenrige");
  assert.equal(typo.resorts[0]?.slug, "breckenridge");
  assert.equal(typo.intent, "conditions");
});

test("openings: is a resort open", () => {
  const p = plan("Is Jackson Hole open yet?");
  assert.equal(p.intent, "openings");
  assert.equal(p.tool, "get_resort_conditions", "a single resort's season comes from its conditions document");
  assert.equal(p.resorts[0]?.slug, "jackson-hole");
});

test("openings: which resorts are open in a state", () => {
  const p = plan("Which Colorado resorts are open right now?");
  assert.equal(p.intent, "openings");
  assert.equal(p.tool, "get_opening_dates");
  assert.equal(p.args.state, "CO");
  assert.equal(p.resorts.length, 0);
});

test("forecast: will it snow this weekend", () => {
  const p = plan("Will it snow at Mammoth this weekend?");
  assert.equal(p.intent, "forecast");
  assert.equal(p.tool, "get_forecast");
  assert.deepEqual(p.args, { slug: "mammoth" });
});

test("forecast: what's the forecast for mt bachelor", () => {
  const p = plan("What's the forecast for Mount Bachelor tomorrow?");
  assert.equal(p.intent, "forecast");
  assert.equal(p.resorts[0]?.slug, "mt-bachelor");
});

test("cams: show me the webcams", () => {
  const p = plan("Show me Vail's webcams");
  assert.equal(p.intent, "cams");
  assert.equal(p.tool, "get_resort_cams");
  assert.deepEqual(p.args, { slug: "vail" });
});

test("cam timeline: what did it look like over the last 24 hours", () => {
  const p = plan("What did the Alta cams look like over the last 24 hours?");
  assert.equal(p.intent, "cam_timeline");
  assert.equal(p.tool, "get_cam_timeline");
  assert.deepEqual(p.args, { slug: "alta", hours: 24 });
});

test("history: how has the base changed this week", () => {
  const p = plan("How has the base at Keystone changed over the last week?");
  assert.equal(p.intent, "history");
  assert.equal(p.tool, "get_snow_history");
  assert.deepEqual(p.args, { slug: "keystone", days: 7 });
  assert.deepEqual(plan("how much snow has Vail got in the past two weeks").args, { slug: "vail", days: 14 });
});

test("compare: two or more resorts", () => {
  const p = plan("Compare Vail, Breckenridge and Keystone for a trip this weekend");
  assert.equal(p.intent, "compare");
  assert.equal(p.tool, "compare_resorts");
  assert.deepEqual(p.args, { slugs: ["vail", "breckenridge", "keystone"] });
  const vs = plan("Alta vs Snowbird?");
  assert.equal(vs.intent, "compare");
  assert.deepEqual(vs.args, { slugs: ["alta", "snowbird"] });
  const or = plan("Should I ski Big Sky or Jackson Hole?");
  assert.equal(or.intent, "compare");
});

test("powder: where did it snow most, with state, window and measured-only", () => {
  const p = plan("Where did it snow most in Colorado over the weekend, measured only?");
  assert.equal(p.intent, "powder");
  assert.equal(p.tool, "find_powder");
  assert.deepEqual(p.args, { window: "48h", state: "CO", sourceOnly: "snotel", limit: 10 });
  const q = plan("Which Utah resorts picked up more than 6 inches?");
  assert.equal(q.intent, "powder");
  assert.equal(q.args.state, "UT");
  assert.equal(q.args.minInches, 6);
  assert.equal(plan("where is the powder right now").tool, "find_powder");
});

test("powder words inside a resort name do not change the intent", () => {
  const p = plan("How much snow at Powder Mountain?");
  assert.equal(p.intent, "conditions");
  assert.equal(p.resorts[0]?.slug, "powder-mountain");
  const q = plan("Is Winter Park open?");
  assert.equal(q.intent, "openings");
  assert.equal(q.resorts[0]?.slug, "winter-park");
  const r = plan("Snowbird cams");
  assert.equal(r.intent, "cams");
});

test("percent of normal: which resorts are above normal snowpack", () => {
  const p = plan("Which Utah resorts are above normal snowpack?");
  assert.equal(p.intent, "percent_of_normal");
  assert.equal(p.tool, "get_percent_of_normal");
  assert.deepEqual(p.args, { state: "UT", limit: 10 });
  const r = plan("how is the snowpack at Alta compared to normal");
  assert.equal(r.intent, "conditions", "a single resort's percent of normal is in its conditions document");
});

test("profile: where is a resort and how high", () => {
  const p = plan("Where is Whistler Blackcomb and how high is it?");
  assert.equal(p.intent, "profile");
  assert.equal(p.tool, "get_resort_profile");
  assert.deepEqual(p.args, { slug: "whistler-blackcomb" });
  assert.equal(plan("Tell me about Ski Portillo").intent, "profile");
});

test("regions: which states does PeakCam cover", () => {
  const p = plan("Which states and countries do you cover?");
  assert.equal(p.intent, "regions");
  assert.equal(p.tool, "list_regions");
  assert.equal(plan("how many resorts do you track").intent, "regions");
});

test("alerts: how do I get notified when it dumps", () => {
  const p = plan("How do I get an alert when it dumps at Alta?");
  assert.equal(p.intent, "alerts");
  assert.equal(p.tool, "get_alert_options");
  assert.equal(plan("can you set up a webhook for powder days").intent, "alerts");
});

test("Andes: a country name scopes a catalogue question and names a resort", () => {
  const p = plan("Where is it snowing in Chile?");
  assert.equal(p.intent, "powder");
  assert.equal(p.args.state, "Chile");
  assert.equal(plan("conditions at Portillo").resorts[0]?.slug, "ski-portillo");
});

test("unanswerable: no resort, no intent, or a resort PeakCam does not track", () => {
  const flight = plan("Book me a flight to Denver");
  assert.equal(flight.intent, "unknown");
  assert.equal(flight.tool, null);
  assert.equal(flight.reason, "no_intent");

  const unknownResort = plan("What's the forecast for Zermatt?");
  assert.equal(unknownResort.intent, "unknown");
  assert.ok(unknownResort.reason === "no_resort" || unknownResort.reason === "unknown_resort");

  const empty = plan("   ");
  assert.equal(empty.reason, "empty");
});

test("typo pass never turns ordinary words into a resort", () => {
  // Seen on production data: "it snow" is one edit from "mt snow" and
  // "in colorado" two from "el colorado".
  const p = plan("where did it snow most in Colorado, measured only");
  assert.deepEqual(p.resorts, []);
  assert.equal(p.intent, "powder");
  assert.deepEqual(p.args, { window: "24h", state: "CO", sourceOnly: "snotel", limit: 10 });
  assert.deepEqual(plan("will it snow this weekend").resorts, []);
  assert.deepEqual(plan("most snow in the last 48 hours").resorts, []);
  assert.equal(plan("conditions at mount snow").resorts[0]?.slug, "mount-snow", "the real name still matches exactly");
  assert.equal(plan("how much snow at el colorado").resorts[0]?.slug, "el-colorado");
  assert.equal(plan("how much at mammouth").resorts[0]?.slug, "mammoth", "a real typo still resolves");
});

test("mentions: longest alias wins and overlapping matches collapse to one resort", () => {
  const m = findMentions("jackson hole mountain resort forecast", RESORTS);
  assert.equal(m.length, 1);
  assert.equal(m[0].resort.slug, "jackson-hole");
  assert.equal(m[0].alias, "jackson hole mountain resort");
});
