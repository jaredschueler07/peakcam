#!/usr/bin/env tsx

/**
 * generate-descriptions.ts
 * ────────────────────────
 * Writes `resorts.description` with `description_source = 'generated'`
 * (parity plan P2): three to five factual sentences per resort from the
 * structured profile row (migration 025, filled by import-profiles.ts) plus
 * the operator's own "about" page as source material, drafted by Claude and
 * accepted only when the validator below passes. No sentence is copied from
 * any source; the page renders the result under its "generated" label.
 *
 * Usage (from the Mini's ops checkout, which has ANTHROPIC_API_KEY and the
 * service-role key in .env.local):
 *   npx tsx scripts/generate-descriptions.ts --dry-run              # draft + validate, print, write nothing
 *   npx tsx scripts/generate-descriptions.ts --resort alta          # one slug
 *   npx tsx scripts/generate-descriptions.ts --limit 10             # first N candidates
 *   npx tsx scripts/generate-descriptions.ts --force                # also rows that already have a description
 *
 * Reads:  .env.local (ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL,
 *         SUPABASE_SERVICE_ROLE_KEY; the anon key is enough for --dry-run),
 *         data/resort-profiles.csv (source_url per slug), the operator page.
 * Writes: resorts.description, resorts.description_source — one PATCH per
 *         slug, only for rows the validator accepted. Rows that already carry
 *         an `operator` or `editor` description are never overwritten, even
 *         with --force: those outrank a generated one.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { parse } from "csv-parse/sync";
import { STATE_NAMES } from "../lib/hubs.js";
import { PASS_LABELS, profileNumber, profilePasses } from "../lib/resort-profile.js";
import type { SeasonPass } from "../lib/types.js";

// ─── Load .env.local manually (same as scripts/snotel-sync.ts) ──────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// ─── Shapes ─────────────────────────────────────────────────────────────────

export const MODEL = "claude-sonnet-5-5";
export const MIN_CHARS = 350;
export const MAX_CHARS = 650;
export const MIN_SENTENCES = 3;
export const MAX_SENTENCES = 5;
/** Words in a row that, if they also appear in that order in the source, count as copied prose. */
export const COPY_RUN_WORDS = 8;
export const MAX_SOURCE_CHARS = 8_000;
export const MAX_ATTEMPTS = 3;

/** The `resorts` columns the generator reads. */
export interface ResortRow {
  slug: string;
  name: string;
  state: string;
  country: string;
  region: string | null;
  lat: number;
  lng: number;
  website_url: string | null;
  snotel_station_id: string | null;
  runs_total: number | string | null;
  lifts_total: number | string | null;
  skiable_acres: number | string | null;
  vertical_ft: number | string | null;
  annual_snowfall_in: number | string | null;
  longest_run_mi: number | string | null;
  elevation_base_ft: number | string | null;
  elevation_summit_ft: number | string | null;
  passes: string[] | null;
  description: string | null;
  description_source: string | null;
}

/** Superlatives and marketing words a factual description never needs. Matched case-insensitively on word boundaries. */
export const BANNED_PHRASES: readonly string[] = [
  "world-class", "world class", "breathtaking", "stunning", "legendary", "premier", "unparalleled", "unrivaled", "unrivalled",
  "iconic", "paradise", "must-visit", "must visit", "renowned", "famous", "spectacular", "amazing", "incredible", "unforgettable",
  "ultimate", "pristine", "finest", "perfect", "dream", "bucket list", "bucket-list", "après", "apres", "nightlife", "luxury",
  "luxurious", "best", "greatest", "most beautiful", "epic terrain", "epic conditions", "epic skiing", "epic powder",
  "endless", "limitless", "thrilling", "exhilarating", "awe-inspiring", "majestic", "magical", "charming", "quaint",
  "nestled", "boasts", "boasting", "gem", "haven", "mecca", "playground", "wonderland",
];

