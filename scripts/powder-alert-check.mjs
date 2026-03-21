#!/usr/bin/env node

/**
 * powder-alert-check.mjs
 * ───────────────────────
 * Standalone cron script that triggers the powder alert email check.
 * Calls POST /api/alerts/trigger on the running Next.js app.
 *
 * Usage:
 *   node scripts/powder-alert-check.mjs
 *
 * Reads:  .env.local (NEXT_PUBLIC_SITE_URL, CRON_SECRET)
 *
 * Run after snotel-sync so snow data is fresh:
 *   node scripts/snotel-sync.mjs && node scripts/powder-alert-check.mjs
 *
 * Example crontab (runs at 8am daily, after the 7am snotel sync):
 *   0 7 * * * cd /path/to/peakcam && node scripts/snotel-sync.mjs
 *   0 8 * * * cd /path/to/peakcam && node scripts/powder-alert-check.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv(filePath) {
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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;

async function main() {
  console.log("[powder-alerts] Triggering powder alert check...");
  console.log(`[powder-alerts] Target: ${SITE_URL}/api/alerts/trigger`);

  const headers = { "Content-Type": "application/json" };
  if (CRON_SECRET) {
    headers["Authorization"] = `Bearer ${CRON_SECRET}`;
  }

  const resp = await fetch(`${SITE_URL}/api/alerts/trigger`, {
    method: "POST",
    headers,
  });

  const text = await resp.text();

  if (!resp.ok) {
    console.error(`[powder-alerts] HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    result = { raw: text };
  }

  if (result.sent !== undefined) {
    console.log(
      `[powder-alerts] Done — ${result.sent} email(s) sent, ${result.failed ?? 0} failed`
    );
    if (result.message) console.log(`[powder-alerts] ${result.message}`);
  } else {
    console.log("[powder-alerts] Response:", result);
  }
}

main().catch((err) => {
  console.error("[powder-alerts] Fatal:", err.message);
  process.exit(1);
});
