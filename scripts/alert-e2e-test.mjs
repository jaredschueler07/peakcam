#!/usr/bin/env node
/**
 * alert-e2e-test.mjs — subscribe a test email, force-trigger the cron,
 * print diagnostic output. Run against prod or local.
 *
 * Usage: node scripts/alert-e2e-test.mjs --email you+peakcamtest@domain.com --resort-slug jackson-hole
 *
 * Note: the /api/alerts/subscribe route expects { email, resort_ids, thresholds }
 * (not resort_slug / threshold_inches). This script accepts --resort-slug for
 * convenience and resolves it to a resort_id via the public Supabase anon key
 * before calling the subscribe endpoint.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !(k in process.env)) process.env[k] = v;
  }
}
loadEnv(path.join(ROOT, ".env.local"));

const SITE = process.env.SITE_URL || "https://www.peakcam.io";
const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => {
    if (v.startsWith("--")) acc.push([v.slice(2), a[i + 1]]);
    return acc;
  }, [])
);
if (!args.email || !args["resort-slug"]) {
  console.error("Usage: --email X --resort-slug Y");
  process.exit(1);
}
if (!CRON_SECRET) {
  console.error("Missing CRON_SECRET in .env.local — required to trigger /api/alerts/trigger");
  process.exit(1);
}

async function j(url, init) {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: t }; }
}

console.log("[0/4] Resolving resort slug -> id...");
if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error("  Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in env");
  process.exit(1);
}
const resortLookup = await j(
  `${SUPABASE_URL}/rest/v1/resorts?slug=eq.${encodeURIComponent(args["resort-slug"])}&select=id,name&is_active=eq.true`,
  { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
);
if (resortLookup.status !== 200 || !Array.isArray(resortLookup.body) || resortLookup.body.length === 0) {
  console.error("  Could not resolve resort slug:", resortLookup.status, resortLookup.body);
  process.exit(1);
}
const resortId = resortLookup.body[0].id;
console.log("  resolved:", resortLookup.body[0].name, "->", resortId);

console.log("[1/4] Subscribing test email...");
const sub = await j(`${SITE}/api/alerts/subscribe`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: args.email,
    resort_ids: [resortId],
    thresholds: { [resortId]: 1 },
  }),
});
console.log("  status:", sub.status, "body:", sub.body);

console.log("[2/4] Triggering alert cron...");
const trig = await j(`${SITE}/api/alerts/trigger`, {
  method: "POST",
  headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
});
console.log("  status:", trig.status, "body:", trig.body);

console.log("[3/4] Re-triggering (dedup check)...");
const trig2 = await j(`${SITE}/api/alerts/trigger`, {
  method: "POST",
  headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
});
console.log("  status:", trig2.status, "body:", trig2.body);
if ((trig.body?.sent ?? 0) === 0) {
  console.warn("  WARN: dedup check not exercised — first trigger sent 0 emails.");
  console.warn("        Pick a resort with fresh snow above threshold to exercise dedup.");
} else if (trig.body?.sent > 0 && trig2.body?.sent > 0) {
  console.error("  FAIL: dedup did not prevent second send");
  process.exit(1);
} else {
  console.log("  OK: dedup suppressed second send");
}

console.log("[4/4] Done. Check inbox for email; use manage link to test edit/unsubscribe.");