const COUNTRY_NAMES: Record<string, string> = { US: "United States", CA: "Canada", CL: "Chile", AR: "Argentina" };

/** "Colorado", "British Columbia", "Chile" — what the description must name. */
export function stateNameFor(row: Pick<ResortRow, "state" | "country">): string {
  const code = (row.state ?? "").trim();
  return STATE_NAMES[code.toUpperCase()] ?? code;
}

/** The numbers the row carries, in the forms a sentence might write them ("5,317" and "5317", "4" and "4.0"). */
export function rowNumbers(row: ResortRow): Array<{ field: string; value: number; forms: string[] }> {
  const fields: Array<[string, unknown]> = [
    ["runs_total", row.runs_total],
    ["lifts_total", row.lifts_total],
    ["skiable_acres", row.skiable_acres],
    ["vertical_ft", row.vertical_ft],
    ["annual_snowfall_in", row.annual_snowfall_in],
    ["longest_run_mi", row.longest_run_mi],
    ["elevation_base_ft", row.elevation_base_ft],
    ["elevation_summit_ft", row.elevation_summit_ft],
  ];
  const out: Array<{ field: string; value: number; forms: string[] }> = [];
  for (const [field, raw] of fields) {
    const value = profileNumber(raw);
    if (value == null) continue;
    const forms = new Set<string>([String(value), value.toLocaleString("en-US"), String(Math.round(value)), Math.round(value).toLocaleString("en-US")]);
    if (!Number.isInteger(value)) forms.add(value.toFixed(1));
    // Snowfall also reads naturally in feet: 354 in ≈ 29.5 ft → "29 feet" / "30 feet".
    if (field === "annual_snowfall_in") {
      const feet = value / 12;
      forms.add(String(Math.floor(feet)));
      forms.add(String(Math.round(feet)));
    }
    out.push({ field, value, forms: [...forms] });
  }
  return out;
}

