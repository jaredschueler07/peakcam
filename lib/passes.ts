// ─────────────────────────────────────────────────────────────
// Season-pass pages (parity plan P10): /passes/{pass} lists every resort on
// PeakCam whose profile names the pass (resorts.passes, from the official
// pass resort lists in data/resort-profiles.csv) with today's measured
// numbers. Pure: no Next.js, no database, no Date.now.
// ─────────────────────────────────────────────────────────────

import type { ResortWithData, SeasonPass } from "./types";
import { PASS_LABELS, SEASON_PASSES, profilePasses } from "./resort-profile";
import { measuredRow, rankByBase, snowHubSentence, type MeasuredRow } from "./snow-hubs";
import { formatMountainTime, inches, latestUpdatedAt, sourceLabel, type Quotable } from "./quotable";
import { stateLabel } from "./hubs";
import { SITE_URL } from "./site";
import { PUBLIC_API_ATTRIBUTION } from "./public-api/headers";

export const PASS_BASE_PATH = "/passes";

export interface PassInfo {
  pass: SeasonPass;
  label: PassLabel;
  /** The pass operator's site, for sameAs and the outbound link. */
  url: string;
  /** One line on what the pass is, written here, not copied from the operator. */
  blurb: string;
}

type PassLabel = (typeof PASS_LABELS)[SeasonPass];

export const PASS_INFO: Record<SeasonPass, PassInfo> = {
  ikon: { pass: "ikon", label: PASS_LABELS.ikon, url: "https://www.ikonpass.com", blurb: "Alterra Mountain Company's multi-resort pass; access rules (unlimited, 5- or 7-day, blackout dates) differ by resort and pass tier." },
  epic: { pass: "epic", label: PASS_LABELS.epic, url: "https://www.epicpass.com", blurb: "Vail Resorts' multi-resort pass; Epic Local and the day products carry blackout dates and limited days at some resorts." },
  "mountain-collective": { pass: "mountain-collective", label: PASS_LABELS["mountain-collective"], url: "https://mountaincollective.com", blurb: "Two days at each partner resort plus discounted extra days, with no blackout dates." },
  indy: { pass: "indy", label: PASS_LABELS.indy, url: "https://www.indyskipass.com", blurb: "Two days at each independent partner resort; some partners have blackout dates on the base pass." },
  power: { pass: "power", label: PASS_LABELS.power, url: "https://www.powerpass.com", blurb: "Mountain Capital Partners' pass for its own resorts in the Southwest and Mexico, plus partner days." },
};

export function isSeasonPassSlug(value: string): value is SeasonPass {
  return (SEASON_PASSES as readonly string[]).includes(value);
}

export function passPath(pass: SeasonPass): string {
  return `${PASS_BASE_PATH}/${pass}`;
}

export function passMarkdownPath(pass: SeasonPass): string {
  return `${passPath(pass)}/index.md`;
}

export interface PassPage {
  info: PassInfo;
  rows: MeasuredRow[];
  count: number;
  reported: number;
  /** Distinct states/provinces/countries the pass's resorts sit in, labelled. */
  places: string[];
  asOf: string | null;
  sentence: Quotable;
  pageUrl: string;
  markdownUrl: string;
}

/** Resorts whose profile names the pass, ranked by base. Empty when the profiles have not been imported. */
export function resortsOnPass(resorts: readonly ResortWithData[], pass: SeasonPass): ResortWithData[] {
  return resorts.filter((r) => profilePasses(r.passes).includes(pass));
}

export function buildPassPage(pass: SeasonPass, resorts: readonly ResortWithData[], baseUrl: string = SITE_URL): PassPage {
  const info = PASS_INFO[pass];
  const members = resortsOnPass(resorts, pass);
  const rows = rankByBase(members.map(measuredRow));
  const reported = rows.filter((r) => r.source);
  const places = [...new Set(members.map((r) => stateLabel(r.state)))].sort((a, b) => a.localeCompare(b, "en"));
  return {
    info,
    rows,
    count: rows.length,
    reported: reported.length,
    places,
    asOf: latestUpdatedAt(reported.map((r) => ({ updated_at: r.measuredAt! }))),
    sentence: snowHubSentence(rows, { where: `among ${info.label} resorts`, group: info.label }),
    pageUrl: `${baseUrl}${passPath(pass)}`,
    markdownUrl: `${baseUrl}${passMarkdownPath(pass)}`,
  };
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Ikon Pass Snow Report — 38 Resorts, Measured Base & Webcams | PeakCam" */
export function passTitle(page: Pick<PassPage, "info" | "count">): string {
  return `${page.info.label} Snow Report — ${plural(page.count, "Resort")}, Measured Base & Webcams | PeakCam`;
}

export function passDescription(page: Pick<PassPage, "info" | "count" | "rows" | "places">): string {
  const lead = page.rows.find((r) => r.baseIn != null && r.baseIn > 0);
  const where = page.places.length ? ` across ${page.places.length === 1 ? page.places[0] : `${page.places.length} states and provinces`}` : "";
  const head = `Today's measured snow at the ${page.count} ${page.info.label} resorts PeakCam tracks${where}: base depth and new snow from NRCS SNOTEL stations where one exists, dated to the reading, with live webcams.`;
  return lead ? `${head} Deepest base right now: ${lead.name}, ${inches(lead.baseIn!)}.` : head;
}

function cell(v: number | null): string {
  return v == null ? "–" : inches(v);
}

/** The pass page as one markdown document for agents (the HTML page's rel=alternate). */
export function passMarkdown(page: PassPage, baseUrl: string = SITE_URL): string {
  const lines: string[] = [
    `# ${page.info.label} snow report, ${plural(page.count, "resort")} on PeakCam`,
    "",
    `Canonical page: ${page.pageUrl}  ·  Pass operator: ${page.info.url}  ·  All passes: ${baseUrl}${PASS_BASE_PATH}`,
    "",
    page.sentence.text,
    "",
    `${page.info.blurb} Membership here comes from the operator's published resort list; PeakCam does not sell passes or know your pass tier.`,
    "",
    "| # | Resort | State | Base | New 24 h | New 48 h | Source | Dated | Live cams |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  page.rows.forEach((r, i) => {
    const source = r.source ? `${sourceLabel(r.source)}${r.stationName ? ` (${r.stationName})` : ""}` : "no report yet";
    lines.push(`| ${i + 1} | [${r.name}](${baseUrl}/resorts/${r.slug}) | ${stateLabel(r.state)} | ${cell(r.baseIn)} | ${cell(r.new24In)} | ${cell(r.new48In)} | ${source} | ${r.measuredAt ? formatMountainTime(r.measuredAt) : "–"} | ${r.liveCams} |`);
  });
  if (!page.rows.length) lines.push("", "No resort on PeakCam currently names this pass; the profile import fills the column.");
  lines.push("", `Attribution: ${PUBLIC_API_ATTRIBUTION}  ·  Terms: ${baseUrl}/about#terms`, "");
  return lines.join("\n");
}
