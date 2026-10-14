# PeakCam — Commercialization Operating Portfolio

**2026–27 US ski season | September 9, 2026 | Prepared for Jared Schueler**

Observed facts, explicit assumptions and proposed actions are separated. No outreach, purchases, repo edits or deployments were performed. This is an operating plan, not legal/tax advice or verified traction.

## Contents
1. Executive Summary
2. Current State Assessment
3. PeakCam Business Model
4. Target Customer & Positioning
5. Competitive Analysis
6. Monetization Strategy
7. Financial Model
8. Legal & Administrative Setup Checklist
9. Webcam & Data Legal Risk Assessment
10. Growth Strategy
11. SEO Strategy
12. Social & Content Strategy
13. Partnership Strategy
14. 2026–27 Ski Season Launch Plan
15. Marketing Budget
16. Analytics & KPI Framework
17. Business Operations Stack
18. Risk Register
19. Experiment Backlog
20. 30/60/90-Day Founder Action Plan
21. September 2026–April 2027 Master Roadmap

# 01 Executive Summary

## The decision
**Treat 2026–27 as a tightly scoped proof season, not a national-platform launch.** PeakCam’s strongest near-term opportunity is to become a fast, trustworthy camera finder for Colorado skiers deciding where to go before a drive. Monetization should follow repeat utility: first approved rental/lodging referrals and small measured local partnerships, then broader sponsorship. A paid forecasting product, national coverage and a large operational stack would be premature.

**Recommended positioning:** “Check the mountain before the drive. Find Colorado ski cameras and the official source—without hunting through resort websites.” This is a proposed message; do not imply every feed plays inside PeakCam or that coverage is already comprehensive.

## What changes the plan
The audited implementation is a **small static camera directory**, not the much broader product described in earlier discussions. It has three Colorado resorts and five camera entries. Two Breckenridge entries contain placeholder embed URLs. The code includes page-level analytics and camera-load events, but actual usage, revenue and bills were not obtained. These observations make reliability, accurate coverage and permission more urgent than billing, AI or accounts. [A01](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/package.json) [A02](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/data/resorts.json) [A03](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx) [A04](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/app/layout.tsx)

## The operating bet
Spend the next four weeks fixing the five-entry catalog, proving that ten people can reach their intended camera quickly, interviewing twelve Colorado skiers, and requesting permission from seven approachable resorts and three upstream providers. Reach 12 useful resort pages in October and at most 20 before Thanksgiving, subject to rights and maintenance capacity. Use clubs, concierge desks, source partners and useful long-tail pages before broad paid acquisition.

The first commercial test is **a small approved referral offer next to a real decision**, not a banner-ad network. An equipment commission on an unrelated camera visitor is weak intent. A rental or lodging offer for the resort the person is checking is more plausible; it still needs actual approved conversions. All conversion rates and dollar outcomes in the model are planning assumptions, not measured PeakCam results.

## Capital and evidence gates
For a founder-funded proof season, a practical starting envelope is **$3,000–$5,000 cash at risk**, with spending released in stages; legal work or a required license could increase it. Start with the $500–$1,000 marketing plan, not the $10,000 plan. Assume about 20 founder hours per week only for scheduling; your actual availability was not established.

The illustrative base case produces about **$4,500 first-year revenue**, not a founder salary, and requires roughly **$4,400 peak first-year funding**. The 24-month upside relies on a much larger second winter, not on a magical ad RPM. A meaningful business must eventually pay for your time as well as hosting. The workbook exposes a separate $50/hour opportunity-cost sensitivity rather than pretending unpaid work is free.

## Go / revise / stop
By November 23: no placeholders, all visible sources documented, 12–20 useful pages, tested analytics, and a small returning cohort. By December 15: at least one attributable approved commercial outcome or two small paid pilots, with reporting that buyers understand. By February: evidence of repeat use during relevant ski weeks and at least two pilot renewals. By April 30: decide whether reliable access, returning users and repeat commercial payments justify another season.

These are **decision thresholds, not forecasts or guarantees**. Small samples require interviews and uncertainty intervals, not an automated “pass” on a single conversion. A useful free resource with no economical acquisition or buyer demand may be a good hobby, but should not be funded as a growth startup indefinitely.

## Decision labels
🔴 **Critical before monetization:** remove placeholders; document content rights; validate analytics and disclosure; use commercial hosting; establish contracting/tax practices that fit the actual operating state. 🟠 **Important this season:** regional depth, favorites, clubs, search visibility, referral tests and permission-first sales. 🟡 **Can wait:** native apps, broad comparison, elaborate CRM, most paid analytics and automated alerts. 🟢 **Future opportunity:** licensed provider distribution, concierge widgets and a paid trip-monitoring product proven by demand.

**Don’t build yet:** forecasting engine, AI snow judgments, national community, full account system, video archive, public data API. **Don’t spend yet:** enterprise software, purchased backlinks, broad ski-interest ads, camera hardware, premium logo work, Delaware incorporation by default. **Easy wins:** honest coverage labels, verified source links, last-checked timestamps, broken-link reporting and a credible founder contact. **Big bet:** a provider-approved, owner-consented multi-resort camera distribution agreement that improves both coverage and reliability.

---

# 02 Current State Assessment