function numberAppears(text: string, form: string): boolean {
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\d.,])${escaped}(?!\\d|[.,]\\d)`).test(text);
}

/** How many distinct row figures the text names. */
export function rowNumbersMentioned(text: string, row: ResortRow): string[] {
  return rowNumbers(row)
    .filter((n) => n.forms.some((form) => numberAppears(text, form)))
    .map((n) => n.field);
}

export function sentenceCount(text: string): number {
  return text
    // Abbreviations that carry a period mid-sentence. Units ("ft.", "mi.") are
    // left alone: they usually end a sentence and would swallow its stop.
    .replace(/\b(?:[A-Z]\.|No\.|Mt\.|St\.|Jr\.|vs\.|approx\.)(?=\s[a-z0-9])/g, "")
    .split(/[.!?]+(?:\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The first run of COPY_RUN_WORDS consecutive words shared with the source, or null. */
export function copiedRun(text: string, source: string, run = COPY_RUN_WORDS): string | null {
  const t = words(text);
  if (t.length < run) return null;
  const sourceGrams = new Set<string>();
  const s = words(source);
  for (let i = 0; i + run <= s.length; i++) sourceGrams.add(s.slice(i, i + run).join(" "));
  for (let i = 0; i + run <= t.length; i++) {
    const gram = t.slice(i, i + run).join(" ");
    if (sourceGrams.has(gram)) return gram;
  }
  return null;
}

export interface Validation {
  ok: boolean;
  problems: string[];
  numbersMentioned: string[];
}

/**
 * The gate a draft must pass before it is written: length, sentence count,
 * the state named, at least two of the row's own figures, no banned phrase,
 * no template leak, no first person, and no run of COPY_RUN_WORDS words
 * lifted from the source page.
 */
export function validateDescription(text: string, row: ResortRow, sourceText: string): Validation {
  const problems: string[] = [];
  const t = text.trim();
  if (t.length < MIN_CHARS) problems.push(`too short: ${t.length} chars, need ${MIN_CHARS}–${MAX_CHARS}`);
  if (t.length > MAX_CHARS) problems.push(`too long: ${t.length} chars, need ${MIN_CHARS}–${MAX_CHARS}`);
  const sentences = sentenceCount(t);
  if (sentences < MIN_SENTENCES || sentences > MAX_SENTENCES) problems.push(`${sentences} sentences, need ${MIN_SENTENCES}–${MAX_SENTENCES}`);
  const state = stateNameFor(row);
  if (state && !t.toLowerCase().includes(state.toLowerCase())) problems.push(`does not name the state "${state}"`);
  const numbersMentioned = rowNumbersMentioned(t, row);
  const available = rowNumbers(row).length;
  if (numbersMentioned.length < Math.min(2, available)) problems.push(`mentions ${numbersMentioned.length} of the row's ${available} figures, need ${Math.min(2, available)}`);
  const lower = t.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(`(^|[^\\p{L}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u");
    if (re.test(lower)) problems.push(`banned phrase "${phrase}"`);
  }
  if (/[{}]/.test(t)) problems.push("template braces in the text");
  if (/!/.test(t)) problems.push("exclamation mark");
  if (/\b(we|our|us|you|your)\b/i.test(t)) problems.push("first or second person");
  if (/\n/.test(t)) problems.push("line breaks (must be one paragraph)");
  if (!t.includes(row.name.split(" ")[0])) problems.push(`does not name the resort "${row.name}"`);
  const copied = copiedRun(t, sourceText);
  if (copied) problems.push(`copies ${COPY_RUN_WORDS} consecutive words from the source: "${copied}"`);
  return { ok: problems.length === 0, problems, numbersMentioned };
}

// ─── Source page text ───────────────────────────────────────────────────────

/** Visible text of an HTML page: scripts, styles, nav and footer dropped, tags stripped, whitespace folded, capped. */
export function extractText(html: string, max = MAX_SOURCE_CHARS): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
  s = s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 30)
    .join("\n");
  return s.length > max ? s.slice(0, max) : s;
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You write short, factual descriptions of ski resorts for a snow-conditions site. The reader is a skier deciding where to go and an AI assistant answering "tell me about this resort".

Rules:
- Three to five sentences, one paragraph, ${MIN_CHARS} to ${MAX_CHARS} characters.
- Plain, neutral, third person. No superlatives, no marketing adjectives, no exclamation marks, nothing about nightlife, dining or après-ski.
- Name the resort and its state or province (and country if outside the United States) in the first sentence.
- Use the structured figures you are given (vertical, acres, runs, lifts, annual snowfall, elevations, longest run) and name at least two of them with their units. Do not invent figures; if a figure is absent, do not guess it.
- The operator page is background only: take facts from it (terrain character, aspect, the range it sits in, lift types, how long it has operated, season timing), never its wording. Do not reuse any phrase of eight words or more.
- If the row lists season passes, you may name them in one clause ("on the Ikon Pass"); do not describe pass terms.
- Do not mention snow measurement, SNOTEL stations, webcams or PeakCam; the page carries those beside the description.
- Output only the paragraph. No heading, no preamble, no quotes.`;

export function buildUserPrompt(row: ResortRow, sourceText: string, sourceUrl: string | null, feedback: string[] = []): string {
  const passes = profilePasses(row.passes).map((p: SeasonPass) => PASS_LABELS[p]);
  const facts: Record<string, unknown> = {
    name: row.name,
    state_or_province: stateNameFor(row),
    country: COUNTRY_NAMES[row.country] ?? row.country,
    region: row.region,
    latitude: row.lat,
    longitude: row.lng,
    runs_total: profileNumber(row.runs_total),
    lifts_total: profileNumber(row.lifts_total),
    skiable_acres: profileNumber(row.skiable_acres),
    vertical_ft: profileNumber(row.vertical_ft),
    annual_snowfall_in: profileNumber(row.annual_snowfall_in),
    longest_run_mi: profileNumber(row.longest_run_mi),
    elevation_base_ft: profileNumber(row.elevation_base_ft),
    elevation_summit_ft: profileNumber(row.elevation_summit_ft),
    season_passes: passes.length ? passes : null,
  };
  const parts = [
    `Structured row (the only figures you may use):\n${JSON.stringify(facts, null, 2)}`,
    sourceText
      ? `Operator page${sourceUrl ? ` (${sourceUrl})` : ""}, background only, do not reuse its wording:\n"""\n${sourceText}\n"""`
      : "No operator page could be fetched; write from the structured row alone.",
  ];
  if (feedback.length) parts.push(`Your previous draft was rejected for these reasons; fix every one:\n- ${feedback.join("\n- ")}`);
  parts.push("Write the paragraph now.");
  return parts.join("\n\n");
}

// ─── CLI args ───────────────────────────────────────────────────────────────

export interface Args {
  dryRun: boolean;
  resort: string | null;
  limit: number | null;
  force: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { dryRun: false, resort: null, limit: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--resort") args.resort = argv[++i] ?? null;
    else if (a.startsWith("--resort=")) args.resort = a.slice("--resort=".length);
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a.startsWith("--limit=")) args.limit = Number(a.slice("--limit=".length));
    else throw new Error(`Unknown argument ${a}`);
  }
  if (args.limit != null && (!Number.isInteger(args.limit) || args.limit <= 0)) throw new Error("--limit must be a positive integer");
  return args;
}

