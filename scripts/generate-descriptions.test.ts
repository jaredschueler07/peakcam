import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANNED_PHRASES,
  MAX_CHARS,
  MIN_CHARS,
  buildUserPrompt,
  copiedRun,
  extractText,
  parseArgs,
  rowNumbersMentioned,
  sentenceCount,
  sourceUrlsFromCsv,
  stateNameFor,
  validateDescription,
  type ResortRow,
} from "./generate-descriptions";

// The pure half of the generator: the validator that gates every draft, the
// prompt it is fed, the source-page text extraction and the CLI parsing. No
// network, no API key.

const VAIL: ResortRow = {
  slug: "vail", name: "Vail Mountain", state: "CO", country: "US", region: "Colorado Rockies", lat: 39.64, lng: -106.37,
  website_url: "https://www.vail.com", snotel_station_id: "842:CO:SNTL", runs_total: 278, lifts_total: 32, skiable_acres: "5317",
  vertical_ft: 3450, annual_snowfall_in: 354, longest_run_mi: 4, elevation_base_ft: 8120, elevation_summit_ft: 11570,
  passes: ["epic"], description: null, description_source: null,
};

const SOURCE = "Vail Mountain is one of the largest ski resorts in North America with 5,317 acres of terrain, seven legendary Back Bowls and Blue Sky Basin. Average annual snowfall is 354 inches. The resort opened in 1962.";

const GOOD =
  "Vail Mountain is a ski resort in Eagle County, Colorado, on the north side of the Gore Range in the Colorado Rockies. " +
  "The lift-served terrain covers 5,317 acres across the front side, the Back Bowls and Blue Sky Basin, with 278 marked runs and 32 lifts. " +
  "The base area sits at 8,120 ft and the summit at 11,570 ft, a vertical drop of 3,450 ft. " +
  "Average annual snowfall is 354 inches, and the resort has operated since 1962 and is on the Epic Pass.";

test("a factual paragraph with the state and the row's figures passes", () => {
  const v = validateDescription(GOOD, VAIL, SOURCE);
  assert.deepEqual(v.problems, []);
  assert.ok(v.ok);
  assert.ok(v.numbersMentioned.includes("skiable_acres"));
  assert.ok(v.numbersMentioned.includes("vertical_ft"));
  assert.ok(GOOD.length >= MIN_CHARS && GOOD.length <= MAX_CHARS);
});

