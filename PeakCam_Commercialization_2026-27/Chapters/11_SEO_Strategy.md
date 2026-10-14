# 11 SEO Strategy

## Evidence boundary
No live Keyword Planner export, Search Console baseline, paid keyword-difficulty panel or reliable Google Trends volume series was obtained. The query priorities below are qualitative hypotheses based on the product and observed competitor page structures. Do not present fabricated search volumes or traffic forecasts to a sponsor.

| Intent / example | Priority | Page strategy | What makes it genuinely useful |
| --- | --- | --- | --- |
| [resort] webcam / live cam | High but often competitive | One canonical resort-camera destination, using the current resort route where practical | Verified official source, correct mountain/camera names, timestamp caveat and fallback |
| [resort] base area cam / summit cam / snow stake cam | High specific intent | Camera watch page only when this distinct view is actually available | Angle/location explanation, source, real capture time if available |
| [small resort] camera not working / official webcam | Potential narrow wedge | Useful troubleshooting/fallback section on the canonical resort page | Working official destination; no misleading “fixed” promise |
| I-70 / Front Range ski webcams | High product fit, unmeasured volume | Curated corridor guide linked to 6–10 relevant resort pages | Why each source helps a drive decision; coverage and source status |
| [resort A] vs [resort B] webcams today | Selective | Comparison page only when it helps a real choice and both sources are maintained | Two useful views, source times and official links; no unsupported snow ranking |
| [resort] snow report / weather today | Defer broad competition | Link to authoritative reports; do not generate thin fake reports | Only add actual licensed data and original useful context |
| [resort] rentals / lodging near ski area | Commercial secondary | Small contextual module or genuinely researched local guide | Real destination fit, accurate disclosure, relevant booking links |
| Colorado / Utah / Tahoe mountain cams | Colorado now; other regions gated | State/region page only when useful maintained inventory exists | Honest coverage, useful grouping, no empty-filter index pages |
| [resort] opening day camera / spring skiing views | Seasonal supporting intent | Update existing page with confirmed official operation links | No guessed opening or snow guarantee; source and date |


## Technical architecture
Keep one canonical host, redirect the other host consistently, and use stable resort and camera IDs. Retain useful existing routes instead of changing URL structure solely for a keyword. A proposed architecture can be `/resorts/[slug]` for the resort hub, the existing watch route for a genuine camera page, and a small number of `/regions/[slug]` or corridor guides if implemented. Do not publish separate near-duplicate “snow,” “conditions,” “weather” and “live” pages without distinct value.

Only include real, useful, canonical, indexable pages in the sitemap. Exclude placeholder entries, empty filters, internal search results and duplicate query-state pages; use noindex where appropriate rather than assuming robots.txt removes already indexed pages. Canonical choices are hints, not a way to make low-value duplicates useful. Preserve redirects when removing defective URLs.

Titles should describe the specific destination and accurate coverage: “Loveland Webcams & Official Camera Links | PeakCam.” A description should explain the actual benefit, not stuff variants of “live.” Internal links should follow real navigation: region → resort → camera/source and adjacent choices. Include breadcrumbs and readable fallback text when the player is absent.

Use WebSite/Organization metadata already observed, then valid breadcrumbs where appropriate. Only use VideoObject or live-video markup when the page truly meets Google’s eligibility and required data; an external source link or iframe load is not proof of a playable live broadcast. Do not invent ratings, aggregate reviews, current weather measurements or timestamps for schema.

## Content quality
Every published resort page needs an accurate source, useful camera context, maintenance status, official operations/report link, and a reason it serves a specific user better than a generic directory listing. Prefer 12 maintained pages over 500 AI-generated resort descriptions. Google’s scaled-content policies target low-value publishing designed for rankings, regardless of whether a human or AI generated it. [G01](https://blog.google/products-and-platforms/products/search/google-search-update-march-2024/)

## 30-day SEO operating loop
Week 1: establish the real baseline and fix placeholder/indexation issues. Week 2: publish a small complete regional cohort and inspect sample URLs. Week 3: review impressions, query fit and landing-page qualified actions; improve pages receiving relevant impressions but no useful actions. Week 4: add only the next destinations requested by users or supported by query evidence. A page that gets traffic but sends everyone to a broken source is a product failure, not an SEO win.

Earn links from actual resort/club/concierge resource pages and honest product coverage. No purchased dofollow links, mass guest posts, copied maps, hidden affiliate redirects or automated “best snow” claims. Uncover Colorado explicitly excludes paid-link/guest-post pitches in its advertising rules; respect that channel’s stated limits.