// ─── I/O ────────────────────────────────────────────────────────────────────

const SELECT = "slug,name,state,country,region,lat,lng,website_url,snotel_station_id,runs_total,lifts_total,skiable_acres,vertical_ft,annual_snowfall_in,longest_run_mi,elevation_base_ft,elevation_summit_ft,passes,description,description_source";

function supabaseHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function fetchRows(url: string, key: string, slug: string | null): Promise<ResortRow[]> {
  const filter = slug ? `&slug=eq.${encodeURIComponent(slug)}` : "";
  const res = await fetch(`${url}/rest/v1/resorts?select=${SELECT}&is_active=eq.true&order=slug${filter}&limit=2000`, { headers: supabaseHeaders(key) });
  if (!res.ok) throw new Error(`resorts read failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as ResortRow[];
}

async function patchDescription(url: string, key: string, slug: string, description: string): Promise<void> {
  const res = await fetch(`${url}/rest/v1/resorts?slug=eq.${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: supabaseHeaders(key, { Prefer: "return=minimal" }),
    body: JSON.stringify({ description, description_source: "generated" }),
  });
  if (!res.ok) throw new Error(`PATCH ${slug} failed (${res.status}): ${await res.text()}`);
}

/** source_url per slug from data/resort-profiles.csv (the first URL in the cell is the stat/about page). */
export function sourceUrlsFromCsv(raw: string): Map<string, string> {
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Array<{ slug: string; source_url?: string }>;
  const out = new Map<string, string>();
  for (const r of rows) {
    const first = (r.source_url ?? "").split(/\s+/)[0];
    if (r.slug && first) out.set(r.slug, first);
  }
  return out;
}

async function fetchSource(url: string | null): Promise<string> {
  if (!url) return "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "PeakCamBot/1.0 (+https://www.peakcam.io/about; descriptions)", Accept: "text/html" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return "";
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return "";
    return extractText(await res.text());
  } catch {
    return "";
  }
}

async function draft(client: Anthropic, row: ResortRow, sourceText: string, sourceUrl: string | null, feedback: string[]): Promise<string | null> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: buildUserPrompt(row, sourceText, sourceUrl, feedback) }],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content
    .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
    .map((b: Anthropic.TextBlock) => b.text)
    .join("")
    .trim();
  return text || null;
}

