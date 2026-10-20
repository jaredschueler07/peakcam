// ─────────────────────────────────────────────────────────────
// Ask — execute a router plan and phrase the result.
//
// `answerQuestion(ctx, question)` runs lib/ask/router.ts, calls the one
// PeakCam tool the plan names (the same handlers the MCP server registers),
// and returns an AskAnswer: the tool's structured result, the resort(s),
// citations, and a dated, source-labelled sentence. The sentences for
// conditions, powder and percent-of-normal are lib/quotable.ts verbatim; the
// rest are built here from the tool output with quotable's formatters, so
// every number carries its source and time. Unanswerable questions come back
// with `answerable: false`, suggestions, and (when the data source offers
// it) a logged copy for review. No language model anywhere.
// ─────────────────────────────────────────────────────────────

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ResortWithData } from "@/lib/types";
import type { PublicApiCatalog } from "@/lib/public-api/data";
import { PUBLIC_API_ATTRIBUTION, PUBLIC_API_LICENSE_URL } from "@/lib/public-api/headers";
import type { AskAnswerPublic, AskResortRef, CamListPublic, PowderListPublic, ResortPublic, SeasonPublic } from "@/lib/public-api/schema";
import { resortCanonicalUrl } from "@/lib/public-api/serialize";
import { SITE_URL } from "@/lib/site";
import { stateLabel } from "@/lib/hubs";
import { formatOpeningDate, toPacificDay } from "@/lib/openings";
import {
  formatMountainTime,
  inches,
  latestUpdatedAt,
  pctOfNormalSentence,
  resortSentence,
  sourceLabel,
} from "@/lib/quotable";
import { stationFor } from "@/lib/stations";
import { sameCode } from "@/lib/mcp/catalog";
import type { PeakCamToolName } from "@/lib/mcp/tool-names";
import type { McpDataSource, UnmatchedQuestion } from "@/lib/mcp/types";
import { MAX_QUESTION_LENGTH, planQuestion, type AskPlan } from "./router";

/** The slice of a tool definition the executor needs; avoids importing tools.ts (which imports this file). */
export interface AskTool {
  name: PeakCamToolName;
  inputSchema: { parse(input: unknown): unknown };
  handler: (args: never) => Promise<CallToolResult>;
}

export interface AskContext {
  tools: readonly AskTool[];
  data: McpDataSource;
}

export interface AskOptions {
  via: UnmatchedQuestion["via"];
  /** Salted IP hash for the unmatched-question log; null over MCP. */
  ipHash?: string | null;
}

/** Offered whenever the router declines, so a client always has a next move. */
export const ASK_SUGGESTIONS = [
  "How much snow did Alta get in the last 24 hours?",
  "Where did it snow most in Colorado, measured only?",
  "Is Breckenridge open yet?",
  "What is the forecast for Jackson Hole this weekend?",
  "Show me Mammoth's webcams.",
  "Compare Vail and Keystone.",
  "Which resorts are above normal snowpack?",
] as const;

const SUBJECT_MAX = 200;

function ref(resort: ResortWithData): AskResortRef {
  return { slug: resort.slug, name: resort.name, canonicalUrl: resortCanonicalUrl(resort.slug) };
}

/** Strip e-mail addresses and long digit runs before a question is logged. */
export function redactQuestion(question: string): string {
  return question
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\d{7,}\b/g, "[number]")
    .trim()
    .slice(0, SUBJECT_MAX);
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function placeClause(plan: AskPlan): string {
  const state = plan.place?.state;
  if (state) return ` in ${stateLabel(state)}`;
  if (plan.place?.country) return ` in ${plan.place.country}`;
  return "";
}

// ── Sentences ────────────────────────────────────────────────

function seasonSentence(resort: ResortWithData, season: SeasonPublic, now: Date): string {
  const today = toPacificDay(now);
  const label = season.seasonLabel ? ` ${season.seasonLabel}` : "";
  const kind = season.openDateKind === "confirmed" ? "confirmed" : "projected";
  if (season.status === "open") {
    const since = season.openDate ? ` since its confirmed opening on ${formatOpeningDate(season.openDate)}` : "";
    const closing = season.closingDate ? `, closing ${formatOpeningDate(season.closingDate)}` : "";
    return `As of ${formatOpeningDate(today)}, ${resort.name} is open for the${label} season${since}${closing}.`;
  }
  if (season.closingDate && season.closingDate < today) {
    return `As of ${formatOpeningDate(today)}, ${resort.name} closed its${label} season on ${formatOpeningDate(season.closingDate)}.`;
  }
  if (season.openDate) {
    const when = season.openDate >= today ? `${kind} opening ${formatOpeningDate(season.openDate)}` : `${kind} opening date ${formatOpeningDate(season.openDate)} has passed without confirmation`;
    const status = season.status === "closed" ? "has not opened yet" : "has no confirmed status";
    return `As of ${formatOpeningDate(today)}, ${resort.name} ${status} for the${label} season; ${when}${season.openDateKind === "projected" ? " (third-party estimate)" : ""}.`;
  }
  return `As of ${formatOpeningDate(today)}, PeakCam has no opening date on file for ${resort.name}'s${label} season.`;
}

