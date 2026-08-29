import { getAllResorts } from "@/lib/supabase";
import { SITE_URL } from "@/lib/site";

// llms.txt (https://llmstxt.org): a markdown map of the site written for LLM
// crawlers and answer engines. Regenerated with the rest of the static site
// every ISR window, so the per-resort lines carry current snow numbers.
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  // Fail closed like sitemap.ts: an empty resort index served successfully is
  // worse than a build/revalidate error.
  const resorts = await getAllResorts();

  const byState = new Map<string, typeof resorts>();
  for (const r of resorts) {
    const list = byState.get(r.state) ?? [];
    list.push(r);
    byState.set(r.state, list);
  }
  const states = [...byState.keys()].sort();

  const resortLines = states
    .map((state) => {
      const lines = byState
        .get(state)!
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => {
          const snow = r.snow_report;
          const facts: string[] = [];
          if (snow?.base_depth != null) facts.push(`${snow.base_depth}" base`);
          if (snow?.new_snow_24h != null && snow.new_snow_24h > 0)
            facts.push(`${snow.new_snow_24h}" new in 24h`);
          const camCount = r.cams.filter((c) => c.is_active).length;
          if (camCount > 0) facts.push(`${camCount} live webcam${camCount === 1 ? "" : "s"}`);
          const detail = facts.length ? `: ${facts.join(", ")}` : "";
          return `- [${r.name}](${SITE_URL}/resorts/${r.slug})${detail}`;
        })
        .join("\n");
      return `### ${state}\n\n${lines}`;
    })
    .join("\n\n");

  const body = `# PeakCam

> Live ski resort webcams, snow reports, and powder alerts for ${resorts.length} resorts
> across North and South America. Snow data comes from NRCS SNOTEL sensors near each
> resort, synced every 6 hours, quality-controlled, and blended with on-mountain user
> reports. Every resort page shows current base depth, 24/48-hour new snow, a 7-day
> trend, percent of the 30-year normal, an NWS/Open-Meteo forecast, and live webcams.

Data on this site is measured, not scraped from resort marketing: base depth and new
snow come from government SNOTEL telemetry, so numbers can differ from a resort's own
report (sensors sit at a fixed elevation; resorts often quote their upper mountain).

## Key pages

- [Snow Report](${SITE_URL}/snow-report): every resort's base depth, fresh snow, and conditions in one sortable table — the fastest answer to "where is the snow right now"
- [Resort Map](${SITE_URL}/map): interactive map of all resorts with live snow data and weather radar
- [Compare](${SITE_URL}/compare): side-by-side conditions for any set of resorts
- [About](${SITE_URL}/about): what PeakCam is and where the data comes from
- [Methodology](${SITE_URL}/methodology): how the numbers are measured — SNOTEL telemetry, quality control, 30-year normals, and the user-report blend

## Resorts

${resortLines}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