export interface Outcome {
  slug: string;
  status: "written" | "drafted" | "skipped" | "rejected" | "refused" | "error";
  description?: string;
  sourceUrl?: string | null;
  problems?: string[];
  note?: string;
}

async function generateOne(client: Anthropic, row: ResortRow, sourceUrl: string | null): Promise<Outcome> {
  const sourceText = await fetchSource(sourceUrl);
  let feedback: string[] = [];
  let last: Validation | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const text = await draft(client, row, sourceText, sourceUrl, feedback);
    if (text == null) return { slug: row.slug, status: "refused", sourceUrl };
    last = validateDescription(text, row, sourceText);
    if (last.ok) return { slug: row.slug, status: "drafted", description: text, sourceUrl, note: `attempt ${attempt}, figures: ${last.numbersMentioned.join(", ")}` };
    feedback = last.problems;
  }
  return { slug: row.slug, status: "rejected", sourceUrl, problems: last?.problems ?? [] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(path.join(ROOT, ".env.local"));
  loadEnv(path.join(ROOT, ".env"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const readKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const writeKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !readKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or a Supabase key in .env.local");
  if (!args.dryRun && !writeKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to write (run from the Mini's ops checkout, or pass --dry-run)");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic();

  const csvPath = path.join(ROOT, "data/resort-profiles.csv");
  const sourceUrls = fs.existsSync(csvPath) ? sourceUrlsFromCsv(fs.readFileSync(csvPath, "utf-8")) : new Map<string, string>();

  const all = await fetchRows(url, readKey, args.resort);
  const candidates = all.filter((r) => {
    if (r.description_source === "operator" || r.description_source === "editor") return false;
    if (r.description && !args.force) return false;
    return true;
  });
  const rows = args.limit ? candidates.slice(0, args.limit) : candidates;

  console.log(`\n🏔  PeakCam — generated descriptions${args.dryRun ? " (dry run)" : ""}`);
  console.log("─────────────────────────────────────────────");
  console.log(`    ${all.length} active resort${all.length === 1 ? "" : "s"} read, ${candidates.length} without a description${args.force ? " or forced" : ""}, ${rows.length} to draft with ${MODEL}`);

  const outcomes: Outcome[] = [];
  for (const row of rows) {
    const sourceUrl = sourceUrls.get(row.slug) ?? row.website_url ?? null;
    let outcome: Outcome;
    try {
      outcome = await generateOne(client, row, sourceUrl);
    } catch (err) {
      const message = err instanceof Anthropic.RateLimitError ? "rate limited" : err instanceof Anthropic.APIConnectionError ? "network error" : err instanceof Error ? err.message : String(err);
      outcome = { slug: row.slug, status: "error", sourceUrl, note: message };
    }
    if (outcome.status === "drafted" && outcome.description && !args.dryRun) {
      await patchDescription(url, writeKey!, row.slug, outcome.description);
      outcome.status = "written";
    }
    outcomes.push(outcome);
    const tag = outcome.status.toUpperCase().padEnd(8);
    console.log(`\n  ${tag} ${row.slug}${outcome.sourceUrl ? `  (source: ${outcome.sourceUrl})` : ""}${outcome.note ? `  ${outcome.note}` : ""}`);
    if (outcome.description) console.log(`           ${outcome.description}`);
    for (const p of outcome.problems ?? []) console.log(`           ✗ ${p}`);
  }

  const count = (s: Outcome["status"]) => outcomes.filter((o) => o.status === s).length;
  console.log(`\n${args.dryRun ? "📝" : "✅"}  ${count("written")} written, ${count("drafted")} drafted (not written), ${count("rejected")} rejected by the validator, ${count("refused")} refused, ${count("error")} errors.`);
  if (!args.dryRun && count("written")) console.log("    Resort pages and markdown alternates revalidate within the hour (ISR 3600 / 900).\n");
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err: Error) => {
    console.error("\n❌  Fatal error:", err.message);
    process.exit(1);
  });
}