interface OpeningRows {
  asOf: string;
  totalMatching: number;
  resorts: Array<{ name: string; slug: string; season: SeasonPublic }>;
}

function openingsSentence(doc: OpeningRows, plan: AskPlan): string {
  const open = doc.resorts.filter((r) => r.season.status === "open").length;
  const future = doc.resorts
    .filter((r) => r.season.status !== "open" && r.season.openDate && r.season.openDate >= doc.asOf)
    .sort((a, b) => (a.season.openDate! < b.season.openDate! ? -1 : 1));
  const next = future[0];
  const confirmed = future.filter((r) => r.season.openDateKind === "confirmed").length;
  const where = placeClause(plan);
  const head = `As of ${formatOpeningDate(doc.asOf)}, ${open} of ${doc.totalMatching} resorts${where} are open`;
  const tail = next
    ? `; next to open is ${next.name} on ${formatOpeningDate(next.season.openDate!)} (${next.season.openDateKind === "confirmed" ? "confirmed by the resort" : "third-party projection"}), with ${confirmed} confirmed date${confirmed === 1 ? "" : "s"} ahead`
    : "";
  return `${head}${tail}.`;
}

function powderSentence(doc: PowderListPublic, plan: AskPlan): { text: string; asOf: string | null } {
  const where = placeClause(plan);
  const window = doc.window === "24h" ? "24 h" : "48 h";
  const key = doc.window === "24h" ? "newSnow24h" : "newSnow48h";
  const reported = doc.results.filter((r) => r[key].value != null);
  const rows = reported.filter((r) => (r[key].value ?? 0) > 0);
  const asOf = reported.reduce<string | null>((best, r) => {
    const t = r[key].measuredAt;
    return t && (!best || t > best) ? t : best;
  }, null);
  const stamp = asOf ? `As of ${formatMountainTime(asOf)}, ` : "";
  if (!rows.length) {
    const filters = [plan.args.minInches != null ? `at least ${inches(Number(plan.args.minInches))}` : null, plan.args.sourceOnly ? "measured only" : null].filter(Boolean).join(", ");
    return { text: `${stamp}no resort${where} reports new snow in the last ${window}${filters ? ` (${filters})` : ""}.`, asOf };
  }
  const lead = rows.slice(0, 2).map((r) => `${inches(r[key].value!)} at ${r.name} (${sourceLabel(r[key].source)})`);
  return { text: `${stamp}the most new snow in the last ${window}${where} is ${listOf(lead)}.`, asOf };
}

function forecastSentence(doc: {
  name: string;
  available: boolean;
  provider: "blend" | "nws" | "none";
  note: string | null;
  generatedAt: string;
  issuedAt: string | null;
  summary: { total7dIn: number; total14dIn: number; modelCount: number; models: string[]; peak: { date: string; in: number } | null } | null;
  periods: Array<{ dow: string; shortForecast: string; highF: number; snowInches: number }>;
}): string {
  if (!doc.available) return `No forecast for ${doc.name}: ${doc.note ?? "no model run is stored yet."}`;
  const days = doc.periods.slice(0, 3).map((p) => `${p.dow} ${p.shortForecast.toLowerCase()}, high ${p.highF} °F`);
  const narrative = days.length ? ` NWS: ${days.join("; ")}.` : "";
  if (doc.provider === "blend" && doc.summary) {
    const s = doc.summary;
    const peak = s.peak && s.peak.in > 0 ? `, peaking at ${inches(s.peak.in)} on ${s.peak.date}` : "";
    const amount = s.total14dIn > 0 ? `${inches(s.total7dIn)} of snow in the next 7 days and ${inches(s.total14dIn)} over 14${peak}` : "no snow in the next 14 days";
    return `PeakCam blend of ${s.models.length} weather models for ${doc.name}, issued ${formatMountainTime(doc.issuedAt ?? doc.generatedAt)}: ${amount} (median across models; ${s.modelCount} models agree on day one; Open-Meteo data, CC BY 4.0).${narrative}`;
  }
  const total = doc.periods.reduce((s, p) => s + (p.snowInches || 0), 0);
  const est = total > 0 ? ` The forecast wording suggests about ${inches(total)} of snow over ${doc.periods.length} days (keyword estimate, not a measured amount).` : ` No snow is named in the ${doc.periods.length}-day wording.`;
  return `NWS forecast for ${doc.name}, fetched ${formatMountainTime(doc.generatedAt)}: ${days.join("; ")}.${est}`;
}

