#!/usr/bin/env node
/**
 * pipeline-inspect.mjs — report row counts for data-pipeline tables.
 *
 * Read-only. Queries Supabase REST for exact row counts plus the latest
 * row timestamp on data_source_readings, resort_conditions_summary, and
 * resort_metadata.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}

// table -> { selectCol, orderCol } — resort_conditions_summary has no `id`
// column; its PK is `resort_id` and its timestamp is `updated_at`.
const TABLES = [
  { name: "data_source_readings", selectCol: "id", orderCol: "fetched_at" },
  { name: "resort_conditions_summary", selectCol: "resort_id", orderCol: "updated_at" },
  { name: "resort_metadata", selectCol: "resort_id", orderCol: "updated_at" },
];

for (const { name, selectCol, orderCol } of TABLES) {
  const countResp = await fetch(`${URL}/rest/v1/${name}?select=${selectCol}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact", Range: "0-0" },
  });
  const count = countResp.headers.get("content-range")?.split("/")[1] ?? "?";
  const latest = await fetch(
    `${URL}/rest/v1/${name}?select=*&order=${orderCol}.desc.nullslast&limit=1`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
  )
    .then((x) => x.json())
    .catch(() => null);
  const latestTs =
    latest?.[0]?.[orderCol] ??
    latest?.[0]?.fetched_at ??
    latest?.[0]?.updated_at ??
    latest?.[0]?.created_at ??
    "n/a";
  console.log(`${name}: ${count} rows; latest: ${latestTs}`);
}
