import { robotsTxt } from "@/lib/robots";

// GET /robots.txt — a route handler rather than the `MetadataRoute.Robots`
// export because the metadata helper cannot emit `Content-Signal`
// (lib/robots.ts). The rules are constants, so a day is plenty.
export const revalidate = 86400;

export function GET(): Response {
  return new Response(robotsTxt(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
