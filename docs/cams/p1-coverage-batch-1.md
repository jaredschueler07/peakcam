# P1 coverage import, batch 1: the SNOTEL-rich West (2026-10-19)
> Block P1 of `docs/research/ai-assistant-first/2026-10-18-parity-plan.md`. The competitor's lead list named the
> resorts; every value below was read on the operator's own site or an official source (NRCS AWDB, the pass
> operators' resort lists, Wikidata for Q-ids), and every cam embed was verified the way the P8 gap audit did
> (`docs/cams/gap-audit-2026-10-18.md`, section 1): YouTube oEmbed 200; image GET 200 `image/*` with no Referer
> and no cache-buster; iframe 200 with no `X-Frame-Options` and no restrictive `frame-ancestors`. Verification
> timestamps are 2026-10-20 02:3x to 03:0x UTC. Rows live in `data/resorts.csv`, `data/cams.csv`,
> `data/resort-profiles.csv`, `data/resort-openings.csv`; new NRCS triplets in `lib/public-api/stations.json`.
>
> **Station rule** (plan section 2, P1): `snotel_station_id` is the nearest *active* AWDB SNOTEL (`SNTL`)
> station within 25 km of the base and within 2,000 ft of the base elevation (the operator's base; the lead
> list's base where the operator publishes none). Nothing closer-but-higher is promoted; the P3 station layer
> assigns those by elevation band on its own. Near misses are listed at the end so a maintainer can override.
>
> Import on the mini: `npm run import-resorts:standalone` then `npx tsx scripts/import-profiles.ts` and
> `node scripts/seed-resort-openings.mjs`; a deploy must follow before `/resorts/{slug}` exists
> (`dynamicParams = false`).

## Result

| | Count |
| --- | ---: |
| Resorts added (CO 4, UT 4, WY 7, MT 8, ID 5, NM 3, AZ 1, NV 1, AK 2, SD 1) | 36 |
| Cam rows added (19 resorts; 24 image, 19 iframe, 7 YouTube) | 50 |
| Resorts with a qualifying SNOTEL station | 32 |
| Resorts with neither cam nor station | 0 |
| Profile rows (`data/resort-profiles.csv`) | 36 (passes verified on the Ikon, Mountain Collective, Indy and Power Pass lists; 30 with a Wikidata Q-id, 25 on a multi-resort pass) |
| Opening rows (`data/resort-openings.csv`, operator-announced 2026-27 dates) | 11 |
| New triplets in `lib/public-api/stations.json` | 29 |

Beartooth Basin moved from the lead list's MT to WY (the operator places it in Wyoming; it is also summer-only).
Terry Peak (SD) rides along because its SNOTEL match was already computed with this batch.

## Needs the user

- **Terms holds (cams verified, not added):** Aspen Mountain, Aspen Highlands and Buttermilk (Aspen Skiing
  Company terms forbid framing "our Sites" in so many words, although the feeds sit on roundshot.com and
  ipcamlive.com, not on aspensnowmass.com) and Great Divide (its Terms of Use ban "unauthorized framing of or
  linking to the Site"; the summit cam is the operator's own YouTube live `eoPlP2Rians`). The verified embeds
  are listed under each resort; flipping the decision is a `data/cams.csv` append.
- **Alyeska stills** (nine `webcamsfolder/*.jpg`) were last modified 2026-10-07, after summer operations ended;
  the two Roundshot panoramas are live. Re-check after the 2026-11-28 opening and let `cam-health` decide.
- **Sandia Peak:** the ski area (sandia.ski, Mountain Capital Partners) and the Tramway (sandiapeak.com) are
  separate operators; the two JPEG cams are the Tramway's and are credited to it. The ski area sells 2026-27
  passes but has not announced an opening date and was closed for skiing in recent seasons.
- **Re-check after opening day:** Silver Mountain's five own cams (`cams.silvermt.com:444` refused connections
  on 2026-10-20), Soldier Mountain's snow cam (Cloudflare-challenged to non-browser fetches), Lost Trail's
  Chair 1 Nest cam (off-grid, in-season only), Pebble Creek's YouTube live, Cherry Peak's iXnay streams,
  Lee Canyon's HD Relay player (404), Eagle Point's IPCamLive players (operator's plan does not allow embedding).
- **Maverick Mountain:** the operator's Instagram (Sept to Oct 2026) says the Sand Creek Fire burned inside
  the boundary and the only chairlift is "most likely inoperable" for 2026-27; the row is active with a
  station and no cam.

### aspen-highlands  (CO, Elk Mountains)
Operator: https://www.aspensnowmass.com/four-mountains/aspen-highlands  |  cams: https://www.aspensnowmass.com/four-mountains/mountain-cams
- coords 39.1811, -106.8560; base/summit 8040 / 12392 ft; station 658:CO:SNTL Nast Lake 8710 ft at 25.0 km; passes ikon|mountain-collective; wikidata Q4807815
- Opening 2026-27: 2026-12-12 (projected) — https://www.aspensnowmass.com/four-mountains/aspen-highlands
- **No cams added: terms hold.** https://www.aspensnowmass.com/aspen-snowmass-app/terms-and-conditions — "Under no circumstances may you "frame" any of our Sites or copy portions of our Sites to a server, except as part of an Internet service provider's incidental caching of pages. When a page of any of our Sites is accessed from a link (including RSS feeds) featured on your web site, each page within o". Verified embeds, for the maintainer's decision:
  - Aspen Highlands (Roundshot panorama): https://aspen.roundshot.com/highlands/
  - Aspen Highlands Snow Stake: https://g3.ipcamlive.com/player/player.php?alias=5fb419457d74f
  - skipped: Aspen Highlands - Exhibition Line — Verkada live player (command.verkada.com/embed.html) domain-locked to *.aspensnowmass.com; not embeddable off-site
- Notes: TERMS HOLD: the aspensnowmass.com footer 'Terms and Conditions' link resolves to Aspen Skiing Company's own terms (not the generic Alterra page assumed in the brief) and they forbid framing of 'our Sites' in so many words, so all cams are listed under skipped_cams with full verified embed data. Maintainer judgement call: the feeds themselves are hosted on third-party domains (aspen.roundshot.com, gX.ipcamlive.com), not on aspensnowmass.com; and backend.roundshot.com/cams/<id>/medium is a plain JPEG (302 to a time-stamped image, 200 image/jpeg with -L). Alterra's generic terms at https://www.alterramtn.co/en/terms-of-use (200) contain no framing clause. Site is Sitecore (server-rendered; curl with browser UA works). Cams page lists per-mountain Roundshot panoramas, per-mountain ipcamlive snow-stake players (on sub-pages), and Verkada live-video players that are domain-locked to *.aspensnowmass.com (not embeddable elsewhere). Snowmass cams deliberately omitted (already in PeakCam). Aspen Snowmass publishes no mountain-stats page; elevations below come from individual operator pages (noted per field). Ikon and Mountain Collective both list 'Aspen Snowmass' covering all four mountains. Coordinates from Wikidata P625 (base areas), within 0.5 km of lead.
- Profile notes: Summit 12,392 ft is hike-to Highland Bowl peak; lift-served top (Loge Peak) is 11,675 ft. Vertical 3,635 ft is lift-served (base to Loge Peak). Runs/lifts/acres/snowfall not published on operator site -> null (lead: 1040 acres / 300 in). Trail map is the 2025-26 PDF.

### aspen-mountain  (CO, Elk Mountains)
Operator: https://www.aspensnowmass.com/four-mountains/aspen-mountain  |  cams: https://www.aspensnowmass.com/four-mountains/mountain-cams
- coords 39.1864, -106.8190; base/summit 7945 / 11212 ft; station 658:CO:SNTL Nast Lake 8710 ft at 21.9 km; passes ikon|mountain-collective; wikidata Q4807834
- Opening 2026-27: 2026-11-26 (projected) — https://www.aspensnowmass.com/four-mountains/aspen-mountain
- **No cams added: terms hold.** https://www.aspensnowmass.com/aspen-snowmass-app/terms-and-conditions — "Under no circumstances may you "frame" any of our Sites or copy portions of our Sites to a server, except as part of an Internet service provider's incidental caching of pages. When a page of any of our Sites is accessed from a link (including RSS feeds) featured on your web site, each page within o". Verified embeds, for the maintainer's decision:
  - Aspen Mountain (Roundshot panorama): https://aspen.roundshot.com/aspen/
  - Aspen Mountain Snow Stake: https://g1.ipcamlive.com/player/player.php?alias=5c8193f8ba576
  - Power of Four (Roundshot panorama): https://aspen.roundshot.com/power-of-four/
  - skipped: Aspen Mountain - Silver Queen Line — Verkada live player (command.verkada.com/embed.html) domain-locked to *.aspensnowmass.com; not embeddable off-site
- Notes: TERMS HOLD: the aspensnowmass.com footer 'Terms and Conditions' link resolves to Aspen Skiing Company's own terms (not the generic Alterra page assumed in the brief) and they forbid framing of 'our Sites' in so many words, so all cams are listed under skipped_cams with full verified embed data. Maintainer judgement call: the feeds themselves are hosted on third-party domains (aspen.roundshot.com, gX.ipcamlive.com), not on aspensnowmass.com; and backend.roundshot.com/cams/<id>/medium is a plain JPEG (302 to a time-stamped image, 200 image/jpeg with -L). Alterra's generic terms at https://www.alterramtn.co/en/terms-of-use (200) contain no framing clause. Site is Sitecore (server-rendered; curl with browser UA works). Cams page lists per-mountain Roundshot panoramas, per-mountain ipcamlive snow-stake players (on sub-pages), and Verkada live-video players that are domain-locked to *.aspensnowmass.com (not embeddable elsewhere). Snowmass cams deliberately omitted (already in PeakCam). Aspen Snowmass publishes no mountain-stats page; elevations below come from individual operator pages (noted per field). Ikon and Mountain Collective both list 'Aspen Snowmass' covering all four mountains. Coordinates from Wikidata P625 (base areas), within 0.5 km of lead.
- Profile notes: Operator publishes no stats page; runs/lifts/acres/snowfall not stated on aspensnowmass.com so left null (lead list had 675 acres / 300 in). Summit 11,212 ft from the Sundeck restaurant blurb; vertical 3,267 ft from the uphilling guide; base derived. Trail map is the 2025-26 PDF (2026-27 not yet posted).

### buttermilk  (CO, Elk Mountains)
Operator: https://www.aspensnowmass.com/four-mountains/buttermilk  |  cams: https://www.aspensnowmass.com/four-mountains/mountain-cams
- coords 39.2050, -106.8610; base/summit — / — ft (operator publishes none); station 658:CO:SNTL Nast Lake 8710 ft at 24.1 km; passes ikon|mountain-collective; wikidata Q5003005
- Opening 2026-27: 2026-12-12 (projected) — https://www.aspensnowmass.com/four-mountains/buttermilk
- **No cams added: terms hold.** https://www.aspensnowmass.com/aspen-snowmass-app/terms-and-conditions — "Under no circumstances may you "frame" any of our Sites or copy portions of our Sites to a server, except as part of an Internet service provider's incidental caching of pages. When a page of any of our Sites is accessed from a link (including RSS feeds) featured on your web site, each page within o". Verified embeds, for the maintainer's decision:
  - Buttermilk (Roundshot panorama): https://aspen.roundshot.com/buttermilk/
  - Buttermilk Snow Stake: https://g1.ipcamlive.com/player/player.php?alias=613a4e47724d8
  - skipped: Buttermilk - Summit Express Line — Verkada live player (command.verkada.com/embed.html) domain-locked to *.aspensnowmass.com; not embeddable off-site
- Notes: TERMS HOLD: the aspensnowmass.com footer 'Terms and Conditions' link resolves to Aspen Skiing Company's own terms (not the generic Alterra page assumed in the brief) and they forbid framing of 'our Sites' in so many words, so all cams are listed under skipped_cams with full verified embed data. Maintainer judgement call: the feeds themselves are hosted on third-party domains (aspen.roundshot.com, gX.ipcamlive.com), not on aspensnowmass.com; and backend.roundshot.com/cams/<id>/medium is a plain JPEG (302 to a time-stamped image, 200 image/jpeg with -L). Alterra's generic terms at https://www.alterramtn.co/en/terms-of-use (200) contain no framing clause. Site is Sitecore (server-rendered; curl with browser UA works). Cams page lists per-mountain Roundshot panoramas, per-mountain ipcamlive snow-stake players (on sub-pages), and Verkada live-video players that are domain-locked to *.aspensnowmass.com (not embeddable elsewhere). Snowmass cams deliberately omitted (already in PeakCam). Aspen Snowmass publishes no mountain-stats page; elevations below come from individual operator pages (noted per field). Ikon and Mountain Collective both list 'Aspen Snowmass' covering all four mountains. Coordinates from Wikidata P625 (base areas), within 0.5 km of lead.
- Profile notes: No base/summit/vertical/acreage/snowfall found anywhere on aspensnowmass.com for Buttermilk (only a Tiehack uphill route gain of 1,683 ft, which is not the full mountain) -> all null rather than guessed. Lead list: 2399 m / 3018 m, 470 acres, 200 in. Trail map is the 2025-26 PDF.

### silverton  (CO, San Juan Mountains)
Operator: https://silvertonmountain.com  |  no cam page
- coords 37.8847, -107.6650; base/summit 10400 / 13487 ft; station 713:CO:SNTL Red Mountain Pass 11060 ft at 4.4 km; passes none; wikidata Q7516849
- Opening 2026-27: 2026-12-31 (projected), closing 2027-04-11 — https://silvertonmountain.com/mountain/schedule/
- No cams added.
- Notes: WordPress. Guided/expert-only operation with one double chair; avalanche gear required. No webcam anywhere on the operator site (homepage, /mountain/, /mountain/snow-report/, /mountain/stats/ checked); the 'snow stake cam' is posted only as Instagram photos. Only a privacy policy is linked (no terms of use), so verdict none.
- Profile notes: Stats page: 'Chairs: 1 double', 'Annual snowfall: 400"+', 'Lift Serviced Vertical Drop: 1,900' (hike-to & heli vertical 3,887), 'Skiable acres: 26,819' (includes heli terrain; 1,819 lift/hike acres per the same page's terrain text, used here). No cut runs -> runs_total null. Not on Indy (Indy's 'Silverton, CO' entry is Kendall Mountain), Ikon, MC, Epic or Power Pass.

### beaver-mountain  (UT, Bear River Range)
Operator: https://www.skithebeav.com  |  cams: https://www.skithebeav.com/mountain/conditions/
- coords 41.9683, -111.5420; base/summit 7160 / 8860 ft; station 1115:UT:SNTL Klondike Narrows 7280 ft at 4.6 km; passes indy; wikidata Q4878141
- Added 2 cam(s):
  - Lodge View Cam (iframe, base) `https://g1.ipcamlive.com/player/player.php?alias=lodgedreamliftcam&autoplay=1` credit Beaver Mountain Ski Resort
  - Little Beaver View (iframe, base) `https://g1.ipcamlive.com/player/player.php?alias=littlebeavercam&autoplay=1` credit Beaver Mountain Ski Resort
  - skipped: Parking Lot Cam (alias beaverparkinglot) — ipcamlive player says 'Camera is not available'; snapshot.php 404 (offline 2026-10-20)
  - skipped: Cabin Cam — the page's 'Cabin Cam' tile embeds the same alias as Little Beaver View (littlebeavercam); duplicate, not a distinct feed
- Notes: WordPress site. Cams are IPCamLive players (g1.ipcamlive.com, lazy-loaded via data-lazy-src with skin/autoplay params stripped). Operator gives season dates only as 'Mid December to early April, conditions permitting' (no 2026-27 opening date). Terms page is generic purchase/site terms, no framing clause.
- Profile notes: Operator 'Mountain Stats': 828 acres, 400+ in average snowfall, 1700 ft vertical, summit 8,860' (top of Harry's Dream; Marge's Triple 8,600'), 48 runs. Base elevation is NOT published; 7160 derived as summit minus vertical. Lifts = 4 fixed-grip chairs (Marge's Triple, Harry's Dream, Beaver's Face, Little Beaver) + 2 surface conveyors. Indy Pass list includes Beaver Mountain.

### cherry-peak  (UT, Bear River Range)
Operator: https://www.skicpr.com  |  cams: https://www.ixnay.net/cams/cherrypeak/index.php
- coords 41.9264, -111.7567; base/summit 5775 / 7040 ft; station 1115:UT:SNTL Klondike Narrows 7280 ft at 14.0 km; passes indy; wikidata Q28450459
- No cams added.
  - skipped: Cherry Peak Webcams Live Stream (YouTube j-OMS-fRd7I, iXnay Networks channel UCEdlqlZbczmtUSDa4HCnAXg) — oembed 200 but not live: channel/live canonical resolves to the channel, watch page liveBroadcastDetails isLiveNow=false, last broadcast ended 2021-03-03. Re-check at season opening.
  - skipped: Cherry Peak Live Snowcat Webcam (YouTube MqnTYz-RfBE, channel UCM3kNQE8tPUOk9LZiWsPBYQ) — oembed 200 but isLiveNow=false; last broadcast ended 2025-01-22
  - skipped: Vista Cam still (https://www.ixnay.net/cams/cp/current.jpg) — GET 404
  - skipped: Snowcat Cam still (https://www.ixnay.net/cams/cp/snowcat/current.jpg) — GET 200 image/jpeg 70 KB but Last-Modified 2025-03-09 (dead)
- Notes: The domain in the lead hint (skicherrypeak.com) now serves only a LiteSpeed directory index; the operator's live site is skicpr.com (Wix, JS-rendered; stats page needed a rendered fetch). Cams are hosted by a third party (iXnay Networks, Raspberry Pi cams) and linked from the operator's nav as 'Live Web Cams'; every feed was offline/stale on 2026-10-20 (pre-season), so cams is empty. No website terms page exists; only 'Mountain Policies' (https://www.skicpr.com/mountain-policies) and reciprocal-pass terms. 2026/27 season passes on sale but no opening date announced.
- Profile notes: Operator stats page: base 5775 ft / 1760 m, summit 7040 ft / 2146 m, vertical 1265 ft (intro text says 1221), '220 + acres' skiable (lead list said 400), 320 in snowfall, 'three triple chair lifts plus a magic carpet' = 4 lifts. Run count and longest run not published. Indy Pass resort list includes Cherry Peak.

### eagle-point  (UT, Tushar Mountains)
Operator: https://www.eaglepointresort.com  |  cams: https://www.eaglepointresort.com/mountain-conditions/#mountain-cams
- coords 38.3226, -112.3762; base/summit 9100 / 10600 ft; station 339:UT:SNTL Big Flat 10320 ft at 2.9 km; passes indy; wikidata —
- No cams added.
  - skipped: Skyline Lift Top (ipcamlive alias 5c64b6b8dfe34) — player.php returns an IPCamLive error page: 'This camera cannot be embedded. Switch to Standard or Professional package.' (both with and without an eaglepointresort.com Referer); snapshot.php 404. Not embeddable off-site
  - skipped: Monarch Lift (ipcamlive alias 5dfd3048669e2) — same IPCamLive 'cannot be embedded' page; snapshot.php 404
  - skipped: Delano's Drop (ipcamlive alias canyonsidelower) — same IPCamLive 'cannot be embedded' page; snapshot.php 404
- Notes: WordPress/Elementor. The Mountain Conditions page embeds three IPCamLive iframes (g1.ipcamlive.com/player/player.php?alias=...), but IPCamLive serves an embed-blocked page for all three (free-tier account), so there is no usable feed; cams is empty. Referer test: 5c64b6b8dfe34:[<title>IPCamLive - Live camera page cannot be embedded ] 5dfd3048669e2:[<title>IPCamLive - Live camera page cannot be embedded ] canyonsidelower:[<title>IPCamLive - Live camera page cannot be embedded ]. Terms and Conditions page is generic (no framing/hot-linking clause). No 2026-27 opening date on the home or conditions page.
- Profile notes: Operator Mountain Stats: 9,100' base, 10,600' summit, 1500' vertical, 600 lift-served skiable acres, 350"+ annual snowfall, 5 lifts, 43 named runs (13 advanced/19 intermediate/11 beginner). Longest run not published. Indy Pass list includes Eagle Point. No Wikidata item found for the ski area (wbsearchentities 'Eagle Point Resort' / 'Eagle Point ski area' return nothing relevant). Trail map exists only as a teaser image; no dedicated page found (/trail-map/ 404).

### nordic-valley  (UT, Northern Wasatch)
Operator: https://www.nordicvalley.ski  |  cams: https://www.nordicvalley.ski/nordic-valley-weather-conditions-webcams/
- coords 41.3099, -111.8652; base/summit 5365 / 7060 ft; station 333:UT:SNTL Ben Lomond Trail 5970 ft at 9.4 km; passes power; wikidata —
- Added 1 cam(s):
  - Nordic Valley Webcam (youtube, base, 5440 ft) `https://www.youtube.com/embed/Ljumxb0U2b0` credit Nordic Valley Ski Resort
- Notes: WordPress (MCP multisite shared with Lee Canyon). Single YouTube live embed captioned 'ALTITUDE: 5,440 FEET | VIEW FROM THE BOTTOM OF CROCKETT LIFT'. Website terms of use contain a generic no-robot/spider clause (ok). 'Opening Day Updates' blog last entry is Jan 2026 (previous season); no 2026-27 date announced.
- Profile notes: Operator: Base 5,365'; Apollo lift top 6,330'; Nordic Express top 7,060' (used as summit); total vertical rise 1,700'; 40 runs (8 green/12 blue/15 black/5 double black); 5 lifts. Acres, snowfall and longest run not published by the operator. Power Pass (thepowerpass.ski, Mountain Capital Partners) lists Nordic Valley. No Wikidata item for the ski area found (Q7050730 is the unincorporated community).

### antelope-butte  (WY, Bighorn Mountains)
Operator: https://www.skiantelopebutte.com  |  cams: https://www.skiantelopebutte.com/weather-reports
- coords 44.6115, -107.5144; base/summit 8400 / 9400 ft; station 358:WY:SNTL Bone Springs Div 9340 ft at 9.2 km; passes indy; wikidata —
- Added 1 cam(s):
  - Pow Stick Webcam (iframe, snow-stake) `https://ipcamlive.com/player/player.php?alias=antelopebuttepowstick&autoplay=1` credit Antelope Butte Foundation
- Notes: Squarespace site; antelopebutte.org redirects to www.skiantelopebutte.com. Operated by the non-profit Antelope Butte Foundation under a Bighorn NF special-use permit. The weather page links (not embeds) the cam at https://www.ipcamlive.com/antelopebuttepowstick, which itself sends X-Frame-Options: SAMEORIGIN, so the IPCamLive player URL is used for the iframe; the alias 'powstick' and the operator's 'Daily Report' context suggest a snow-stake cam (kind set accordingly). Image-type alternative: the snapshot.php alias URL (302 to an s94.ipcamlive.com stream snapshot). Opening: homepage says 'Thank you for a great season! Reopening in December!' with no date; normal operating hours listed as Wed-Sun Jan 7-May 29. No terms page linked. YouTube channel UCMUNDHk5KVEilcpWe3B4cWA linked from the site.
- Profile notes: Operator QUICK FACTS: Lift Accessed Summit 9,400 ft; Hike-To Summit (not patrolled) 9,953 ft; Base 8,400 ft; 1,000 ft lift-accessed vertical; 'Permitted area for recreation: 500 acres' (permit area, not stated skiable acres); Lifts 3; Trails '30+' (not an exact count, so runs_total null). Annual snowfall not published by the operator. Indy Pass confirmed on indyskipass.com/our-resorts; operator also sells an 'IndyPass Add-On'. Trail map image (2020) linked from /maps.

### beartooth-basin  (WY, Beartooth Range)
Operator: https://beartoothbasin.com  |  no cam page
- coords 44.9755, -109.4353; base/summit — / — ft (operator publishes none); station 326:WY:SNTL Beartooth Lake 9360 ft at 11.0 km; passes none; wikidata Q48804084
- No cams added.
- Notes: SUMMER-ONLY ski area on the Beartooth Pass (US-212), operated by Red Lodge International Summer Racing Camp, Inc. under a Shoshone National Forest permit; 2026 lift tickets were sold for late June dates, so the 2026 season is over and there is no 2026-27 winter season (opening=null). Squarespace site; no webcam anywhere (home, Basin, Conditions, Media, Contact pages) - conditions page points to Snoflo/NOAA weather and to Facebook/Instagram; the lead list's '2 cams' are not on the operator site. STATE CHANGED from lead 'MT' to 'WY': the operator says the area is in Wyoming (mailing address is Red Lodge, MT). Coordinates moved ~3.7 km from the lead (45.006,-109.452) to the Wikidata/OSM position on the Wyoming side; flagging the move. Wikidata P31 is Q3034650 (summer ski area / ski resort variant).
- Profile notes: Operator: 'perched ... at roughly 10,900 ft', 'two high-speed platter lifts', 'Twin Lakes Headwall provides 600 acres', pitches 15-50 degrees; 'surrounding areas offer 3,000 vertical feet of shuttled or hike-in backcountry' (not lift-served, so vertical left null). No runs count, snowfall, longest run or trail map published. Not on any of the pass lists.

### grand-targhee  (WY, Teton Range)
Operator: https://www.grandtarghee.com  |  cams: https://www.grandtarghee.com/the-mountain/cams-conditions/webcams
- coords 43.7887, -110.9577; base/summit 7851 / 9920 ft; station 1082:WY:SNTL Grand Targhee 9260 ft at 2.6 km; passes mountain-collective; wikidata Q5595130
- Opening 2026-27: 2026-11-20 (projected), closing 2027-04-18 — https://www.grandtarghee.com/the-mountain/mountain-information/mountain-stats
- Added 5 cam(s):
  - Dreamcatcher (image) `https://copyrighted.seejh.com/gtrdream/gtrdream.jpg` credit Grand Targhee Resort
  - Stick Of Truth (image, snow-stake) `https://copyrighted.seejh.com/gtrsnowstick/gtrsnowstick.jpg` credit Grand Targhee Resort
  - Summit (image, summit) `https://copyrighted.seejh.com/gtrsummit/gtrsummit.jpg` credit Grand Targhee Resort
  - Habitat / Colter (image, base) `https://copyrighted.seejh.com/gtrcolter/gtrcolter.jpg` credit Grand Targhee Resort
  - Teton Valley View (image) `https://copyrighted.seejh.com/tetonvalley/tetonvalley.jpg` credit Grand Targhee Resort (image hosted by SeeJH; may be a SeeJH-owned valley cam)
  - skipped: Plaza — stale image: https://copyrighted.seejh.com/gtrplaza/gtrplaza.jpg Last-Modified 2026-10-15T17:16Z (4 days old while resort is closed for the fall off-season); re-check after 2026-11-20 opening
- Notes: Drupal 11 site. Webcam page is server-rendered but the <img> tags use lazyload data-src; six JPEGs on copyrighted.seejh.com with a ?v= cache-buster (stripped). Page description also mentions town and Teton Pass cams but only these six appear. Stick of Truth is 'not an official snow measurement', cleared daily 9am in winter. Terms are generic no-reproduction boilerplate (no framing/embedding clause). Socials from footer: Facebook, Instagram, Twitter, LinkedIn, YouTube (youtube.com/user/GrandTargheeResort).
- Profile notes: Operator stats: 2,602 acres, 500+ in snowfall, 2,270 ft vertical drop, base 7,851 ft, 6 lifts, longest run 2.7 mi (Teton Vista Traverse). Summit 9,920 ft is Mary's Nipple (in-bounds hike-only); Fred's Mountain lift summit 9,862 ft, Peaked Mountain 9,830 ft. Run count not on the stats page. Mountain Collective confirmed on mountaincollective.com/resorts; Grand Targhee is NOT on the 2026-27 Ikon destinations list (ikonpass.com/en/destinations, checked 2026-10-20) and the operator's pass menu only lists Mountain Collective. Trail map PDF: /sites/default/files/2026-10/GRAND%20TARGHEE-01.1%2009242026forWEB_0.pdf

### meadowlark  (WY, Bighorn Mountains)
Operator: https://www.meadowlarklodge.com  |  no cam page
- coords 44.1640, -107.2155; base/summit — / — ft (operator publishes none); station 703:WY:SNTL Powder River Pass 9480 ft at 7.1 km; passes none; wikidata —
- No cams added.
- Notes: The hinted domain meadowlarkskilodge.com does not respond (connection failure, http and https). The operator site is now https://www.meadowlarklodge.com (Wix), branded 'Meadowlark | Bighorn National Forest' / 'Meadowlark, by MAS Tierra'; homepage: 'Now part of MAS Tierra, Meadowlark will reopen Winter 2026/2027' with season passes on sale but no opening date announced (opening left null). Site pages per sitemap: /, /home, /seasonpasses, /careers, /tellyourstory. No webcam anywhere on the site and no terms page. Historic name 'Meadowlark Ski Lodge' (used by USFS/Facebook) may be the better display name.
- Profile notes: Operator site publishes no mountain stats, trail map or elevations (only lodge/season-pass marketing). Not on Indy, Ikon, Mountain Collective or Powder Alliance lists. For reference only (NOT used, not operator data): the Bighorn NF page fs.usda.gov/r02/bighorn/recreation/meadowlark-ski-lodge lists 2 lifts, 20 runs, 800 ft vertical, 200 acres.

### sleeping-giant  (WY, Absaroka Range)
Operator: https://skisg.com  |  cams: https://skisg.com/conditions-maps
- coords 44.4923, -109.9413; base/summit — / — ft (operator publishes none); station 807:WY:SNTL Sylvan Road 7140 ft at 7.8 km; passes none; wikidata —
- No cams added.
  - skipped: Sheepeater webcam — dead: https://webcams.skisg.com/SGSheepeater.jpg - HTTPS fails (TLS certificate expired, curl exit 60); over plain http it returns image/jpeg 108 KB with Last-Modified 2024-06-15 (16 months old)
  - skipped: SGwebcam1 — dead: https://webcams.skisg.com/SGwebcam1.jpg - HTTPS fails (TLS certificate expired); over http Last-Modified 2023-12-22 (almost 3 years old)
- Notes: Squarespace site ('Sleeping Giant Ski & Zip'). Conditions page says 'Current epic view from Sheepeater!' and embeds two images from webcams.skisg.com plus a WeatherLink weather iframe, but both images are stale and the host's TLS cert is expired, so no cam is importable; re-check once the operator fixes the host. No 2026-27 opening date on the site. Terms page is generic (no framing/embedding clause).
- Profile notes: Operator site publishes no elevations, acreage, vertical, snowfall or lift/run counts (About page is narrative only; the conditions page's SnoCountry widget is empty and dated 2023). Not on Indy/Ikon/Mountain Collective/Powder Alliance lists (checked 2026-10-20).

### snowy-range  (WY, Snowy Range)
Operator: https://snowyrangeski.com  |  cams: https://snowyrangeski.com/webcams/
- coords 41.3409, -106.1844; base/summit 8798 / 9663 ft; station 367:WY:SNTL Brooklyn Lake 10250 ft at 4.4 km; passes none; wikidata Q7548753
- Opening 2026-27: 2026-12-04 (projected), closing 2027-04-11 — https://snowyrangeski.com/
- Added 5 cam(s):
  - Snow Cam (iframe, snow-stake) `https://www.cameraftp.com/Camera/Cameraplayer.aspx?parentID=397142069&shareID=17935300&isEmbedded=true&mode=live` credit Snowy Range Ski Area
  - Base Webcam (iframe, base) `https://www.cameraftp.com/file/PublishCameraplayer.aspx?parentID=224864296&shareID=13751043&isEmbedded=true&mode=live` credit Snowy Range Ski Area
  - Sundance Webcam (iframe) `https://www.cameraftp.com/file/PublishCameraplayer.aspx?parentID=224855203&shareID=13750595&isEmbedded=true&mode=live` credit Snowy Range Ski Area
  - Chute Webcam (iframe) `https://www.cameraftp.com/file/PublishCameraplayer.aspx?parentID=224864295&shareID=13789949&isEmbedded=true&mode=live` credit Snowy Range Ski Area
  - Colt Webcam (iframe) `https://www.cameraftp.com/Camera/Cameraplayer.aspx?parentID=300668346&shareID=14584106&isEmbedded=true&mode=live` credit Snowy Range Ski Area
- Notes: WordPress site. Five CameraFTP (DriveHQ) embedded players on /webcams/; the Snow Cam is also embedded on /snow-report/. The player HTML fetches thumbnails from cameraftpapi.drivehq.com with a session id, so there is no stable still-image URL - iframe only, and whether each camera is currently uploading could not be confirmed headlessly (resort closed until Dec 4). Sundance/Chute/Colt are lift names; their position (base vs top) is not stated so kind left blank. Only a privacy policy, cancellation policy and drone policy are linked - no terms of use.
- Profile notes: Homepage 'Fun Facts': annual snowfall 250 in, base 8,798 ft, summit 9,663 ft, skiable area 250 acres; homepage copy: '30 trails, and 990 feet of vertical' (summit minus base is 865 ft - operator's 990 kept as stated). Lifts counted from the Lift Status table (Pioneer, The Colt, Chute, Sundance, Virginian); the trail report lists 33 named runs vs the marketing '30 trails'. Homepage announces an 'Ikon Pass Partnership' but it is a season-passholder add-on (Ikon Session Pass 3-Day at 50% off); Snowy Range is NOT on the Ikon destinations list, so passes left empty. No trail-map file found on the site.

### white-pine  (WY, Wind River Range)
Operator: https://www.whitepineresort.com  |  no cam page
- coords 42.9774, -109.7578; base/summit 8500 / 9500 ft; station 468:WY:SNTL Elkhart Park G.S. 9410 ft at 3.2 km; passes indy; wikidata Q7995204
- Opening 2026-27: 2026-12-11 (projected), closing 2027-03-28 — https://www.whitepineresort.com/plan
- No cams added.
- Notes: whitepineski.com 301s to www.whitepineresort.com (new Squarespace site, Oct 2026). No webcam on any page (home, /plan 'Current Conditions', /explore, /play, /contact) - conditions section shows a temperature and links WYDOT wyoroad.info; cams: [] accordingly. Footer links Instagram only; 'Policies' footer item has no page. Google Maps short link on /plan (maps.app.goo.gl/KMUd1ib27y18P8zP9) did not expose coordinates.
- Profile notes: Operator /play page: 'Elevation: Base: 8,500 ft | Summit: 9,500 ft | Vertical: 1,000 ft; Terrain: 27 runs - 7 green - 9 blue - 11 black; Lifts: 2 chairs, 1 surface lift, tubing hill'. lifts_total=3 counts the surface lift (the /explore page says 'Two lifts', i.e. chairs). The /plan FAQ says '29 runs' in one answer; 27 kept as the stats figure. Snowfall not published. Indy Pass confirmed ('White Pine Resort' on indyskipass.com/our-resorts; distinct from White Pine Touring Nordic Center, UT).

### blacktail-mountain  (MT, Flathead Valley)
Operator: https://blacktailmountain.com  |  cams: https://blacktailmountain.com/blacktail-webcam/
- coords 48.0142, -114.3709; base/summit 5340 / 6780 ft; station 1144:MT:SNTL Blacktail Mtn 5660 ft at 3.7 km; passes none; wikidata Q4923451
- Added 1 cam(s):
  - Blacktail Webcam (iframe, summit, 6780 ft) `https://g1.ipcamlive.com/player/player.php?alias=olycam&autoplay=1` credit Blacktail Mountain Ski Area
- Notes: WordPress site. Single IPCamLive stream (alias olycam) embedded as an iframe; operator says 'Our webcam is located just outside of the Lodge and looks out over the top of the Olympic lift' - the lodge sits at the mountaintop (upside-down ski area), hence kind=summit at 6,780 ft. A snapshot image alternative exists via https://ipcamlive.com/player/snapshot.php?alias=olycam (302 to an s47.ipcamlive.com stream-id URL that may change; the player iframe is the stable form). Site says 'We're getting ready for winter! Opening is weather and conditions dependent' for the 26/27 season - no date. No terms page linked. Lead list said 1 cam - matches.
- Profile notes: Operator: average annual snowfall 250 in (100% natural); 'over 1000 acres' (recorded 1000); 1,440 ft vertical; top elevation 6,780 ft; longest run 1.75 mi; chairlifts Thunderhead (double), Olympic (triple), Crystal (double) + Magic Carpet = 4 lifts; lift capacity 3,900/hr. Base (bottom) elevation derived as top minus vertical (5,340 ft); note the lodge/parking are at the TOP. Run count not published. No trail-map page found in the nav. Listed on powderalliance.com (not in the pass set); not on Indy/Ikon/Epic/MC/Power lists.

### discovery  (MT, Flint Creek Range)
Operator: https://www.skidiscovery.com  |  cams: https://www.skidiscovery.com/
- coords 46.2496, -113.2385; base/summit 5770 / 8158 ft; station 930:MT:SNTL Peterson Meadows 7190 ft at 14.8 km; passes none; wikidata Q5281969
- Added 4 cam(s):
  - Top Overview (image, summit, 8158 ft) `https://webcam.skidiscovery.com/webcam-images/top-overview/top-overview/top-overview-webcam.jpg` credit Discovery Ski Area
  - OD Front (image, base, 5770 ft) `https://webcam.skidiscovery.com/webcam-images/od-front/od-front/od-front-webcam.jpg` credit Discovery Ski Area
  - Base Stake (image, snow-stake, 5770 ft) `https://webcam.skidiscovery.com/webcam-images/base-stake/base-stake/base-stake-webcam.jpg` credit Discovery Ski Area
  - Top Stake (image, snow-stake, 8158 ft) `https://webcam.skidiscovery.com/webcam-images/top-stake/top-stake/top-stake-webcam.jpg` credit Discovery Ski Area
- Notes: WordPress site. Cams live in a 'WEBCAMS' header dropdown present on every page (no dedicated /webcams/ page; it 404s), so cam_page_url is the homepage. Operator text: images update every 30 minutes, taken from 'the deck of the Ski Patrol building, front of the base lodge, top of the Anaconda Chairlift, and top of the Rumsey Chairlift'. Cam names are the operator's alt labels; elevations are the operator's summit/derived base figures and are approximate placements (top cams = top of lifts, OD Front/Base Stake = base lodge). Image URLs are stable (no cache-buster). Hours page says 'Winter Season Early Dec Weather Permitting - April 4', no specific 2026-27 opening date. No terms page linked. Wikidata P625 (46.2564,-113.242) is ~800 m from the operator's own map pin; kept the operator pin.
- Profile notes: Operator Mountain Stats: total patrolled area 2,200 acres; vertical drop 2,388 ft; summit 8,158 ft; longest run 1.5 mi (Winning Ridge); annual snowfall 215 in; 67 trails; lifts '5 triples, 2 doubles, 1 surface' = 8. Base elevation derived as summit minus vertical (5,770 ft). Trail map images: /wp-content/uploads/2019/05/TrailMap.jpg and /wp-content/uploads/2017/11/Frontside_map-2_LG.jpg. Not on Indy/Ikon/Epic/MC/Power lists.

### great-divide  (MT, Continental Divide)
Operator: https://www.skigd.com  |  cams: https://www.skigd.com/webcam
- coords 46.7531, -112.3135; base/summit 5830 / 7330 ft; station 903:MT:SNTL Nevada Ridge 7030 ft at 17.8 km; passes none; wikidata Q5599069
- Opening 2026-27: 2026-11-28 (projected) — https://www.skigd.com/hours-of-operations
- **No cams added: terms hold.** https://www.skigd.com/terms-of-use — "Engage in unauthorized framing of or linking to the Site.". Verified embeds, for the maintainer's decision:
  - GD Ski Cam (summit; YouTube live eoPlP2Rians via camstreamer.com/embed/V5dtB7F32kI4jhHMa3D48QS7T9c6utjsgGwMiw1C): terms forbid: Terms of Use prohibit 'unauthorized framing of or linking to the Site'. Embed itself is fine technically: camstreamer 302 -> youtube.com/embed/eoPlP2Rians, oEmbed 200 2026-10-20T02:50Z, title 'Great Divide Ski Area Summit Webcam', channel @greatdivide7602 (operator-owned YouTube stream) - needs operator permission or a maintainer decision
  - GD Ski Cam (Verkada embed vauth.command.verkada.com/embed/html/27d62ae1-5f0b-49ab-b4ee-302011263baa/): Verkada embed link is domain-locked to skigd.com,*.skigd.com (302 to command.verkada.com/embed.html with domains param); not embeddable elsewhere, plus the terms hold above
- Notes: Framer-built site, but the raw HTML already contains the iframes. Webcam page has two embeds labelled 'GD Ski Cam': (1) camstreamer.com embed that redirects to the YouTube live stream eoPlP2Rians ('Great Divide Ski Area Summit Webcam', kind summit, credit Great Divide Ski Area) and (2) a Verkada command embed that is domain-restricted. Page note: 'The patio is now heated, therefore snow will not accumulate on the patio'. Terms of Use (termly-style, dated 2022-12-07) list 'Engage in unauthorized framing of or linking to the Site' among prohibited activities, so per the brief the cams are held; a maintainer may judge that embedding the operator's own public YouTube stream (governed by YouTube ToS) is not 'framing of the Site', or ask the operator. No social links anywhere in the site HTML (footer has none). Opening day Nov 28, 2026 is explicitly tentative.
- Profile notes: Operator Mountain Guide: '5 chairlifts + 1 rope tow' (6), '6 terrain parks', '1,500 acres', '100+ trails' (recorded as 100), '1,500 ft vertical', '7,330 ft summit'. Base derived as summit minus vertical (5,830 ft). Annual snowfall and longest run not published. Wikidata entry is labelled 'Great Divide Snowsports' (Q5599069, P31 ski area, Montana). Not on Indy/Ikon/Epic/MC/Power lists.

### lost-trail  (MT, Bitterroot Mountains)
Operator: https://losttrail.com  |  cams: https://losttrail.com/snow-report/
- coords 45.6918, -113.9523; base/summit — / — ft (operator states '7,000 feet' for the area but no base/summit pair; left blank); station 727:MT:SNTL Saddle Mtn. 7890 ft at 1.2 km; passes indy; wikidata Q6684278
- No cams added.
  - skipped: Chair 1 Web Cam — Nest embed //video.nest.com/embedded/live/hZpTGj8LaK returns 'Live Not Found' (HTTP 408) on 2026-10-20T02:35Z; the operator says the mountainside camera near Chair 1 only runs when Lost Trail is in operation (off-grid, p
- Notes: WordPress site (Blue Dogs Media). Snow-report page still shows the March 30, 2026 season-wrap post; no 2026-27 opening date announced on the home, news or snow-report pages, so opening is null. The YouTube id pdO4yYASASY on the snow-report page is a promo video, not a cam. No terms-of-use page is linked; only a privacy policy (https://losttrail.com/privacy-policy/) and mountain policies (https://losttrail.com/lost-trail-policies/), neither of which mentions framing/embedding. Operator name on site is 'Lost Trail Ski Area'; Wikidata/Indy call it 'Lost Trail Powder Mountain'.
- Profile notes: Trail-map page: 69 trails, vertical 1,800 ft (550 m), 5 double chairs + 3 rope tows (lifts_total counts the 5 chairs, matching the snow report's 'Lifts Open 0/5'), longest run 1.2 mi (2 km), 'over 300 inches of snowfall every year'. Skiable acres not published. Base elevation taken from the about page's 'stands at an elevation of 7,000 feet' (not explicitly labelled base); summit not published (base + 1,800 ft vertical would imply ~8,800 ft but that is derived, so left null). Indy Pass lists it as 'Lost Trail Powder Mountain'.

### maverick-mountain  (MT, Pioneer Mountains)
Operator: https://www.skimaverick.com  |  cams: https://www.skimaverick.com/weather
- coords 45.4343, -113.1278; base/summit — / — ft (operator publishes none); station 656:MT:SNTL Mule Creek 8300 ft at 13.4 km; passes none; wikidata —
- No cams added.
  - skipped: Live Weather Cam (top of Maverick Mountain) — ipcamlive iframe https://g1.ipcamlive.com/player/player.php?alias=618713bdb981b answers 200 but https://g1.ipcamlive.com/player/snapshot.php?alias=618713bdb981b is 404 on 2026-10-20T02:51Z, i.e. no stream is currently pu
- Notes: Square Online (Weebly/editmysite) site; pages are JS-rendered, the webcam iframe lives in an embed-code block (found in the raw page JSON). IMPORTANT: the operator's Instagram feed embedded on the home page (Sept-Oct 2026 posts) says the Sand Creek Fire burned inside the ski-area boundary and 'our only chairlift sustained extensive damage and will most likely be inoperable for this coming ski season'; fundraisers are under way and 'our road forward is undefined'. Treat 2026-27 operations as uncertain. No terms or privacy page linked (Cookiebot banner only). Instagram feed also links a Facebook presence but no Facebook URL is on the site.
- Profile notes: About page: '24 Runs!', lifts = Riblet Double + MavKids Conveyor, 27/37/18/18% beginner/intermediate/advanced/expert. Weather page snow report: 'Annual Snowfall: 140"'. No elevations, acres, vertical or longest run published. Not on the Indy Pass Rockies/West lists (checked 2026-10-20); Ikon/Epic/MC/Power not applicable. No ski-area Wikidata item: Q107324338 is the 'Maverick Mountain' census-designated place and Q49048395 the peak, so wikidata_id left empty. The /mountain page is an image-only Square Online page with no extractable trail map.

### montana-snowbowl  (MT, Missoula)
Operator: https://montanasnowbowl.com  |  cams: https://montanasnowbowl.com/sbblog/base-web-cam/
- coords 47.0144, -113.9994; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q14704736
- Added 1 cam(s):
  - Base Web Cam (iframe, base) `https://g1.ipcamlive.com/player/player.php?alias=690b67247173f&autoplay=1` credit Montana Snowbowl
- Notes: WordPress site served under /sbblog/ (home 301s there). Alternative still-image URL for the same cam: https://g1.ipcamlive.com/player/snapshot.php?alias=690b67247173f (302 to a per-stream s106.ipcamlive.com snapshot.jpg; no Last-Modified header, frame carries a burned-in timestamp). 'Summit Weather' in the nav is an Ambient Weather dashboard (https://ambientweather.net/dashboard/b19d4b0403e5fe5694a2a9a52cdabe5a), not a cam. The legacy snow report at https://montanasnowbowl.com/report.php shows summer operations (updated Jul 16, 2026) and no 2026-27 opening date; opening null. No terms or privacy page linked.
- Profile notes: Lift-tickets page states '2,600 Ft. Vertical Drop' and '2.6 miles Longest Run'. No mountain-stats page found: base/summit elevations, run count, lift count, acres and annual snowfall are not published on the operator pages crawled (home, trail map, hours, lift tickets, passes, contact, about, safety). Indy Pass Rockies list includes 'Montana Snowbowl'.

### showdown  (MT, Little Belt Mountains)
Operator: https://www.showdownmontana.com  |  cams: https://www.showdownmontana.com/mountain-cams
- coords 46.8384, -110.7005; base/summit 6800 / 8200 ft; station 437:MT:SNTL Deadman Creek 6440 ft at 5.4 km; passes indy; wikidata Q7503202
- Opening 2026-27: 2026-12-11 (projected) — https://www.showdownmontana.com/
- Added 1 cam(s):
  - Mountain Cam (iframe) `https://video.nest.com/embedded/live/AfYTevjCiS` credit Showdown Montana
  - skipped: Mountain Cam (second Nest embed) — //video.nest.com/embedded/live/kqtJQIN6tD returns 'Live Not Found' (HTTP 408) on 2026-10-20T02:38Z
- Notes: Squarespace site. The Mountain Cams page carries two unlabelled Nest iframes (operator's src uses '?autoplay=1'); no captions, so the cam name here is generic. Terms & Conditions is a generic TermsFeed-style template (last updated Oct 19, 2021) with no framing/embedding clause. TikTok also linked (https://www.tiktok.com/@showdownmontana). Operator describes itself as 'Montana's oldest & only woman-owned ski area'.
- Profile notes: Snow-report page: 'Base Depth elv. 6,800'' (measured at the base of the Triple Chair), 'Summit Depth elv. 8,200'', 'Trails Open: 0/39', 'Lifts Open: 0/4'. Lodge & Mountain Info page lists the 4 lifts (Payload Triple 1,100 vert ft, Hoxters Express Double 650, Prospector Double 1,400, Little Belt Conveyor 60) and '20 feet Average Annual Snowfall' (converted to 240 in). Vertical derived as summit minus base (1,400 ft; matches the Prospector chair's 1,400 vertical ft). Skiable acres and longest run not published; /mountain-info redirects to /employment. No standalone trail-map page found (grooming report at /grooming-report-trail-status).

### yellowstone-club  (MT, Gallatin Range)
Operator: https://yellowstoneclub.com  |  no cam page
- coords 45.2314, -111.4510 (Wikidata P625 / OSM winter_sports node for the ski base; the operator's map pin marks the club entrance); base/summit — / — ft (operator publishes none); station 590:MT:SNTL Lone Mountain 8820 ft at 5.1 km; passes none; wikidata Q14704796
- No cams added.
- Notes: PRIVATE, members-only club; no public webcams, snow report or trail map on the public site (Nuxt). COORDINATE FLAG: the operator's Google Maps pin (45.2458,-111.3745) is ~4.5 km from the lead point (45.222,-111.421) and ~6 km from Wikidata P625 (45.2314,-111.451) / OSM winter_sports node (45.2389,-111.4521); the operator pin likely marks the club entrance off the Big Sky spur rather than the ski base, so the maintainer may prefer the lead/Wikidata point for the base area. Only a privacy policy is linked (https://yellowstoneclub.com/privacy), no terms of use. Contact: concierge@yellowstoneclub.com, 406-995-4900.
- Profile notes: Private members-only club (Discovery Land Company). The public site publishes no mountain statistics: the Ski page is prose only ('wide-open groomers, gladed tree runs, and sustained steeps'). Home page says the club 'spans 15,200 acres of Private Powder skiing, golf, and luxury amenities' - that is the whole property, not skiable acres, so skiable_acres is null. Not on any multi-resort pass.

### kelly-canyon  (ID, Eastern Idaho)
Operator: https://kellycanyonresort.com  |  cams: https://kellycanyonresort.com/live-cam
- coords 43.6458, -111.6303; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q6385971
- Added 3 cam(s):
  - Top of the Mountain (youtube, summit) `https://www.youtube.com/embed/tHrldu8CqCs` credit Kelly Canyon Resort
  - Lost Treasure (youtube) `https://www.youtube.com/embed/mZa2DuN9NdY` credit Kelly Canyon Resort
  - Learners Carpet (youtube, base) `https://www.youtube.com/embed/hVYOSEtRJZs` credit Kelly Canyon Resort
- Notes: Vite/React SPA hosted on Replit (all routes serve the same index.html; old /live-feeds redirects client-side to /#webcam). The 'Live Mountain Cams' page (/live-cam) renders three YouTube iframes from a hard-coded list; labels in the bundle are the operator's ('Top of the Mountain', 'Lost Treasure', 'Learners Carpet'), the YouTube stream titles differ ('Skiers Lane', 'Bunny Hill'). Pricing calendar in the bundle has 'Fall Frenzy Nov 11 - Dec 15' and 'In-Season Dec 16 - Feb 28, 2027' windows but no opening date is announced (opening null). Terms are generic (no-reproduction; 'embed' only appears regarding third-party YouTube/Google embeds).
- Profile notes: The operator's React single-page site publishes no elevations, vertical, acreage, snowfall or lift/run counts (bundle index-93iqBfKj.js searched for acres/vertical/elevation/snowfall). A 'Download Map' button points at https://kellycanyonresort.com/trail-map/, which returns only the empty app shell (no map rendered), so trail_map_url left empty. Indy Pass confirmed on indyskipass.com/our-resorts.

### pebble-creek  (ID, Eastern Idaho)
Operator: https://pebblecreekskiarea.com  |  cams: https://pebblecreekskiarea.com/the-mountain/webcam/
- coords 42.7816, -112.1634; base/summit — / — ft (operator publishes the 9,271 ft summit only; a lone summit is not stored); station 1299:ID:SNTL Pebble Creek 6520 ft at 4.9 km; passes indy; wikidata Q7158509
- No cams added.
  - skipped: Webcam Stream — offline: operator page says 'Stream Currently Offline ... Closed for the Season'; the page's YouTube embed targets https://www.youtube.com/@PebbleCreekSkiArea/live (channel UC9JJMI8_XAlMU3Z0YPOtj8A), which resolved 2026-
- Notes: Umbraco-style site (/media/ paths). The webcam page uses the YouTube iframe API against the channel's /live URL rather than a fixed video id, so a concrete id must be re-resolved each season. No opening date announced for 2026-27 (only 'Mid December Through Late March'); homepage shows 'Closed for the Season'. No terms/privacy page linked.
- Profile notes: Operator stats: 225" avg snowfall, 2,200' vertical drop, 1,100 acres, 51 named runs, 3 triple lifts + 1 conveyor (lifts_total 4), Summit Elevation 9,271 ft, Top of Skyline Lift 8,650 ft, season 'Mid December Through Late March'. Base elevation is not published (9,271 minus 2,200 would imply ~7,071; left null rather than derived). Indy Pass confirmed on indyskipass.com/our-resorts.

### pomerelle  (ID, Albion Mountains)
Operator: https://www.pomerelle.com  |  cams: https://www.pomerelle.com/conditions
- coords 42.3177, -113.6083; base/summit 7760 / 8762 ft; station 534:ID:SNTL Howell Canyon 8010 ft at 0.7 km; passes indy; wikidata Q7227275
- Added 1 cam(s):
  - Pomerelle Mountain Ski Resort Webcam (youtube) `https://www.youtube.com/embed/uM-oftYVFGA` credit ATC Communications
- Notes: Wix site. The conditions page embeds one YouTube live stream client-side (not in the raw HTML; found via Firecrawl rendered HTML): video uM-oftYVFGA, hosted/owned by ATC Communications (local fiber ISP), so credit ATC Communications. Lead list said 0 cams. Site shows status CLOSED; no 2026-27 opening date announced (news posts are season-pass sale and 'pray for snow'). Night skiing 'starts Dec. 27th' per contact page but no opening-day date. No terms page linked. Only Facebook in the footer.
- Profile notes: Operator: summit 8,762 ft (2,671 m), vertical drop 1,002 ft (305 m), two triple chairlifts + a magic carpet (lifts_total 3), average annual snowfall 500 in. Base elevation derived as summit minus vertical (7,760 ft). Trail count 32 from the conditions page lift & trail status ('0/32 trails'); the trail-map page lists 3 lifts (Triple 88, EZ Rider, Magic Carpet). Skiable acres and longest run not published. Indy Pass confirmed via indyskipass.com sitemap /our-resorts/pomerelle-mountain-resort and the operator's Indy Pass page.

### silver-mountain  (ID, Silver Valley)
Operator: https://silvermt.com  |  cams: https://silvermt.com/mountain/about/webcams
- coords 47.5405, -116.1327; base/summit — / — ft (operator publishes none); station 803:ID:SNTL Sunset 5570 ft at 23.2 km; passes indy; wikidata Q7516211
- Added 1 cam(s):
  - KREM 2 Camera (iframe) `https://api.wetmet.net/widgets/stream/frame.php?ruc=162-04-01` credit KREM 2
  - skipped: Silver Mountain Resort Mountain House Webcam | 5,700 ft. (https://cams.silvermt.com:444/mtnhaus.jpg) — cams.silvermt.com:444 connection refused from local curl and from WebFetch (ECONNREFUSED 143.244.106.170:444) 2026-10-20T02:47Z; host currently down, re-check
  - skipped: Kellogg Snow Stake (https://cams.silvermt.com:444/snow.jpg) — same host, connection refused on port 444 2026-10-20T02:47Z
  - skipped: Kellogg Peak Webcam (https://cams.silvermt.com:444/peak.jpg) — same host, connection refused on port 444 2026-10-20T02:47Z
  - skipped: Snow Tubing Park Webcam (https://cams.silvermt.com:444/tubing.jpg) — same host, connection refused on port 444 2026-10-20T02:47Z
  - skipped: View of Silver Rapids Waterpark (https://cams.silvermt.com:444/water.jpg) — same host, connection refused; indoor waterpark cam, not a snow cam
- Notes: Static PHP site (ShieldsSGF), plain HTML, no JS rendering needed. Cam page has 1 relayed KREM 2 TV-station stream (wetmet.net HLS player iframe, credit KREM 2) plus 5 operator JPEG cams served from cams.silvermt.com on port 444, which refused connections at research time (both local and cloud fetch) - the image URLs are stable (no cache-buster) and should be re-verified later: mtnhaus.jpg (Mountain House, 5,700 ft, kind base), snow.jpg (Kellogg snow stake), peak.jpg (Kellogg Peak, summit), tubing.jpg, water.jpg. Coordinates moved ~5 km from lead (47.495,-116.135, which is up on the mountain) to the Kellogg base/gondola village at 610 Bunker Ave. Base/summit elevations are not published on the operator site (lead list said 1268/1905 m). No 2026-27 opening date announced on the site (conditions page still shows the 04/12/26 end-of-season report). Terms are generic boilerplate.
- Profile notes: Operator stats page: snowfall 340 in, vertical 2200 ft, '1600+' acres, 7 lifts (incl. 1 single-stage gondola), longest trail 2.5 mi. Run count not published. Indy Pass confirmed via indyskipass.com sitemap entry /our-resorts/silver-mountain. Also listed on powderalliance.com (not in the pass set; season-pass page mentions Powder Alliance).

### soldier-mountain  (ID, Wood River Valley)
Operator: https://soldiermountain.com  |  cams: https://soldiermountain.com/snowcam/
- coords 43.4855, -114.8293; base/summit 5752 / 7177 ft; station 769:ID:SNTL Soldier R.S. 5780 ft at 0.2 km; passes indy; wikidata Q7557305
- No cams added.
  - skipped: Mountain Cam (https://soldiermountain.com/webcam/webcam/soldiermtncam.jpg) — Cloudflare 403 'Attention Required' challenge for curl and WebFetch (image is only reachable through a real browser), and the page's cache-buster ?v=1790597402 = 2026-09-28, i.e. the image file is ~3 weeks old (off-seaso
- Notes: WordPress (Salient theme, WPBakery, NitroPack CDN) behind Cloudflare bot protection: curl/WebFetch get 403 on every URL; Firecrawl rendered fetch works. SnowCam page has a single <img class='ww-webcam-image'> pointing at soldiermountain.com/webcam/webcam/soldiermtncam.jpg?v=<mtime>; strip ?v= for the stable URL. Could not verify content-type/Last-Modified because of Cloudflare; the mtime stamp suggests it is not currently updating. Re-check once the season starts (operator says 'Winter is coming', no date). Terms are generic (no-republish/anti-scraping boilerplate, no framing/embedding clause). Homepage shows 2026/27 season passes on sale; no opening date.
- Profile notes: Operator (My Mountain page): lifts reach up to 7,177 ft (top of Soldier Peak), 1,150 acres, 1,425 vertical ft. Base derived as summit minus vertical (5,752 ft). No dedicated mountain-stats page found; lift count, run count, snowfall and longest run not published on the operator site. Cat-skiing page mentions 3,000 ft of backcountry vertical topping out near 10,000 ft (not lift-served). Indy Pass confirmed via indyskipass.com sitemap /our-resorts/soldier-mountain.

### pajarito  (NM, Jemez Mountains)
Operator: https://www.pajarito.ski  |  cams: https://www.pajarito.ski/weather-conditions-webcams/webcams/
- coords 35.8974, -106.3971; base/summit 9000 / 10440 ft; station 708:NM:SNTL Quemazon 9500 ft at 2.8 km; passes power; wikidata Q14706086
- Added 1 cam(s):
  - View from the top of Pajarito Lodge (iframe, base) `https://player.brownrice.com/embed/pajarito1` credit Pajarito Mountain Ski Area
- Notes: WordPress (same MCP theme as Sipapu; WP Rocket, 403 for short UAs). Webcam page loads a Brownrice script (player.brownrice.com?sn=pajarito1&em=1) under the heading 'Webcam' with caption 'View from the top of Pajarito Lodge - Controllable by viewer, 5 fixed positions available'; normalised to player.brownrice.com/embed/pajarito1. Lodge is at the base (9,000 ft) but cam elevation not stated. Page banner: 'Pajarito is closed until further notice' (end of 2025/26); no 2026-27 opening date published. MCP website terms generic -> ok.
- Profile notes: Operator: 'Skiable Acres: 280', 'Trails: 53 (20% easy, 50% intermediate, 30% difficult)', 'Lifts: 6; 3 doubles, 1 triple, 1 quad, 1 conveyor'. Vertical derived as summit minus base (not stated). Annual snowfall not on the stats page -> null (lead said 125 in). Power Pass page lists Pajarito.

### sandia-peak  (NM, Sandia Mountains)
Operator: https://www.sandia.ski  |  cams: https://sandiapeak.com/weather-conditions/
- coords 35.2070, -106.4134; base/summit 8678 / 10378 ft; station: none qualifies; passes power; wikidata Q106041132
- Added 2 cam(s):
  - East Mountain View (image) `https://webcams.sandiapeak.com/images/cams/ski-cam.jpg` credit Sandia Peak Tramway
  - Tram Cam (image) `https://webcams.sandiapeak.com/images/cams/tram-cam.jpg` credit Sandia Peak Tramway
- Notes: OPERATOR SPLIT: sandiapeak.com is the Sandia Peak Tramway (WordPress) and states 'Sandia Peak Ski Area is NOT affiliated with the Tram. Please visit sandia.ski'. The ski area operator site is https://www.sandia.ski (Wix, Mountain Capital Partners / Power Pass; MCP website terms, generic -> ok). OPERATING STATUS 2026-27: sandia.ski is selling '26/27 Season Passes' and lists open hours 9:00 am - 3:00 pm, i.e. it intends to operate, but no opening date is announced (opening = null); it was closed for skiing in recent seasons, so the maintainer should re-check before launch. CAMS: sandia.ski shows no webcams; the two cams above are the Tramway's public JPEGs (rendered into #webcam-container by JS on sandiapeak.com/weather-conditions/; 'ski-cam.jpg' is labelled 'East Mountain View' and looks toward the ski area). Recorded per the task note, credited to Sandia Peak Tramway; the Tramway site links only a privacy page (/privacy), no terms. Drop them if operator-page-only is enforced strictly.
- Profile notes: Stats page: 'Number of runs: 35', 'Lifts: 3 with 1 tow rope (ski school only)' (intro says '4 lifts'; recorded 4), 'Skiable Acres: 300', 'Average Snowfall: 117"', 'Snowmaking: 30 Acres'. Power Pass page: 'unlimited skiing at ... Sandia Peak'.

### sipapu  (NM, Sangre de Cristo)
Operator: https://www.sipapu.ski  |  cams: https://www.sipapu.ski/the-mountain/sipapu-webcams/
- coords 36.1495, -105.5536; base/summit 8200 / 9255 ft; station 1083:NM:SNTL Tres Ritos 8740 ft at 3.4 km; passes power; wikidata Q7525584
- Added 2 cam(s):
  - Sipapu Lower Webcam (iframe, base, 8200 ft) `https://player.brownrice.com/embed/sipapu1` credit Sipapu Ski and Summer Resort
  - Sipapu Upper Webcam (iframe, mid, 9064 ft) `https://player.brownrice.com/embed/sipapu2` credit Sipapu Ski and Summer Resort
- Notes: WordPress (MCP multisite theme, WP Rocket; short UAs get 403 on some pages - use full browser UA). Cam page embeds live4.brownrice.com/embed/sipapu1|2, normalised to player.brownrice.com/embed/<sn> per the brief. Operator captions: Lower 'Altitude: 8,200 feet | View from the base area up the mountain'; Upper 'Altitude: 9,064 feet | View looking down Lift One' (top of Lift One, below the 9,255 ft peak -> kind mid). Page banner currently says 'Sipapu is now closed for skiing' (2025/26 wrap-up); no 2026-27 opening date announced anywhere on the site (snow-report only says '26/27 Power Pass drops March 18'). MCP website terms are generic (arbitration/IP boilerplate, no framing/hot-linking clause) -> ok.
- Profile notes: Operator: '215 Skiable Acres', '185 inches Average Annual Snowfall' (lead said 190), '43 Named Trails', '6 Lifts' (1 quad, 2 triples, 1 platter, 2 carpets per page), '4 Terrain Parks'. Power Pass page lists Sipapu.

### sunrise-park  (AZ, White Mountains of Arizona)
Operator: https://sunrise.ski  |  cams: https://sunrise.ski/winter/trails-and-camera/
- coords 33.9734, -109.5640; base/summit 9300 / 10700 ft; station 310:AZ:SNTL Baldy 9210 ft at 5.6 km; passes none; wikidata Q7641115
- Added 2 cam(s):
  - Sunrise Peak Live (youtube, summit, 10700 ft) `https://www.youtube.com/embed/mCbHN6zvhpk` credit Sunrise Park Resort
  - Sunrise Base Live (youtube, base, 9300 ft) `https://www.youtube.com/embed/VX29Awryg30` credit Sunrise Park Resort
- Notes: WordPress (Avada theme). Operated by the White Mountain Apache Tribe. Cams are CamStreamer embeds that 302 to YouTube; the same two streams appear on /summer/map-and-camera/ and /winter/trails-and-camera/. Operator says feeds run 6:30 am - 6:30 pm daily (PTZ on a schedule). The only legal page is /privacy-policy/, which is titled 'Terms of Use and Privacy Policy' (generic: external-link disclaimer, purchases, privacy; no framing/hot-linking clause) -> ok. No 2026-27 opening date on the site (only '2026/27 Season Passes ... prices go up November 1'); socials: footer X handle differs between pages (SunriseSkiAZ on homepage, SunriseResortAZ on winter page) - homepage used.
- Profile notes: Winter page 'Mountain Stats' counters (data-value attrs): 3 Mountains, 8 Lifts, 5 Day Lodges, 67 Trails, 1,200 Acres, 250" Avg. Season Snowfall (lead said 117 in). Elevations are only stated in the webcam captions (Sunrise Mountain top/base), not a formal stats table; vertical derived as summit minus base. No operator-published stats page. Not on Indy, Power, Ikon, MC or Epic lists (Indy 'west' page matches only a Hoodoo image filename).

### lee-canyon  (NV, Spring Mountains)
Operator: https://www.leecanyonlv.com  |  cams: https://www.leecanyonlv.com/webcams/
- coords 36.3016, -115.6808; base/summit 8660 / 11289 ft; station 1112:NV:SNTL Lee Canyon 8620 ft at 0.7 km; passes power; wikidata Q6492638
- No cams added.
  - skipped: Base Area and Uphill Views (HD Relay player e8ecca63-a91c-4ebe-98a7-341b2244dbc5) — https://manage.hdrelay.com/webPlayer/iframe/e8ecca63-a91c-4ebe-98a7-341b2244dbc5 returns 404 (also with Referer); manage.hdrelay.com/player/<id> 404; img.hdrelay.com/camera/<id>/snapshot 404 -> player removed/dead
- Notes: WordPress (MCP multisite). The webcams page embeds a single HD Relay player which no longer resolves; no other cam on the operator site, so cams is empty. Only Facebook found in the footer (no Instagram/X link in HTML). Summer bike park open through Nov 1; no winter 2026-27 opening date announced.
- Profile notes: Operator: Base Lodge 8,660 ft; Summit 11,289 ft; avg snowfall 129 in; 36 trails; total terrain 445 acres (235 lift-served + 210 hiking); vertical: lifts-serviced 860 ft, hiking routes 1,919 ft, total 2,779 ft (total used); lifts listed: Sherwood, Bluebird, Ponderosa, Rabbit Peak = 4 chairs ('NEW for 26/27: West Bowl - details coming soon'; a new 'Let 'em Ride' rope tow also announced). Wikidata item is titled 'Las Vegas Ski and Snowboard Resort' with alias Lee Canyon. Power Pass lists Lee Canyon. Trail-map page not found at a stable URL.

### alyeska  (AK, Chugach Mountains)
Operator: https://www.alyeskaresort.com  |  cams: https://www.alyeskaresort.com/webcams/
- coords 60.9705, -149.0980; base/summit — / — ft (operator publishes none); station 1103:AK:SNTL Mt. Alyeska 1500 ft at 1.4 km; passes ikon; wikidata Q9147336
- Opening 2026-27: 2026-11-28 (projected) — https://www.alyeskaresort.com/mountain-report/
- Added 11 cam(s):
  - Glacier Bowl 360° Cam (iframe, mid) `https://alyeskaresort.roundshot.com/glacierbowl/` credit Alyeska Resort
  - Sundeck 360° Cam (iframe, summit) `https://alyeskaresort.roundshot.com/tram-summit/` credit Alyeska Resort
  - Turnagain Arm (image) `https://www.alyeskaresort.com/webcamsfolder/Turnagain.jpg` credit Alyeska Resort
  - Upper Tram (image, summit) `https://www.alyeskaresort.com/webcamsfolder/TramUpper.jpg` credit Alyeska Resort
  - Top of Glacier Bowl Express (image, mid) `https://www.alyeskaresort.com/webcamsfolder/TopGBX.jpg` credit Alyeska Resort
  - The North Face (image) `https://www.alyeskaresort.com/webcamsfolder/NorthFace.jpg` credit Alyeska Resort
  - Ted's Express Base (image, base) `https://www.alyeskaresort.com/webcamsfolder/Chair4_3.jpg` credit Alyeska Resort
  - Max's Mountain (image) `https://www.alyeskaresort.com/webcamsfolder/Chair4_4.jpg` credit Alyeska Resort
  - Ted's Express (image) `https://www.alyeskaresort.com/webcamsfolder/Chair4_1.jpg` credit Alyeska Resort
  - Hotel Courtyard (image, village) `https://www.alyeskaresort.com/webcamsfolder/CourtYard.jpg` credit Alyeska Resort
  - Daylodge (image, base) `https://www.alyeskaresort.com/webcamsfolder/Chair4_2.jpg` credit Alyeska Resort
  - skipped: Base of Glacier Bowl Express (Base6.jpg) — GET 200 but Last-Modified 2026-07-03 (3+ months stale)
  - skipped: Denali (Mombo.jpg) — Last-Modified 2026-07-03 (stale)
  - skipped: Town (Town.jpg) — Last-Modified 2026-07-03 (stale)
  - skipped: Rocky Point (Highway.jpg) — Last-Modified 2026-07-03 (stale)
  - skipped: Turnagain6.jpg (second image under Turnagain Arm, no own caption) — Last-Modified 2026-07-03 (stale); duplicate caption
  - skipped: Tram summit (Roundshot still backend.roundshot.com/cams/602/medium) — 302 to a signed/rotating URL, not a stable image; the live view is already covered by the Sundeck 360° Roundshot iframe
- Notes: WordPress/Elementor behind Sucuri CloudProxy: plain curl gets a JS challenge page, so pages were fetched with Firecrawl; the image URLs and roundshot hosts themselves serve to curl fine. Webcam page = 2 Roundshot 360 panoramas (iframes allowed) + 14 static JPGs in /webcamsfolder/ with captions. Static JPGs stamped 2026-10-07 are included but flagged: they were ~13 days old at verification (summer ops ended Oct 12); re-check that they refresh after the Nov 28 opening. Footer links a privacy policy only, no terms of use. Operator does not publish base/summit elevation on the pages found (lead list: 76 m / 1201 m).
- Profile notes: Operator 'About the Mountain': 1,610 skiable acres, 7 total lifts (2 high-speed quads, 2 fixed quads, 2 magic carpets, 40-passenger aerial tram), 76 named trails, vertical rise 2,500 ft, over 669 in snow annually. Base/summit elevations not found on the operator site (left null). Ikon Pass destination page exists for Alyeska Resort (200).

### eaglecrest  (AK, Southeast Alaska)
Operator: https://skieaglecrest.com  |  cams: https://skieaglecrest.com/conditions/#webcams
- coords 58.2761, -134.5153; base/summit 1130 / 2750 ft; station: none qualifies; passes indy; wikidata Q5325323
- Opening 2026-27: 2026-12-12 (projected), closing 2027-04-11 — https://skieaglecrest.com/info/
- Added 4 cam(s):
  - Peak Camera 1 (image, summit) `https://eaglecams.ci.juneau.ak.us/eagle-ptarm-top-cam-2.jpeg` credit Eaglecrest Ski Area (City and Borough of Juneau)
  - Peak Camera 2 (image, summit) `https://eaglecams.ci.juneau.ak.us/eagle-ptarm-top-cam-3.jpeg` credit Eaglecrest Ski Area (City and Borough of Juneau)
  - Base Camera 1 (image, base) `https://eaglecams.ci.juneau.ak.us/eagle-ptarm-bot-cam-3.jpeg` credit Eaglecrest Ski Area (City and Borough of Juneau)
  - Base Camera 2 (image, base) `https://eaglecams.ci.juneau.ak.us/eagle-ptarm-bot-cam-2.jpeg` credit Eaglecrest Ski Area (City and Borough of Juneau)
  - skipped: Base Camera 3 (eagle-hooter-top-cam-1.jpeg) — GET 200 image/jpeg but Last-Modified 2026-07-16 (stale 3 months)
  - skipped: FAA Cameras — operator says 'We can't link the FAA images here' and only links the FAA weathercams map (weathercams.faa.gov cameraSite/413); no embeddable image URL on the operator page
- Notes: WordPress/Avada; the hint domain skijuneau.com (WP Engine) timed out / returned 409 and the operator's live site is skieaglecrest.com. Cams are plain JPEGs on eaglecams.ci.juneau.ak.us (City and Borough of Juneau host; Eaglecrest is CBJ-owned), refreshed every few minutes. The operator labels them only by group ('Peak Cameras' x2, 'Base Cameras' x3); names here carry the file stem for disambiguation. No website terms/privacy page is linked (the footer 'policy' anchor is the mountain-safety policy section).
- Profile notes: Operator Mountain Stats counters (data-value attributes; rendered text animates from 0): 640 acres, 1620 ft vertical drop, 2750 ft peak elevation, 320 in average snowfall, 640 in record snowfall, 36 marked trails, 20/40/40 % beginner/intermediate/expert. Base elevation not published; 1130 derived as peak minus vertical. Lift count not stated on the stats page. Indy Pass list includes Eaglecrest.

### terry-peak  (SD, Black Hills)
Operator: https://terrypeak.com  |  cams: https://terrypeak.com/the-mountain/live-web-cams/
- coords 44.3346, -103.8404; base/summit 6000 / 7100 ft; station 920:SD:SNTL North Rapid Creek 6150 ft at 14.9 km; passes indy; wikidata Q61102492
- Added 2 cam(s):
  - Stewart Slope from the Stewart Lodge Cam (iframe, base) `https://g1.ipcamlive.com/player/player.php?alias=5c3526110e41f&autoplay=1` credit Terry Peak Ski Area
  - Terry Peak Summit from the Summit Cam (iframe, summit, 7100 ft) `https://g1.ipcamlive.com/player/player.php?alias=5c352da4f3420&autoplay=1` credit Terry Peak Ski Area
- Notes: WordPress. Two IPCamLive players on the operator's Live Web Cams page, both streaming on 2026-10-20. Footer links only a privacy policy (/privacy-policy), no terms of use. Home page mentions a Nov 7 2026 job fair and 'snowmaking season is right around the corner' but no opening date.
- Profile notes: Operator 'The Mountain' page: summit elevation 7,100 ft, vertical drop 1,100 ft, 30 trails, four chairlifts (three high-speed quads + one triple). Base elevation not published; 6000 derived as summit minus vertical. Acres, snowfall and longest run not published. Indy Pass list includes Terry Peak. Wikidata Q61102492 has no coordinates.

## Station near misses (rule applied strictly; override by hand if wanted)

- montana-snowbowl: 901:MT:SNTL Stuart Mountain 7270 ft @ 5.9 km (base 4980 ft; station is more than 2,000 ft above it)
- kelly-canyon: no active SNOTEL within 25 km
- sandia-peak: no active SNOTEL within 25 km
- eaglecrest: no active SNOTEL within 25 km