## Scope and provenance
The repository and Vercel project were accessed through connected read actions. Audited commit: `61c5f264a6e16c827ff2a7a8654dd6d5a07e809d`. The observed Vercel production deployment was READY and matched that main-branch commit. The production URL returned HTTP 200 and expected title/canonical metadata. This was **source and HTML inspection, not an interactive browser, mobile usability test, load test or legal review**. Earlier broad feature plans are not treated as current functionality. [A01](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/package.json) [A02](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/data/resorts.json) [A03](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx) [A04](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/app/layout.tsx) [A05](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/CLAUDE.md) [A06](https://www.peakcam.io)

| Area | Observed fact | Commercial implication |
| --- | --- | --- |
| Stack | Next.js ^16.0.10, React ^19.2.3, TypeScript 5, Tailwind 4; Vercel Analytics and Speed Insights dependencies | A small, inexpensive web utility can be enough; no stack rewrite is justified |
| Storage / data | Static curated resort JSON; no database client or backend service in reviewed tree | No database, storage or auth bill should be invented |
| Inventory | Loveland, Arapahoe Basin, Breckenridge; five camera records | Market as an early Colorado directory, not a national network |
| Critical data defect | A YouTube channel placeholder and example-resort-cdn image URL in Breckenridge data | Remove or suppress before outreach or paid traffic |
| Viewing | External source links, direct third-party images and iframes; fallback after timeout | Link-out utility is real, but in-site live playback not validated |
| Rights | Local image paths and third-party source URLs observed; no license portfolio supplied | Rights are unknown, not proven infringing or cleared |
| Routes | Home, resort directory, resort detail and camera watch routes; about/contact/privacy/terms routes in tree | Basic commercial shell exists; contents and enforceability still need review |
| SEO | Canonical base, titles/descriptions, Website/Organization structured data; recent SEO work in commits | Foundation exists; actual crawling, indexation and rankings unverified |
| Analytics | Analytics components mounted; camera_watch_open and camera_embed_ready in renderer | Instrumentation exists, but event semantics and real data must be validated |
| Deployment | Vercel production READY; custom aliases peakcam.io and www.peakcam.io | No evidence of a current hosting outage; actual plan/usage bill not obtained |
| Security / config | Optional public site URL / GA measurement environment values described; no secret needed for reviewed core | Do not expose or request secret values; check deployed tags and access controls |
| Absent in reviewed implementation | No observed accounts, billing, paid tier, alerts, AI summaries, weather API, maps, community database or affiliate backend | Treat all as potential experiments, not sales promises |
| Recent work | September commits address directory simplification, SEO, event context and camera fallback | Code is changing; recheck inventory and deployment before public claims |
| Verification limits | No executed tests/build, no complete open-issue audit, no measured CWV or bills, no authenticated analytics view | Engineering/commercial sign-off still requires the specified owner checks |


## Immediate repair specification
Remove the two placeholder URLs from the published catalog, not just their thumbnails. Introduce a schema rule rejecting placeholder channel IDs, example domains and unverified active embeds. Record `camera_id`, `resort_id`, owner, official source URL, provider, display mode, license status, permitted thumbnail/marketing use, last manually checked time and expiry. An iframe `load` event should remain a technical event: it cannot establish that a visitor saw a valid live video. [A02](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/data/resorts.json) [A03](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx)

For Loveland, manually verify the official webcam page and any redirect from the stored older snow-report/weather path. For Breckenridge, keep an honestly labeled official-source link until legitimate embeds are verified. For all three resorts, identify the source and license for the local preview photograph. Replace unknown assets with founder-owned or explicitly licensed artwork, or omit the photo.

The homepage exposes region filters beyond the current Colorado inventory in inspected HTML. Hide empty regions or label them as future coverage rather than implying results exist. Do not present an unverified image as “live now.” Show **“Official webcam page”** for link-out entries; use **“Last source check”** separately from the camera’s actual capture timestamp. A page refresh time is not the image timestamp. [A02](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/data/resorts.json) [A03](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx) [A06](https://www.peakcam.io)

## What the owner must verify, without granting email access
Open Vercel billing and analytics, Search Console and the production site directly. Record the actual plan, trailing-30-day human visitors, pageviews, traffic sources and spend; inspect policy text and any deployed tags. Run a mobile checklist with keyboard navigation and a real camera source. Complete a read-only issue/build-log review. These missing facts are captured as R03–R05 and R18, not invented in the model. No messages were sent, no repository was changed and no deployment was initiated for this portfolio.
## Brand & trust launch checklist
The name “PeakCam” clearly suggests mountain viewing, but no trademark clearance opinion was performed. The .io domain and existing visual identity do not establish legal rights or consumer trust. Use the existing brand until evidence warrants changes. A full logo/design audit on physical devices was not performed.

| Priority | Check | Acceptance criterion |
| --- | --- | --- |
| Critical | Honest hero and coverage | Three-resort early scope stated until expanded; no unsupported national/live claims |
| Critical | Visible source and freshness context | Official destination, correct camera identity and distinction between capture vs check time |
| Critical | No placeholder or unknown-license preview | All published assets and URLs reviewed |
| Critical | Real founder/contact and corrections | About/contact accessible; monitored mailbox; independent-site statement |
| Critical | Policy accuracy and disclosures | Actual analytics/embeds, commercial labels, no copied promises not implemented |
| Season | Mobile and accessible source journey | Large clear controls, keyboard/focus, readable fallback, no modal trap |
| Season | Public partner claims | Use only approved names/logos/quotes; no fake testimonials |
| Season | Useful sparse homepage | Working region choices, explain link-out behavior, clear first action |
| Later | New logo, brand campaign, native app | Only after product evidence; not a prerequisite to professional conduct |


---

# 03 PeakCam Business Model

## A small commercial system, not a collection of features
The intended loop is: **useful camera destination → successful official-source/verified-playback action → saved return visit → relevant disclosed referral → approved transaction or sponsor renewal**. Each step must be measurable. Registration is optional; a frictionless external camera handoff can be a successful session even when time on site is short.

The supply side is a curated set of source destinations and, when available, explicit embed/image permissions. The demand side is a concentrated audience with a recurring mountain decision. The commercial side is a small number of nearby merchants or accepted affiliate programs. The scarce assets are **trusted access, habitual usage and measurable commercial intent**, not the number of logos in the footer.

| Business component | This season | Later only with evidence |
| --- | --- | --- |
| Product | Fast directory, accurate resort/source pages, useful fallback and local favorites | Personalized monitoring, licensed comparison and alerts |
| Customer | Colorado repeat skiers; secondarily destination trip planners | Adjacent regions with validated maintenance economics |
| Distribution | Clubs, concierge sharing, official-source relationships, useful search pages | Paid acquisition and bigger creator placements |
| Revenue | Approved referral commissions and a handful of local pilots | Regional sponsorship, selective ads, validated paid features |
| Cost structure | Commercial hosting, rights/legal review, modest tools and founder time | Licensed data, backend alerts, contractors scaled to contribution |
| Defensibility | Source/rights registry, reliable corrections, local partner trust and direct return behavior | Owner-consented distribution rights and genuinely differentiated workflow |
| Not a moat | Public URLs, generic AI text, a large unverified catalog | Do not value these as proprietary data or exclusive IP |


## The buyer’s economic question
A local rental shop does not buy “AI-powered outdoor technology.” It buys relevant attention, leads or bookings from people near its mountain. A resort may value accurate source referral and fewer broken listings without ever paying PeakCam. A camera provider may want distribution while also charging a license. A media outlet may offer publicity but sell its own advertising. Keep **supplier, distributor, advertiser and affiliate merchant** as separate CRM roles.

Initial operator goals: two written source permissions, three measurable distribution relationships, one approved affiliate program with a real payable transaction, and two small paid pilots whose owners understand the report. Do not count a contact form submission, affiliate application, free review or vendor quote as a revenue partnership.

## Kill or change the model when
Source permissions systematically require uneconomical minimum guarantees; users prefer direct resort bookmarks and do not return to PeakCam; no localized commercial intent appears after substantial qualified traffic; or maintenance consumes most founder capacity. In those cases, narrow to a link-first concierge/club curation service, reduce spending, or retain it as a low-cost utility. The alternative is not automatically “build more features.”

---

# 04 Target Customer & Positioning

## Ranked segments
Scores are strategic judgments (1 low, 5 high), not market survey findings. All skier types can use cameras, but that does not make them equally economical acquisition targets.

| Rank / audience | Repeat need | Fit today | Monetization | Priority / job |
| --- | --- | --- | --- | --- |
| 1 Colorado local / weekend skier or snowboarder | 5 | 5 | 2 | Core: choose between familiar mountains before a drive |
| 2 Returning destination traveler, 1–14 days before trip | 3 | 4 | 5 | Secondary: visually check destination and finish rental/lodging logistics |
| 3 Ski club trip organizer / hotel concierge | 4 | 4 | 3 | Distribution: share one reliable set of official sources with a group |
| 4 Powder hunter / advanced skier | 5 | 3 | 3 | Good camera user, but forecasting/safety expectations exceed current product |
| 5 Families planning first ski trip | 2 | 3 | 4 | Useful rental/lesson intent; need clear beginner context, not assumed expert knowledge |
| 6 Weather/snow enthusiasts and webcam watchers | 5 | 4 | 1 | May create traffic with little purchase intent; do not confuse with travelers |
| 7 Niche creator / ski media | 3 | 3 | 2 | Feedback and distribution partner; not primary subscription buyer |
| 8 Resort / DMO | 3 | 3 | 3 | Source/accuracy partner first, potentially later sponsor |
| 9 Generic outdoor consumer / summer tourist | 1 | 2 | 2 | Defer acquisition; weak ski-season focus |


## Core persona and jobs
**Core persona, hypothesis:** a Colorado skier with two or three familiar mountain options, who checks cams before leaving or during a storm. They are comfortable opening official sources and value speed over a new account. The pain is hunting through different navigation systems, discovering broken/stale cameras, and not knowing whether a view is current. Interview the behavior, not a fictional demographic profile.

**Primary job:** “When I’m deciding whether and where to ski, help me get to the right current mountain view quickly, so I can make my own call.” Success is the camera/source reached and a repeat visit during another decision. It is not time spent scrolling advertisements.

**Traveler job:** “Before my trip, help me see what the destination looks like and find relevant practical services.” This supports lodging, equipment rentals and transportation much better than selling a generic weather subscription.

**Group organizer job:** “Give my group a single accurate, shareable starting point so I do not answer the same camera-link question repeatedly.” This creates a club/concierge acquisition loop and a possible small setup service.

## Three positioning options
**Recommended:** “Check the mountain before the drive.” Supporting line: “Find Colorado ski cameras and their official sources in one quick place.” It fits the inspected product and gives the user a decision context.

**Secondary:** “Your ski trip’s camera shortlist.” Better for visitors with monetizable travel needs, but likely less habitual outside their trip window.

**Do not use yet:** “America’s real-time mountain intelligence platform.” It overstates three-resort coverage, unverified live playback, data capabilities and operating maturity.

## Return, referral and willingness to pay
A person returns for reliable access to saved mountains during a new weather/drive decision. They recommend PeakCam when a shareable list saves their group work. They may eventually pay to avoid missing a specific relevant event or to monitor a trip across several sources—provided notifications are accurate and distinct from free alternatives. They are unlikely to pay merely to see public camera links behind a paywall.

A business may pay for attributable local exposure, a qualified lead, a credible destination guide, or a workflow service it otherwise maintains manually. It will not rationally pay a premium simply because the founder has a large national prospect list. Free favorites should support retention first; charge only for a proven incremental job.

---

# 05 Competitive Analysis

## The market reality
Trade reporting of NSAA’s preliminary 2025–26 data put US skier visits at **52.6 million**, versus 61.5 million in the prior season. These are visits, not unique people or webcam users; the latest-season number is secondary-reported and preliminary. This establishes a seasonal industry, not PeakCam’s obtainable market. No reliable PeakCam market share, keyword volume, competitor MAU or paid-search CPC was obtained. [M06](https://www.snow-forecast.com/whiteroom/us-skier-visits-drop-dramatically-after-poor-snowfall-winter-in-the-west/) [M07](https://www.forbes.com/sites/michellebruton/2025/05/30/us-ski-resorts-had-second-best-season-on-record-in-202425/)

| Competitor / type | Audience and offer | Current price evidence | Business / channel observations | Wedge implication |
| --- | --- | --- | --- | --- |
| OpenSnow | Forecast-led skiers; local experts, custom alerts, maps and conditions | Base $49.99/year; Premium $99.99/year on current official support page | Paid web/mobile product; deep forecast workflow. Premium is NOT a group plan | Do not try to beat forecast depth this season; make camera access simpler |
| OnTheSnow | Broad resort discovery, snow reports, webcams, favorites and powder alerts | Official mobile page describes free app | Web and native app; resort/region pages, reports and commercial trip modules. App-store rating count is not MAU | A free-feature paywall is weak; narrow reliable corridor execution |
| Snow-Forecast | Weather-led mountain users and travelers | Localized display roughly $8.08 monthly / $24.28 six months / $29.68 annually; recheck checkout | Free shorter forecast and paid longer forecast; broad mountain pages and commercial rewards | Avoid duplicating model forecasts; source clarity and fast camera handoff |
| Official resort sites/apps | Visitors seeking authoritative operations, tickets and cameras | Public information often free; transactions priced by resort | Direct booking, pass ecosystem, owned email/app channels | Your partner AND competitor; send credit/traffic, do not pretend authority |
| Provider portals: Roundshot / Panomax / HDOnTap | Camera viewers and destinations buying infrastructure | Publisher redistribution price not publicly verified; quote required | Own camera discovery networks and B2B services | A potential upstream supply partnership, not simply a site to scrape |
| SnowStash | Camera-centric resort pages, specific angles and ski planning | Pricing and audience not verified | Observed resort/camera landing pages and contextual trip links; direct product overlap | Camera aggregation is not novel; test measurable speed, reliability and return behavior |
| General camera aggregators / YouTube | Casual watchers and destination searchers | Public viewing commonly available; exact competitor commercial terms vary | Search distribution and existing video players; individual channels vary | Useful link aggregation alone has low barriers |
| Ski.com / SnowPak / travel booking platforms | Ski travelers shopping packages/lodging | Trip-specific quote/checkout | Commercial trip conversion and destination guides; some affiliate routes | Refer purchase-intent users instead of becoming a travel agency |


Pricing and feature facts above come from current official product/support sources where available. Inferred channel strategy is qualitative; no proprietary traffic panel was purchased. OpenSnow’s current Base/Premium distinction matters because “cheaper snow forecasts” would place PeakCam against an already established paid product. OnTheSnow’s free overlap also undermines favorites or generic powder alerts as a standalone paid proposition. [M01](https://support.opensnow.com/subscription/how-much-does-opensnow-cost) [M02](https://www.onthesnow.com/news/mobile/) [M03](https://apps.apple.com/us/app/onthesnow-ski-snow-report/id300412347) [M04](https://www.snow-forecast.com/pages/membership.php) [M05](https://www.snow-forecast.com/pages/rewards) [M08](https://snowstash.com/usa/california/sugar-bowl/snow-cams) [P01](https://www.roundshot.com/en/messages.html/21/news/946) [P02](https://www.ski.com/affiliates)

## Search and mobile implications
Incumbents already have resort, region, webcam and report pages. Broad “[resort] snow report” and “best ski resorts” competition should be considered hard, not an immediate win. More specific camera-angle queries, reliable fallback information, small-resort pages, and corridor comparisons offer a more plausible entry point—but this is a hypothesis without measured keyword difficulty.

Mobile web should be the first product. A skier needs a source quickly, not necessarily an installation. The existing third-party player dependencies mean a responsive layout alone does not prove a good mobile experience; test tap targets, loading behavior, full-screen handling, back navigation and cellular conditions before buying traffic.

## Defensible gap to test
“Fewer dead ends, clear source/timestamp context, and your familiar mountains one tap away.” That is narrower than “all ski information” and creates a measurable promise. If users do not notice or value this distinction after observing the actual product, the wedge is not validated. A bigger resort count is not an adequate substitute.

---

# 06 Monetization Strategy

## Ranked portfolio
The following prices, launch times and revenue ranges are **commercial test proposals**, not quoted contracts or industry benchmarks. Difficulty includes sales and permission work, not just coding.

| Model | Rank | Earliest realistic time | Economic test | Difficulty | Scale | UX impact | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Permission + referral resort pilot | 1 | 1–3 weeks | No initial revenue; access/quality benefit | Low | High strategic leverage | Positive | First ten contacts; not a disguised ad sale |
| Contextual rental / lodging affiliate | 2 | 1–4 weeks after approval | $0–0.03 per visitor initially; higher only in proven trip intent | Low–medium | High | Low clutter | Track approved net commission, cancellations and payout lag |
| Local featured listing | 3 | 2–6 weeks | $50–150/month pilot; $150–400 with measured local value | Medium sales | Medium | Low if one labeled slot | Need destination-specific audience, not national MAU |
| Mountain page sponsorship | 4 | 3–8 weeks | $100–300/month early; $300–1,000 with meaningful verified reach | Medium | Medium | Medium | Sell placement/reporting, not guaranteed bookings or editorial ranking |
| Regional destination sponsorship | 5 | 4–12 weeks | $250–750/month pilot; $750–2,500 only with evidence | High sales | Medium | Medium | No statewide exclusivity at pilot price |
| Gear / apparel affiliate | 6 | 1–3 weeks | $0–0.02/visitor general audience; uncertain | Low | High | Low–medium | Use specific packing/rental context, not generic product clutter |
| Newsletter sponsor | 7 | 2–4 weeks after list exists | $50–150 per issue initially, contingent on real engaged list | Medium | Medium | Low | Sell measured delivered opens/clicks, not raw subscribers |
| Selective display advertising | 8 | 2–6 weeks after eligibility | $3–8 net eligible-page RPM planning range | Low integration / medium approval | High | Medium–high | Eligibility not assured; low revenue at small traffic |
| Seasonal Pro alerts / trip monitor | 9 | 4–10 weeks AFTER demand and licensing gates | $19–29 season / $29–39 annual price test | High | High if retention real | Positive if core stays free | No generic paywall around already-free camera links |
| Concierge / club landing-page setup | 10 | 2–4 weeks | $150–500 one-time setup; $25–100/month maintenance | Medium manual | Low–medium | Positive | Sell curation/custom links, not redistributed unlicensed data |
| Camera issue notification for owners | 11 | 4–8 weeks after pilot | $25–100/month hypothesis | Medium | Medium | Positive | Competes with monitoring tools; manually validate first |
| API / licensed conditions data resale | 12 | 3–9 months | $0 this season baseline; negotiated later | Very high rights/data | High theoretical | Neutral | No proprietary data asset or resale rights demonstrated |
| Sponsored conditions / recommendations | Reject | N/A | Reputation downside outweighs early dollars | High trust/legal risk | Poor | Negative | Never let payment change observed snow or safety claims |


## Affiliate program portfolio
| Category / program | Public opportunity | Planning treatment | Next action |
| --- | --- | --- | --- |
| Lodging — Ski.com | Publisher affiliate program; commission/cookie terms not published in retrieved page | Forecast $0 until accepted and terms known | Email affiliates@ski.com with small accurate site scope |
| Hotels/rentals — Expedia Group | Program includes group brands; up to 4% qualifying bookings | Treat as one group relationship; no guaranteed across-product rate | Apply; confirm deep links, sub-IDs, completed-stay rule and exclusions |
| Hotels — Booking.com | Current official affiliate signup route | Do not assume old percentage-of-commission tiers | Choose applicable publisher program/region and obtain current terms |
| Gear/rentals — evo | 5% / 30-day published program terms | Net eligible orders only; rental eligibility must be specifically confirmed | Apply via official page; confirm US publisher eligibility |
| Gear — Backcountry | 8% base / 30-day published terms | Returned/excluded purchases reduce payable revenue | Use only relevant product context and approved assets |
| Snowboards — Weston | 6% / 30-day AvantLink program | Small brand may be accessible; not proof of sponsor budget | Apply to affiliate route rather than guessing personal email |
| Outdoor gear — Snow Peak | Content partners 6%; coupon partners 2%; 30-day window | Ski-trip fit weaker than rental/lodging | Later, specific travel-gear content only |
| Rental cars — DiscoverCars | 70% of rental profit and 30% of Full Coverage revenue | NEVER multiply 70% by the full booking value | Ask for net commission reporting and terms by market |
| Activities — GetYourGuide | Creator/partner route identified; up to 8% creator offer noted | Specific ski lessons/activities and publisher route need confirmation | Test only relevant available destination inventory |
| Insurance — Allianz | Official affiliate route linked from company hub | No rate assumed; insurance marketing/producer rules and ski exclusions matter | Refer only through approved relationship, never advise coverage as certain |
| Camera gear — GoPro | Localized official affiliate page shows 3% | US acceptance and terms not confirmed | Later; no equipment purchase needed to apply |
| Ski passes / tickets | No current publisher commission verified for Epic, Ikon, Indy or Mountain Collective | Base case $0; pass ownership or consumer referrals are not affiliate approval | Ask operator/partnership team; never invent rates |
| Flights | No suitable approved publisher program verified for PeakCam | Do not model flight commission | Avoid metasearch/API build this season |
| Lessons / shuttles / packages | Direct referral or approved activity/package program may work | Net verified booked referrals only | Pilot with one business using a code or merchant-confirmed report |


Program sources: [P02](https://www.ski.com/affiliates) [P03](https://www.evo.com/pages/affiliate-program) [P04](https://www.backcountry.com/info/affiliate-program) [P05](https://www.affiliates.expediagroup.com/) [P06](https://www.booking.com/affiliate-program/v2/index.html) [P07](https://westonbackcountry.com/pages/weston-affiliate-program) [P08](https://www.snowpeak.com/pages/affiliates) [P09](https://www.discovercars.com/pl/affiliate) [P10](https://gopro.com/en/dk/legal/gopro-affiliate-program). The CRM contains contact/signup links and limitations for the rest. A pro discount, creator gifting page, travel-agent program or old press release is **not** proof of a current affiliate agreement. Always confirm geographic eligibility, deep linking, trademark bidding, coupon rules, attribution window, payout threshold, reversals and whether a commission is on booking value, merchant margin or completed net sale.

### Unit economics without fake precision
A simple formula is `monthly users × commercial-link click rate × merchant conversion rate × average net commission × approval fraction`. Base illustration: 10,000 × 2.5% × 2.5% × $20 × 80% = **$100 earned commission/month**. None of these rates is an observed PeakCam result. At a low-intent 1% click rate, 1.5% conversion, $12 commission and 75% approval, the same audience yields only about **$14**. Separate referral clicks from payable commissions and cash received.

## Display ads: useful later, not a financing strategy now
At 10,000 monthly users, 5.5 pageviews/user, 60% eligible inventory and $5 net RPM, ads generate **$165/month**. At 1,000 users, the same arithmetic is $16.50 before eligibility and UX tradeoffs. The model deliberately keeps ads off below an internal 10,000-user gate; this is not a network rule. Journey’s current official requirements cite 1,000 premium sessions in 30 days plus content/engagement requirements. Acceptance and camera-directory suitability are not established. [V07](https://journeymv.zendesk.com/hc/en-us/articles/24633185741723-Journey-Minimum-Requirements)

One labeled direct local slot can be worth more than display ads at low traffic, but only if a real buyer sees value. Never sell $500/month against 100 unqualified impressions using an invented CPM. Use small pilot prices, actual local reach, cancellation flexibility and merchant outcomes. Newsletter sponsorship waits for a genuinely opted-in, engaged list, not a scraped email database.

## Premium: test price and job, not a feature list
Keep source access and basic local favorites free. Test **$19–29 for a ski season**, **$29–39 annual**, and **$4.99 monthly** as separate propositions, not simultaneous permanent price promises. A season pass expiring April 30 can reduce renewal complexity but still needs clear expiry/refund terms. Annual subscriptions require earned-versus-cash treatment not modeled by the monthly-plan sensitivity.

Potential paid jobs: monitor a trip’s selected mountains, notify the user when a specific verified source is available or relevant, or compare licensed timestamped views. Generic favorites, ad removal on a nearly ad-free site, or repackaged forecasts do not justify a paid product. Historical footage and AI image summaries add rights, cost and accuracy issues. Do not build Pro unless at least ten engaged users explicitly accept a stated price and the source/notification workflow can be delivered reliably.

## B2B and unconventional offers
A concierge/club “camera shortlist” is a lightweight custom landing page plus maintenance, not a licensed data API. Test $150–500 setup plus $25–100/month only when a customer would otherwise maintain it. A resort camera-health digest could test $25–100/month, but existing uptime tools may make it redundant. Neither belongs in the base revenue forecast without a buyer. Selling aggregate analytics to resorts also requires sufficiently large, reliable, privacy-preserving data; today there is no demonstrated data asset to sell.

**Reject paid factual manipulation:** no sponsor should buy a better snow report, a “best mountain” ranking disguised as editorial judgment, or an implied official resort endorsement. A clearly marked sponsored business module is a different proposition.

---

# 07 Financial Model

## What this model is—and is not
The companion workbook models **September 2026 through August 2028**, with separate 6-, 12- and 24-month summaries. It has editable assumptions and three seasonal operating cases. No historical PeakCam users, revenue, bills, bank balances or investment data were retrieved. The model is a scenario tool, not a valuation, tax return, forecast confidence interval or statement of actual accounts.

**The core architectural distinction:** camera bytes loaded directly from third-party image/iframe hosts are not assumed to traverse PeakCam’s server. The reviewed renderer does not proxy, record or archive video. Therefore the present model does not invent video CDN/storage costs. A future proxy/recording feature requires a new rights review and a new bandwidth model. [A01](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/package.json) [A03](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx)

## Vendor facts and planning allowances
Vercel’s September 8, 2026 Flat Rate CDN announcement is relevant: Pro includes 1 million CDN requests and 1 TB transfer; added tiers are $20/month for 10 million requests/50 TB, $100 for 50 million/50 TB and $300 for 150 million/50 TB. This is team-wide capacity, not all compute/product usage. Existing teams must opt into the new plan. The workbook assumes the new tier structure, a $20 one-seat Pro base and no competing team-project consumption; **actual billing settings must be verified**. Hobby is not the commercial plan. [V01](https://vercel.com/pricing) [V02](https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams) [V03](https://vercel.com/docs/limits/fair-use-guidelines)

The $0.001/user variable reserve is an **unquoted planning allowance**, not Vercel’s actual analytics/compute rate. Rights budgets are negotiation reserves, not licenses. Admin includes a small allowance for email/domain/books/security/insurance; the first attorney/formation work is separately included as setup. App stores, database, weather, mapping, AI, authentication and stream storage are **$0 in the present architecture**, not “forgotten expenses.” When a new service is approved, add its actual commercial contract instead of silently assuming a free tier.

## Traffic stages: current architecture, illustrative economics
| Monthly users | Model pageviews | Core tech budget range/month | All-in cash range/month* | Illustrative revenue/month** | Model gross margin** |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 5,500 | $20–$142 | $121–$1,542 | $10 | -610% |
| 10,000 | 55,000 | $21–$160 | $130–$1,560 | $415 | 80% |
| 50,000 | 275,000 | $63–$280 | $190–$1,680 | $1,775 | 91% |
| 100,000 | 550,000 | $98–$380 | $240–$1,780 | $3,900 | 94% |
| 500,000 | 2,750,000 | $434–$1,340 | $720–$2,740 | $16,250 | 95% |


\* All-in ranges are planning envelopes including modest admin and discretionary support/marketing, **excluding founder salary, taxes and major one-time legal/license costs**. They are not vendor quotes or confidence intervals. \** Illustrative revenue assumes accepted affiliates, eligible ad inventory and hypothetical sponsor counts; zero revenue remains possible at every traffic stage. Gross margin uses modeled revenue less direct hosting, rights reserve and payment fees, not total operating profit. It can be negative at low traffic.

### Next 6 / 12 / 24 months
| Case | Horizon | Earned revenue | Operating result before founder pay/tax | Peak cumulative funding needed | Result after $50/hour founder-time sensitivity |
| --- | --- | --- | --- | --- | --- |
| Conservative | 6 months | $92 | $-1,194 | $1,206 | $-25,194 |
| Conservative | 12 months | $176 | $-1,889 | $1,890 | $-49,889 |
| Conservative | 24 months | $1,037 | $-2,734 | $2,736 | $-98,734 |
| Base | 6 months | $2,660 | $-3,007 | $4,428 | $-27,007 |
| Base | 12 months | $4,506 | $-4,273 | $4,428 | $-52,273 |
| Base | 24 months | $29,576 | $12,726 | $4,776 | $-83,274 |
| Breakout | 6 months | $11,693 | $-7,987 | $14,542 | $-31,987 |
| Breakout | 12 months | $21,267 | $-11,246 | $14,542 | $-59,246 |
| Breakout | 24 months | $170,531 | $102,184 | $14,542 | $6,184 |


**Conservative** reaches only 5,000 monthly users in the first winter and 12,000 in the second; virtually no sponsor revenue and very weak affiliate intent. **Base** peaks at 35,000 and then 150,000 users, with 3 and 8 active sponsors at winter peaks; Pro remains zero. **Breakout** reaches 90,000 then 500,000 users, more sponsors and a conditional small paid-user target beginning February 2027. These are ambitious assumed trajectories, not observed baselines or statistically predicted outcomes.

The breakout paid-user line is an **active paid-user target derived from monthly traffic**, not a subscriber cohort/churn model. It must not be presented as validated recurring revenue. Replace it with acquisition, cancellation and renewal cohorts if subscriptions actually launch. Display ads are conditional on approval/quality and excluded below an internal traffic gate; setting net RPM to zero is an important downside test.

## Cash is not earned revenue
The model delays affiliate cash by two months and ad cash by one month; sponsor and monthly premium payments are assumed collected in the same month. Network terms, stay completion, reversals and invoice collection can make timing worse. Peak funding need is the most negative cumulative cash balance, not simply the accounting loss. The fixed payout lags are editable in the workbook.

Standard domestic-card processing uses 2.9% plus $0.30 per modeled sponsor/monthly subscriber charge; the conditional paid subscription also includes a 0.7% Billing assumption. These are not charges on affiliate payouts. Foreign cards, disputes, refunds, tax services, ACH options and other fees need actual agreement review. [V04](https://stripe.com/pricing) [V05](https://stripe.com/billing/pricing)

## Sensitivities that matter more than small SaaS savings
Halve pageviews/user; zero out all display ads; halve commercial click rate; remove two-thirds of sponsors; double the maintenance budget; extend affiliate settlement to 90 days; and hold traffic flat after December. Then rerun funding need. A warm winter or no provider permission can erase most upside. The budget should survive a zero-revenue season without relying on consumer borrowing.

For a hypothetical future video proxy, 100,000 viewers × 10 minutes × 2 Mbps is roughly **15 TB** before retries or multiple streams. That is a unit-conversion illustration, not current PeakCam traffic. Add transcoding, storage, bandwidth, source permissions and abuse controls separately. Do not use the current low-cost static model to justify a video-hosting product.

## Financial operating rule
At each month-end, replace scenarios with actual users, approved commissions, sponsor invoices, cash received and invoices paid. Record owner contributions separately from revenue. Reserve for income/self-employment taxes based on a CPA’s view of your total circumstances; no personal tax rate or account balances have been assumed. Expand spending only when measured contribution and cash runway support it.

---

# 08 Legal & Administrative Setup Checklist

## Scope
This is founder-level issue spotting, not a legal opinion or tax advice. Your state of residence, operating location, business entity, employer IP agreement and present insurance were not established. **America/Chicago is a timezone, not proof of Illinois incorporation.** Confirm the operating state before filing. Use a US small-business CPA and an attorney experienced in media/IP, consumer internet and privacy for the specific high-risk questions.

| Item | Classification | Practical action | Timing / cost treatment |
| --- | --- | --- | --- |
| Legal right to use content and marks | Required when applicable | Obtain appropriate permission/license or use a lawful limited alternative; do not infer rights from public URLs | Before relevant use; quote-specific |
| Truthful ads / affiliate disclosure | Required when applicable | Label ads, disclose material connections near link/post, no invented traction or safety claims | Before first commercial placement |
| Taxes and records | Required | Track all revenue/expenses and state/federal filing obligations; separate tax categories | From first business activity |
| LLC | Strongly recommended for commercial contracting/risk; not universally required to test a website | Compare home-state LLC vs sole proprietor with counsel; liability protection is not absolute | Before meaningful paid contracts/content exposure; budget state-specific |
| DBA / local license / home business rules | Required when applicable | Check city/county/state rules for trade name, home occupation and relevant activity | Before operation where required |
| Registered agent | Required for entity where state law requires | Use eligible physical state address; paid agent can reduce public home-address exposure | Annual vendor quote; not automatically necessary for sole proprietor |
| EIN | Required in specified tax/employer situations; often useful for banking | Apply free directly through IRS after entity formation if forming one | Do not pay a formation upsell for a free IRS application |
| Bank account / card | Strongly recommended; supports separation and entity formalities | Separate business receipts/expenses; no rewards-chasing balance or commingling | Before paid contracts; compare bank terms |
| Bookkeeping / contracts | Strongly recommended | Monthly reconciliation; written scope, rights, payment, termination, reporting and liability allocation | Start now, simple ledger and one-page order form |
| Privacy / cookies / data retention | Required depending on practices and jurisdiction; strongly recommended accurate notice now | Inventory tags/embeds/vendors, explain data use, limit retention and honor applicable rights | Before collection/ad technology changes |
| Consumer subscriptions | Required when launched | Clear recurring price, affirmative consent, required reminders and easy cancellation; review states served | Before recurring checkout, not a later cleanup |
| Email compliance | Required for commercial outreach/marketing | Accurate identity, subject, business postal address and opt-out; maintain suppression list | Before first outbound sequence |
| General liability / cyber / E&O / media coverage | Usually risk/contract driven rather than universal mandate | Broker review of actual publishing, advice, data and contractor risks; check IP exclusions | Before substantial monetization; quote not assumed |
| Trademark clearance and filing | Clearance strongly recommended; registration useful later | Search similar marks and relevant services; filing does not itself establish no conflict | Clear before major brand spend; file after scope settled |
| Accessibility | Applicable obligations need assessment; practical core accessibility is essential | Keyboard/focus/labels/contrast, nonvisual source links, reachable fallback | Before growth; do not confuse private site with public-entity deadlines |
| COPPA / minors | Required if child-directed or actual-knowledge collection triggers apply | Avoid under-13 account/UGC expansion; family travel audience alone not definitive | Before collecting new account/community data |
| Incident and takedown process | Strongly recommended; notification duties may be required | Owner, quick disable, evidence log, breach counsel and state-specific notification assessment | Before growth |
| Complex corporate stack / S-corp election | Useful later only if justified | No automatic payroll/tax election, Delaware structure or financing documents | Revisit sustained profit or actual financing need |


### Entity choice without startup theater
A sole proprietor can test demand without pretending to be a corporation, but personal exposure, contracts, assets and banking need care. A single-member LLC does not automatically change federal income-tax treatment; the default generally remains disregarded absent an election. Formation in a different state can create an additional foreign-registration burden where you actually operate. A home-state LLC is the default option to investigate, not a universal legal answer. [L02](https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies)

Illinois provides a useful **example**, not a personalized filing instruction: the official LLC instructions list $150 standard and $250 expedited formation. A paid registered agent is optional if the entity has another eligible agent/address. Check annual reports, local licenses and state tax registrations separately. EIN applications are free from the IRS. [L01](https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number) [L03](https://www.ilsos.gov/departments/business-services/organization/llc-instructions.html)

### September 2026 rules that are easy to get wrong
FinCEN’s August 2026 final rule exempts US-created companies from BOI reporting; foreign-formed reporting companies have different rules. Do not buy a BOI filing service based on an obsolete blanket checklist. The FTC’s 2024 negative-option rule was vacated; its March 2026 rulemaking is not a final nationwide replacement. That does **not** remove ROSCA, FTC Act or state automatic-renewal duties. [L04](https://www.fincen.gov/boi) [L05](https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-seeks-public-comment-response-advance-notice-proposed-rulemaking-regarding-negative-option)

California’s strengthened automatic-renewal requirements include important consent, notice and cancellation obligations. State privacy coverage also depends on thresholds and actual data practices, not only whether PeakCam is “small.” CCPA applicability requires an actual analysis, particularly before targeted ads or selling/sharing personal information. Other states differ. Use minimal data and no ad-tech stack until that review is complete. [L06](https://oag.ca.gov/news/press-releases/attorney-general-bonta-issues-consumer-alert-california%E2%80%99s-automatic-renewal-law) [L07](https://www.oag.ca.gov/privacy/ccpa)

### Tax workstream
Classify affiliate commissions, ad/sponsor revenue, service fees and consumer subscriptions separately. All may contribute to taxable business income; receiving no information return does not make receipts tax-free. Sales/use tax treatment of digital subscriptions, advertising and services varies by jurisdiction and can depend on nexus and customer location. Interstate online income does not automatically require forming an entity in every customer state. A CPA should determine registrations, estimated tax payments, business-use deductions and treatment of setup costs; the model intentionally does not invent a personal effective tax rate. [L02](https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies)

### Brand/IP and publishing protection
The USPTO base trademark application fee is currently $350 per class, with possible additional fees. No professional clearance of “PeakCam” was performed. Domain ownership and a GitHub repository are not proof of trademark availability. Separately document ownership of code, photographs and contractor work; review any employment invention-assignment or moonlighting restrictions before investing heavily. [L12](https://www.uspto.gov/trademarks/trademark-fee-information)

### Operational compliance
Commercial B2B email is not exempt from CAN-SPAM. Use an accurate founder identity and a legitimate business postal address, include an opt-out and honor requests within the applicable period; the operating system uses suppression immediately rather than waiting. Keep research contacts separate from a newsletter list—public contact information is not newsletter consent. [L08](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

Privacy statements must describe the actual embed/analytics stack, not a generic template. Set a documented deletion schedule; avoid sending raw emails, precise location or free-text reports to analytics. A 90-day event-log retention test is a **proposed minimization choice**, not a universal legal rule. Children’s and accessibility obligations should be assessed before expanding data collection; practical keyboard and fallback accessibility belongs in the first launch gate. [L10](https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa) [L11](https://www.ada.gov/resources/web-guidance/)

### Minimal professional review brief
Ask counsel for: (1) a permitted-use matrix for links, embeds, preview photos and social screenshots; (2) a short source permission/pilot agreement; (3) review of actual policies and advertising disclosures; (4) a takedown process and whether any DMCA agent/safe-harbor steps are relevant to the chosen service; and (5) the subscription/privacy changes required **only if** Pro or accounts launch. Ask the CPA for entity/tax/bookkeeping recommendations grounded in your actual state and employment circumstances. This is a focused review, not a $10,000 generic startup package.

---

# 09 Webcam & Data Legal Risk Assessment

## What the implementation changes
The reviewed renderer serves third-party images directly and uses iframes/external links. It does not show a server-side video proxy, scraping pipeline, screenshot archive or historical-image database. That reduces some operational exposure compared with republishing streams, but it does **not** establish permission to embed, hotlink, reproduce preview photos or use content in advertisements. Unknown rights must stay unknown until documented. [A02](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/data/resorts.json) [A03](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx)

| Use | Current exposure | Risk / impact | Mitigation and permitted fallback | Attorney? |
| --- | --- | --- | --- | --- |
| Plain official source link | Several live directory entries | Lower relative content-copying risk, but endorsement/contract/deceptive framing still matters | Accurate destination and attribution, no false affiliation; remove upon valid issue | Review overall approach |
| Iframe / embedded stream | Renderer supports; placeholder YouTube entry present | Provider terms, territorial restrictions, copyright and third-party tracking | Use official permitted player; no circumvention; obtain commercial scope; click-to-open fallback | Yes |
| Direct image hotlink | Renderer supports; placeholder remote-image entry present | Hotlink restrictions, copyright display theories, bandwidth/terms and privacy | No unapproved reuse; owner consent or own licensed image; no guessed CDN paths | Yes |
| Local resort preview image | Local asset paths in catalog | Potential reproduction/distribution without known license; high-impact unresolved issue | Record license/source/author; remove unknown assets until cleared | Yes |
| Screenshot / thumbnail / crop | Future marketing/history proposals, not observed archive | Separate reproduction and derivative/marketing permissions; credit alone is not a license | Written still-capture, storage and promotional scope; no footage until cleared | Yes |
| Caching / history / timelapse | Not observed in current implementation | Storage plus repeated copying; expiration and takedown complexity | Do not build this season without contract and cost model | Yes |
| Automated collection / scraping | No observed scraper/backend in current rewrite | Terms, access controls, rate limits and non-US database protections | No circumvention; prefer licensed API or manual source curation | Yes before new pipeline |
| Resort names / logos | Names observed; full logo audit not completed | Identification differs from endorsement; logos/marks may need permission | Text identification with clear independent status; no partner badge without approval | Yes for branding |
| Trail maps / resort photography | No fully reviewed content license inventory | Often creative copyrighted assets even when facts are public | Link to official map; obtain image rights separately | Yes |
| Weather / condition facts | No weather API observed | Facts vs copied expression/database access/contract restrictions; stale safety impression | Cite source/time; license commercial API and caching; do not scrape forecast prose | Yes if licensed feed |
| Third-party API/data resale | No current product | Commercial display rights may exclude bulk redistribution, model training and resale | Get separate resale rights; do not expose raw upstream data API | Yes |
| US-government data | Potential future source only | Government authorship does not cover all third-party graphics, logos or hosted content | Check specific dataset/asset provenance and attribution rules | As needed |


Legal exposure from embedding is fact- and jurisdiction-sensitive; a favorable “server test” decision should not be treated as nationwide permission. Provider terms and the camera owner’s rights are separate layers. YouTube API/player restrictions must be evaluated for the exact integration; do not download, strip controls/branding or create a paid wrapper that violates the applicable terms. Publicly reachable does not mean publicly licensed. [L13](https://www.msk.com/newsroom-alerts-embedding-copyright) [L14](https://developers.google.com/youtube/terms/developer-policies-guide) [L15](https://www.doi.gov/copyright)

## Data/Content Risk Register
The scored workbook includes K01–K07, K14, K16–K17, K24–K25 and K27–K28 for this topic, with probability, impact, observed exposure, mitigation, owner and attorney flag. Likelihood scores are prioritization judgments, not probabilities of litigation. **K01/K02/K05 can kill the model** if required licenses are unavailable or too expensive. A small LLC and a disclaimer do not cure unlicensed content use.

## Permission record that should exist for every camera
Store the owner/licensor legal entity, source URL, provider, original author where relevant, who approved, dated written evidence, commercial/noncommercial scope, allowed display modes, image capture/thumbnail/social rights separately, attribution format, domains/territories, cache lifetime, embargo/delay, API limits, withdrawal process, expiration, fees and any exclusivity. Record “link only—embed not approved” where appropriate. Avoid collecting credentials for a resort’s private camera network.

## Upstream agreement: precise questions
Ask Roundshot, HDOnTap and Panomax whether PeakCam can join an existing distribution program with a small US ski-camera subset. Identify **which cameras and owners** are included, whether the provider can sublicense or only introduce the owner, whether commercial placements around the player are allowed, and whether separate screenshots are permitted. Ask for approved embed/API documentation, quotas, support contact and takedown turnaround. Request a zero/minimal-fee pilot, but treat a quote as a cost until actual revenue sharing is agreed.

Roundshot’s June 30, 2026 announcement documents real sharing partners, including a hiking app and a ski portal, making this a grounded partnership hypothesis. It is not an open blanket license. Other provider or integrator products in the CRM establish possible supply routes; specific US ski customers and redistributable camera inventories were **not fully verified for each vendor**, so no customer logos or rights claims should be copied into a PeakCam pitch. [P01](https://www.roundshot.com/en/messages.html/21/news/946) [P11](https://camstreamer.com/partners)

## Incident response
On a credible rights complaint: acknowledge promptly, temporarily disable the specific disputed asset/embed, preserve the source/permission history, notify counsel where material and determine whether a permitted official link can remain. On an accuracy complaint: label stale/unavailable, repair or remove, and avoid retaining a misleading “live” badge. On a security/privacy incident: preserve relevant logs with restricted access and obtain jurisdiction-specific notification advice; do not promise a universal breach deadline.

---

# 10 Growth Strategy

## Acquisition order
Start with **product reliability → concentrated seed users → repeat behavior → relevant commercial offer → repeatable channel**. Do not run a national launch campaign for a five-entry catalog. October should produce evidence that a particular Colorado skier wants to come back, not merely a rising vanity visitor counter.

### The first 100 useful users
Recruit 20 people who actually ski the covered corridor through existing relationships and clubs; ask each to perform a real camera lookup. Add three club or concierge pilots with a source-credited landing page and a unique campaign tag. Invite feedback on broken sources and missing familiar mountains. Ask organizers to share only if they find it useful; do not imply their endorsement from a meeting or email.

Measure successful official-source actions and a second visit during another relevant ski decision. Aim for 40–60% of recruited visitors to take a qualified action and 15–25% to return within 14 days during active weather/operations. These are proposed targets; a summer visitor cohort is not comparable to a storm-week cohort.

### From 100 to 1,000
Expand only the requested Colorado destinations with verified sources. Publish four substantive corridor guides and make the camera page useful enough that an organizer bookmarks it. Ask permitted source partners for a resource link only where it helps their guests. Run twelve permissioned social posts across two formats and compare referred qualified actions per production hour. End formats that produce only unqualified views.

### From 1,000 to 10,000
Double down on the channel with the strongest 28-day repeat cohort. Improve internal links from guides to useful resort pages. Ask the first satisfied local businesses for introductions; separate sponsorship from editorial placement. Test one accepted affiliate offer and reconcile payable transactions. Search growth can compound slowly; do not buy a national content factory while most existing pages are unindexed or unused.

## Channel economics and spending rule
Paid traffic is unlikely to work on ad-and-affiliate revenue alone early on. Under the base illustrative per-visitor economics, affiliate revenue is about $0.01/user and display adds about $0.0165/user when enabled. A $1 click would be wildly uneconomical without much greater proven repeat value. This is model arithmetic, not a current CPC quote. Paid experiments should therefore be small and diagnostic, not presented as a growth engine.

Clubs and creators can be more efficient but founder time is a real cost. Track hours spent researching, producing and following up per activated returning user. A “free” channel requiring 30 hours for 20 one-time visits is not automatically efficient. Compare channels by retained qualified users and contribution, not reach or post count.

## Retention and community
Implement local favorites, recent sources and shareable lists before an account system. A simple “report this camera” form can improve source quality without opening public discussions. Defer mountain chat, reviews and photo uploads until there is moderation capacity and a demonstrated need. Public user reports create content, privacy and safety work that the current static product does not have.

## Geographic expansion trigger
Add one adjacent corridor only after core sources remain reliable, the return cohort is measurable, and maintenance fits the founder’s weekly capacity. Utah/Tahoe/Northeast contacts are a sequenced opportunity queue, not proof that those regions should launch in October. National reach is a result of repeatable regional execution, not an initial homepage claim.

---

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

---

# 12 Social & Content Strategy

## The rights-first constraint
The camera being visible on PeakCam does not authorize screenshots, clips, timelapses, crops or paid social use. Build social formats around **founder-owned demonstrations, permissioned assets, original commentary and official links**. Retain the written promotional reuse scope and source/time labels. A screen recording that contains third-party camera imagery still requires the relevant rights analysis. [L09](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers) [L13](https://www.msk.com/newsroom-alerts-embedding-copyright) [L14](https://developers.google.com/youtube/terms/developer-policies-guide)

| Repeatable format | Production recipe | Channels | Specific test / guardrail |
| --- | --- | --- | --- |
| Before the drive: three camera checks | Explain three source types—base, summit, snow stake—using only permitted imagery and clear times | Reels, Shorts, TikTok; share guide to clubs | 15–30 second useful checklist; destination page link; no snow-total inference |
| The camera that answered today’s question | Describe one real visibility/source question, show the permitted source context and official link | Instagram, X, Threads | Measure qualified site actions, not generic likes |
| Three mountains, same morning | Side-by-side only where rights and timestamps are comparable; describe visible differences narrowly | Reels / Shorts; corridor guide | Do not claim “most snow in America” from unequal camera coverage |
| Five sources before your holiday trip | Original short guide to camera, official operations, travel logistics and rental planning | YouTube Shorts, Facebook group with moderator approval | Disclose any affiliate relationship near recommendation |
| Broken camera rescue | Show how PeakCam finds the correct official fallback without displaying unlicensed footage | Reddit useful answer, short demo, product update | Solve an existing question; no repetitive self-promotion |
| How to read a snow-stake cam | Explain reset time, location and limits with owner-approved example | Short video and evergreen guide | Do not substitute for official snowfall or avalanche information |
| Club trip camera shortlist | Custom shareable list of actual destination sources | Facebook clubs, club newsletter, group organizer | Track one campaign tag; no automatic subscription |
| Founder build note with a useful fix | One changed source or removed dead end, with factual before/after description | Threads, X, niche forum | Honest small product progress, not launch hype |


## Channel-specific behavior
**Reddit and ski forums:** answer a camera/source question directly; disclose you built PeakCam and respect moderator/self-promotion rules. Ask permission before a product-feedback thread. Do not automate posting, buy votes or DM members at scale.

**Facebook groups:** work with the group organizer on a relevant trip resource. A tailored destination list is more useful than a national promo image. Use the group’s rules; no harvesting member contacts.

**TikTok, Instagram and Shorts:** start with two formats, not seven daily channels. A founder-owned walkthrough can launch before footage rights are secured. Caption source dates and avoid unsafe claims. One weekly recording session can produce three short versions; prioritize formats that generate repeat site actions.

**X and Threads:** timely source updates, narrow storm-context links and founder replies can support discovery, but do not rely on these as the main funnel without evidence. **YouTube:** longer camera-reading explainers may compound search value, but only after basic short-format evidence; do not buy gear or a studio.

## Semi-automated workflow
Store approved assets with source, rights and expiry. Generate a draft storyboard using metadata you have permission to use; a human checks the actual image time, mountain identity and wording. Export only approved graphics or a founder demo. Add campaign tags, disclosure and accessibility captions. Log production minutes and qualified actions. Automation may select templates and resize approved assets; it must not scrape screenshots, fabricate snow totals or auto-publish unverified conditions.

## First 21-day test
Produce twelve posts split between “before the drive” and “camera that answered the question.” Cap each at 30 minutes after setup. Evaluate qualified referred visits and return behavior; target 100 qualified visits total and more than five per production hour as initial evidence. These are internal targets, not platform benchmarks. Stop an ineffective format even if it gets attractive view counts.

---

# 13 Partnership Strategy

## The database is an operating queue
The CRM contains **100 researched organizations** across resorts/operators, tourism, lodging, gear/rentals, passes, camera/data providers, media, clubs and local businesses. Twenty-five are prioritized for first contact, and twenty resort targets are ranked. Public contact/source fields are included; unavailable person/email/LinkedIn fields are marked N/A. Some channels are general routing or public-directory contacts, not confirmed buyers. No contact has been email-delivery tested and no organization has agreed to a partnership.

Priority combines subjective 1–5 scores for response likelihood, fit, revenue, ease and speed. The spreadsheet computes their product. **The First 25 also deliberately includes access and distribution dependencies** that a pure revenue score would underrate. A camera licensor may be strategically important while being a cost, not a sponsor. Use the score to organize comparable prospects, not as a predicted closing probability.

## First twenty resort targets
| Order | Resort | Why now / sequencing |
| --- | --- | --- |
| 1 | Loveland Ski Area | Already listed in the audited catalog; resolve the official webcam URL and request a small early-season attribution/referral pilot. |
| 2 | Monarch Mountain | Colorado expansion with an explicit marketing inbox; propose link-first conditions discovery and agreed image rights. |
| 3 | Ski Cooper | Compact Colorado pilot near existing coverage; ask general form to route to marketing. |
| 4 | Sunlight Mountain Resort | Publishes a media-use policy and dedicated contact; start with approved imagery and traffic referrals, not blanket content reuse. |
| 5 | Granby Ranch | Family-trip use case and regional expansion; ask for correct camera sources and concierge feedback. |
| 6 | Wolf Creek Ski Area | Official homepage exposes multiple named cameras; useful snow-observation destination to add only after source verification. |
| 7 | Arapahoe Basin | Already in the audited catalog; request routing to digital marketing for correct source, attribution and permission. |
| 8 | Powderhorn Mountain Resort | Western Colorado regional pilot with an explicit departmental contact form. |
| 9 | Purgatory Resort | Southwest Colorado destination with lodging and transport referrals; local marketing pilot before operator-wide negotiation. |
| 10 | Sipapu Ski and Summer Resort | Small-resort family and lodging proposition suitable for later Southwest pilot. |
| 11 | Taos Ski Valley | Regional travel audience; ask contact form to route to digital partnerships, not reservations sales. |
| 12 | Sugar Bowl Resort | A Tahoe expansion candidate with departmental routing and active webcam section. |
| 13 | Bogus Basin | Explicit marketing and community focus; pilot morning camera discovery for local repeat skiers. |
| 14 | Bridger Bowl | Direct marketing team and clear imagery permission policy; good later rights-respecting regional pilot. |
| 15 | Lost Trail Ski Area | Accessible small-area team, snow-focused users and source-link distribution opportunity. |
| 16 | Brundage Mountain | Named camera program and public media team; request permission-led regional expansion. |
| 17 | Magic Mountain | Small Northeast resort with a directly published media channel; later local-repeat pilot. |
| 18 | Mad River Glen | Community-oriented audience; directory-listed general manager for a permission and referral pilot. |
| 19 | Jay Peak Resort | Later Northeast camera pilot; a named communications route within PGR. |
| 20 | Middlebury Snowbowl | Small-area and university distribution experiment; confirm coverage before contacting. |


Colorado entries come first because that is where the inspected product exists. Out-of-region resorts are second-wave permission/demand tests; do not imply they are already listed. “Smaller or approachable” is a prospecting hypothesis, not proof of current independence or ownership. Arapahoe Basin should not be called independent; the research observed its Alterra affiliation. For Vail, Alterra, Boyne, POWDR, Aspen, Mountain Capital Partners and Pacific Group Resorts, the CRM provides corporate routing channels and caveats rather than inventing current marketing executives or historical portfolio lists.

## Commercial roles and pitches
**Resort:** accurate official-source referral, owner-approved embed scope and correction process. **DMO:** a narrow useful destination guide, source introductions and joint measurement; ask for a distribution pilot before a sponsorship budget. **Lodging/rental:** approved destination-context referral or a small disclosed local slot. **Brand:** only a specific audience/format with actual metrics; an ambassador discount is not a publisher commission. **Media/creator:** candid test/feedback and optional editorial coverage, not paid dofollow links. **Club:** practical shareable camera shortlist. **Provider:** exact commercial display rights and owner consent, not access to a private camera network.

## Upstream camera/provider diligence
| Target | Evidence / product fit | Commercial/API status | Action |
| --- | --- | --- | --- |
| Roundshot / Seitz | Documented sharing-partner program; panoramic camera network | Actual PeakCam pricing, API and camera-owner sublicense rights unknown | Contact now; request 5–10 named owner-consented cameras, embed and thumbnail scope |
| HDOnTap | Live streaming and camera services; public sales route | Custom distribution/recording rights and price not verified | Contact now; ask for approved player, domain permission and resort introductions |
| Panomax | Panoramic mountain/tourism camera product and distribution positioning | Commercial redistribution/thumbnail API pricing requires quote | Contact now; clarify competitive portal relationship and exact permitted use |
| EarthCam | Camera infrastructure plus referral/reseller route | Hardware/service referrals not evidence of audience booking commission | Later supplier discovery; do not forecast referral income |
| CamStreamer | Camera-streaming software / integration ecosystem | Software/reseller rights do not convey footage copyright | Later technical partner; no hardware needed now |
| feratel | Tourism/mountain camera and destination technology | Regional availability, embed/API and commercial license scope unverified | Later licensed distribution inquiry |
| IPCamLive | Streaming platform, including domain controls | Public stream reachability not blanket embed permission | Later technical option; ask source owner and platform |
| CanDat / Dotworkz / Netwavz | Publicly listed camera integrators / hardware services | Not verified ski-customer rosters or camera-rights owners | Discovery-only tier; request introduction rather than content license assumption |
| Open-Meteo | Commercial weather data option, not currently used | Free hosted tier noncommercial; commercial plan/attribution required | Later; obtain current quote and caching/display limits before integration |


The direct provider announcement and policy sources support the category opportunity, not a claim that each supplier already serves a particular US resort or has a public API suitable for PeakCam. Specific ski-client verification and custom pricing are explicitly open fields in the licensing inquiry. [P01](https://www.roundshot.com/en/messages.html/21/news/946) [P11](https://camstreamer.com/partners) [V06](https://open-meteo.com/en/pricing)

## Destination-local prospect clusters
Start with a **Breckenridge/Summit** cluster: GoBreck, Blue River Sports, Mountain View Sports, SummitCove Lodging, Breckenridge Brewery and Summit Express. Use resort-specific relevance: lodging/rentals for planners, transport for destination visitors, and food only when the placement reaches people actually nearby. Do not expose precise user location to merchants.

A **Glenwood/Sunlight** cluster includes Sunlight, Visit Glenwood Springs and Blue Sky Ski Rentals. An **Aspen/Snowmass** cluster includes Aspen Skiing Company, Aspen Chamber and Snowmass Tourism, with Ski.com as a travel-program prospect rather than an implied destination-owned supplier. A **Park City/Utah** cluster includes Visit Park City, Ski Utah and rental/travel providers only after Utah coverage is maintained. Telluride’s Alpine Luxury Limo is a later routing test, not a reason to build a new region immediately.

The separate outreach playbook supplies the exact First 25 messages, seven sequences, starter deals, media-kit copy and weekly routine. Every pitch must be refreshed after the catalog repair and actual analytics check: the prepared copy intentionally says “small” and “starting with three Colorado resorts,” not an established national audience.

---

# 14 2026–27 Ski Season Launch Plan

## Work backward from actual windows
Early US openings are snow/weather dependent; do not promise an October opening date for a resort without a current official announcement. Thanksgiving is **November 26, 2026**; Christmas is **December 25, 2026**; New Year’s Day is **January 1, 2027**. Complete the Thanksgiving reliability review by November 23 and the holiday sweep by December 20. Those are founder deadlines, not resort operating schedules.

| Window | Main outcome | What must be true before spending more | Avoid |
| --- | --- | --- | --- |
| NOW: September 9–30 | Repair trust and establish access, baseline and user job | No placeholders; rights register; 10-user test; focused professional review | National launch, empty-region SEO, premium build |
| Before November: October | 12 useful resort pages, favorites test, club beta and one accepted affiliate | Sources maintained; events validated; recurring need observed | Bulk thin pages, paid forecast/API stack |
| November to Thanksgiving | At most 20 reliable destinations and first local commercial conversations | Proof of local reach and accurate sponsor report | Guarantees of audience or bookings |
| Thanksgiving to Christmas | Holiday trip-intent campaigns and small monetization pilots | Approved affiliate tracking; responsive support; clear disclosures | A major navigation rewrite during holiday traffic |
| January–February | Renew successful pilots; improve retained cohorts; one justified expansion | Renewal evidence and low repair burden | Feature sprawl or paid acquisition without unit economics |
| March–April | Spring usefulness, next-season permissions and financial decision | Reconciled commissions/cash and cohort comparisons | Summer fixed costs with no tested summer demand |


## Ten highest-leverage actions before Thanksgiving
1. Remove placeholder camera entries and label link-out versus verified embed accurately.
2. Build the camera/source/permission register, including local preview images.
3. Verify the actual analytics baseline, commercial hosting plan and spend settings.
4. Observe ten mobile camera journeys and fix their biggest failure.
5. Obtain small written permissions or lawful link-first paths from initial resorts/providers.
6. Maintain 12–20 complete Colorado pages rather than a national shell.
7. Add simple local favorites/share and measure returning use without forced accounts.
8. Recruit three club/concierge distribution pilots and record retained cohorts.
9. Add one approved contextual affiliate offer with disclosure and payable-conversion reconciliation.
10. Offer a tiny measured local sponsor pilot only after sharing actual destination traffic.

The detailed 36-action roadmap provides owner, dollar allowance, hours, dependency, expected benefit, metric, deadline and status. Tasks overlap, so total hours are not a critical-path schedule. Costs are authorizations/reserves, not a requirement to spend every listed dollar; the financial workbook controls the overall envelope. Complete critical repairs even when a growth target slips.

---

# 15 Marketing Budget

## Founder-funded release schedule
These are **total marketing envelopes**, not monthly recurring budgets. Legal/entity/insurance and core hosting are separate operating costs. Reserve is unspent cash, not a required vendor purchase. At $0, use existing tools, interviews and permission-first outreach; do not compensate for no cash with spam or unlicensed footage.

| Budget | Paid search | Paid social | Creators | Content / SEO labor | PR / community | Giveaways | Partnership visits / samples | Tools | Reserve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| $500 | $0 | $0 | $50 | $150 | $50 | $0 | $100 | $50 | $100 |
| $1,000 | $50 | $0 | $150 | $350 | $100 | $0 | $150 | $50 | $150 |
| $5,000 | $300 | $200 | $800 | $1,700 | $300 | $100 | $500 | $200 | $900 |
| $10,000 | $700 | $500 | $1,800 | $3,000 | $500 | $200 | $1,000 | $300 | $2,000 |
| $25,000 | $2,000 | $1,500 | $4,000 | $7,000 | $1,000 | $500 | $2,000 | $500 | $6,500 |


**$0–$500:** founder work, source repair, a small beta and modest assistance creating useful original pages. Creator money is a tightly scoped experiment or production help—not payment for a positive review. No paid traffic is necessary.

**$1,000:** improve one useful content/SEO cohort, seed club distribution and test a niche creator. The $50 search line is optional diagnostic spend only after landing-page and tracking readiness; keep it in reserve otherwise.

**$5,000:** buy carefully scoped help with source verification, useful pages and approved-asset production. Support a small number of relevant creators and local partner introductions. Release the $500 combined ad budget only after retained users exist. Do not equate the budget tier with a recommendation to spend it immediately.

**$10,000:** scale the winning creator/content/partnership workflow, not the number of channels. Require a written brief, source rights, deliverables and tracking for contractor work. Maintain the $2,000 reserve for uncertainty; legal or licensing needs may require a separate budget decision.

**$25,000:** this is a contingent growth envelope after evidence, not the default recommendation. More than one-quarter stays reserved. A quality curation/content operator may create more value than a broad paid campaign. Require monthly release gates tied to qualified returning users, partner renewals and contribution margin. Do not commit a season-long spend contract before a first successful pilot.

## Wasteful today
Broad “skiing” search terms, national interest-targeted social, expensive press-release distribution, bought backlinks, large giveaways attracting non-skiers, general influencer reach buys, automation that creates rights exposure, several analytics products tracking the same event, premium CRM, new camera hardware, app-store launches and branding agencies. A giveaway also adds promotion-rule and disclosure work; the small later lines are capped tests with proper rules, not the growth strategy.

## Incremental-dollar rule
Spend the next dollar on the bottleneck shown by evidence. Broken sources → repair and verification. Good activation but weak repeat → investigate the recurring job. Strong local repeat but no sales → improve the offer and merchant fit. Proven commercial conversion but poor acquisition → test a narrow channel. Do not solve low traffic with a subscription feature or solve low willingness to pay with a new logo.

---

# 16 Analytics & KPI Framework

## North Star
**Weekly returning camera decision-makers:** consent-aware, non-bot visitors who complete a qualified camera action on at least two distinct days in a rolling 28-day period, with at least one action in the current week. A qualified action is a deliberate click to the correct official camera source or a confirmed provider playback event where that can actually be measured. The definition is a proposed operational metric, not a claim that the current analytics supports it out of the box.

The observed `camera_watch_open` is intent; `camera_embed_ready` from iframe onLoad is a technical load signal. Neither alone establishes a valid live view. Use these to diagnose the funnel, not to inflate a sponsor’s “video views.” [A03](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx) [A04](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/app/layout.tsx)

| Funnel step | Proposed range / interpretation | Metric |
| --- | --- | --- |
| Impression → visitor | Channel-specific; no universal forecast. For search, inspect actual query CTR | UTM/search clicks divided by valid impressions where measurable |
| Visitor → engaged | 35–60% initial target, not industry benchmark | At least one relevant source/play action or meaningful resort interaction |
| Engaged → repeat | 15–30% within 14 days during active ski windows as test target | Cohort return, excluding founder/test traffic |
| Repeat → registered/opted-in | 10–25% only if there is a valuable opt-in reason | Optional email consent; registration is not required for free utility |
| Engaged → affiliate click | 1–4% of visitors in scenario tests | Approved tracked commercial clicks, separate from camera source links |
| Affiliate click → payable conversion | 1–3% planning range, merchant/product dependent | Approved net commissions, not frontend click events |
| Engaged → paid Pro | 0 now; test 0.2–1% only after evidence | Server-confirmed payment / eligible offer cohort |


Do not multiply the entire funnel into a single fake forecast: people can monetize without registering, return without accepting analytics identifiers, or book weeks after a visit. Maintain separate paths for source utility, affiliate intent, sponsor outcomes and optional premium conversion. Report “not measurable” rather than silently filling missing stages.

## Exact event plan
| Event | Trigger | Properties | Implementation status / caveat | Purpose |
| --- | --- | --- | --- | --- |
| page_view | Page rendered | page_type,resort_id,region,source_channel | Existing analytics integration; validate payload | Acquisition denominator; bot filtering |
| resort_search | Search submitted | query_class,result_count | Proposed; do not send raw personal queries | Find unmet destination demand |
| region_filter_select | Region filter used | region,available_count | Proposed | Demand and empty-state diagnosis |
| resort_card_click | Resort selected | resort_id,position,entry_page | Validate existing implementation | Navigation conversion |
| resort_page_view | Resort detail loaded | resort_id,camera_count,verified_count | Proposed/validate | Intent denominator |
| camera_watch_open | User opens watch experience | resort_id,camera_id,embed_type | Observed in renderer | Intent; NOT proof of playback |
| camera_embed_ready | Image/iframe load event | camera_id,embed_type,elapsed_ms | Observed; iframe onLoad only | Technical load; do NOT call video view |
| camera_play_confirmed | Provider playback callback, where supported | camera_id,provider,event_source | Proposed only where technically measurable | Confirmed playback numerator |
| camera_source_click | User opens official source | camera_id,resort_id,source_host,reason | Validate tracking; proposed dimensions | Core qualified action for external mode |
| camera_fallback_shown | Timeout/error fallback appears | camera_id,error_class,elapsed_ms | Proposed/validate | Reliability diagnosis |
| camera_error | Load fails | camera_id,host,error_class | Proposed | Broken camera repair queue |
| camera_status_report | User reports broken/stale camera | camera_id,report_type | Proposed; no personal text in analytics | Human quality signal |
| favorite_add | User saves resort locally | resort_id,number_saved | Proposed; no account required | Activation |
| favorite_remove | User removes resort | resort_id | Proposed | Favorites quality |
| favorites_return | User returns and opens saved resort | resort_id,days_since_last_visit | Proposed consent-aware identifier | Retention / North Star contribution |
| share_click | User opens native share/copies URL | resort_id,camera_id,share_method | Proposed | Referral intent, not successful share proof |
| signup_start | User opens opt-in form | offer,placement | Future only | Email funnel |
| signup_confirmed | Double opt-in confirmed | offer,consent_version | Future server event; no raw email in analytics | Consented audience |
| premium_offer_view | Price-specific concept displayed | offer_id,price,currency | Experiment only, no current Pro product | Eligible concept denominator |
| premium_intent_submit | User explicitly selects paid-interest option | offer_id,price | Experiment only | Intent not sale |
| affiliate_click | User clicks approved commercial link | program,merchant,resort_id,placement,sub_id | Future after approval | Commercial outbound denominator |
| affiliate_sale_approved | Network confirms payable conversion | program,sub_id,net_commission,currency,booking_month | Import network data; no traveler PII | Earned revenue, reversal reconciliation |
| affiliate_sale_reversed | Network reverses commission | program,sub_id,net_reversal,reason_class | Import network data | Net economics |
| sponsor_impression | Visible sponsored slot enters viewport | sponsor_id,placement,resort_id | Future, count once per session rules | Auditable sponsor exposure |
| sponsor_click | User clicks labeled sponsor | sponsor_id,placement,resort_id | Future | Partner click report |
| sponsor_lead | Merchant confirms qualified referral | sponsor_id,lead_id,qualification | Future no sensitive lead detail | Outcome beyond clicks |
| consent_update | Visitor changes consent or opt-out | consent_version,choices,region_class | Proposed if applicable | Privacy controls; minimize logs |
| subscription_started | Payment confirmed server-side | plan_id,net_amount,currency | Future only after product/legal gates | Never count frontend checkout click as sale |
| subscription_canceled | Cancellation effective | plan_id,reason_class,effective_date | Future only | Churn and cancellation compliance |


## Core dashboards
A weekly product view should show human visitors, qualified-action rate, official-source versus confirmed-playback split, fallback/error rate, favorites use and 7/14/28-day return cohorts by acquisition source and destination. A partner view should show dated relevant page reach, viewable labeled slot impressions, unique clicks and any merchant-confirmed leads/bookings. A financial view should reconcile approved commissions, reversals, invoices, collected cash and direct costs.

## Data minimization and QA
Use stable internal resort/camera IDs, controlled event names and UTC event times with camera-source timezone separately. Keep raw email, names, precise location, payment details and unrestricted user text out of product analytics. Minimize persistent identifiers and apply the actual consent/opt-out requirements. A sponsor receives aggregate outcome reporting, not raw visitor identities.

Before launch, execute test journeys for external link, working image, failed iframe, fallback, mobile back navigation and opt-out. Deduplicate events caused by React rerenders or retries. Exclude founder/test traffic and obvious bots. Verify attribution joins with affiliate sub-IDs without leaking personal data. Retention comparisons should state sample size, weather/season window and collection limitations.

## Viability thresholds
By late November, target 100 measured repeat decision-makers and consistent core completion, not an arbitrary national MAU headline. By January, target at least two paid renewals and demonstrable affiliate approvals. By April, assess cash contribution, maintenance hours, paid renewal intent for next season and non-search direct return behavior. A small but recurring valuable audience can be better evidence than a viral weather spike.

---

# 17 Business Operations Stack

## Keep the stack smaller than the business
The inspected product does not require a database, AI vendor, paid map, enterprise CRM or app store. Existing GitHub and Vercel workflows can support a focused web launch. Prices below are **budget allowances or “quote required,” not newly verified vendor offers** except where the source register identifies current official pricing. Do not add services simply to look established. [A01](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/package.json) [A05](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/CLAUDE.md) [V01](https://vercel.com/pricing) [V02](https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams)

| Function | Solo-founder approach / example | Budget allowance | Buy trigger |
| --- | --- | --- | --- |
| Banking / card | Separate low-fee business checking and debit/paid-in-full card; compare actual eligibility and terms | $0–20/month planning allowance | Entity/tax choice and first commercial contracts |
| Accounting / books | Spreadsheet ledger initially; CPA chooses suitable Wave/QuickBooks/Xero-class tool if needed | $0–40/month software + annual tax prep quote | Transaction volume or accountant requirement, not launch prestige |
| Tax advice | Small-business CPA with relevant state/digital revenue experience | $300–1,000 annual prep/advice planning reserve | Before revenue becomes material or nexus questions arise |
| Legal / contracts | Focused media/IP/privacy review; reusable permission and pilot order form | $750–2,000 initial scoped review allowance; quote required | Now for content use; re-review for subscriptions/UGC |
| Insurance | Broker compares E&O/media, cyber and relevant general liability | $30–100/month planning reserve; actual quotes may differ materially | Publishing/contract exposure and required buyer coverage |
| Business email | One domain mailbox from a reputable provider; SPF/DKIM/DMARC configured | $7–15/month allowance, not a quoted plan | Before business outreach; no mailbox access needed for this research |
| CRM | Provided workbook + CSV; one active 25-account queue | $0 incremental | Move to CRM only when missed follow-ups justify it |
| Support | One monitored support/contact address, saved replies and issue log | $0–15/month allowance | Ticket system only after meaningful volume |
| Analytics | Validate existing Vercel/optional GA instrumentation; one source of truth | Existing plan + metered-use reserve | Do not install several overlapping products |
| Uptime / errors | Basic external URL monitoring plus existing platform/build logs | $0–20/month allowance | Paid monitoring only when needed for reliability targets |
| Documentation | Repository docs and versioned operating handbook | $0 incremental | No enterprise knowledge platform |
| Secrets / security | Password manager, MFA and recovery keys; never secrets in research artifacts | $0–10/month incremental allowance | Immediately for account hygiene |
| Social scheduling | Manual publishing initially; one scheduler after a winning format | $0–20/month allowance | Only if scheduling saves measured founder time |
| Affiliate tooling | Use approved network reports, sub-IDs and spreadsheet reconciliation | $0 incremental initially | Paid link management only with proven volume |
| Billing | Simple approved invoice/checkout after legal/business setup | Usage fees rather than full subscription stack | Only for an actual paying partner/customer |
| Authentication / database | Not needed for browser-local favorites | $0 current model | Only if validated cross-device/paid workflow needs it |


A lean recurring administrative allowance of roughly **$50–$150/month**, excluding hosting, paid marketing, one-time legal and outsourced tax work, is a reasonable planning envelope. Buying every item’s high-end range would exceed that: the point is to choose the minimum set, not sum a shopping list. The model uses $100/month and separate setup/direct costs; replace with actual invoices.

## Weekly business cadence
On Monday, check camera reliability, cash and the pipeline. Tuesday, send five researched permission/partner messages. Wednesday, handle follow-ups and two user interviews. Thursday, do one or two partner calls and the single highest-impact product fix. Friday, reconcile sources/events, publish the weekly report and choose the next test. Cap the active queue so follow-ups do not consume every development hour.

During storm/holiday periods, do a brief source health check before promoting content and a second check if a major camera is reported broken. During summer, reduce maintenance to the minimum viable schedule and switch off unproven variable services. Reserve credentials and account recovery to the founder; contractors receive least-privilege access and documented IP/content obligations.

---

# 18 Risk Register

## Scoring
Probability 1–5 and impact 1–5 are **subjective prioritization scores**, not actuarial estimates. Score = probability × impact. Review high scores weekly during launch. Current exposure is distinguished from a hypothetical future feature; “not observed” is not a security or legal certification.

| ID | Category / risk | P | I | Score | Current exposure | Mitigation | Attorney / trigger |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K01 | Copyright — Unlicensed local resort photos/thumbnails | 4 | 5 | 20 | Local image paths observed; ownership or licenses not supplied | Inventory each asset; remove unknown provenance; obtain written web/marketing reuse scope | Yes / Before using any asset commercially |
| K02 | Content licensing — Assuming an accessible embed means commercial permission | 4 | 5 | 20 | Iframe/image modes exist; no licenses reviewed | Use official link fallback; obtain provider AND rights-holder permission; preserve attribution | Yes / Before new embedded source |
| K03 | Product trust — Placeholder camera URLs appear as real inventory | 5 | 4 | 20 | Two Breckenridge placeholder embed URLs in catalog | Remove/hide immediately; schema validation rejects example/placeholder domains | No / Now |
| K04 | Platform dependency — Provider/resort revokes feed or changes URL | 4 | 4 | 16 | Static curated links and embeds depend on external hosts | Owner/source registry, quick disable, official fallback, weekly checks | Yes for license / Any outage/complaint |
| K05 | Copyright — Screenshots, timelapses or social clips exceed website-only rights | 4 | 5 | 20 | Not observed as current feature; high future exposure | Separate rights for still capture, storage, transformations, social and sponsored use | Yes / Before first marketing clip |
| K06 | Security — Third-party iframe/image tracks visitors or serves harmful content | 3 | 4 | 12 | External iframe/image rendering observed | Allowlist hosts, deliberate sandbox/CSP, click-to-load when appropriate, disclose third parties | Yes privacy / New provider or CSP violation |
| K07 | Privacy — Analytics/cookies without accurate disclosure or required opt-outs | 3 | 4 | 12 | Instrumentation observed; policy contents and consent settings unverified | Map actual tags/data/regions; retention limits; honor applicable opt-out signals; validate consent controls | Yes / Before adding ad tech |
| K08 | Financial — Demand too small or low-intent to fund founder time | 4 | 4 | 16 | No verified traffic or revenue baseline | Cost cap; 30-day retention cohorts; cancel weak spend; explicit April decision | No / Two monthly missed gates |
| K09 | Seasonality — Warm winter / late openings / short season | 4 | 4 | 16 | Outdoor winter utility; opening dates weather dependent | Avoid fixed sponsorship guarantees; seasonal contracts, cash reserve and low summer burn | No / Delayed opening or traffic shock |
| K10 | SEO — Thin duplicate programmatic pages never index or lose rankings | 4 | 4 | 16 | Small catalog; future scale could create low-value pages | Publish only verified useful pages; consolidate duplicate intent; diversify clubs/direct | No / Coverage/indexation audit |
| K11 | SEO — Dependence on one search platform | 4 | 4 | 16 | Acquisition mix unknown | Build direct bookmarks, clubs and opted-in updates; measure non-search returning users | No / >70% acquisition from one source |
| K12 | Competition — Incumbents already offer free cameras/favorites/alerts | 5 | 3 | 15 | Verified competitor capabilities overlap | Win speed, reliability and corridor focus; do not rebuild forecast incumbent | No / Positioning interview quarterly |
| K13 | Financial — Bandwidth, analytics or compute spike after traffic jump | 3 | 4 | 12 | Static link-first mode low delivery exposure; actual plan unknown | Commercial plan; spend alerts; bot limits; avoid video proxy; verify team-wide CDN tier | No / 50/80/100% of monthly budget |
| K14 | Data licensing — Weather API free tier used commercially or redistribution exceeds terms | 3 | 4 | 12 | No weather API observed; future risk | No API spend now; quote commercial caching and display rights before integration | Yes for contract / Before weather feature |
| K15 | Consumer protection — Subscription consent, renewals or cancellation not compliant | 3 | 4 | 12 | No current subscription implementation found | Delay checkout until validated; clear terms, easy online cancel, notices and state-law review | Yes / Before taking recurring payments |
| K16 | Reputation — Sponsored ranking presented as objective snow quality | 3 | 4 | 12 | No observed paid ranking; prospective monetization risk | Separate sponsored module; label ads; no sponsor influence on factual conditions | Yes disclosure / Before sponsor launch |
| K17 | Safety / AI — Stale camera/AI summary misrepresented as current safe skiing conditions | 3 | 5 | 15 | Live wording without demonstrated timestamps; AI not observed | Show timestamp/timezone/source; never assert trail safety or avalanche guidance from images | Yes / Staleness or safety complaint |
| K18 | Sales — No buyer will pay at current traffic | 4 | 3 | 12 | No traction verified; sponsor economics hypothetical | Sell small measured pilots only; cancel if no local outcome; make no minimum reach claims | No / After 30 qualified sales conversations |
| K19 | Affiliate — Commissions rejected, reversed, delayed or banned | 4 | 3 | 12 | No accepted accounts observed | Track sub-ID approvals/net payout; follow PPC/coupon rules; model 60-day lag and reversals | Contract review / Monthly reconciliation |
| K20 | Corporate — Personal liability or mixed business/personal funds | 3 | 5 | 15 | Entity, insurance, books unknown | Home-state professional advice; proper entity when justified; separate bank/books/contracts | Yes + CPA / Before paid contracts |
| K21 | Security — Account takeover / malicious dependency / secrets exposure | 3 | 5 | 15 | Public repo; no secret required in reviewed architecture | MFA, least privilege, branch review, dependency updates, secret scanning and recovery keys | No / Critical dependency advisory |
| K22 | Operations — Solo founder overwhelmed by maintenance and prospecting | 4 | 4 | 16 | 100 prospects are a queue, not weekly workload | Limit active outreach to 25; cap 20 resorts initially; automate link checks not scraping | No / >8 hours weekly repair work |
| K23 | IP / employment — Founder ownership conflicts with employer or contractor | 2 | 5 | 10 | Employment/IP agreements not reviewed | Use own time/equipment; review invention assignment/moonlighting restrictions; written contractor assignment | Yes / Before contractor or commercialization |
| K24 | Trademark — PeakCam conflicts with an existing similar mark | 3 | 4 | 12 | Name/domain observed; no clearance search opinion | Professional similarity/class search before major spend; retain rebrand contingency | Yes / Before mark filing or large ad buy |
| K25 | Children / community — Under-13 data or harmful user uploads create new obligations | 2 | 4 | 8 | No accounts/UGC observed in current rewrite | Do not launch child-directed accounts or uploads; privacy counsel before community features | Yes / Before collecting user content |
| K26 | Accessibility — Core source links, filters or fallback unusable with keyboard/screen reader | 3 | 3 | 9 | Interactive accessibility testing not performed | Keyboard test, labels/focus/contrast, reduced motion, textual external fallback | As needed / Every core UI release |
| K27 | Content / international — Non-US database and contract restrictions on large-scale extraction | 2 | 4 | 8 | No bulk scrape observed; international provider contacts proposed | Avoid mass extraction; scope territories and permitted data fields in written license | Yes / Before international aggregation |
| K28 | Incident response — Missing takedown or breach response procedure | 3 | 4 | 12 | Contact/policy routes exist; process unverified | One owner, evidence preservation, quick content disable, state-specific breach counsel playbook | Yes / Any credible notice |


## Risks that can end the commercial thesis
Unobtainable or unaffordable content rights; a product that does not create return behavior beyond direct resort bookmarks; and no meaningful purchase intent or renewing sponsor demand at achievable traffic. A copyright dispute, serious security/privacy incident or employer IP ownership problem can also create losses disproportionate to the revenue. These deserve more founder attention than marginal hosting optimizations.

## Control ownership
Jared owns each risk until explicitly delegated. Counsel owns legal interpretation, not day-to-day source maintenance. A provider owns its infrastructure, not PeakCam’s promises to users. A merchant owns booking confirmation, not PeakCam’s click analytics. Assigning a vendor does not remove the founder’s obligation to verify what the product displays and what the sales materials claim.

---

# 19 Experiment Backlog

## Evidence before scope
Run at most **two product/growth experiments and one commercial test concurrently**. Record the hypothesis and threshold before launch. For tiny samples, a threshold is a discussion gate, not statistical proof. Capture refusals and failed tests as useful findings. Do not silently change the success metric to match a favorable result.

| ID | Hypothesis | Implementation | Cost allowance | Duration | Success threshold | Learning | Deadline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E01 | Camera utility works without accounts | Watch 10 users locate their preferred current official camera | $0 | 5 days | 9/10 complete within 20 seconds; no placeholder exposure | Whether navigation, not more features, is bottleneck | 2026-09-18 |
| E02 | Colorado locals have a repeat pre-drive job | 12 interviews about last real skiing decision; avoid feature hypotheticals | $100 | 14 days | 8 describe a recurring multi-site camera check | Choose core persona and corridor | 2026-09-27 |
| E03 | Resorts welcome attributed referral distribution | 10 short permission requests with exact source URL and scope | $0 | 14 days | 3 substantive replies; 2 written approvals or clear licensing path | Access feasibility and procurement friction | 2026-10-02 |
| E04 | One provider can simplify lawful coverage | Roundshot, HDOnTap and Panomax scoped 5–10 camera pilot requests | $0 | 21 days | One written commercial pilot proposal identifying owner consent | Whether upstream partnership is a real leverage point | 2026-10-09 |
| E05 | Favorites increase return use | Browser-local favorites for a 50-person beta; compare by cohort, acknowledge self-selection | $0 | 21 days | 20% save; 25% return within 14 days during relevant weather | Value of retention feature, not causal proof | 2026-10-23 |
| E06 | Club distribution acquires engaged users cheaply | 3 club messages with unique UTM/landing page; no paid blast | $100 | 21 days | 100 visitors; >40% qualified action; >15% 14-day return | Repeatable channel economics | 2026-10-30 |
| E07 | Specific long-tail pages can gain search exposure | Publish 12 useful pages; inspect indexing and nonbrand impressions | $300 | 45 days | 8 eligible pages indexed and rising impressions; not a traffic guarantee | Indexation and keyword fit | 2026-11-15 |
| E08 | Resort-context rentals convert better than generic gear | One approved rental CTA versus one contextual gear CTA, same disclosure | $0 | 30 days | 100 qualified outbound clicks; at least one approved transaction; report intervals | Revenue per outbound click and destination intent | 2026-11-30 |
| E09 | A local merchant pays for measured exposure | Pitch 10 appropriate businesses after showing actual local usage | $0 | 21 days | 2 $50–150 paid monthly pilots without false reach promises | Real budget and buyer language | 2026-11-20 |
| E10 | Camera condition reminders have paid demand | Price-specific Pro waitlist ($19–29 season); interview opt-ins, no fake checkout | $0 | 21 days | 10% of 200 engaged visitors join; 10 explicitly accept price in follow-up | Whether any premium build is justified | 2026-10-31 |
| E11 | Permissioned morning comparison content drives site actions | 12 posts across 2 formats with trackable links; 30-minute production cap | $150 | 21 days | At least 100 qualified visits; >5 visits per production hour; one repeatable format | Content efficiency rather than viral vanity | 2026-10-31 |
| E12 | A small creator review reaches the right audience | 3 niche creators; free honest product access, no payment for positive review | $100 | 21 days | 2 reviews/mentions; 50 qualified visits from one | Earned distribution and product weaknesses | 2026-11-20 |
| E13 | Destination sponsor pilot can renew | Send actual report to first 3 sponsors and ask renewal at transparent price | $0 | 30 days | At least 2 renew or increase scope voluntarily | Buyer value beyond novelty | 2027-01-15 |
| E14 | Paid acquisition can eventually clear unit economics | Only after retention proof: capped $100 exact-intent campaign, no broad match | $100 | 7 days | Measured 90-day gross profit/CAC plausibly >1.5; otherwise stop | Whether paid traffic is commercially rational | 2026-12-15 |
| E15 | Ads do not damage the useful camera journey | Small holdout on eligible pages; cap one nonblocking unit | $0 | 21 days | Positive revenue less infra/retention cost; no material core-action decline | Marginal ad value, not just RPM | 2027-02-20 |


## Decision rules
Pass: reproduce the result in a second cohort or partner before scaling spend. Ambiguous: improve measurement or interview participants, not automatically build the feature. Fail: stop or materially change the offer; do not add a month of engineering to rescue a weak premise. A partner saying “interesting” is not a signed pilot; a user clicking a pricing button is not a paid conversion; a commission reported as pending is not cash.

For experiments that depend on permissions, do not run the content use first and ask forgiveness later. For premium tests, clearly label the proposed product and avoid a fake purchase completion. A refundable preorder can be a later stronger test only after the delivery, consumer-law and refund terms are actually ready.

---

# 20 30/60/90-Day Founder Action Plan

## First 30 days — through October 9, 2026
Make the existing experience honest and usable. Remove placeholders, fix source destinations, inventory preview rights, validate analytics, establish a baseline and commercial hosting configuration, and complete a short professional risk review. Observe ten mobile journeys and interview twelve skiers. Send the initial resort/provider permission requests and recruit a small club beta. Deliver a minimum of a few written permissions or clearly documented lawful link-only choices, not a large unlicensed catalog.

**Allocation hypothesis:** 35% reliability/source work, 25% users/club recruiting, 20% permission outreach, 10% analytics, 10% administration. Stop feature work that does not improve the basic camera decision or unblock a rights issue. By this checkpoint, a stranger should understand what PeakCam does and what it does not yet cover.

## First 60 days — through November 8, 2026
Maintain twelve complete Colorado pages, local favorites/share and a verified tracking path. Run three club/concierge pilots, publish four substantive corridor guides, apply to one lodging and one relevant rental/gear affiliate, and test two social formats with approved assets. Create a real media kit using actual analytics. Test a price-specific premium concept only as research.

**Gate:** a visible repeat cohort, reliable source access, evidence of one economical distribution route and an accepted commercial program. An affiliate application still pending is not a business milestone achieved. If the core job is weak, pause expansion and rework it rather than publishing thirty more destinations.

## First 90 days — through December 8, 2026
Reach at most twenty maintained resorts if quality permits; pass the November 23 holiday readiness check. Present honest local audience reports to a handful of shops/lodging operators. Close or reject two to three small pilots, test real booking attribution and reconcile the first payable commission. Use holiday trip-planning content where relevant and avoid a major product rewrite.

**Gate:** source rights under control, returning user evidence, and at least one real commercial signal stronger than verbal interest. If those are absent, retain a low-cost utility and reduce the December spend plan. If present, improve the winning workflow and prepare January renewal discussions; do not interpret an initial friendly purchase as full product-market fit.

## The weekly founder scorecard
Record: active verified destinations; unresolved rights items; camera failure/fallback rate; weekly returning decision-makers; top acquisition source’s 28-day return; approved net commissions; partner cash collected; renewal asks/results; cash spent; hours worked; and next single decision. This scorecard should fit one page. No pitch deck is required to run it.

---

# 21 September 2026–April 2027 Master Roadmap

## Execution table
Costs and hours below are planning allowances, not quotes. Owner is Jared unless specialist involvement is specified. Dependencies must be satisfied before the action goes live; a date does not override permission or compliance. Status starts “Not started” because this portfolio is a plan, not a claim that the actions were executed.

| ID | Phase | Action | Priority | Deadline | Owner | Hours | Cost allowance | Dependency | Success metric | Benefit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | NOW | Remove both placeholder Breckenridge embeds; retain verified official outbound link | Critical | 2026-09-10 | Jared | 2 | $0 | None | Zero placeholder or fabricated source URLs visible | Stop avoidable trust loss |
| R02 | NOW | Create camera provenance/permission register and verify all five entries | Critical | 2026-09-12 | Jared | 5 | $0 | R01 | Each visible entry has owner, source, mode and check date | Control content and reliability risk |
| R03 | NOW | Read current policies, actual Vercel billing and analytics dashboards | Critical | 2026-09-12 | Jared | 3 | $0 | Owner dashboard access | Actual plan, spend, 30-day users and policy gaps recorded | Replace unknown baselines |
| R04 | NOW | Test 10 end-to-end journeys on Android, iPhone and desktop | Critical | 2026-09-15 | Jared | 5 | $0 | R01 | At least 9/10 users reach intended source within 20 seconds | Validate core use case |
| R05 | NOW | Separate embed-load telemetry from verified playback; validate event capture | Critical | 2026-09-16 | Jared | 6 | $0 | R03 | All required core events have clean test payloads | Avoid fake activation metrics |
| R06 | NOW | Send permission-first First 7 resort inquiries and 3 provider inquiries | Season | 2026-09-18 | Jared | 5 | $0 | R01,R02 | 10 tailored messages; 2 conversations target | Secure access before scaling |
| R07 | NOW | Consult media/IP attorney on thumbnails, embeds, takedown and pilot terms | Critical | 2026-09-25 | Jared + IP attorney | 3 | $900 | R02 | Written permitted-use approach and red-line checklist | Address existential content exposure |
| R08 | NOW | Choose home-state entity approach; obtain EIN/bank separation when appropriate | Critical | 2026-09-30 | Jared | 4 | $300 | Operating state and counsel/tax review | Entity/DBA/tax requirements mapped; separate ledger live | Enable professional contracting |
| R09 | NOW | Publish accurate coverage, founder/contact, source credit and correction process | Critical | 2026-09-20 | Jared | 5 | $50 | R02,R07 scope | No unearned national/live coverage claims | Increase trust and response probability |
| R10 | NOW | Interview 12 Colorado skiers about last pre-drive camera decision | Season | 2026-09-27 | Jared | 8 | $100 | Recruit via clubs/personal network | 12 behavioral interviews; top recurring job identified | Avoid feature-led guessing |
| R11 | BEFORE NOVEMBER | Curate 12 reliable Colorado resort pages; use link-first when rights unclear | Season | 2026-10-15 | Jared | 18 | $0 | R02,R06 | 12 unique useful pages; all visible sources checked weekly | Create regional depth |
| R12 | BEFORE NOVEMBER | Implement browser-local favorites and one-click share without accounts | Season | 2026-10-10 | Jared | 10 | $0 | R04,R05 | 20% of 50 beta users save at least one resort | Test repeat-use value |
| R13 | BEFORE NOVEMBER | Set Search Console; validate sitemap, redirects, canonicals, indexation | Season | 2026-10-12 | Jared | 6 | $0 | R11 | No placeholder URLs submitted; all priority pages inspectable | Enable discoverability |
| R14 | BEFORE NOVEMBER | Create 4 genuinely useful region/drive-corridor guides | Season | 2026-10-25 | Jared | 14 | $300 | R11 | Unique decision information; source credits and internal links | Win specific search intents |
| R15 | BEFORE NOVEMBER | Obtain affiliate approval for one lodging and one rental/gear offer | Season | 2026-10-20 | Jared | 6 | $0 | R09 | Written acceptance + test click attribution; no self-booking abuse | Enable measurable first revenue |
| R16 | BEFORE NOVEMBER | Add contextual affiliate link and disclosure only on appropriate pages | Season | 2026-10-30 | Jared | 8 | $0 | R15,R05 | Click and sub-ID reconciliation tested end to end | Monetize intent without clutter |
| R17 | BEFORE NOVEMBER | Run 3 club/concierge beta distribution pilots | Season | 2026-10-30 | Jared | 8 | $100 | R11,R12 | 100 referred users; qualified-action and repeat cohorts measured | Find a low-cost repeatable channel |
| R18 | BEFORE NOVEMBER | Set mobile performance and broken-camera operating checks | Critical | 2026-10-31 | Jared | 8 | $50 | R04,R11 | No layout-blocking video loads; health status and fallback tested | Keep core utility reliable |
| R19 | BEFORE NOVEMBER | Test permissioned morning-camera content formats, 12 posts total | Season | 2026-10-31 | Jared | 12 | $150 | Written still/video reuse rights | Compare qualified visits/production hour, not likes | Identify one content format worth repeating |
| R20 | BEFORE NOVEMBER | Run Pro concept page with explicit waitlist, no automatic charge | Season | 2026-10-31 | Jared | 4 | $0 | R10,R12 | Price-specific intent from 200 eligible visitors | Test willingness before building |
| R21 | BEFORE NOVEMBER | Build one real media-kit page with actual audience placeholders filled | Season | 2026-10-31 | Jared | 3 | $0 | R03,R17 | All metrics dated; paid placement clearly labeled | Avoid fabricated traction in sales |
| R22 | THANKSGIVING–CHRISTMAS | Expand to 20 reliable resort pages only if weekly maintenance manageable | Season | 2026-11-15 | Jared | 14 | $0 | R11,R18 | 95% of listed official destinations accessible on checks | Expand useful inventory |
| R23 | THANKSGIVING–CHRISTMAS | Offer 3 measured local rental/lodging sponsor pilots | Season | 2026-11-20 | Jared | 8 | $0 | R17,R21; meaningful destination traffic | 2 paid pilots at $50–150/month target | Test business willingness to pay |
| R24 | THANKSGIVING–CHRISTMAS | Thanksgiving readiness review and issue freeze | Critical | 2026-11-23 | Jared | 4 | $0 | R18,R22 | No critical broken source or privacy blocker | Protect holiday acquisition |
| R25 | THANKSGIVING–CHRISTMAS | Publish holiday travel camera checklist and club sharing links | Season | 2026-12-05 | Jared | 6 | $100 | R14,R19 | 300 qualified campaign visits target | Match trip-planning demand |
| R26 | THANKSGIVING–CHRISTMAS | Review first booking approvals, returns and sponsor reports | Season | 2026-12-15 | Jared | 4 | $0 | R16,R23 | Earned commissions reconciled, not just clicks | Validate cash economics |
| R27 | THANKSGIVING–CHRISTMAS | Decide whether alert prototype deserves a capped build | Season | 2026-12-18 | Jared | 3 | $0 | R20 + price interviews | 10 explicit paid commitments or stop | Avoid unpaid feature expansion |
| R28 | THANKSGIVING–CHRISTMAS | Pre-holiday reliability/coverage sweep | Critical | 2026-12-20 | Jared | 5 | $0 | All camera records | All active pages checked; holiday on-call owner named | Keep Christmas visitors from dead ends |
| R29 | JANUARY–FEBRUARY | Renew successful sponsors; stop those with no attributed value | Season | 2027-01-15 | Jared | 5 | $0 | R26 | At least half of eligible pilot partners renew target | Find evidence beyond friendly first sales |
| R30 | JANUARY–FEBRUARY | Expand one adjacent corridor only with rights and user demand | Season | 2027-01-31 | Jared | 20 | $300 | R22; >25% 28-day return target | Adjacent cohort performs within 20% of core corridor | Avoid national maintenance sprawl |
| R31 | JANUARY–FEBRUARY | Evaluate selective display ads versus speed and return visits | Later | 2027-02-05 | Jared | 6 | $0 | Eligibility, content quality, >10k MAU planning gate | Positive incremental contribution; retention not materially lower | Add scalable low-touch revenue carefully |
| R32 | JANUARY–FEBRUARY | Run retained-user research and willingness-to-pay revisit | Season | 2027-02-20 | Jared | 8 | $100 | At least 100 measured repeat users | Top paid job validated or Pro shelved | Let real behavior set product priorities |
| R33 | MARCH–APRIL | Promote spring operating schedules and permitted late-season cameras | Season | 2027-03-10 | Jared | 8 | $100 | Current official dates, not guessed schedules | Weekly spring return cohort maintained | Extend useful season |
| R34 | MARCH–APRIL | Negotiate next-season permission renewals and sponsor early commitments | Season | 2027-03-31 | Jared | 8 | $0 | R29 | 3 written next-season commitments target | Reduce next September scramble |
| R35 | MARCH–APRIL | Season close: reconcile cash, retention, contracts and permission expiry | Critical | 2027-04-30 | Jared | 10 | $250 | Complete source/finance records | Document continue/pivot/stop decision with actual evidence | Avoid subsidizing an unproven hobby indefinitely |
| R36 | MARCH–APRIL | Choose narrow summer maintenance or one summer-camera experiment | Later | 2027-04-30 | Jared | 3 | $0 | R35 | Fixed cost cap and maintenance owner set | Preserve runway through seasonality |


## April decision memo template
**What happened:** [actual users, repeat cohorts, verified destinations, source permissions, approved commissions, sponsor renewals and cash]. **What cost it:** [invoices, founder hours, unresolved obligations and summer fixed burn]. **What is repeatable:** [specific channel and commercial outcome with evidence]. **What is not:** [failed tests, attribution gaps, rights/maintenance bottlenecks]. **Decision:** continue this corridor, expand one justified region, pivot to a small service, or stop commercial investment. **Next-season committed exposure:** [license renewals, sponsor contracts, refunds, email/data retention and operating cash].

The business becomes credible through honest utility, repeat use, clean rights and payments that renew—not through the number of planning documents. This portfolio is the operating system for collecting that evidence.

---

# Source & Evidence Register

Research date: September 9, 2026. Sources are current where retrievable. Public contact routes are not confirmed buying authority or deliverability. Exact rates, rules and staff roles should be rechecked before commitment.

| ID | Source | URL | Evidence / limitation |
| --- | --- | --- | --- |
| A01 | Audited dependency manifest | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/package.json | Connected GitHub read; declared dependencies, not tests executed |
| A02 | Audited camera catalog | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/data/resorts.json | Connected GitHub read; three resorts, five entries, two placeholders |
| A03 | Audited camera renderer | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx | Connected GitHub read; external links/raw image/iframe; no server proxy |
| A04 | Audited page metadata and analytics | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/app/layout.tsx | Connected GitHub read; instrumentation present, usage not retrieved |
| A05 | Audited product documentation | https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/CLAUDE.md | Connected GitHub read; architecture description cross-checked against files |
| A06 | Production website | https://www.peakcam.io | Vercel read returned HTTP 200; HTML inspection only, not interactive mobile testing |
| M01 | OpenSnow official current pricing | https://support.opensnow.com/subscription/how-much-does-opensnow-cost | Base $49.99/year; Premium $99.99/year |
| M02 | OnTheSnow app | https://www.onthesnow.com/news/mobile/ | Free reports, cameras, favorites and powder alerts; vendor coverage claims |
| M03 | OnTheSnow iOS popularity indicator | https://apps.apple.com/us/app/onthesnow-ski-snow-report/id300412347 | App rating count is a storefront snapshot, NOT active users |
| M04 | Snow-Forecast membership | https://www.snow-forecast.com/pages/membership.php | Free/premium forecast distinction |
| M05 | Snow-Forecast localized pricing | https://www.snow-forecast.com/pages/rewards | Currency and checkout region affect displayed price |
| M06 | 2025–26 preliminary skier visits | https://www.snow-forecast.com/whiteroom/us-skier-visits-drop-dramatically-after-poor-snowfall-winter-in-the-west/ | May 6 2026 trade coverage of NSAA: 52.6m visits; secondary, preliminary, not unique skiers |
| M07 | Prior-season industry context | https://www.forbes.com/sites/michellebruton/2025/05/30/us-ski-resorts-had-second-best-season-on-record-in-202425/ | 2024–25 61.5m visits; do not confuse season or visits with people |
| V01 | Vercel pricing | https://vercel.com/pricing | Public list pricing; actual PeakCam plan and bills not obtained |
| V02 | Vercel Flat Rate CDN GA September 8 2026 | https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams | Pro includes 1m requests/1TB; additional $20 10m/50TB, $100 50m/50TB; team level; existing teams must switch |
| V03 | Vercel fair use | https://vercel.com/docs/limits/fair-use-guidelines | Hobby noncommercial; commercial deployment must use appropriate plan |
| V04 | Stripe payments pricing | https://stripe.com/pricing | Standard US domestic cards 2.9% + $0.30; other fees and taxes possible |
| V05 | Stripe Billing pricing | https://stripe.com/billing/pricing | Billing additional usage fee; not included in simple one-time invoice assumption |
| V06 | Open-Meteo pricing and commercial terms | https://open-meteo.com/en/pricing | Free hosted API noncommercial; paid subscription and attribution for commercial service; dollar quote not verified |
| V07 | Journey minimum requirements | https://journeymv.zendesk.com/hc/en-us/articles/24633185741723-Journey-Minimum-Requirements | Updated August 14 2026; 1,000 premium sessions/30 days plus qualitative requirements; not guaranteed acceptance |
| L01 | IRS free EIN application | https://www.irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number | Free direct from IRS; form entity before applying for its EIN |
| L02 | IRS single-member LLC treatment | https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies | Default disregarded entity absent election; not automatic tax savings |
| L03 | Illinois LLC instructions — illustrative state only | https://www.ilsos.gov/departments/business-services/organization/llc-instructions.html | $150 standard formation; $250 expedited; founder operating state NOT established |
| L04 | FinCEN BOI current rule | https://www.fincen.gov/boi | August 2026 final rule exempts US-created entities; foreign-company rules differ |
| L05 | FTC negative-option rulemaking March 2026 | https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-seeks-public-comment-response-advance-notice-proposed-rulemaking-regarding-negative-option | 2024 rule vacated; 2026 proceeding not a final nationwide click-to-cancel rule |
| L06 | California automatic renewal law alert | https://oag.ca.gov/news/press-releases/attorney-general-bonta-issues-consumer-alert-california%E2%80%99s-automatic-renewal-law | Rules effective July 1 2025; consent, notices and cancellation obligations |
| L07 | California CCPA guidance | https://www.oag.ca.gov/privacy/ccpa | Applicability requires threshold and data-practice analysis; do not assume all small sites exempt |
| L08 | FTC CAN-SPAM compliance | https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business | B2B commercial email covered; accurate sender, postal address and opt-out |
| L09 | FTC advertising disclosures | https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers | Clear conspicuous material-connection disclosures |
| L10 | FTC COPPA rule | https://www.ftc.gov/legal-library/browse/rules/childrens-online-privacy-protection-rule-coppa | Child-directed services and actual knowledge; under-13 personal information |
| L11 | DOJ website accessibility | https://www.ada.gov/resources/web-guidance/ | Private business accessibility and public-entity rules must not be conflated |
| L12 | USPTO trademark fees | https://www.uspto.gov/trademarks/trademark-fee-information | Base application $350/class; additional fees possible; no clearance opinion performed |
| L13 | Embedding copyright legal analysis | https://www.msk.com/newsroom-alerts-embedding-copyright | Secondary legal analysis; server test is not a blanket national embedding safe harbor |
| L14 | YouTube developer policy guide | https://developers.google.com/youtube/terms/developer-policies-guide | Applies where using YouTube API services; preserve player restrictions and branding; check embed terms too |
| L15 | US government copyright caveats | https://www.doi.gov/copyright | Government works may be public domain; third-party content and marks can remain protected |
| G01 | Google scaled-content policy explanation | https://blog.google/products-and-platforms/products/search/google-search-update-march-2024/ | Do not mass-publish low-value pages for rankings |
| P01 | Roundshot sharing partner announcement June 30 2026 | https://www.roundshot.com/en/messages.html/21/news/946 | Real upstream distribution precedent; NOT approval for PeakCam |
| P02 | Ski.com affiliate program | https://www.ski.com/affiliates | Real publisher program; commission and acceptance not verified for PeakCam |
| P03 | evo affiliate program | https://www.evo.com/pages/affiliate-program | Public program; 5% and 30-day terms subject to contract and exclusions |
| P04 | Backcountry affiliate program | https://www.backcountry.com/info/affiliate-program | 8% base / 30 days published; not all purchases necessarily eligible |
| P05 | Expedia Group affiliate program | https://www.affiliates.expediagroup.com/ | Up to 4% qualifying bookings; actual product/account rules control |
| P06 | Booking.com current affiliate signup | https://www.booking.com/affiliate-program/v2/index.html | Current signup route; no historical commission-share tiers assumed |
| P07 | Weston affiliate program | https://westonbackcountry.com/pages/weston-affiliate-program | 6% / 30 days through AvantLink, subject to approval |
| P08 | Snow Peak affiliate program | https://www.snowpeak.com/pages/affiliates | Content partners 6%, coupon partners 2%, 30 days |
| P09 | DiscoverCars affiliate economics | https://www.discovercars.com/pl/affiliate | 70% rental PROFIT and 30% Full Coverage revenue, not 70% booking price |
| P10 | GoPro localized affiliate terms | https://gopro.com/en/dk/legal/gopro-affiliate-program | 3% on localized official page; US terms need recheck |
| P11 | CamStreamer integrator directory | https://camstreamer.com/partners | Integrators are discovery leads, NOT verified ski-resort clients or footage licensors |
| M08 | SnowStash camera-centric resort page | https://snowstash.com/usa/california/sugar-bowl/snow-cams | Observed web-camera page, angle descriptions and trip modules; pricing/traffic not verified |

## Organization-level contact sources

| CRM ID | Organization | Public contact / program source | Additional evidence | Verification caveat |
| --- | --- | --- | --- | --- |
| PC-001 | Loveland Ski Area | https://skiloveland.com/media-center/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-002 | Monarch Mountain | https://skimonarch.com/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-003 | Ski Cooper | https://www.skicooper.com/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-004 | Sunlight Mountain Resort | https://sunlightmtn.com/media-link/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-005 | Granby Ranch | https://granbyranch.com/contact-us/ | https://granbyranch.com/news/granby-faq/general-customer-inquiries/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-006 | Wolf Creek Ski Area | https://wolfcreekski.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-007 | Arapahoe Basin | https://www.arapahoebasin.com/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-008 | Powderhorn Mountain Resort | https://www.powderhorn.com/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-009 | Purgatory Resort | https://www.purgatory.ski/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-010 | Sipapu Ski and Summer Resort | https://www.sipapu.ski/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-011 | Taos Ski Valley | https://www.skitaos.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-012 | Sugar Bowl Resort | https://www.sugarbowl.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-013 | Big Powderhorn Mountain Resort | https://bigpowderhorn.net/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-014 | Eldora Mountain Resort | https://business.boulderchamber.com/active-member-directory/Details/eldora-mountain-resort-3330316 | N/A | Public directory/business-profile route; reverify with organization |
| PC-015 | Bogus Basin | https://bogusbasin.org/about-bogus/contact/ | https://bogusbasin.org/about-bogus/culture/bogus-basin-hosts-summer-season-finale/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-016 | Bridger Bowl | https://bridgerbowl.com/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-017 | Lost Trail Ski Area | https://losttrail.com/lost-trail-policies/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-018 | Brundage Mountain | https://brundage.com/media/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-019 | Magic Mountain | https://www.magicmtn.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-020 | Mad River Glen | https://skivermont.com/pr-contacts | N/A | Public directory/business-profile route; reverify with organization |
| PC-021 | Jay Peak Resort | https://skivermont.com/pr-contacts | N/A | Public directory/business-profile route; reverify with organization |
| PC-022 | Killington Resort | https://skivermont.com/pr-contacts | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-023 | Middlebury Snowbowl | https://skivermont.com/pr-contacts | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-024 | Vail Resorts | https://www.vailresorts.com/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-025 | Alterra Mountain Company | https://www.alterramtn.co/en/become-a-partner | https://www.alterramtn.co/en/contact-us | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-026 | Boyne Resorts | https://www.boyneresorts.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-027 | Mountain Capital Partners | https://www.mcp.ski/contact | https://www.mcp.ski/people | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-028 | Pacific Group Resorts | https://www.pgri.us/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-029 | Aspen Skiing Company / Aspen Snowmass | https://www.aspensnowmass.com/discover/guest-services | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-030 | Roundshot / Seitz Phototechnik AG | https://www.roundshot.com/en/messages.html/21/news/946 | https://www.roundshot.com/en | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-031 | HDOnTap | https://sales.hdontap.com/contact-us/ | https://sales.hdontap.com/streaming-faqs/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-032 | Panomax GmbH | https://www.panomax.com/en | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-033 | EarthCam | https://www.earthcam.com/company/contact.php | https://www.earthcam.net/referral/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-034 | Ski.com | https://www.ski.com/affiliates | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-035 | evo | https://www.evo.com/pages/affiliate-program | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-036 | Ski Butlers | https://www.skibutlers.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-037 | Christy Sports | https://www.christysports.com/on/demandware.store/Sites-ChristySports_US-Site/en_US/ContactUs-Landing | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-038 | Expedia Group Affiliate Program | https://www.affiliates.expediagroup.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-039 | DiscoverCars.com | https://www.discovercars.com/affiliate | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-040 | GetYourGuide | https://partner.getyourguide.support/hc/en-us/articles/23082933149981-How-to-get-started-with-the-Affiliate-Program-as-a-Creator | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-041 | Colorado Ski Country USA | https://www.coloradoski.com/media-room/ | https://www.coloradoski.com/contact/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-042 | Visit Glenwood Springs | https://visitglenwood.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-043 | Breckenridge Tourism Office / GoBreck | https://gobreck.com/media/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-044 | Ski Utah | https://www.skiutah.com/about/about-us/raelene-davis/ | https://www.skiutah.com/media-room/Press-Room | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-045 | Blue River Sports | https://www.summitchamber.org/connections/78492-blue-river-sports/ | https://www.colorado.com/breckenridge/winter-activities/equipment-rentals/blue-river-sports | Public directory/business-profile route; reverify with organization |
| PC-046 | Mountain View Sports | https://mountainviewsports.com/store-location/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-047 | SummitCove Lodging | https://www.trustpilot.com/review/summitcove.com | N/A | Public directory/business-profile route; reverify with organization |
| PC-048 | Breckenridge Brewery & Pub | https://www.breckbrew.com/visit/breckenridge/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-049 | Blue Sky Ski Rentals | https://www.blueskyski.net/privacy-policy/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-050 | SnowBrains | https://snowbrains.com/contact/ | https://www.linkedin.com/company/snowbrains/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-051 | The Storm Skiing Journal and Podcast | https://www.stormskiing.com/p/ask-me-anything | N/A | Stale first-party source; reverify before sending |
| PC-052 | Uncover Colorado | https://www.uncovercolorado.com/contact/ | https://www.uncovercolorado.com/advertise-with-uncover-colorado/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-053 | Glade Optics | https://www.shopglade.com/pages/contact-us | https://www.shopglade.com/pages/become-a-rep | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-054 | PeakRankings | https://www.peakrankings.com/about | https://www.linkedin.com/in/sam-weintraub/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-055 | Newschoolers | https://www.newschoolers.com/advertise | https://www.newschoolers.com/contact | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-056 | FREESKIER / Storm Mountain Media | https://www.freeskier.com/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-057 | Summit Skier | https://summitskier.com/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-058 | Schussbaumer Ski Club | https://schuss.clubexpress.com/content.aspx?club_id=942033&page_id=4 | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-059 | Colorado Mountain Club | https://www.cmc.org/view | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-060 | Freeskier Society | https://www.freeskiersociety.com/new-page | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-061 | Ski & Snowboard Club Vail | https://discovervail.com/businesses/ski-snowboard-club-vail/ | N/A | Public directory/business-profile route; reverify with organization |
| PC-062 | Visit Park City | https://www.visitparkcity.com/media/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-063 | Steamboat Springs Chamber | https://www.steamboatchamber.com/about-us/board-staff/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-064 | Jackson Hole Chamber of Commerce | https://www.jacksonholechamber.com/about-us/chamber-staff/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-065 | Ski Vermont | https://skivermont.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-066 | Visit California | https://industry.visitcalifornia.com/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-067 | Travel Oregon | https://industry.traveloregon.com/about/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-068 | Visit Idaho | https://visitidaho.org/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-069 | Backcountry | https://www.backcountry.com/info/affiliate-program | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-070 | Snow Peak USA | https://www.snowpeak.com/pages/affiliates | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-071 | Stio | https://www.stio.com/pages/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-072 | Weston | https://westonbackcountry.com/pages/weston-affiliate-program | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-073 | Ski The East | https://www.skitheeast.net/pages/faq | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-074 | Wildhorn Outfitters | https://www.wildhornoutfitters.com/pages/contact-us | https://www.linkedin.com/company/wildhorn-outfitters | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-075 | Open-Meteo | https://open-meteo.com/en/pricing | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-076 | Visit Lake Tahoe / Lake Tahoe Visitors Authority | https://visitlaketahoe.com/media-and-pr/media/ | https://visitlaketahoe.com/about-us/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-077 | Utah Office of Tourism / Visit Utah | https://www.visitutah.com/fr-fr/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-078 | Indy Pass | https://www.indyskipass.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-079 | Mountain Collective | https://mountaincollective.com/support-contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-080 | CamStreamer | https://camstreamer.com/about-us | https://camstreamer.com/become-partner | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-081 | feratel media technologies | https://www.feratel.com/en/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-082 | IPCamLive | https://web.ipcamlive.com/ | https://web.ipcamlive.com/pricing | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-083 | POWDR | https://www.visitparkcity.com/listing/powdr/30108/ | N/A | Public directory/business-profile route; reverify with organization |
| PC-084 | GoPro | https://gopro.com/en/dk/legal/gopro-affiliate-program | https://gopro.com/en/us/legal/gopro-affiliate-program | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-085 | Summit Express | https://wtd.summitexpress.com/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-086 | Alpine Luxury Limo | https://alpineluxurylimo.com/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-087 | SnowPak | https://www.snowpak.com/about | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-088 | Hestra Gloves USA | https://www.hestragloves.us/pages/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-089 | Yakima | https://yakima.com/pages/contact-us | https://yakimasupport.zendesk.com/hc/en-us/articles/360006717572-Media-Requests | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-090 | Dakine | https://www.dakine.com/pages/contact | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-091 | CanDat Systems | https://camstreamer.com/partners | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-092 | Dotworkz Systems | https://camstreamer.com/partners | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-093 | Netwavz | https://camstreamer.com/partners | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-094 | Aspen Chamber Resort Association | https://aspenchamber.org/about/contact-us/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-095 | Snowmass Tourism | https://www.gosnowmass.com/about-us/media/media-photos/ | https://www.gosnowmass.com/about-us/media/ | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-096 | Colorado Tourism Office | https://www.colorado.com/media-room | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-097 | Visit Big Sky | https://www.visitbigsky.com/contact/ | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-098 | Visit Montana | https://visitmt.com/contact-us | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-099 | Allianz Partners / Allianz Travel Insurance | https://www.allianztravelinsurance.com/about | https://www.allianztravelinsurance.com/about/partners.htm | Public first-party business route researched; no delivery test or buyer authority confirmed |
| PC-100 | Booking.com | https://www.booking.com/affiliate-program/v2/index.html | N/A | Public first-party business route researched; no delivery test or buyer authority confirmed |