test("the validator rejects superlatives, missing state, too few figures, copied prose and template leaks", () => {
  const noState = GOOD.replace("Colorado, on", "the Rockies, on").replace("Colorado Rockies", "Rockies");
  assert.match(validateDescription(noState, VAIL, SOURCE).problems.join("; "), /does not name the state "Colorado"/);

  const superlative = GOOD.replace("is a ski resort", "is a world-class, legendary ski resort");
  const problems = validateDescription(superlative, VAIL, SOURCE).problems;
  assert.ok(problems.some((p) => p.includes('"world-class"')));
  assert.ok(problems.some((p) => p.includes('"legendary"')));

  const copied = GOOD.replace("The lift-served terrain covers 5,317 acres across the front side, the Back Bowls and Blue Sky Basin,", "It is one of the largest ski resorts in North America with 5,317 acres of terrain,");
  assert.match(validateDescription(copied, VAIL, SOURCE).problems.join("; "), /copies 8 consecutive words/);

  const fewNumbers = "Vail Mountain is a ski resort in Colorado in the Gore Range. It has a front side, the Back Bowls and Blue Sky Basin served by gondolas and chairlifts. The village at the base was built for the resort in the early 1960s and the mountain has operated since then. It sits beside Interstate 70 about two hours west of Denver and is on the Epic Pass, which covers several other Colorado resorts.";
  assert.match(validateDescription(fewNumbers, VAIL, SOURCE).problems.join("; "), /mentions 0 of the row's 8 figures, need 2/);

  assert.match(validateDescription(GOOD.replace("Vail Mountain", "{resort}"), VAIL, SOURCE).problems.join("; "), /template braces/);
  assert.match(validateDescription(GOOD.replace("Epic Pass.", "Epic Pass!"), VAIL, SOURCE).problems.join("; "), /exclamation/);
  assert.match(validateDescription(GOOD.replace("the resort has", "we have"), VAIL, SOURCE).problems.join("; "), /first or second person/);
  assert.match(validateDescription("Vail is in Colorado with 278 runs and 32 lifts.", VAIL, SOURCE).problems.join("; "), /too short/);
  assert.match(validateDescription(GOOD + " " + GOOD, VAIL, SOURCE).problems.join("; "), /too long/);
});

test("figures count in either written form, and snowfall also in feet", () => {
  assert.deepEqual(rowNumbersMentioned("5317 acres and 3,450 feet of vertical", VAIL), ["skiable_acres", "vertical_ft"]);
  assert.deepEqual(rowNumbersMentioned("about 29 feet of snow a winter", VAIL), ["annual_snowfall_in"]);
  // 32 inside 32,000 or 3.2 does not count as the lift total.
  assert.deepEqual(rowNumbersMentioned("32,000 visitors", VAIL), []);
  assert.equal(sentenceCount(GOOD), 4);
  assert.equal(sentenceCount("One. Two! Three?"), 3);
});

test("copiedRun finds an eight-word run and ignores shorter overlap", () => {
  assert.equal(copiedRun("the resort has 278 runs and 32 lifts across 5,317 acres of terrain", SOURCE), null);
  assert.equal(copiedRun("It is one of the largest ski resorts in North America, they say.", SOURCE), "is one of the largest ski resorts in");
});

test("extractText keeps body copy and drops chrome, scripts and short fragments", () => {
  const html = `<html><head><title>Vail</title><script>var x = 1;</script><style>.a{}</style></head><body>
    <nav><a href="/">Home</a><a href="/tickets">Buy tickets now and save on lift tickets</a></nav>
    <h1>About the mountain</h1>
    <p>Vail Mountain covers 5,317 acres of skiable terrain &amp; seven Back Bowls, with 278 runs served by 32 lifts.</p>
    <p>Short.</p>
    <footer>Copyright 2026 Vail Resorts Management Company, all rights reserved.</footer>
  </body></html>`;
  const text = extractText(html);
  assert.match(text, /Vail Mountain covers 5,317 acres of skiable terrain & seven Back Bowls/);
  assert.doesNotMatch(text, /var x|Buy tickets|Copyright|Short\./);
  assert.equal(extractText("<p>" + "a".repeat(100) + "</p>", 50).length, 50);
});

test("the prompt carries the structured row, the source and the rejection feedback", () => {
  const prompt = buildUserPrompt(VAIL, "some operator text", "https://www.vail.com/about", ["too short: 100 chars"]);
  assert.match(prompt, /"skiable_acres": 5317/);
  assert.match(prompt, /"state_or_province": "Colorado"/);
  assert.match(prompt, /"season_passes": \[\s*"Epic Pass"\s*\]/);
  assert.match(prompt, /Operator page \(https:\/\/www\.vail\.com\/about\)/);
  assert.match(prompt, /- too short: 100 chars/);
  assert.match(buildUserPrompt(VAIL, "", null), /No operator page could be fetched/);
  assert.equal(stateNameFor({ state: "BC", country: "CA" }), "British Columbia");
  assert.equal(stateNameFor({ state: "Chile", country: "CL" }), "Chile");
});

test("parseArgs and the CSV source lookup", () => {
  assert.deepEqual(parseArgs(["--dry-run", "--resort", "alta", "--limit=5", "--force"]), { dryRun: true, resort: "alta", limit: 5, force: true });
  assert.deepEqual(parseArgs([]), { dryRun: false, resort: null, limit: null, force: false });
  assert.throws(() => parseArgs(["--limit", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown argument/);
  const csv = "slug,source_url,notes\nvail,https://www.vail.com/a https://www.epicpass.com,x\nalta,,y\n";
  const urls = sourceUrlsFromCsv(csv);
  assert.equal(urls.get("vail"), "https://www.vail.com/a");
  assert.equal(urls.has("alta"), false);
  assert.ok(BANNED_PHRASES.includes("world-class"));
});
