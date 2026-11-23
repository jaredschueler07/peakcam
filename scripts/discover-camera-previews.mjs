import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { fetchPagedRest, readTextCapped } from "./rest-helpers.mjs";

const env = {
  ...(fs.existsSync(".env") ? parse(fs.readFileSync(".env")) : {}),
  ...(fs.existsSync(".env.local") ? parse(fs.readFileSync(".env.local")) : {}),
  ...process.env,
};

(async () => {
  const urlBase = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!urlBase || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or key");
  const data = await fetchPagedRest(
    urlBase,
    "cams?select=embed_url&is_active=eq.true&embed_type=eq.iframe&embed_url=ilike.*roundshot.com*&order=id",
    { apikey: key, Authorization: `Bearer ${key}` },
  );
  const results = {};
  for (const row of data) {
    if (!row.embed_url) continue;
    const source = new URL(row.embed_url);
    if (!source.hostname.endsWith(".roundshot.com")) continue;
    try {
      const res = await fetch(source, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        continue;
      }
      const html = await readTextCapped(res, { maxBytes: 2 * 1024 * 1024 });
      const thumb = html.match(/<meta[^>]+(?:name|property)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
      if (!thumb) continue;
      const url = new URL(thumb, source);
      if (url.protocol !== "https:" || url.hostname !== source.hostname) continue;
      results[source.href] = url.href;
    } catch {
      console.log("No thumbnail:", source.href);
    }
  }
  const outPath = path.join("scripts", "data", "camera-previews", "roundshot.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  console.log("Provider-declared thumbnail mappings:", Object.keys(results).length);
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