function camsSentence(doc: CamListPublic): string {
  const live = doc.cams.filter((c) => c.live === true).length;
  const checked = doc.cams.map((c) => c.lastCheckedAt).filter((t): t is string => Boolean(t)).sort().pop();
  const stamp = checked ? ` as of PeakCam's last probe at ${formatMountainTime(checked)}` : "";
  if (!doc.cams.length) return `PeakCam lists no webcams for ${doc.name} yet; the resort page is ${doc.canonicalUrl}.`;
  return `${doc.name} has ${doc.cams.length} webcam${doc.cams.length === 1 ? "" : "s"} on PeakCam, ${live} live${stamp}; they play at ${doc.canonicalUrl}.`;
}

function historySentence(doc: { name: string; source: string | null; station: { name: string | null; elevationFt: number | null } | null; days: number; rows: Array<{ date: string; snowDepthIn: number | null }> }): string {
  const withDepth = doc.rows.filter((r) => r.snowDepthIn != null);
  if (withDepth.length < 1) return `PeakCam has no daily snow rows on file for ${doc.name} in the last ${doc.days} days.`;
  const newest = withDepth[0];
  const oldest = withDepth[withDepth.length - 1];
  const where = doc.station?.name ? `the ${doc.station.name} SNOTEL station${doc.station.elevationFt != null ? ` (${Math.round(doc.station.elevationFt).toLocaleString("en-US")} ft)` : ""} near ${doc.name}` : `the ${doc.source === "open_meteo" ? "model estimate" : "station"} for ${doc.name}`;
  if (newest === oldest) return `At ${where}, snow depth was ${inches(newest.snowDepthIn!)} on ${formatOpeningDate(newest.date)} (the only day on file in the last ${doc.days}).`;
  const delta = newest.snowDepthIn! - oldest.snowDepthIn!;
  const sign = delta > 0 ? "+" : "";
  return `At ${where}, snow depth went from ${inches(oldest.snowDepthIn!)} on ${formatOpeningDate(oldest.date)} to ${inches(newest.snowDepthIn!)} on ${formatOpeningDate(newest.date)} (${sign}${Math.round(delta * 10) / 10} in. over ${doc.days} days).`;
}

function compareSentence(doc: { resorts: Array<Omit<ResortPublic, "cams">> }): { text: string; asOf: string | null } {
  const asOf = doc.resorts.reduce<string | null>((best, r) => {
    const t = r.snow?.reportedAt ?? null;
    return t && (!best || t > best) ? t : best;
  }, null);
  const parts = doc.resorts.map((r) => {
    const s = r.snow;
    if (!s) return `${r.name} has no snow report`;
    const bits: string[] = [];
    if (s.newSnow24h.value != null) bits.push(`${inches(s.newSnow24h.value)} in 24 h`);
    if (s.baseDepth.value != null) bits.push(`base ${inches(s.baseDepth.value)}`);
    return `${r.name} ${bits.length ? `reports ${bits.join(", ")}` : "reports no depth or new-snow values"} (${sourceLabel(s.source)}, season ${r.season.status})`;
  });
  return { text: `${asOf ? `As of ${formatMountainTime(asOf)}, ` : ""}${parts.join("; ")}.`, asOf };
}

function profileSentence(doc: { name: string; location: { region: string; state: string; country: string; lat: number; lon: number; baseElevationFt: number | null; summitElevationFt: number | null }; websiteUrl: string | null; station: { name: string | null; elevationFt: number | null } | null }): string {
  const loc = doc.location;
  const elev = loc.baseElevationFt != null && loc.summitElevationFt != null
    ? `, base ${loc.baseElevationFt.toLocaleString("en-US")} ft to summit ${loc.summitElevationFt.toLocaleString("en-US")} ft`
    : loc.baseElevationFt != null
      ? `, base elevation ${loc.baseElevationFt.toLocaleString("en-US")} ft`
      : "";
  const station = doc.station?.name ? ` Snow numbers come from the ${doc.station.name} SNOTEL station${doc.station.elevationFt != null ? ` at ${Math.round(doc.station.elevationFt).toLocaleString("en-US")} ft` : ""}.` : " Snow numbers are weather-model estimates (no station assigned).";
  const site = doc.websiteUrl ? ` Website: ${doc.websiteUrl}.` : "";
  return `${doc.name} is in ${loc.region}, ${stateLabel(loc.state)}, ${loc.country} (${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)})${elev}.${station}${site}`;
}

