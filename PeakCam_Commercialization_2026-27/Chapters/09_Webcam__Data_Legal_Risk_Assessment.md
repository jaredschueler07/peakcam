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
