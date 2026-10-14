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