function regionsSentence(doc: { totalResorts: number; regions: Array<{ state: string; label: string; country: string; resorts: number }> }): string {
  const top = [...doc.regions].sort((a, b) => b.resorts - a.resorts).slice(0, 5).map((r) => `${r.label} (${r.resorts})`);
  const countries = [...new Set(doc.regions.map((r) => r.country))];
  return `PeakCam covers ${doc.totalResorts} resorts across ${doc.regions.length} states, provinces and countries in ${listOf(countries)}; the largest groups are ${listOf(top)}.`;
}

function timelineSentence(doc: { name: string; hours: number; frameCount: number; camCount: number; newestCapturedAt: string | null; lastStorm: { capturedAt: string } | null; canonicalUrl: string }): string {
  if (!doc.frameCount && !doc.lastStorm) return `PeakCam has no archived frames for ${doc.name} in the last ${doc.hours} h; live cams are at ${doc.canonicalUrl}.`;
  const newest = doc.newestCapturedAt ? `, newest captured ${formatMountainTime(doc.newestCapturedAt)}` : "";
  const storm = doc.lastStorm ? `; the last storm frame on tape is from ${formatMountainTime(doc.lastStorm.capturedAt)}` : "";
  return `PeakCam has ${doc.frameCount} archived frame${doc.frameCount === 1 ? "" : "s"} from ${doc.camCount} cam${doc.camCount === 1 ? "" : "s"} at ${doc.name} in the last ${doc.hours} h${newest}${storm}.`;
}

const ALERTS_SENTENCE =
  `PeakCam powder alerts are free: register an e-mail, a webhook (Standard Webhooks, signed) or subscribe to the Atom and iCal feeds on ${SITE_URL}/alerts/manage; the threshold is 8 in. in 24 h, measured or forecast, checked daily at 13:00 UTC.`;

// ── Citations ────────────────────────────────────────────────

function citationsFor(plan: AskPlan, structured: Record<string, unknown> | undefined): string[] {
  const urls: string[] = plan.resorts.map((r) => resortCanonicalUrl(r.slug));
  const pages: Partial<Record<AskPlan["intent"], string>> = {
    powder: `${SITE_URL}/snow-report`,
    openings: `${SITE_URL}/opening-dates`,
    percent_of_normal: `${SITE_URL}/snow-report/percent-of-normal`,
    alerts: `${SITE_URL}/alerts/manage`,
    regions: `${SITE_URL}/ski-cams`,
  };
  const rows = (structured?.results ?? structured?.resorts ?? structured?.ranked) as Array<{ canonicalUrl?: string }> | undefined;
  if (!urls.length && Array.isArray(rows)) {
    for (const row of rows.slice(0, 3)) if (row?.canonicalUrl) urls.push(row.canonicalUrl);
  }
  const page = pages[plan.intent];
  if (page) urls.push(page);
  return [...new Set(urls)];
}

// ── Main ─────────────────────────────────────────────────────

async function logUnmatched(ctx: AskContext, question: string, options: AskOptions): Promise<void> {
  const log = ctx.data.logUnmatchedQuestion;
  if (!log) return;
  const entry: UnmatchedQuestion = { question: redactQuestion(question), ipHash: options.ipHash ?? null, via: options.via };
  try {
    await Promise.race([log.call(ctx.data, entry), new Promise<void>((resolve) => setTimeout(resolve, 800))]);
  } catch {
    // Logging is best-effort; the answer never depends on it.
  }
}

