// Canonical origin for every absolute URL the app emits — metadata,
// canonicals, sitemap, robots, JSON-LD, OG images, and email links.
//
// This is the www host because that is what Vercel actually serves: the apex
// redirects to www, so a canonical/sitemap URL on the apex points every
// crawler at a redirect (which is how it shipped for months). If the serving
// domain ever changes, change it HERE and nowhere else.
export const SITE_URL = "https://www.peakcam.io";
