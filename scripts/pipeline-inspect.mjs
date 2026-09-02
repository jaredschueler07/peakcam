#!/usr/bin/env node
/**
 * pipeline-inspect.mjs — report row counts for data-pipeline tables.
 *
 * Read-only. Queries Supabase REST for exact row counts plus the latest
 * row timestamp on data_source_readings, resort_conditions_summary, and
 * resort_metadata.
 */
import { loadEnv, requireSupabaseEnv } from "./lib/env.mjs";

loadEnv();
const { url: URL, key: KEY } = requireSupabaseEnv();

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