export async function answerQuestion(ctx: AskContext, rawQuestion: string, options: AskOptions): Promise<AskAnswerPublic> {
  const catalog: PublicApiCatalog = await ctx.data.catalog();
  const plan = planQuestion(rawQuestion.slice(0, MAX_QUESTION_LENGTH), catalog.resorts);
  const now = catalog.now;
  const base = {
    question: plan.question,
    intent: plan.intent,
    resort: plan.resorts[0] ? ref(plan.resorts[0]) : null,
    resorts: plan.resorts.map(ref),
    place: plan.place ? { state: plan.place.state, country: plan.place.country } : null,
    attribution: PUBLIC_API_ATTRIBUTION,
    license: PUBLIC_API_LICENSE_URL,
    generatedAt: now.toISOString(),
  };

  if (!plan.tool) {
    const didYouMean = plan.didYouMean.map((r) => `Did you mean ${r.name}? Try "How much snow at ${r.name}?"`);
    const sentence =
      plan.reason === "empty"
        ? "Ask a question about a ski resort PeakCam tracks."
        : plan.reason === "no_intent"
          ? "PeakCam answers questions about snow, cams, forecasts, season dates and powder rankings at the resorts it tracks; it could not tell what this one asks for."
          : "PeakCam could not match a resort in that question. Name one of the ~150 resorts it tracks, or ask a catalogue-wide question.";
    if (plan.reason !== "empty") await logUnmatched(ctx, plan.question, options);
    return {
      ...base,
      answerable: false,
      tool: null,
      arguments: null,
      sentence,
      asOf: null,
      data: null,
      citations: [`${SITE_URL}/connect`],
      suggestions: [...didYouMean, ...ASK_SUGGESTIONS],
    };
  }

  const tool = ctx.tools.find((t) => t.name === plan.tool);
  if (!tool) throw new Error(`ask: tool ${plan.tool} is not registered`);
  const args = tool.inputSchema.parse(plan.args) as never;
  const result = await tool.handler(args);
  const structured = result.structuredContent as Record<string, unknown> | undefined;
  if (result.isError || !structured) {
    const text = result.content.find((c) => c.type === "text") as { text?: string } | undefined;
    return {
      ...base,
      answerable: false,
      tool: plan.tool,
      arguments: plan.args,
      sentence: text?.text ?? "The tool could not answer.",
      asOf: null,
      data: null,
      citations: citationsFor(plan, undefined),
      suggestions: [...ASK_SUGGESTIONS],
    };
  }

  const first = plan.resorts[0] ?? null;
  let sentence: string;
  let asOf: string | null = null;
  switch (plan.intent) {
    case "conditions": {
      const q = resortSentence(first!, now, { station: stationFor(first!), opening: catalog.openings.get(first!.id) ?? null });
      sentence = q.text;
      asOf = q.asOf;
      break;
    }
    case "openings": {
      if (first) {
        const doc = structured as unknown as ResortPublic;
        sentence = seasonSentence(first, doc.season, now);
      } else {
        sentence = openingsSentence(structured as unknown as OpeningRows, plan);
      }
      break;
    }
    case "forecast":
      sentence = forecastSentence(structured as unknown as Parameters<typeof forecastSentence>[0]);
      break;
    case "cams":
      sentence = camsSentence(structured as unknown as CamListPublic);
      asOf = (structured as unknown as CamListPublic).updatedAt;
      break;
    case "cam_timeline":
      sentence = timelineSentence(structured as unknown as Parameters<typeof timelineSentence>[0]);
      asOf = (structured as { newestCapturedAt?: string | null }).newestCapturedAt ?? null;
      break;
    case "history":
      sentence = historySentence(structured as unknown as Parameters<typeof historySentence>[0]);
      asOf = latestUpdatedAt([first?.snow_report]);
      break;
    case "compare": {
      const c = compareSentence(structured as unknown as Parameters<typeof compareSentence>[0]);
      sentence = c.text;
      asOf = c.asOf;
      break;
    }
    case "powder": {
      const p = powderSentence(structured as unknown as PowderListPublic, plan);
      sentence = p.text;
      asOf = p.asOf;
      break;
    }
    case "percent_of_normal": {
      const pool = plan.place?.state ? catalog.resorts.filter((r) => sameCode(r.state, plan.place!.state)) : catalog.resorts;
      const q = pctOfNormalSentence(pool, now);
      sentence = q.text;
      asOf = q.asOf;
      break;
    }
    case "profile":
      sentence = profileSentence(structured as unknown as Parameters<typeof profileSentence>[0]);
      break;
    case "regions":
      sentence = regionsSentence(structured as unknown as Parameters<typeof regionsSentence>[0]);
      break;
    case "alerts":
      sentence = ALERTS_SENTENCE;
      break;
    default:
      sentence = "";
  }

  return {
    ...base,
    answerable: true,
    tool: plan.tool,
    arguments: plan.args,
    sentence,
    asOf,
    data: structured,
    citations: citationsFor(plan, structured),
    suggestions: [],
  };
}
