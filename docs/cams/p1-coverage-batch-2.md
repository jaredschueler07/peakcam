# P1 coverage import, batch 2: WA, OR, the Northeast and the Midwest (2026-10-20)
> Block P1 of `docs/research/ai-assistant-first/2026-10-18-parity-plan.md`. The competitor's lead list named the
> resorts; every value below was read on the operator's own site or an official source (NRCS AWDB, the pass
> operators' resort lists, Wikidata for Q-ids), and every cam embed was verified the way the P8 gap audit did
> (`docs/cams/gap-audit-2026-10-18.md`, section 1): YouTube oEmbed 200; image GET 200 `image/*` with no Referer
> and no cache-buster; iframe 200 with no `X-Frame-Options` and no restrictive `frame-ancestors`. Verification
> timestamps are 2026-10-20 02:3x to 03:0x UTC. Rows live in `data/resorts.csv`, `data/cams.csv`,
> `data/resort-profiles.csv`, `data/resort-openings.csv`; new NRCS triplets in `lib/public-api/stations.json`.
>
> **Station rule** (plan section 2, P1): `snotel_station_id` is the nearest *active* AWDB SNOTEL or SCAN
> station within 25 km of the base and within 2,000 ft of the base elevation (the operator's base; the lead
> list's base where the operator publishes none). East of the Rockies that is rare, so most rows here carry no
> triplet: their snow report comes from `model-sync` (Open-Meteo) and their measured numbers from the P3 station
> layer (`stations-sync`: GHCN-Daily and NWS observations). Every resort that ships with neither a cam nor a
> triplet is listed with its nearest P3 station in `tests/resort-catalog.test.ts` so the gap is a decision.
>
> Import on the mini: `npm run import-resorts:standalone` then `npx tsx scripts/import-profiles.ts` and
> `node scripts/seed-resort-openings.mjs`; a deploy must follow before `/resorts/{slug}` exists
> (`dynamicParams = false`).

## Result

| | Count |
| --- | ---: |
| Resorts added (NY 14, MI 11, PA 9, NH 8, WI 8, ME 7, MN 5, VT 4, MA 3, NC 3, WA 2, OH 2, MO 2, VA 2, OR 1, NJ 1, IN 1, WV 1) | 84 |
| Cam rows added (45 resorts; 30 image, 48 iframe, 34 YouTube) | 112 |
| Resorts with a qualifying SNOTEL/SCAN station | 7 |
| Resorts with neither cam nor triplet (P3 station layer; each listed in the test allowlist with its nearest GHCN/NWS station) | 35 |
| Profile rows (`data/resort-profiles.csv`) | 84 (67 with a Wikidata Q-id, 56 on a multi-resort pass) |
| Opening rows (operator-announced 2026-27 dates) | 8 |
| New triplets in `lib/public-api/stations.json` | 6 |

## Needs the user

- **Terms holds (cams verified, not added):** Pleasant Mountain and The Highlands (Boyne Resorts terms: "Frame or
  utilize framing techniques to enclose any Trademark or other Content", the clause that held Loon in the P8 audit)
  and Wild Mountain ("unauthorized framing of or linking to the Services"). The embeds are under each resort.
- **Vail's Midwest and Mid-Atlantic cam pages render empty off-season** (Mt. Brighton, Wilmot, Afton Alps, Boston
  Mills, Mad River, Hidden Valley, Paoli Peaks, Jack Frost, Big Boulder, Laurel Mountain: "Download My Epic App" or
  "webcams will return this fall"). Re-scrape after their late-November openings. Roundtop, Whitetail, Liberty,
  Crotched, Mount Sunapee and Snow Creek did expose Brownrice players and are in.
- **Seasonal or stale feeds included because the player verifies:** Roundtop and Whitetail Brownrice snapshots date
  from July and September; Crystal Mountain MI's five non-Inn stills from 2026-10-15. Big Powderhorn's three
  Twitch players are *not* included (they need a host-bound parent parameter).
- **Not embeddable as published:** plain-http bare-IP cams at the SkiCNY hills (Labrador, Song Mountain), Snowriver's
  HLS-only playlists, Elk Mountain's domain-locked Verkada players. Listed per resort.
- **Coordinates moved more than 2 km from the lead list** (operator address or Wikidata/OSM agree): Afton Alps
  (12 km), Roundtop (10 km), Mount Bohemia (10 km), Swain (4.4 km), Paoli Peaks (3.9 km), Cataloochee (2.8 km),
  Mt. Brighton (2.5 km), Wild Mountain (2.3 km).

### loup-loup  (WA, North Cascades)
Operator: https://skitheloup.org  |  cams: https://skitheloup.org/mountain/conditions-weather/
- coords 48.3944, -119.9110; base/summit 4020 / 5260 ft; station 1259:WA:SNTL Muckamuck 4470 ft at 21.5 km; passes indy; wikidata Q6689691
- Added 2 cam(s):
  - Upper Mountain Camera (youtube) `https://www.youtube.com/embed/qp-GrRsWBEQ` credit Loup Loup Ski Bowl
  - Lower Mountain Camera (youtube, base) `https://www.youtube.com/embed/1wraMeolGF4` credit Loup Loup Ski Bowl
- Notes: WordPress site; skitheloup.com 301s to skitheloup.org (use .org). Cam page is the Conditions & Weather page: two YouTube embeds titled 'Loup Loup Ski Bowl - Upper Mountain Live' and 'Lower Mountain Webcam'; page text says 'Closed for the season' (off-season) but both oEmbeds return 200. Opening: operating-schedule block still reads '2025/2026 ... Opening to be announced'; no 2026-27 date, so opening=null (homepage only mentions the 2026/27 pass sale). No terms/privacy page linked in the footer. Non-profit (Loup Loup Ski Education Foundation), operates Wed/Fri-Sun.
- Profile notes: Operator states '1,240 vertical feet (base located at 4,020 feet)', '10 Cut Runs on Little Buck Mountain', 'Quad Chair, Poma Lift, Beginner Rope Tow', '300 acres'. Summit derived as base+vertical (5,260). Annual snowfall and longest run not published. Indy Pass: listed at /our-resorts/loup-loup-ski-bowl. Pass check: Indy list fetched at https://www.indyskipass.com/our-resorts (resorts page 404s); ikonpass.com/epicpass.com are JS/bot-blocked but none of these resorts is plausibly on them; powderalliance.com member list and mountaincollective.com text contain no match.

### mt-spokane  (WA, Selkirk Mountains)
Operator: https://www.mtspokane.com  |  cams: https://www.mtspokane.com/webcams
- coords 47.9210, -117.1140; base/summit 4200 / 5889 ft; station 707:WA:SNTL Quartz Peak 4710 ft at 5.0 km; passes none; wikidata Q6923783
- Added 7 cam(s):
  - Mt. Spokane Web Cam, Snow Stake (youtube, snow-stake) `https://www.youtube.com/embed/lBgqL-YwCcE` credit Mt. Spokane Ski & Snowboard Park
  - Mt. Spokane Web Cam, Lodge 2 (youtube, base) `https://www.youtube.com/embed/0i8hMjxhnho` credit Mt. Spokane Ski & Snowboard Park
  - Mt. Spokane Web Cam, Northwood, Chair 6 (youtube) `https://www.youtube.com/embed/m1kzBdiTyFU` credit Mt. Spokane Ski & Snowboard Park
  - Parkway Express, Chair 3 (youtube) `https://www.youtube.com/embed/KSIuO1ITLlU` credit Mt. Spokane Ski & Snowboard Park
  - Mt. Spokane Web Cam, Hourglass, Lodge 1 (youtube, base) `https://www.youtube.com/embed/rvY2pHYzMlE` credit Mt. Spokane Ski & Snowboard Park
  - Mt. Spokane Web Cam, Vista Cruiser (youtube) `https://www.youtube.com/embed/r1N4CmHq0RA` credit Mt. Spokane Ski & Snowboard Park
  - Mt. Spokane Webcam, Hidden Treasure, Chair 4 (youtube) `https://www.youtube.com/embed/rQnOjOnHrpw` credit Mt. Spokane Ski & Snowboard Park
- Notes: Duda-hosted site (irp.cdn-website.com assets), server-rendered. /webcams has 7 YouTube iframes with no on-page captions; cam names are the YouTube video titles from oEmbed. Competitor lead list said 0 cams; operator has 7. Opening: homepage only says 'get your pass ahead of opening day', no date, so opening=null. Policies page is generic (no framing/embedding language). Name on site: 'Mt. Spokane Ski & Snowboard Park' (nonprofit).
- Profile notes: Conditions page: 'Summit Elevation: 5,889 ft.', 'Base Lodge Elevation: 4,200 ft.', '53 designated runs', '1,704 acres skiable terrain', '2,000 skiable vertical feet' (operator figure; summit minus base is 1,689 ft), '16 night skiing runs'. Homepage: 'six lifts'. Snowfall and longest run not published. Not on the Indy /our-resorts list (0 hits for 'Spokane'); has its own 'partner mountains' page. Pass check: Indy list fetched at https://www.indyskipass.com/our-resorts (resorts page 404s); ikonpass.com/epicpass.com are JS/bot-blocked but none of these resorts is plausibly on them; powderalliance.com member list and mountaincollective.com text contain no match.

### anthony-lakes  (OR, Blue Mountains)
Operator: https://anthonylakes.com  |  no cam page
- coords 44.9637, -118.2350; base/summit 7100 / 8000 ft; station 873:OR:SNTL Wolf Creek 5730 ft at 13.2 km; passes none; wikidata Q4772915
- No cams added.
- Notes: WordPress site. No webcam page or embed found anywhere on the operator site (homepage, Bert's Daily Report, Maps & Stats, schedule); the snow report links NOAA/Wallowa Avalanche Center only. cams=[] and cam_page_url='' accordingly (competitor list also had 0). Nonprofit under Wallowa-Whitman NF special use permit. Terms page is generic.
- Profile notes: Maps & Stats page: 'Highest base elevation in Oregon at 7,100 ft.', 'Snowfall Average Annual 250 Inches', 'Vertical 900 ft.', 'Longest Run 1.5 miles', Lifts: 1 Triple Chair, 1 Handletow, 1 Wonder Carpet. Summit derived as base+vertical (8,000). Runs count and skiable acres not stated on the stats page. Not on the Indy /our-resorts list. Pass check: Indy list fetched at https://www.indyskipass.com/our-resorts (resorts page 404s); ikonpass.com/epicpass.com are JS/bot-blocked but none of these resorts is plausibly on them; powderalliance.com member list and mountaincollective.com text contain no match.

### bristol-mountain  (NY, Finger Lakes)
Operator: https://www.bristolmountain.com  |  cams: https://www.bristolmountain.com/webcam/
- coords 42.7450, -77.4044; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q4968955
- Added 5 cam(s):
  - Morning Star Webcam (image) `https://www.bristolmountain.com/webcams/morningstarcurrent.jpg` credit Bristol Mountain
  - Launching Pad Webcam (image, base) `https://www.bristolmountain.com/webcams/roselandcurrent.jpg` credit Bristol Mountain
  - Launching Pad Live Feed (iframe, base) `https://player.brownrice.com/embed/bristolmountain2` credit Bristol Mountain
  - Rocket Webcam (image) `https://www.bristolmountain.com/webcams/rocketcamstill.jpg` credit Bristol Mountain
  - Rocket Live Feed (iframe) `https://player.brownrice.com/embed/bristolmountain1` credit Bristol Mountain
- Notes: WordPress site. /webcam/ page shows three still images (alt texts: 'Live View of Nova - Morning Star Web Cam', 'Live view of the Launching Pad', 'Live view of Rocket') plus two Brownrice live players (live7.brownrice.com ?sn=bristolmountain2 under 'Launching Pad Live Feed', ?sn=bristolmountain1 under 'Rocket Live Feed'), normalised to player.brownrice.com/embed/<sn>. Stills are refreshed server-side (Last-Modified within a minute of fetch). Footer links only a refund policy and safety policies; no terms/privacy page, so terms verdict 'none'. Only Instagram is linked in the footer (no Facebook/X link found). No 2026-27 opening announcement found.
- Profile notes: About page: '1200' of vertical', '138 acres of total skiable terrain', '39 slopes and trails', '2 high speed quads', 97% lit, 100% snowmaking. Lift count 7 from the conditions page lift list (Comet Express Quad, Galaxy Express Quad, Lunar Launch Surface Lift #1 and #2, Morning Star Quad, Rocket Triple, Sunset Double). Base/summit elevation, annual snowfall and longest run are not published by the operator (lead list base/summit of 305/671 m not confirmed). Not on the Indy /our-resorts list. Pass check: Indy list fetched at https://www.indyskipass.com/our-resorts (resorts page 404s); ikonpass.com/epicpass.com are JS/bot-blocked but none of these resorts is plausibly on them; powderalliance.com member list and mountaincollective.com text contain no match.

### buffalo-ski-center  (NY, Western New York)
Operator: https://www.buffaloskicenter.com  |  cams: https://www.buffaloskicenter.com/slope-cameras/
- coords 42.6848, -78.6868; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata —
- Added 2 cam(s):
  - Tam Cam (youtube) `https://www.youtube.com/embed/DOJwy9f70IM` credit Buffalo Ski Center
  - Sitz Cam (youtube) `https://www.youtube.com/embed/piySo9PJ9n0` credit Buffalo Ski Center
- Notes: WordPress site. /slope-cameras/ has 'TAM CAM' (YouTube DOJwy9f70IM, title 'Buffalo Ski Club - Tamarack Lift') and 'SITZ CAM' (camstreamer.com/embed/NWIcHz... which 302s to YouTube piySo9PJ9n0, title 'Buffalo Ski Club - Sitz Lift'). Operator names itself both 'Buffalo Ski Center' (site/brand) and 'Buffalo Ski Club' (the club that combines Sitzmarker, Tamarack and Buffalo Ski Club areas). Footer links privacy/cookie/refund/security policies only; privacy policy has no framing language. No 2026-27 opening date found.
- Profile notes: History page: 'covers 300 acres with 43 trails', 'serviced by two chair lifts, two t-bars and two handle lifts' (lifts_total=6 summed). Vertical, elevations, snowfall and longest run are not published. Indy Pass: listed at /our-resorts/buffalo-ski-club. No Wikidata item found for 'Buffalo Ski Center'/'Buffalo Ski Club'. Pass check: Indy list fetched at https://www.indyskipass.com/our-resorts (resorts page 404s); ikonpass.com/epicpass.com are JS/bot-blocked but none of these resorts is plausibly on them; powderalliance.com member list and mountaincollective.com text contain no match.

### catamount  (NY, Taconic Mountains)
Operator: https://catamountski.com  |  cams: https://catamountski.com/winter/the-mountain/mountain-conditions
- coords 42.1690, -73.4767; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q5051409
- Added 7 cam(s):
  - Catamount Patio West (image, base) `https://catamountski.com/images/webcams/snap.jpeg` credit Catamount Mountain Resort
  - Catamount Mountain View (image) `https://catamountski.com/images/webcams/mountainview.jpeg` credit Catamount Mountain Resort
  - Magic Carpet (image, base) `https://catamountski.com/images/webcams/snap2.jpeg` credit Catamount Mountain Resort
  - Toni Matt Race Trail (image) `https://catamountski.com/images/webcams/snap3.jpeg` credit Catamount Mountain Resort
  - Main Expanse (image) `https://catamountski.com/images/webcams/main-expanse.jpeg` credit Catamount Mountain Resort
  - Catamount Walkway (image, base) `https://catamountski.com/images/webcams/walkway.jpeg` credit Catamount Mountain Resort
  - Slope Stairs (image, base) `https://catamountski.com/images/webcams/slopestairs.jpeg` credit Catamount Mountain Resort
- Notes: Joomla/YOOtheme site. Webcams live on the Mountain Conditions page as seven self-hosted JPEG stills under /images/webcams/ (snap.jpeg=Patio West, mountainview.jpeg=Mountain View, snap2.jpeg=Magic Carpet, snap3.jpeg=Toni Matt Race Trail, main-expanse.jpeg (640x360), walkway.jpeg, slopestairs.jpeg), refreshed server-side roughly every minute. Resort straddles NY/MA; address 78 Catamount Road, Hillsdale NY 12529. Page currently says closed for the 2025-26 season; no 2026-27 opening date posted. Terms section (#Terms on the privacy-policy article) is generic.
- Profile notes: About page: 'LIFTS: 8 lifts: 2 Quad Chairlifts, 3 Triple Chairlifts, and 3 Wonder Carpet surface lifts', 'TRAILS: 44 trails: 16 Green, 18 Blue, and 10 Black', 'VERTICAL DESCENT: 1,000 feet', 'LONGEST RUN: 1.75 miles', 93% snowmaking, 22 night trails. Base/summit elevation, skiable acres and annual snowfall not published. Indy Pass: listed at /our-resorts/catamount-mountain-resort (operator also has an Indy reservations page). Pass check: Indy list fetched at https://www.indyskipass.com/our-resorts (resorts page 404s); ikonpass.com/epicpass.com are JS/bot-blocked but none of these resorts is plausibly on them; powderalliance.com member list and mountaincollective.com text contain no match.

### greek-peak  (NY, Finger Lakes)
Operator: https://www.greekpeak.net  |  cams: https://www.greekpeak.net/ski-ride/webcams/
- coords 42.5050, -76.1472; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q14706299
- Added 3 cam(s):
  - Base Cam (youtube, base) `https://www.youtube.com/embed/JWugDNXhOoA` credit Greek Peak Mountain Resort
  - Lodge Cam (youtube, base) `https://www.youtube.com/embed/WK5nRpqGkd8` credit Greek Peak Mountain Resort
  - Snowfall Cam (youtube, snow-stake) `https://www.youtube.com/embed/Cm0NAIS5z9o` credit Greek Peak Mountain Resort
- Notes: WordPress site. /ski-ride/webcams/ has three YouTube embeds titled 'Greek Peak Mountain Resort - Base Cam / Lodge Cam / Snowfall Cam'. Terms page contains only a generic no-scraping clause ('To spam, phish, pharm, pretext, spider, crawl, or scrape'); no framing/embedding wording, so 'ok'. No 2026-27 opening date found on the site.
- Profile notes: Trail Map & Current Conditions page stat strip: '45 Trails', '11 Glades', '9 Lifts', '952' Vertical', '95% Snowmaking', '110 days Avg Season'. Base/summit elevation, acres, snowfall and longest run not published. Trail map image is the operator's 2026-27 winter map (/ski-ride/trail-map/ 404s). Indy Pass: listed at /our-resorts/greek-peak-mountain-resort. Pass check: Indy list fetched at https://www.indyskipass.com/our-resorts (resorts page 404s); ikonpass.com/epicpass.com are JS/bot-blocked but none of these resorts is plausibly on them; powderalliance.com member list and mountaincollective.com text contain no match.

### holiday-valley  (NY, Western New York)
Operator: https://www.holidayvalley.com  |  cams: https://www.holidayvalley.com/webcams/
- coords 42.2624, -78.6682; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q14706383
- Opening 2026-27: 2026-11-27 (projected) — https://www.holidayvalley.com/event/opening-day-2026-27/
- Added 6 cam(s):
  - Top of Cindy's (image, summit) `https://img.hdrelay.com/camera/896d837c-d4b2-4d29-a555-0e5fcd81a8ea/snapshot` credit Holiday Valley
  - Main Lodge (image, base) `https://img.hdrelay.com/camera/691f45852fc3303fedc919bf/snapshot` credit Holiday Valley
  - Mardi Gras Top (image, summit) `https://img.hdrelay.com/camera/691f44032fc3303fedc919bc/snapshot` credit Holiday Valley
  - Morning Star Top (image, summit) `https://img.hdrelay.com/camera/691f48292fc3303fedc919c3/snapshot` credit Holiday Valley
  - Tannenbaum (image, base) `https://img.hdrelay.com/camera/691f41e72fc3303fedc919b6/snapshot` credit Holiday Valley
  - Double Black Diamond Golf Course (image) `https://img.hdrelay.com/camera/691f43502fc3303fedc919b9/snapshot` credit Holiday Valley
- Notes: Server-rendered (Dirigo CMS). /webcams/ loads six HD Relay players via HDRelay.create({id}) with player ids 619e67b47ee0bcc6eb462f81, 691f45a02fc3303fedc919c1, 691f441c2fc3303fedc919be, 691f483e2fc3303fedc919c5, 691f420a2fc3303fedc919b8, 691f43722fc3303fedc919bb; each resolved via manage.hdrelay.com/player/<id> to the camera id used in the snapshot URL. Operator captions: Top of Cindy's ('view from the top of Cindy's Run looking down at the Resort Center'), Main Lodge ('Base Area of the Resort Center with a view of the Mardi Gras 6 and Cindy's lifts'), Mardi Gras Top ('top of the Mardi Gras 6 terminal'), Morning Star Top, Tannenbaum ('looking down at the Base Area of Tannenbaum'), Double Black Diamond Golf Course ('from the bottom of the Snowpine Quad'). Page also links the resort's YouTube channel (not a cam). Policies page is a generic privacy/cookie policy. Lead list said 6 cams; 6 added.
- Profile notes: History page: 'Holiday Valley boasts 13 lifts, 60 slopes and trails, 3 base lodges'; snow report shows 0 of 13 lifts. No mountain-stats page found (sitemap checked): vertical, elevations, acres, snowfall and longest run are not published on the operator site, left null. Not on the Indy /our-resorts list. Pass check: Indy list fetched at https://www.indyskipass.com/our-resorts (resorts page 404s); ikonpass.com/epicpass.com are JS/bot-blocked but none of these resorts is plausibly on them; powderalliance.com member list and mountaincollective.com text contain no match.

### holimont  (NY, Western New York)
Operator: https://holimont.com  |  cams: https://holimont.com/slope-report/
- coords 42.2732, -78.6889; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata —
- Added 2 cam(s):
  - HoliMont Main Chalet SnowCam (image, base) `https://img.hdrelay.com/camera/f4fb7d5d-4b50-43e9-b449-4fe204b6244e/snapshot` credit HoliMont
  - Sunset (youtube) `https://www.youtube.com/embed/1TLQieIVRfU` credit HoliMont
  - skipped: HoliMont Sunset SnowCam (HD Relay player 63a36720d0964a1867dc17a0) — resolved camera id 63a367176d7590186d4e5336 but img.hdrelay.com snapshot returns 404 (camera offline/off-season); the same Sunset lift view is covered by the YouTube 'Holimont Sunset Lift 24/7' stream
- Notes: PRIVATE CLUB: HoliMont is a members-only private ski club on winter weekends and holidays; it sells weekday (midweek, non-holiday) lift tickets and 5/10/15-weekday passes to the public (https://holimont.com/explore/tickets-and-passes/ 'A flexible entry point for casual weekday skiers'). Say so on the resort page. WordPress/Elementor site; /resources/slope-report/ redirects to /slope-report/, which carries a 'Snow Cams' section: 'Main Chalet' = HD Relay iframe manage.hdrelay.com/webPlayer/iframe/b787c0df-9fcd-48c3-9fc8-60e7b88388b2 (resolved to camera f4fb7d5d-... snapshot), 'Sunset' = camstreamer.com/embed/7k28gOa2... which 302s to YouTube 1TLQieIVRfU ('Holimont Sunset Lift 24/7'), plus a second HD Relay iframe for the Sunset SnowCam whose snapshot 404s (skipped). Policies & Practices page is a generic privacy/cookie policy. No 2026-27 opening date posted (slope report still shows April 7, 2026 closing).
- Profile notes: About page: '700 vertical feet of wall-to-wall, top-to-bottom snow', 'average of 180 inches of natural snow per season', title '56 Trails, 100% Snowmaking'; trail-maps page: '56 Trails & 8 Lifts'. Elevations, acres and longest run not published. No Wikidata item found for HoliMont. Not on the Indy /our-resorts list. Pass check: Indy list fetched at https://www.indyskipass.com/our-resorts (resorts page 404s); ikonpass.com/epicpass.com are JS/bot-blocked but none of these resorts is plausibly on them; powderalliance.com member list and mountaincollective.com text contain no match.

### kissing-bridge  (NY, Western New York)
Operator: https://www.kissingbridge.com  |  cams: https://www.kissingbridge.com/on-the-slopes/mountain-cams
- coords 42.6000, -78.6551; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata —
- Added 2 cam(s):
  - Holly Webcam (iframe) `https://g1.ipcamlive.com/player/player.php?alias=kbsaloon&autoplay=1` credit Kissing Bridge
  - Twister Webcam (iframe) `https://g1.ipcamlive.com/player/player.php?alias=twister&autoplay=1` credit Kissing Bridge
- Notes: Webflow site; kbski.com 301s to www.kissingbridge.com. Cam page is static HTML with two ipcamlive.com player iframes (labels 'Holly Webcam' / 'Twister Webcam' in that order, aliases kbsaloon / twister). ipcamlive also exposes a stable snapshot redirect (https://g1.ipcamlive.com/player/snapshot.php?alias=<alias> -> 302 to a stream-server snapshot.jpg) if an image embed is preferred. Footer 'Terms of Service' and 'Privacy Policy' links are href='#' (no page), so terms verdict is none. YouTube link in footer (@kissingbridge5883) is a channel, not a cam. Holly is also the name of the Holly Quad lift; Twister is a slope name.
- Profile notes: Operator publishes no elevation, vertical, acreage, snowfall or longest-run figures (checked /on-the-slopes, /about, /general-faqs, /on-the-slopes/trail-map). 39 slopes from /on-the-slopes ('39 slopes') and the slope report ('Open Trails 0/39'); 9 lifts from the slope report ('Open Lifts 0/9'). Not on the Indy Pass East list; no Ikon/Epic/MC/Power. Wikidata search for 'Kissing Bridge' returns no ski-area item.

### labrador-mountain  (NY, Finger Lakes)
Operator: https://www.skicny.com/labrador/  |  cams: https://www.skicny.com/labrador/
- coords 42.7418, -76.0302; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata —
- No cams added.
  - skipped: Lab Triple Cam — http-only bare-IP camera feed http://65.73.126.18/cgi-bin/viewer/video.jpg (GET 200 image/jpeg 228171 B at 2026-10-20T14:32Z) - https://65.73.126.18/ does not answer, so the URL cannot be stored as https / would be mixed
  - skipped: Lab Badger Cam — http://65.73.126.81/cgi-bin/viewer/video.jpg - connection failed (000) at 2026-10-20T14:32Z, offline; also http-only bare IP.
- Notes: skilabrador.com does not resolve (DNS); the operator site is skicny.com (WordPress), shared with Song Mountain. 'Webcams' nav menu links directly to raw IP-camera JPEGs (no cam page). Terms: only a privacy policy is linked (no terms-of-use page); no framing/hot-linking clause. Lead coords (42.741758,-76.030249) confirmed. Labrador and Song sell a joint 'Inter-Mountain Passport'.
- Profile notes: Operator site (SkiCNY, shared with Song Mountain) publishes no mountain-stats page: no elevations, vertical, acreage, snowfall, lift count. Only text is 'Over 20 trails of skiing, including 17 lighted trails' (not a precise count, left null). Not on the Indy Pass East list; no Ikon/Epic/MC/Power. Wikidata search 'Labrador Mountain' returns no item.

### plattekill  (NY, Catskills)
Operator: https://plattekill.com  |  cams: https://plattekill.com/on-the-trail/
- coords 42.2903, -74.6537; base/summit 2400 / 3500 ft; station: none qualifies; passes none; wikidata Q22096716
- Opening 2026-27: 2026-12-12 (projected) — https://plattekill.com/on-the-trail/
- No cams added.
  - skipped: Plattekill Mountain Live Stream (YouTube) — Page embeds YouTube vcUI0UZeYIo ('Plattekill Mountain Live Stream | Plattekill Mountain'); oEmbed 200 but the watch page reports liveBroadcastDetails isLiveNow=false (broadcast 2026-10-01 to 2026-10-07). Stream has ended
  - skipped: camName-webcam (https://plattekill.com/webcam/image2.jpg) — GET 200 image/jpeg but only 1448 B with Last-Modified 2026-04-16 - placeholder / dead image.
- Notes: WordPress (Divi) with Complianz consent gating: the YouTube iframe is src=about:blank with data-src-cmplz, so a plain curl shows no live src. The webcams section is #webCams on /on-the-trail/ (no separate cam page). Lead coords confirmed (identical to Wikidata P625). Only a privacy policy is linked (no terms-of-use page), no framing clause.
- Profile notes: Map & Stats block on /on-the-trail/: Summit 3,500 ft, Base 2,400 ft, Vertical 1,100 ft, Trails 41, Lifts 4, Longest Trail 2 miles, Average Snowfall 175in, Snowmaking 75%. Skiable acres not published. Not on Indy/Ikon/Epic/MC/Power lists.

### snow-ridge  (NY, Tug Hill Plateau)
Operator: https://snowridge.com  |  cams: https://snowridge.com/live-feed/
- coords 43.6397, -75.4202; base/summit 1350 / 1850 ft; station: none qualifies; passes indy; wikidata —
- Added 1 cam(s):
  - Live Feed (iframe) `https://www.myearthcam.com/snowridge?embed` credit Snow Ridge
  - skipped: northernchateau.com webcam47 — Third-party link ('View other webcams') to a neighbouring business, not the operator's camera.
- Notes: WordPress (Genesis child theme). Single myEarthCam (EarthCam) embed on /live-feed/; banner says the resort is '*CURRENTLY CLOSED*' for the season but the embed itself loads. No terms or privacy page linked anywhere in the footer. Lead coords confirmed (within 60 m). Home page news mentions last season opened December 7; no 2026-27 opening date announced.
- Profile notes: Mountain Stats: Top Elevation 1850', Base Elevation 1350', Vertical 500', Trails 31, Lifts 5, Terrain Parks 2, Longest Run 3/4 mile (=0.75 mi), Average Annual Snowfall 230in. Skiable acres not published. Indy Pass East list shows 'Turin, NY, USA Snow Ridge' (Indy's own card says 33 trails; operator's 31 used). Wikidata search returns no ski-area item (only unrelated ridges).

### song-mountain  (NY, Finger Lakes)
Operator: https://www.skicny.com/song/  |  cams: https://www.skicny.com/song/
- coords 42.7742, -76.1588; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata —
- No cams added.
  - skipped: Song Cam — http-only bare-IP camera feed http://208.125.159.115/cgi-bin/viewer/video.jpg (GET 200 image/jpeg 167861 B at 2026-10-20T14:32Z) - https://208.125.159.115/ does not answer, so the URL cannot be stored as https / would be
- Notes: songmountain.com 301s to www.skicny.com (WordPress), shared with Labrador Mountain. 'Webcams' nav menu links directly to a raw IP-camera JPEG (no cam page). Terms: only a privacy policy is linked, no framing clause. Lead coords (42.774586,-76.160218) confirmed within ~150 m. Operator's map link labels it 'Song Mountain Resort'.
- Profile notes: Operator site (SkiCNY, shared with Labrador) publishes no mountain-stats page: no elevations, vertical, acreage, snowfall, trail or lift counts. Not on the Indy Pass East list; no Ikon/Epic/MC/Power. Wikidata search 'Song Mountain' returns no item.

### swain  (NY, Western New York)
Operator: https://swain.com  |  no cam page
- coords 42.4766, -77.8546; base/summit 1320 / 1970 ft; station: none qualifies; passes indy; wikidata —
- No cams added.
- Notes: WordPress site. No webcam anywhere on swain.com (checked home, /mountain/, /trail-report/, /trail-map/; the only video is a YouTube promo youtu.be/Un1cr2jryzg used as a page background). COORDS MOVED ~4.4 km: lead list had 42.5,-77.9 (rounded); geocoded operator address is 42.4766,-77.8546. Only a privacy policy is linked (standard WordPress text, 'embedded content' paragraph is about third-party embeds on their site, not a restriction).
- Profile notes: Mountain stats on /mountain/: Trails 35, Base 1,320 ft, Summit 1,970 ft, Vertical 650 ft, Skiing Terrain 120 acres, Longest Run 5,280 ft (converted to 1.0 mi), Annual Snowfall 130in, Snowmaking 97%; lifts = 3 quads + 1 double + 1 surface = 5. Indy Pass East list shows 'Swain, NY, USA Swain Resort'. Wikidata search ('Swain', 'Swain Resort', 'Swain Ski Center') returns no ski-area item.

### titus-mountain  (NY, Adirondacks)
Operator: https://www.titusmountain.com  |  cams: https://www.titusmountain.com/snowcams
- coords 44.7653, -74.2336; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q14707489
- Added 2 cam(s):
  - Lower Mountain (iframe, base) `https://player.brownrice.com/embed/lowertitusmountain` credit Titus Mountain Family Ski Center
  - Upper Mountain (iframe) `https://player.brownrice.com/embed/titusmountainsnow` credit Titus Mountain Family Ski Center
- Notes: Wix site; the snowcams page is JS-rendered (raw curl shows no cam URLs) - Firecrawl render shows two Brownrice players, labelled 'Lower Mountain' (alias lowertitusmountain) and 'Upper Mountain' (alias titusmountainsnow) in that order; page also links per-cam timelapses (player.brownrice.com/embed/<alias>/timelapse/<id>) and HLS (live7.brownrice.com:444/lowertitusmountain/..., streamer4.brownrice.com/titusmountainsnow/...). Stable JPEG alternatives: https://player.brownrice.com/snapshot/<alias>. Terms & Conditions page is generic (no framing/hot-linking/embedding clause). Lead coords confirmed within ~260 m.
- Profile notes: Operator site (Wix) publishes no mountain-stats block: searched home, /trail-map, /conditions, /hours-of-operation, /first-timer-guide, /general-6 for elevation/vertical/acres/snowfall - none. (Indy's own card lists 1200 ft vertical / 53 trails / 9 lifts, but that is not an operator source, so left null.) Trail map PDF also at https://www.titusmountain.com/_files/ugd/b125f1_0139d55a9b7d49f889b045c2e53c20c0.pdf ('Download Map'). Indy Pass East list shows 'Malone, NY, USA Titus Mountain'.

### west-mountain  (NY, Adirondacks)
Operator: https://westmountain.com  |  cams: https://westmountain.com/trail-conditions/
- coords 43.2935, -73.7286; base/summit 460 / 1470 ft; station: none qualifies; passes indy; wikidata Q7986039
- Added 2 cam(s):
  - West Express Face Cam (iframe) `https://g1.ipcamlive.com/player/player.php?alias=racezoomcam&autoplay=1` credit West Mountain
  - Sunrise Cam (iframe) `https://g1.ipcamlive.com/player/player.php?alias=sunrisecam&autoplay=1` credit West Mountain
- Notes: WordPress (Beaver Builder); westmtn.net 301s to westmountain.com. 'Mountain Cams' block on /trail-conditions/ holds two ipcamlive iframes, labelled 'West Express Face Cam' (alias racezoomcam) then 'Sunrise Cam' (alias sunrisecam). ipcamlive snapshot redirect https://g1.ipcamlive.com/player/snapshot.php?alias=<alias> gives a stable JPEG alternative. Only a privacy policy is linked (no terms-of-use page), no framing clause. Lead coords were 0.9 km south of the geocoded base address (not flagged, < 2 km). 26-27 season passes on sale; no opening date announced.
- Profile notes: 'Winter Mountain Stats' on /trail-maps/: Top Elevation 1470', Base Elevation 460', Vertical Drop 1010', Skiable acres 130, Longest Run 1.4 mi, Terrain Parks 2, Uphill lifts: 2 surface / 1 quad / 2 triple / 1 rope tow (=6), Trails 35 (30 groomed / 5 ungroomed glades), Night Skiing 100%, Snowmaking 100%. Annual snowfall not published. Indy Pass East list shows 'Queensbury, NY, USA West Mountain'.

### bromley  (VT, Southern Vermont)
Operator: https://bromley.com  |  cams: https://bromley.com/webcams
- coords 43.2136, -72.9327; base/summit 1950 / 3284 ft; station 2042:VT:SCAN Lye Brook 2440 ft at 19.4 km; passes none; wikidata Q4973688
- Added 2 cam(s):
  - Slope Cam (image, mid) `https://img.hdrelay.com/camera/62c706457fd92a4cfa4d6b39/snapshot` credit Bromley Mountain Ski Resort
  - Base Area Cam (image, base, 1950 ft) `https://img.hdrelay.com/camera/62c7049a7fd92a4cfa4d6b37/snapshot` credit Bromley Mountain Ski Resort
- Notes: Next.js site (Craft CMS backend at admin.bromley.com). Webcam page embeds two HD Relay iframes with NO labels; names above are descriptive from the snapshots (cam 1 looks up a chairlift line/slope from low on the mountain, cam 2 shows the base area sun deck with umbrellas and the lower lift terminals). HD Relay player JSON gives the same placeholder lat/lng for both. No 2026-27 opening date published (snow report 2026-10-19 shows 0/48 trails, no date). Terms & Conditions are generic (no-reproduction/anti-scraping boilerplate, no framing/embedding clause). Policies index: https://bromley.com/policies.
- Profile notes: About page 'Mountain Facts': base 1,950 ft, summit 3,284 ft, vertical 1,334 ft, 47 trails on 178 of 300 acres, 9 lifts, 145in avg snowfall, longest trail 2.5 mi (Runaround). Homepage/snow report say 48 trails; stats page says 47. Bromley sells an Ikon Session 3-Day add-on to its own passholders but is NOT listed on ikonpass.com/en/destinations; not on Indy or Mountain Collective lists.

### magic-mountain  (VT, Southern Vermont)
Operator: https://www.magicmtn.com  |  cams: https://www.magicmtn.com/snow-report
- coords 43.2017, -72.7727; base/summit 1350 / 2850 ft; station: none qualifies; passes indy; wikidata Q6730788
- Added 1 cam(s):
  - Magic Mountain Live Webcam (skimagicvt livestream) (youtube) `https://www.youtube.com/embed/iMdj-G2rvfA` credit Magic Mountain (Ski Magic LLC)
- Notes: Wix site. The snow-report page embeds the YouTube live (youtube.com/live/iMdj-G2rvfA) via a Wix 'webcamUrl' CMS field with placeholder title 'Your Video Title'; the operator gives no cam label, so the YouTube stream title is used and kind is unknown. Opening: about page only says 'Lifts Open Early December' (no 2026-27 date). No terms/privacy page linked in the footer (only copyright + uphill policy).
- Profile notes: Operator: 'Base/Summit Elevation: 1,350 / 2,850 feet; Vertical Drop: 1,500 feet; Longest Trail: 1.6 miles; Average Snowfall: 130"; 39 Trails / 11 Glades (on map); 205 Acres of on-map trails and glades' plus '200 Acres of off-map tree skiing' (not counted); '5 total lifts'. runs_total = 39 trails (glades excluded).

### middlebury-snowbowl  (VT, Green Mountains)
Operator: https://middleburysnowbowl.com  |  cams: https://middleburysnowbowl.com/webcams/
- coords 43.9392, -72.9575; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q6841756
- Added 1 cam(s):
  - Worth Mtn. Chairlift - Bottom of the Allen (youtube, mid) `https://www.youtube.com/embed/zittSTsKYNs` credit Middlebury Snow Bowl (Middlebury College)
  - skipped: Sheehan Base Area - Bottom of the Lang, Cameron, Kelton — oembed 404 for embedded YouTube id 1SxtS7A2hJo (stream ended); no replacement live stream on the @MiddleburySnowBowl channel streams tab as of 2026-10-20
- Notes: WordPress. Webcam page embeds two YouTube lives; only the Worth Mtn. one is alive. Footer links only a Cancellation & Refund Policy, no terms/privacy page. No 2026-27 opening announcement on mountain-updates (latest post 2026-06-01). Operator spells the name both 'Snowbowl' (site title) and 'Snow Bowl' (YouTube/Wikidata).
- Profile notes: Operator: 'three chairlifts (two triples and one double) and a surface lift serve 28 trails and 11 gladed areas across 110 skiable acres, with over 600 additional acres of woods and backcountry terrain'. Lead list's 600 acres is the backcountry figure, not skiable acres. No elevation, vertical, snowfall or longest-run figures published on the operator site (mountain-info, conditions, trail-map pages checked).

### quechee  (VT, Green Mountains)
Operator: https://quecheeclub.com/web/pages/skiquechee  |  cams: https://quecheeclub.com/web/pages/ski-conditions-weather-station
- coords 43.6572, -72.4431; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q28407653
- No cams added.
  - skipped: Ski Quechee LIVE Feed — YouTube xbiRopr0cx4 (linked as youtube.com/live/xbiRopr0cx4 on the conditions page): oembed 200 but liveBroadcastDetails.isLiveNow=false, stream ended 2026-03-27 (seasonal). Re-check for a new live id once the 2026-27 se
- Notes: Liferay portal site (quecheeclub.com) of the Quechee Lakes Landowners' Association; the ski hill is 'Ski Quechee' at the Quechee Club. Conditions page also embeds a WeatherLink weather-station iframe (not a cam) and a 2018 trail-map image. No terms/privacy page found in the footer.
- Profile notes: Operator conditions page: 'TRAILS: 13, LIFTS: 3, VERTICAL DROP: 650''. No elevations, acres, snowfall or longest run published. Not on Indy/Ikon/Epic/Mountain Collective lists.

### black-mountain-nh  (NH, White Mountains)
Operator: https://www.blackmt.com  |  no cam page
- coords 44.1630, -71.1662; base/summit 1250 / 2350 ft; station: none qualifies; passes indy; wikidata Q4921350
- No cams added.
- Notes: Wix site. No webcam page or embedded cam found on the homepage, /conditions, /the-mountain or /trail-map (grepped for iframe/YouTube/HD Relay/Brownrice/Wetmet). The GM's 2026-10 letter says snowmaking is starting but gives no 2026-27 opening date.
- Profile notes: Operator stats box: 'Lifts: 5, Trails: 61, Skiable Terrain: 140 Acres, Summit Elevation: 2350', Vertical Drop: 1100''. The prose on the same page says '45 trails'; the stats box figure is used. Base elevation derived as summit minus vertical (operator does not state it). Snowfall and longest run not published. Indy Pass lists 'Black Mountain Ski Area' (Indy Pass bought the mountain in 2024, per operator history).

### crotched  (NH, Southern New Hampshire)
Operator: https://www.crotchedmtn.com  |  cams: https://www.crotchedmtn.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 43.0120, -71.8788; base/summit 1050 / 2066 ft; station: none qualifies; passes epic; wikidata Q14705323
- Added 1 cam(s):
  - Base Area (iframe, base, 1050 ft) `https://player.brownrice.com/embed/crotchedrocket` credit Crotched Mountain (Vail Resorts)
  - skipped: Crotched Summit — Brownrice cam 'crotchedsummit' offline: snapshot https://streamer2.brownrice.com/cam-images/crotchedsummit.jpg returns 404 and the operator page renders the Brownrice 'webcam appears to be offline' placeholder (player.br
- Notes: Vail Resorts site behind Akamai (curl gets a stub; fetched with Firecrawl). Cam page = two Brownrice players titled 'Crotched Summit' and 'Base Area'. Hours page still shows the 2025-26 schedule ('Closed for the 25/26 Winter Season'); no 2026-27 date. No social links in the rendered page; terms are the generic Epic Pass policies page.
- Profile notes: Operator: Highest Elevation 2,066 ft; Base Elevation 1,050 ft; Skiable Terrain 100 Acres; Lifts 5; Trails 25; Terrain Parks 2. Vertical derived as summit minus base (operator says 'over 1,000 vertical feet'). Snowfall and longest run not published. epicpass.com footer lists 'Crotched, NH'.

### gunstock  (NH, Lakes Region)
Operator: https://www.gunstock.com  |  cams: https://www.gunstock.com/discover/webcams/
- coords 43.5411, -71.3629; base/summit 960 / 2300 ft; station: none qualifies; passes none; wikidata Q5619412
- Added 3 cam(s):
  - Summit (Lake Winnipesaukee view) (iframe, summit, 2300 ft) `https://api.wetmet.net/widgets/stream/frame.php?ruc=196-01-01` credit Gunstock Mountain Resort
  - Historic Lodge (trails, summit, Ramrod and Panorama lifts) (iframe, base) `https://api.wetmet.net/widgets/stream/frame.php?ruc=196-02-01` credit Gunstock Mountain Resort
  - Base Area (tubing hill and Penny Lift) (iframe, base) `https://api.wetmet.net/widgets/stream/frame.php?ruc=196-03-01` credit Gunstock Mountain Resort
- Notes: Custom CMS (not WordPress). Webcam page has three WetMet (Weather Metrics) PlayerFrame iframes; the operator labels them only by description ('A live view from the summit overlooking Lake Winnipesaukee', '...from the Historic Lodge', '...base area, tubing hill, and Penny Lift'), names above are condensed from those. Snow report (2026-10-19) says closed for skiing, no 2026-27 opening date.
- Profile notes: Operator: 'Summit Elevation: 2,300 feet; Vertical Drop: 1,340 feet; Average Annual Snowfall: 120 inches; Skiable acreage: 227 (trails and glades); Number of trails 44 (plus 5 glades); Longest Run: Flintlock to Stonebar 1.5 Miles; 8 Lifts: 1 high-speed quad, 2 quads, 2 triples, 3 carpets'. Base elevation derived as summit minus vertical (not stated). Not on Indy/Ikon/Epic/Mountain Collective lists (county-owned independent).

### mount-sunapee  (NH, Dartmouth-Sunapee)
Operator: https://www.mountsunapee.com  |  cams: https://www.mountsunapee.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 43.3306, -72.0800; base/summit 1233 / 2743 ft; station: none qualifies; passes epic; wikidata Q6923944
- Added 3 cam(s):
  - Summit Camera (iframe, summit, 2743 ft) `https://player.brownrice.com/embed/sunapeesummit` credit Mount Sunapee (Vail Resorts)
  - Spruce Lodge (iframe, base, 1233 ft) `https://player.brownrice.com/embed/sunapeesprucelodge` credit Mount Sunapee (Vail Resorts)
  - Express Lift (iframe, base) `https://player.brownrice.com/embed/sunapeeexpresslift` credit Mount Sunapee (Vail Resorts)
- Notes: Vail Resorts site behind Akamai (fetched with Firecrawl). Three Brownrice players (section heading 'Spruce Web Cam' groups the Spruce Lodge and Express Lift players). Summit snapshot is small (15 KB, night image) but refreshed within the minute. Hours page: 'Closed for the season. See you this winter!' with no 2026-27 date. No social links in the rendered page; terms are the generic Epic Pass policies page.
- Profile notes: Operator: Highest Elevation 2,743 ft; Base Elevation 1,233 ft; Skiable Terrain 233 Acres; Lifts 8; Trails 67; Terrain Parks 4. Vertical derived as summit minus base. Snowfall and longest run not published. epicpass.com footer lists 'Mount Sunapee, NH'.

### pats-peak  (NH, Southern New Hampshire)
Operator: https://www.patspeak.com  |  cams: https://www.patspeak.com/the-mountain/cams-media/web-cams/
- coords 43.1633, -71.7958; base/summit 690 / 1460 ft; station: none qualifies; passes indy; wikidata Q7148200
- Added 2 cam(s):
  - Pats Peak LIVE! Cam (youtube) `https://www.youtube.com/embed/KFjl8wPJvyg` credit Pats Peak Ski Area
  - Pats Peak Bluster Area LIVE! (youtube) `https://www.youtube.com/embed/NYfXOUPjSNI` credit Pats Peak Ski Area
- Notes: WordPress 7.1.3 behind a WAF: curl and WebFetch get 403, Firecrawl works. Webcam page embeds two YouTube lives from channel UCe5pvOdykmiDAYsLct9lq1g. Socials come from page meta (twitter:site @patspeak, article:publisher facebook.com/patspeakskiarea); footer not rendered in the scrape, Instagram unknown. Only an Accessibility Policy was found, no terms/privacy page. No 2026-27 opening date announced (night skiing 'starting December 26th' is a generic schedule note).
- Profile notes: Operator 'Trail Map + Stats': 'Summit Elevation: 1,460 feet; Base Elevation: 690 feet; Vertical Drop: 770 feet; 28 TRAILS & SLOPES WITH 9 GLADED AREAS; 11 LIFTS; Longest run: 1.5 miles Breeze/Zephyr/Squall Line'. Skiable acres and annual snowfall not published. Indy Pass east list includes Pats Peak.

### ragged-mountain  (NH, Dartmouth-Sunapee)
Operator: https://www.raggedmountainresort.com  |  cams: https://www.raggedmountainresort.com/mountain-report-cams/
- coords 43.4871, -71.8410; base/summit 1036 / 2286 ft; station: none qualifies; passes indy; wikidata Q7282899
- Added 2 cam(s):
  - Elmwood Lodge Cam (iframe, base) `https://api.wetmet.net/widgets/stream/frame.php?uid=7dc1cb45d929cdd28e605666a9315cbc` credit Ragged Mountain Resort
  - Meetinghouse Lodge Cam (iframe, base) `https://api.wetmet.net/widgets/stream/frame.php?uid=1e039d71ff08195e4052b01859843890` credit Ragged Mountain Resort
- Notes: WordPress (pgri theme, WP Rocket lazy-load: iframes are data-lazy-src). Operator descriptions: Elmwood Lodge cam 'just outside of Stone Hearth at the base of the Wild Side Terrain Park'; Meetinghouse Lodge cam 'at the base of the Summit Six Express'. Mapping of WetMet uids to names follows card order (image + stream iframe precede each title). Still-image alternatives are listed in verification if iframes are not wanted. Site banner: 'now closed for the 2025-26 winter season', no 2026-27 date.
- Profile notes: Operator: 'Ski Trails: 57 total including glades; Vertical Drop: 1,250 feet; Skiable Terrain: 250 acres; LIFTS: 1 high speed six person chairlift, 1 high speed four person chairlift, 1 triple chairlift, 2 surface carpet lifts; ELEVATION: The top of Ragged Mountain Resort is Pinnacle Peak at 2,286 feet above sea level'. Base elevation derived as summit minus vertical. Snowfall and longest run not published.

### tenney-mountain  (NH, White Mountains)
Operator: https://skitenney.com  |  no cam page
- coords 43.7475, -71.7646; base/summit 850 / 2350 ft; station 2043:NH:SCAN Mascoma River 1400 ft at 21.2 km; passes indy; wikidata Q7700283
- No cams added.
- Notes: Lead domain tenneymtn.com is dead (HTTPS refuses, HTTP serves a parked page); operator site is skitenney.com (WordPress). No webcam anywhere on the site (snow report is an iframe from skitenney.propapps.io with no cams). Only a privacy page is linked, no terms page. Site says 'closed for the 2025/26 winter season'; no 2026-27 opening date announced.
- Profile notes: Stats page 'TENNEY MOUNTAIN STATS': elevation 2350 ft (720 m), vertical drop 1500 ft (457 m), 130 acres, 50 trails. Home page 'by the numbers' disagrees: 2,100' summit, 53 named trails; snow-report widget shows 0/4 lifts (lift count taken from that). Base elevation derived as 2350-1500=850 (not published). Snowfall and longest run not published. Indy Pass confirmed on indyskipass.com east list.

### whaleback  (NH, Dartmouth-Sunapee)
Operator: https://www.whaleback.com  |  no cam page
- coords 43.5988, -72.1821; base/summit — / — ft (operator publishes none); station 2043:NH:SCAN Mascoma River 1400 ft at 23.3 km; passes indy; wikidata Q7990522
- No cams added.
- Notes: Squarespace site; /mountain-info redirects to /about-whaleback. 501(c)(3) non-profit. No webcam on the site. No terms or privacy page linked. No 2026-27 opening date announced.
- Profile notes: Operator site publishes no mountain stats (no elevation, vertical, acres, trail or lift counts found on about-whaleback, trail-map, trail-report, hours-location). Indy Pass confirmed on indyskipass.com east list.

### big-moose  (ME, Moosehead Lake)
Operator: https://skibigmoose.com  |  cams: https://skibigmoose.com/live-web-cam
- coords 45.5040, -69.7073; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q4906452
- Added 2 cam(s):
  - Mountain Cam (youtube, base) `https://www.youtube.com/embed/8cGtyN9MiwA` credit Boston and Maine Live
  - Lift Cam (youtube) `https://www.youtube.com/embed/sGrMkMV26Uw` credit Boston and Maine Live
- Notes: GoDaddy Website Builder site run by Friends of the Mountain (501c3, operator since 2012). bigmoosemountain.com is a parked redirect page, not the operator. Cam page labels: 'Mountain Cam — Live time happenings from the base lodge' and 'Lift Cam — Chairlift view from the lifthouse'; both are YouTube live streams owned by the 'Boston and Maine Live' channel embedded on the operator page. Footer links only Google's generic policies (GoDaddy template) — no operator terms. Home page: 'Opening Day is a couple months away!' with no date.
- Profile notes: No current stats page. History page says the Thompson Double 'increased the vertical drop to 1,700ft' (historical, upper mountain, not confirmed as current). Wikidata item is under the former name 'Big Squaw Mountain Resort' (P31 ski area, Greenville). Indy Pass confirmed on indyskipass.com east list.

### black-mountain-of-maine  (ME, Western Maine)
Operator: https://skiblackmountain.org  |  no cam page
- coords 44.5770, -70.6134; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q4921353
- No cams added.
- Notes: Squarespace site; /the-mountain redirects to /mountain-report. No webcam on the site or on the blackmtn.whitepeakstechnologies.com store. No 2026-27 opening date announced.
- Profile notes: About page: '1380' of vertical ... Two chair lifts & a T-bar connect you to over 50 trails & glades'; visit page: '600 acres of boundary to boundary skiing'. runs_total left null because only 'over 50 trails & glades' is stated. No elevations, snowfall or longest run published. Trail map page not found in nav. Indy Pass confirmed on indyskipass.com east list and operator /indy-pass page.

### camden-snow-bowl  (ME, Midcoast Maine)
Operator: https://camdensnowbowl.com  |  cams: https://camdensnowbowl.com/web-cam/
- coords 44.2167, -69.1345; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q5025811
- Added 1 cam(s):
  - Web Cam (iframe) `https://player.brownrice.com/embed/camdensnowbowl1` credit Camden Snow Bowl
- Notes: WordPress site, town-owned (Camden Parks and Rec). Single Brownrice cam embedded directly as an iframe on /web-cam/, labelled just 'Web Cam' (view location not described). Only a winter-policies page, no terms page. No 2026-27 opening date announced.
- Profile notes: About page: 1000 vertical feet, 15 ski trails, 2 terrain parks, 11 glades; conditions page lists three lifts (Triple Chairlift, Double Chairlift, Conveyor Lift). No elevations, acres, snowfall or longest run published. Indy Pass confirmed on indyskipass.com east list.

### lost-valley  (ME, Southern Maine)
Operator: https://www.lostvalleyski.com  |  no cam page
- coords 44.1353, -70.2810; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q6684296
- Opening 2026-27: 2026-12-05 (projected) — https://www.lostvalleyski.com/lift_ticket_season_pass/
- No cams added.
- Notes: WordPress site whose home page is currently branded for the brewpub/event venue. No webcam on the site. No terms or privacy page linked.
- Profile notes: Operator site publishes no mountain stats and no trail map page was found in the nav. Indy Pass confirmed on indyskipass.com east list.

### mt-abram  (ME, Western Maine)
Operator: https://www.mtabram.com  |  no cam page
- coords 44.3807, -70.7063; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q61233805
- No cams added.
- Notes: WordPress site. No webcam on the site (mountain-report page has none). No 2026-27 opening date announced.
- Profile notes: Winter FAQ: '42 trails across Mainside and Westside'; 'two double chairlifts, a T-Bar, and a Magic Carpet' (=4 lifts). No elevations, vertical, acres, snowfall or longest run published. Indy Pass confirmed on indyskipass.com east list.

### pleasant-mountain  (ME, Southern Maine)
Operator: https://www.pleasantmountain.com  |  cams: https://www.pleasantmountain.com/mountain-report
- coords 44.0589, -70.8154; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q7491557
- **No cams added: terms hold.** https://www.pleasantmountain.com/terms-of-sale — "You agree to no scraping, crawling, or automated data extraction from the Sites or Apps ... (2) Frame or utilize framing techniques to enclose any Trademark or other Content (including, without limitation, any images, text or page layout).". Verified embeds, for the maintainer's decision:
  - Main Base Webcam: terms forbid (Boyne terms-of-sale: 'Frame or utilize framing techniques to enclose any Trademark or other Content'). Would otherwise be youtube rsWFrwmJL40 via camstreamer.com/embed/ln5sPfRcP6CL71TugywNtpdAlBm5ZHQnVSxlCaj6 (302), oembed 200, isLiveNow true, iframe title 'Main Base Area', kind base
- Notes: Next.js/Sanity site (Boyne Resorts); nav is client-rendered so use sitemap.xml. Footer links Boyne's privacy policy and the site's terms-of-sale, which contains an explicit anti-framing clause -> hold. Event page 'Opening Weekend' is still the 2025-26 one; no 2026-27 date announced.
- Profile notes: No mountain-stats page found (faqs, trail-map, our-history, mountain-report checked); Boyne site publishes no elevation/vertical/acreage numbers. Not on the Indy east list; not found on ikonpass.com destinations (Maine entries seen: Sunday River/Sugarloaf) — Boyne's own New England Pass is not one of the tracked passes.

### saddleback  (ME, Western Maine)
Operator: https://www.saddlebackmaine.com  |  cams: https://www.saddlebackmaine.com/webcams/
- coords 44.9462, -70.5271; base/summit 2460 / 4120 ft; station: none qualifies; passes indy; wikidata Q7397750
- Added 3 cam(s):
  - Top of the World Cam (image, summit) `https://img.hdrelay.com/camera/6201a432a002ff5c9960fef3/snapshot` credit Saddleback Mountain
  - Top of the Rangeley Cam (image, mid) `https://img.hdrelay.com/camera/6201a4aca002ff5c9960fef4/snapshot` credit Saddleback Mountain
  - Lodge Cam (image, base) `https://img.hdrelay.com/camera/6201a37aa002ff5c9960fef2/snapshot` credit Saddleback Mountain
- Notes: WordPress site. Webcams page loads three HDRelay players via JS (webcam_holder1-3 -> player ids 6201a85ba002ff5c9960fef5 / 6202fb39ad44285b71b28d2a / 62067f4cad44285b71b28d2c), resolved via manage.hdrelay.com/player/<id> to camera ids 6201a37a... (Lodge), 6201a432... (Top of the World, top of Kennebago Quad), 6201a4ac... (Top of the Rangeley, top of Rangeley Express Quad). Lift-top elevations not published. Also on TikTok @saddlebackmaine. No 2026-27 opening date announced on the site.
- Profile notes: Stats page: base 2,460', summit 4,120', vertical 2,000', 68 trails, 6 lifts, 600+ skiable acres (recorded as 600), 225" annual snowfall, longest run 3.1 miles. Indy Pass confirmed on indyskipass.com east list and operator /indy-pass page.

### berkshire-east  (MA, Berkshires)
Operator: https://www.berkshireeast.com  |  cams: https://www.berkshireeast.com/winter/mountain-conditions
- coords 42.6227, -72.8784; base/summit 660 / 1840 ft; station: none qualifies; passes indy; wikidata Q4892259
- No cams added.
  - skipped: Base Area — static image only (/media/yootheme/cache/e2/base-e21970f9.jpeg); Last-Modified 2026-09-04, no live feed URL found
  - skipped: Lower Big Chief — static image only (/media/yootheme/cache/56/bigchief-560b07ef.jpeg); Last-Modified 2026-09-04
  - skipped: Summit — static image only (/media/yootheme/cache/fe/summit-fee39db0.jpeg); Last-Modified 2026-09-04
- Notes: Joomla/YOOtheme site, curl OK. The WEBCAMS section on /winter/mountain-conditions (#webcams) and /summer/summer-mountain-conditions is a lightbox gallery of three YOOtheme-cached JPEGs (base/bigchief/summit) last modified 2026-09-04; no iframe, YouTube or snapshot endpoint found. Re-check once the season starts in case the source images are refreshed by cron. Terms live in a 'Terms & Conditions' section of the privacy-policy article (no-reproduction boilerplate only).
- Profile notes: Operator publishes summit 1,840 ft and vertical 1,180 ft; base derived as summit minus vertical. Longest run published as 13,200 ft (=2.5 mi). Lifts: 3 quads, 2 surface, 1 double (operator says 'number of lifts 5'). Indy Pass verified on indyskipass.com East list.

### bousquet  (MA, Berkshires)
Operator: https://bousquetmountain.com  |  cams: https://bousquetmountain.com/live-cam/
- coords 42.4192, -73.2777; base/summit 1068 / 1818 ft; station: none qualifies; passes indy; wikidata Q105883515
- Added 2 cam(s):
  - Live Cam 1 (iframe) `https://streamedian.com/saas/embed/?s=cnRzcDovLzcyLjQzLjI1LjE3MDo3NDQ3L3R5Mm5CVjdtekJrV3NpZFM=&r=NzIweDQ4MA==&w=d3NzOi8vc3RyZWFtZWRpYW4uY29tL2RlbW9uc3RyYXRpb24vd3Mv` credit Bousquet Mountain
  - Live Cam 2 (iframe) `https://streamedian.com/saas/embed/?s=cnRzcDovLzcyLjQzLjI1LjE3MDo3NDQ3L2pzR2w4MTFEajB6dklSd3I=&r=NzIweDQ4MA==&w=d3NzOi8vc3RyZWFtZWRpYW4uY29tL2RlbW9uc3RyYXRpb24vd3Mv` credit Bousquet Mountain
- Notes: WordPress/Elementor, curl OK (bousquets.com does not resolve; site is bousquetmountain.com). /live-cam/ holds two unlabeled Streamedian SaaS iframes (names 'Live Cam 1/2' are ours; the page title is just 'Live Cam'). The embeds wrap RTSP streams from a resort IP via Streamedian's 'demonstration' websocket relay, so they may be a trial setup; WebRTC/websocket playback could not be confirmed with curl, only the embed page headers. Footer also links a YouTube channel (https://www.youtube.com/channel/UCRo8Vl9Lq7h90isp_C2cTNA) and a Twitter icon with no URL.
- Profile notes: Operator: base 1,068 ft, peak 1,818 ft, vertical 750 ft, 23 trails, 200 acres, lifts 4 (1 triple, 1 double, 2 surface), 90% snowmaking. Snowfall and longest run not published. Indy Pass verified on indyskipass.com East list.

### butternut  (MA, Berkshires)
Operator: https://skibutternut.com  |  cams: https://skibutternut.com/livestream/
- coords 42.1828, -73.3204; base/summit 800 / 1800 ft; station: none qualifies; passes none; wikidata Q7534854
- Added 2 cam(s):
  - Livestream 1 (iframe) `https://rtsp.me/embed/Q93RN9H7/` credit Ski Butternut
  - Livestream 2 (iframe) `https://rtsp.me/embed/BK6ynZ7b/` credit Ski Butternut
- Notes: SoSimple CMS, curl OK. /livestream/ has two unlabeled rtsp.me iframes (operator heading is just 'Livestream'; 'Livestream 1/2' are our names). rtsp.me embed pages are JS players; the stream being live could not be confirmed with curl (both pages are identical 15 KB shells). Nominatim geocodes the street address to the road only, so the 'Ski Butternut' sports_centre node (0.5 km from the lead coords) was used.
- Profile notes: Operator: 22 trails, vertical 1000', summit 1800', 100 skiable acres, lifts: 5 quads + 4 learning carpets (+1 tubing carpet, excluded). Base derived as summit minus vertical. Snowfall not published. Not on Indy East list; homepage 'Ikon Pass Discounts' is a perk, not Ikon membership.

### big-boulder  (PA, Pocono Mountains)
Operator: https://www.jfbb.com  |  cams: https://www.jfbb.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 41.0502, -75.6013; base/summit 1700 / 2175 ft; station: none qualifies; passes epic; wikidata —
- No cams added.
  - skipped: Big Boulder mountain cams — operator page says 'The webcams are currently offline and will return this fall'; no cam embeds or names in the rendered HTML
- Notes: Vail Resorts site shared with Jack Frost (jfbb.com; Akamai, fetched with Firecrawl). The shared mountain-cams page shows only an offline notice as of 2026-10-19; re-scrape in November and attribute cams by name.
- Profile notes: Operator (Big Boulder section): highest 2,175 ft, base 1,700 ft, 7 lifts, 19 trails, 2 terrain parks. Vertical derived as summit minus base. Acres, snowfall, longest run not published. Epic Pass verified on epicpass.com ('Big Boulder, PA'). No Wikidata item found for the ski area. Note the operator's getting-here page repeats Jack Frost's DMS coordinates under Big Boulder by mistake; the Big Boulder Google Maps link was used instead.

### blue-knob  (PA, Allegheny Mountains)
Operator: https://blueknob.com  |  cams: https://blueknob.com/trail-map-conditions/
- coords 40.3013, -78.5295; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata —
- Added 1 cam(s):
  - Blue Knob Webcam (iframe) `https://g0.ipcamlive.com/player/player.php?alias=blueknob&autoplay=1` credit Blue Knob All Seasons Resort
- Notes: WordPress behind Cloudflare: curl gets 403, fetched with Firecrawl. The operator links 'Click Here For Our Webcam' to https://www.ipcamlive.com/blueknob (that landing page sends X-Frame-Options SAMEORIGIN); the IPCamLive player URL for the same alias embeds cleanly. The per-stream snapshot https://s152.ipcamlive.com/streams/986d2onvsgjixfl3j/snapshot.jpg works as an image source but the streamid may rotate, so the alias-based player is stored. Coordinates: the operator address geocodes to the resort entrance / golf clubhouse at 40.3013,-78.5295, about 3.1 km NE of the lead coords (40.288544,-78.563006, which sit on the ski slopes); flagging the move, maintainer may prefer the lead point for the ski base. No social links or terms page found on the operator site.
- Profile notes: Operator site publishes no elevation/vertical/acres/lift/snowfall figures on the home, resort, trail-map-conditions, FAQ, contact or directions pages (only 'highest skiable mountain in PA'). runs_total=34 is the count of named trails on the operator's conditions table (page keywords also say '34 trail conditions'). Indy Pass verified on indyskipass.com Mid-Atlantic list ('Blue Knob All Season Resort'). Wikidata only has the mountain (Q4929311), not the ski area.

### elk-mountain  (PA, Endless Mountains)
Operator: https://www.elkskier.com  |  cams: https://www.elkskier.com/webcams/
- coords 41.7234, -75.5534; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q5364061
- No cams added.
  - skipped: Picnic Lodge — Verkada embed (vauth.command.verkada.com/__v/elk-mountain-ski-resort/embed/html/6eaf1849-...) 302s to command.verkada.com/embed.html with a per-request token, payload domain-locked to www.elkskier.com; final page sends X
  - skipped: Susquehanna — same Verkada embed scheme (71ff54c3-...); per-request token, domain-locked, X-Frame-Options SAMEORIGIN
  - skipped: Boardwalk — same Verkada embed scheme (fd468386-...); per-request token, domain-locked, X-Frame-Options SAMEORIGIN
- Notes: WordPress, curl OK. /webcams/ has three Verkada Command embeds (Picnic Lodge, Susquehanna, Boardwalk). The redirected player page does send 'content-security-policy: frame-ancestors ... *' alongside X-Frame-Options SAMEORIGIN (CSP wins in modern browsers), but the embed token is minted per request and the payload names domains=www.elkskier.com, so cross-site embedding is not stable; skipped per the audit rule. /conditions-web-cam/ redirects to /conditions/. Only a privacy policy is linked (no terms of use).
- Profile notes: Operator homepage states '180 acres. 27 trails.' Lifts counted from the conditions page lift table: 6 chairlifts (5 doubles, 1 quad) plus a terrain-park cable tow (excluded). No elevation, vertical, snowfall or longest-run figures published on the operator site. Not on Indy, Epic, Ikon lists.

### jack-frost  (PA, Pocono Mountains)
Operator: https://www.jfbb.com  |  cams: https://www.jfbb.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 41.1075, -75.6531; base/summit 1400 / 2000 ft; station: none qualifies; passes epic; wikidata Q15229111
- No cams added.
  - skipped: Jack Frost mountain cams — operator page says 'The webcams are currently offline and will return this fall'; no cam embeds or names in the rendered HTML
- Notes: Vail Resorts site (Akamai; curl gets a stub, fetched with Firecrawl). Jack Frost and Big Boulder share jfbb.com and one mountain-cams page; as of 2026-10-19 it shows only an offline notice, so no cams could be attributed to either mountain. Re-scrape in November; Vail sister sites use Brownrice players (player.brownrice.com/embed/<slug>). The lead list had no coordinates; these come from the operator's getting-here page.
- Profile notes: Operator (Jack Frost section of the JFBB mountain-info page): highest 2,000 ft, base 1,400 ft, 9 lifts, 20 trails, 1 terrain park. Vertical derived as summit minus base. Acres, snowfall, longest run not published. Epic Pass verified on epicpass.com ('Jack Frost, PA').

### laurel-mountain  (PA, Laurel Highlands)
Operator: https://www.laurelmountainski.com  |  cams: https://www.laurelmountainski.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 40.1636, -79.1652; base/summit 2005 / 2766 ft; station: none qualifies; passes epic; wikidata Q6499924
- No cams added.
  - skipped: Laurel Main Lodge — Brownrice cam 'laurelmainlodge' offline: player page says 'The webcam that you are attempting to view appears to be offline'; snapshot Last-Modified 2026-09-22 (stale)
- Notes: Vail Resorts site (Akamai, fetched with Firecrawl). One Brownrice cam, Laurel Main Lodge (player.brownrice.com/embed/laurelmainlodge, 200 and frameable), but offline as of 2026-10-20; re-check in season. No social links found in the scraped pages. No 2026-27 opening date on the snow report page.
- Profile notes: Operator: highest 2,766 ft, base 2,005 ft, 70 acres, 1 lift, 19 trails. Vertical derived as summit minus base. Snowfall and longest run not published. Epic Pass verified on epicpass.com ('Laurel Mountain, PA').

### liberty-mountain  (PA, South Mountain)
Operator: https://www.libertymountainresort.com  |  cams: https://www.libertymountainresort.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 39.7637, -77.3755; base/summit 570 / 1190 ft; station: none qualifies; passes epic; wikidata Q6541882
- Added 5 cam(s):
  - Courtyard Cam (iframe, base) `https://player.brownrice.com/embed/libertyiceskate1` credit Liberty Mountain Resort
  - Learning Area (iframe, base) `https://player.brownrice.com/embed/libertymountaintlc` credit Liberty Mountain Resort
  - Alpine Base (iframe, base, 570 ft) `https://player.brownrice.com/embed/libertyalpinebase` credit Liberty Mountain Resort
  - Summit Cam (iframe, summit, 1190 ft) `https://player.brownrice.com/embed/libertysummit` credit Liberty Mountain Resort
  - Backside (iframe) `https://player.brownrice.com/embed/libertybackside` credit Liberty Mountain Resort
  - skipped: Bubly Tubing — Brownrice cam 'libertytubing' snapshot Last-Modified 2026-09-22 (stale, seasonal tubing park not yet open)
- Notes: Vail Resorts site (Akamai, fetched with Firecrawl). Six Brownrice players; the operator caption sits below each player, so slugs map as libertyiceskate1=Courtyard Cam, libertymountaintlc=Learning Area, libertyalpinebase=Alpine Base, libertysummit=Summit Cam, libertybackside=Backside, libertytubing=Bubly Tubing. Still images are also available at https://player.brownrice.com/snapshot/<slug> (stable, no cache-buster) if an image embed is preferred. No 2026-27 opening date on the snow report page.
- Profile notes: Operator: highest 1,190 ft, base 570 ft, 100 acres, 8 lifts, 16 trails, 2 terrain parks. Vertical derived as summit minus base. Snowfall and longest run not published. Epic Pass verified on epicpass.com ('Liberty Mountain Resort, PA'). Coordinates moved ~1.1 km W of the lead point to the operator's parking-lot pin.

### montage-mountain  (PA, Pocono Mountains)
Operator: https://www.montagemountainresorts.com  |  cams: https://www.montagemountainresorts.com/live-cams/
- coords 41.3511, -75.6618; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q7548935
- No cams added.
  - skipped: Mountain Cam 1 (wetmet 1be3c2fd...) — iframe https://api.wetmet.net/widgets/stream/frame.php?uid=1be3c2fdc8d6aea9d2e859c11bb1bf3a returns 200 with no XFO, but its HLS origin https://wmso-us-ea1.wetmet.net/live/180-01-01/playlist.m3u8 is unreachable (curl 000
  - skipped: Mountain Cam 2 (wetmet fbf2223f...) — same as above; uid=fbf2223feb7cda6252608936eb0ff889, stream 180-03-01 unreachable 2026-10-20T14:36Z
  - skipped: Mountain Cam 3 (wetmet 026a38d4...) — same as above; uid=026a38d400bd6c3ff4d40fa08e6fb3d5, stream 180-02-01 unreachable 2026-10-20T14:36Z
  - skipped: Interstate 81 at Exit 182 (via PennDOT) — http://www.511pa.com/flowplayeri.aspx?CAMID=CAM-04-007 -> 404 https://www.511pa.com/notfound (dead PennDOT embed, http-only)
- Notes: WordPress 7.1 + WPBakery. Live-cams page has three WetMet (WMVision) stream iframes with no captions and a dead PennDOT I-81 iframe; all three WetMet streams were offline at check (off-season) so none added — re-check in season; the three iframe URLs are recorded in skipped_cams. No terms/privacy page linked anywhere in the footer. No 2026-27 opening date announced (snow report 2026-09-24 only mentions the season-pass sale).
- Profile notes: Homepage and trails page: 'over 140 skiable acres, 27 trails, 1000 vertical feet' (experience page says 26 trails; trail counter widget 0/26). No base/summit elevation, lift count, snowfall or longest-run figures published. Indy Pass confirmed on indyskipass.com/our-resorts (Montage Mountain) and operator's seasonpass/#IndyPass.

### roundtop  (PA, South Mountain)
Operator: https://www.skiroundtop.com  |  cams: https://www.skiroundtop.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 40.1084, -76.9287; base/summit 735 / 1335 ft; station: none qualifies; passes epic; wikidata Q22096738
- Added 1 cam(s):
  - Summit (iframe, summit, 1335 ft) `https://player.brownrice.com/embed/roundtopsummit2` credit Roundtop Mountain Resort
- Notes: Vail Resorts site (Akamai; fetched with Firecrawl). Cam page has a single Brownrice player (roundtopsummit2) with no visible caption; name derived from the Brownrice id. Stream is seasonal: the embed verifies but the last snapshot is from July 2026, so the maintainer may want to hide it until the stream resumes. HLS also exposed at https://live8.brownrice.com:444/roundtopsummit2/roundtopsummit2.stream/main_playlist.m3u8. No 2026-27 opening date announced on the homepage ('2026/27 Passes On Sale' only). Lead coordinates were ~10 km west of the resort; corrected.
- Profile notes: Mountain Statistics: highest 1,335 ft (407 m), base 735 ft (224 m), vertical 600 ft, 9 lifts, 21 trails, 3 terrain parks, 100% snowmaking. Skiable acres and snowfall not published. Epic confirmed on epicpass.com Mid-Atlantic list.

### whitetail  (PA, South Mountain)
Operator: https://www.skiwhitetail.com  |  cams: https://www.skiwhitetail.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 39.7415, -77.9344; base/summit 865 / 1800 ft; station: none qualifies; passes epic; wikidata Q7996297
- Added 1 cam(s):
  - Base Area (iframe, base, 865 ft) `https://player.brownrice.com/embed/whitetailkmc` credit Whitetail Resort
  - skipped: Expert's Choice — second Brownrice player container on the page has no embed id/src in the rendered HTML (only the offline placeholder image); cannot resolve a stream — re-check in season
- Notes: Vail Resorts site (Akamai; fetched with Firecrawl). Two captioned Brownrice players: 'Base Area' (whitetailkmc, verified) and 'Expert's Choice' (no embed id exposed). Base Area stream is seasonal (last snapshot Sept 2026). No 2026-27 opening date announced on the homepage. Wikidata label is 'Whitetail Ski Resort' (Q7996297).
- Profile notes: Mountain Statistics: highest 1,800 ft (549 m), base 865 ft (264 m), 120 acres, 9 lifts, 23 trails, 2 terrain parks, 100% snowmaking. Vertical derived as summit minus base (operator only says 'close to 1000' vertical'). Snowfall and longest run not published. Epic confirmed on epicpass.com Mid-Atlantic list.

### mountain-creek  (NJ, Kittatinny Mountains)
Operator: https://mountaincreek.com  |  cams: https://mountaincreek.com/skiing-riding/mountain-report/live-cam/
- coords 41.1916, -74.5092; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q6924907
- No cams added.
  - skipped: Live Cam — HD Relay player 692795952fc3303fedc919ce -> camera 6927942e2fc3303fedc919cc; snapshot https://img.hdrelay.com/camera/6927942e2fc3303fedc919cc/snapshot returns 200 image/jpeg 193722 B with a fresh Last-Modified, but the f
- Notes: WordPress site. The Live Cam page (/skiing-riding/mountain-report/live-cam/) loads one HD Relay player via HDRelay.create({id:'692795952fc3303fedc919ce'}); the camera reports lat/lng 41.1913,-74.5034 (base area). Feed is garbled/stale as of 2026-10-20, so no cam added. Terms & Conditions page is a short generic page with no framing/embedding clause. No 2026-27 opening date announced (mountain report 2026-10-12 is about Fall Fest; snowtubing/ski pages give no date).
- Profile notes: No mountain-stats page found on the operator site (snow overview, trail map, beginners guide, safety, tickets pages checked); only a downloadable trail map PDF (https://mountaincreek.com/wp-content/uploads/2024/12/MC2024_TrailMap-1.pdf). All numeric fields left null rather than taken from the lead list. Not on Ikon, Indy, Mountain Collective or Epic lists.

### big-powderhorn  (MI, Upper Peninsula)
Operator: https://bigpowderhorn.net  |  cams: https://bigpowderhorn.net/webcams/
- coords 46.5041, -90.0960; base/summit 1214 / 1631 ft; station: none qualifies; passes indy; wikidata Q4906143
- No cams added.
  - skipped: Summit Camera — Twitch player needs a host-bound parent parameter (302 without it); revisit when the embed host is settled
  - skipped: Base Camera — same Twitch parent-parameter limit
  - skipped: Double Barrel Camera — same Twitch parent-parameter limit
- Notes: WordPress 7.1.3 custom theme; webcams page (JSON-LD VideoObjects, isLiveBroadcast) embeds three Twitch channels: bigpowderhorn1 Summit ('top of Chair 4'), bigpowderhorn3 Base ('base area, lifts and village'), bigpowderhorn2 Double Barrel ('close-up of a signature trail'). Twitch embeds REQUIRE a parent= parameter matching the embedding hostname (CSP frame-ancestors is generated from it) — PeakCam must append its own host; the preview JPG (static-cdn.jtvnw.net/previews-ttv/live_user_<channel>-1280x720.jpg) can serve as an image fallback. All three show a black slate right now (off-season), so the caller may prefer to hold them until the season starts. No terms/privacy page linked. No 2026-27 opening date announced (mountain report still shows spring closure text).
- Profile notes: Trail-map page: '45 runs and two terrain parks across two peaks, served by nine Riblet double chairlifts and one handle tow, over 253 skiable acres. The summit is 1,631 ft, the base 1,214 ft, giving 417 ft of vertical on roughly 200 inches of natural lake-effect snow a season.' lifts_total = 9 chairs + 1 handle tow (mountain report counts 0/9 lifts, 0/47 trails). Indy Pass confirmed on indyskipass.com/our-resorts and operator's /indy-pass/ page.

### caberfae-peaks  (MI, Northern Michigan)
Operator: https://caberfaepeaks.com  |  cams: https://caberfaepeaks.com/live-cam-caberfae/
- coords 44.2442, -85.7198; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q16890068
- Opening 2026-27: 2026-11-27 (projected) — https://caberfaepeaks.com/snow-report/
- Added 4 cam(s):
  - East Peak Triple (youtube) `https://www.youtube.com/embed/DYIAd-5x48w` credit Caberfae Peaks Ski & Golf Resort
  - North Peak (Vista 1561) (youtube, summit) `https://www.youtube.com/embed/H8eQ0D_tQis` credit Caberfae Peaks Ski & Golf Resort
  - South Peak (youtube, summit) `https://www.youtube.com/embed/jTQVAiWkKgc` credit Caberfae Peaks Ski & Golf Resort
  - Arlo's Deck (youtube, base) `https://www.youtube.com/embed/tq-COKfY29I` credit Caberfae Peaks Ski & Golf Resort
- Notes: WordPress 7.1.3 (Enfold/avia theme). Live-cam page embeds four YouTube live streams; a duplicate small iframe of jTQVAiWkKgc is mislabeled 'Arlo's Deck' on the page — names taken from the YouTube oEmbed titles. oEmbed 200 only proves the video objects exist; streams may be idle off-season. No terms/privacy page linked (only camping and lodging cancellation policies). Opening derived from the published lift-hours calendar.
- Profile notes: Operator publishes no mountain-stats page; the snow report lists 5 lifts (East Peak Triple, Vista 1561' Triple, South Peak Triple, North Peak Quad, Green Mountain Flying Carpet) and the lift name 'Vista 1561'' implies a 1,561 ft summit but no explicit elevation figure is stated, so elevations left null. Pass partners page only offers an Ikon Session 3-Day discount to Peak Passholders; Caberfae is not on ikonpass.com destinations, Indy or Mountain Collective lists.

### crystal-mountain-michigan  (MI, Northern Michigan)
Operator: https://www.crystalmountain.com  |  cams: https://www.crystalmountain.com/ski/cams-conditions/webcams
- coords 44.5193, -85.9907; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q5191297
- Added 6 cam(s):
  - Inn View (image, village) `https://www.crystalmountain.com/sites/default/files/webcams/35496.jpg` credit Crystal Mountain
  - Lodge View (image, base) `https://www.crystalmountain.com/sites/default/files/webcams/88841.jpg` credit Crystal Mountain
  - Base of Loki (image, base) `https://www.crystalmountain.com/sites/default/files/webcams/117742.jpg` credit Crystal Mountain
  - Crystal Clipper (image) `https://www.crystalmountain.com/sites/default/files/webcams/114533.jpg` credit Crystal Mountain
  - Golf Learning Center (image) `https://www.crystalmountain.com/sites/default/files/webcams/108594.jpg` credit Crystal Mountain
  - Mountain Ridge, Hole #7 (image) `https://www.crystalmountain.com/sites/default/files/webcams/131842.jpg` credit Crystal Mountain
- Notes: Drupal 11 site. Webcam page shows six still-image cams at /sites/default/files/webcams/<id>.jpg (page appends a cache-buster '?', stripped). Only 'Inn View' was refreshed within the last day; the other five stopped updating 2026-10-15 — likely off-season/maintenance, so re-check before relying on them. 'Golf Learning Center' and 'Mountain Ridge, Hole #7' are golf-course cams that the operator lists on the same ski webcam page. Only a Privacy Policy is linked (no terms-of-use page); it contains no framing/embedding clause. No 2026-27 opening date announced (mountain report only says 'ready to go on Opening Day' for the 70th-anniversary season, 0/59 slopes, 0/8 lifts).
- Profile notes: Mountain Facts: 59 downhill slopes, 104 skiable acres, vertical 375 ft, 'Average Annual Snowfall: Over 11 feet' (converted to 132 in), 8 lifts (1 HSQ, 3 quads, 2 triples, 2 carpets), 93% snowmaking. Base/summit elevations not published. Indy Pass confirmed on indyskipass.com/our-resorts (Crystal Mountain, Midwest) and operator's season-pass-perks page ('Eligible for Indy Pass AddOn').

### mount-bohemia  (MI, Upper Peninsula)
Operator: https://www.mtbohemia.com  |  no cam page
- coords 47.3877, -88.0208; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q6919769
- No cams added.
- Notes: WordPress (Common Angle). No webcam anywhere on the site: current-conditions page is a text snow report plus a YouTube channel link; sitemap has no cam page; 'cam' never appears in page text. Lead coordinates (47.397,-88.155) are ~10 km west of the actual base at Lac La Belle - corrected to the operator's street address (moved > 2 km). Opening date for 2026-27 not announced (season passes 2026-2027 on sale; conditions page still shows last season's YTD).
- Profile notes: About page lists 'Vertical drop: 900 feet, Snowfall: 273 inches, Skiable acres: 585 acres, Chairlifts: 2, Buses: 4'. Trail-maps page says 'Over 900 acres of ski terrain spread over three separate mountains' (Bohemia, Little Boho, Voodoo) - 585 is the figure on the stats line. No base/summit elevation, run count or longest run published. Not on Indy (Midwest list), Ikon or Epic lists.

### mt-brighton  (MI, Southeast Michigan)
Operator: https://www.mtbrighton.com  |  cams: https://www.mtbrighton.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 42.5381, -83.8069; base/summit 1100 / 1330 ft; station: none qualifies; passes epic; wikidata Q14716235
- No cams added.
  - skipped: Mt Brighton Live Mountain Cams — page is an app promo only - 'Download My Epic App: Live Webcams and Weather'; rendered HTML (Firecrawl) contains no iframe/img/stream for any camera
- Notes: Vail Resorts .aspx site behind Akamai (curl gets a 1.8 KB stub; Firecrawl renders it). Mountain Cams page exists (200) but shows only 'Get a sneak peek at the slopes' + My Epic App download; cams are app-only. Lead coords (42.544,-83.777) are ~2.5 km east of Wikidata/OSM position - corrected (moved > 2 km). Home page: 'Stay tuned for opening day details, coming soon!' - no 2026-27 date yet. Operator policies link is https://www.mtbrighton.com/policies (generic Vail terms).
- Profile notes: Mountain Statistics table: Highest Elevation 1,330 ft (405 m), Base Elevation 1,100 ft (335 m), Skiable Terrain 130 acres, Lifts 5 chairlifts + 7 surface lifts (=12), Trails 24 (intro prose says 25), Terrain Parks 2. Vertical derived as summit minus base. Snowfall and longest run not published. Vail Resorts-owned; site sells Epic Pass / Epic Local / Epic Day / Mt Brighton Pass.

### otsego-resort  (MI, Northern Michigan)
Operator: https://otsegoclub.com  |  no cam page
- coords 45.0316, -84.6518; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata —
- No cams added.
- Notes: WordPress/Elementor site (otsegoclub.com; www redirects to apex). No webcam page or embedded cams anywhere on the site (checked home, mountain-information, skiing, winter-activities, contact; only a YouTube channel link @otsegoresort7137). Lead-list 'competitor cam count 0' matches. No 2026-27 opening date announced. No terms/privacy page linked in footer (only lodging-policies).
- Profile notes: Stats page says 32 runs / 5 lifts; trail-map image says 400 ft vertical and 1,329 ft elevation (summit). The skiing page FAQ contradicts with '27 runs' and 'vertical drop of 260 feet' - operator inconsistency, used the mountain-information page + trail map. Acres, snowfall, longest run not published. Wikidata has no item for Otsego Resort/Otsego Club (searched both). Not on Indy Midwest or Ikon lists.

### pine-mountain  (MI, Upper Peninsula)
Operator: https://www.pinemountainresort.com  |  no cam page
- coords 45.8387, -88.0882; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata —
- No cams added.
- Notes: Site is a hotel-group (GF Hotels) template; no webcam page or cam embeds anywhere (the only YouTube embed on mountain-info is a 'Skier Responsibility Code' video, 6hCsdBLCyxQ). The footer legal link goes to the parent company's privacy/legal note (no framing/hotlinking language). No 2026-27 opening date published (only 'August 1 - November 30 / December 1 - End of Season' pricing windows).
- Profile notes: The operator's mountain-info page publishes no stats in text (only the ski jump record, a snow-forecast.com link and PDF trail map / brochure that could not be text-extracted here). All profile numbers left null rather than taken from third parties. Indy Pass Midwest list includes 'Pine Mountain' (Iron Mountain, MI). Wikidata only has the ski jump (Q518777), not the ski area, so left blank.

### schuss-mountain  (MI, Northern Michigan)
Operator: https://www.shantycreek.com  |  cams: https://www.shantycreek.com/ski/conditions-cams/
- coords 44.9344, -85.1314; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata —
- Added 3 cam(s):
  - Schuss Village View from Top (youtube, summit) `https://www.youtube.com/embed/9KBLem3gwTM` credit Shanty Creek Resort
  - Schuss Mountain Face (youtube, base) `https://www.youtube.com/embed/vYMimVMT6rg` credit Shanty Creek Resort
  - Shanty Creek Resort (youtube) `https://www.youtube.com/embed/guUYNd2CV8E` credit Shanty Creek Resort
- Notes: WordPress (Mega Menu). Three YouTube live embeds on the Conditions + Cams page with no on-page captions; names taken from the YouTube stream titles. The third stream ('Shanty Creek Resort') may show Summit Village rather than Schuss - kind left blank. Page currently says 'Schuss Mountain is officially closed for the season' (off-season banner), no 2026-27 opening date. Only a privacy policy is linked (no framing/hotlink language).
- Profile notes: Runs/lifts from the conditions page counters ('Trails 0 of 42', 'Lifts 0 of 7', '2 terrain parks'). Vertical, acres, elevation, average snowfall are not published in text on the ski pages (season-to-date snowfall 198 in shown, not an average). Indy Midwest list has 'schuss-mountain-at-shanty-creek'. No Wikidata item found for Schuss Mountain or Shanty Creek.

### ski-brule  (MI, Upper Peninsula)
Operator: https://skibrule.com  |  no cam page
- coords 46.0285, -88.7056; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q7534851
- Opening 2026-27: 2026-11-20 (projected) — https://skibrule.com/brule-mountain/snow-conditions/
- No cams added.
- Notes: WordPress site (www redirects to apex). No webcam page or cam embeds on the site (snow-conditions page is a text/lift-status report; only a YouTube channel link @Skibrule1). Terms & conditions page is generic (external-links disclaimer only).
- Profile notes: Operator stats page: 17 trails, 11 lifts (5 chairs, 2 T-bars, 3 rope tows, 1 paddle tow), 150 skiable acres, 150 in average annual snowfall, longest trails Homestead/Maple Syrup 'approximately 1 mile'. Vertical and elevations are not published on the site. Not on Indy Midwest or Ikon lists.

### snowriver  (MI, Upper Peninsula)
Operator: https://www.snowriver.com  |  cams: https://www.snowriver.com/mountain-info/our-webcams
- coords 46.5003, -89.9710; base/summit 1212 / 1750 ft; station: none qualifies; passes ikon; wikidata —
- Opening 2026-27: 2026-11-26 (projected) — https://www.snowriver.com/things-to-do/upcoming-events/opening-thanksgiving-weekend
- No cams added.
  - skipped: Jackson Creek Summit — HLS stream only (https://wms.apt9stream.com/snowriver/jackson-top_output/playlist_dvr.m3u8, GET 200 application/vnd.apple.mpegurl); no image/iframe/YouTube embed
  - skipped: Black River Basin Top — HLS stream only (https://wms.apt9stream.com/snowriver/blackriver-top_output/playlist_dvr.m3u8); no image/iframe/YouTube embed
  - skipped: Black River Basin Bottom — HLS stream only (https://wms.apt9stream.com/snowriver/blackriver-bottom_output/playlist_dvr.m3u8); no image/iframe/YouTube embed
- Notes: Drupal site. The webcam page renders three <video class=webcam-video data-src=...m3u8> HLS players from wms.apt9stream.com (operator-owned cams). PeakCam has no HLS embed type, so listed under skipped_cams with the stream URLs; if an HLS/m3u8 embed type is added these three can be imported directly (jackson-top = summit of Jackson Creek Summit, blackriver-top = summit, blackriver-bottom = base). No terms/privacy page linked in the footer. Boyne-style terms do not apply (independent operator, Midwest Family Ski Resorts).
- Profile notes: Operator stats: 2 mountains (Jackson Creek Summit = former Indianhead, Black River Basin = former Blackjack), 200"+ annual snowfall (recorded as 200), 73 trails & glades (43 JCS + 19 BRB headline counts plus glades), 370 skiable acres, 7 lifts, 538' vertical, elevation 1212-1750 ft. Longest run not published. Ikon destination list: 'Snowriver Mountain Resort, MI'. Wikidata has no item for Snowriver; Q4923060 is the legacy Blackjack Ski Resort (Black River Basin side) only, so left blank.

### the-highlands  (MI, Northern Michigan)
Operator: https://www.highlandsharborsprings.com  |  cams: https://www.highlandsharborsprings.com/mountain-report
- coords 45.4708, -84.9347; base/summit — / — ft (operator publishes none); station: none qualifies; passes ikon; wikidata Q4952557
- **No cams added: terms hold.** https://www.boyneresorts.com/terms-and-conditions — "(2) Frame or utilize framing techniques to enclose any Trademark or other Content (including, without limitation, any images, text or page layout).". Verified embeds, for the maintainer's decision:
  - Main Lodge Webcam: terms forbid (Boyne Resorts terms: 'Frame or utilize framing techniques to enclose any Trademark or other Content'); YouTube 1U6JaO6gr6c, oembed 200 2026-10-19T22:21Z
  - Day Lodge Webcam: terms forbid (same clause); YouTube rVeAkiGOBIY, oembed 200 2026-10-19T22:21Z
- Notes: Next.js + Sanity (Boyne Resorts). Mountain Report page 'Webcams' section has two YouTube live embeds: 'Main Lodge Webcam' (1U6JaO6gr6c, title 'The Highlands - Main Lodge') and 'Day Lodge Webcam' (rVeAkiGOBIY, title 'Day Lodge - The Highlands'); both verify via oEmbed but the footer terms (boyneresorts.com/terms-and-conditions, also mirrored on /terms-of-sale) explicitly prohibit framing, so held. Lead list said 3 cams; only 2 found in the rendered page. Site banner: 'currently closed as we prepare for our winter season. Lodging opens December 10' - no ski opening date yet.
- Profile notes: Operator our-terrain stat block: 552' vertical, 435 skiable acres, 8 chairlifts, 55 trails. Longest run: ski page describes the 'mile-long Camelot run' and 'the longest run in the state' (recorded as 1.0 mi). Base/summit elevations and average snowfall are not published. Ikon destination list: 'The Highlands, MI'. Wikidata item is under the former name Boyne Highlands (Q4952557, P31 ski resort).

### alpine-valley  (WI, Southern Wisconsin)
Operator: https://www.alpinevalleyresort.com  |  no cam page
- coords 42.7361, -88.4281; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q4735527
- No cams added.
- Notes: WordPress. No webcam page, cam embed or cam link found on the home, snow-report, mountain-information, trail-map or contact pages, and a site: search for webcam/live cam returned nothing - lead list's 1 cam could not be located on the operator site. Only a privacy policy is linked (generic). No 2026-27 opening date (only 'Don't wait until opening day' pass promo).
- Profile notes: Mountain-information page: 'over 100 skiable acres with 20 runs ... vertical drop of 388 feet. The longest run is 3,000 feet' (3000 ft = 0.57 mi, converted). Lifts counted from the operator's own list: 3 high-speed quads + 4 triple chairs + 2 rope tows + 5 magic carpets = 14 (a 'snow carousel' is also mentioned, not counted). Snow-report widget: Peak Elevation 1040 ft, 'Average Snowfall 20 in' (recorded as-is; lead list says 28). Not on Indy Midwest or Ikon lists.

### cascade-mountain  (WI, Southern Wisconsin)
Operator: https://www.cascademountain.com  |  cams: https://www.cascademountain.com/snow-cams/
- coords 43.5036, -89.5175; base/summit 820 / 1280 ft; station: none qualifies; passes none; wikidata Q5048151
- Added 2 cam(s):
  - Snow Cam 1 (image, base) `https://img.hdrelay.com/camera/7b228510-8133-475f-8d69-aee7020405aa/snapshot` credit Cascade Mountain
  - Snow Cam 2 (image) `https://img.hdrelay.com/camera/80bd0e30-cb89-4a4b-bf32-ce44adf13270/snapshot` credit Cascade Mountain
- Notes: WordPress + Elementor. Snow Cams page embeds two HD Relay players (HDRelay.create ids above) under a single 'Snow Cams' heading - the operator gives no per-camera names, so they are numbered in page order. Snapshot 1 shows the base patio / rentals / Mountain Top Express lift terminal (fog at capture); snapshot 2 shows a chairlift line over the 'Daisy Bridge 2016' underpass - location on the hill unclear, kind left blank. HD Relay HLS streams (b15.hdrelay.com) exist too if a video embed is wanted. /snow-cams-timelapse/ reuses player 1. Opening 2026-27 not announced; hours page says 'Hours and rates prior to 12/12 will be added once early season hours are determined' and an Instagram caption says ~3 months out from opening day (Sept).
- Profile notes: FAQ 'What are your mountain statistics?': base 820 ft, peak 1,280 ft, vertical 460 ft, 176 acres, 11 lifts (2 HS detachable quads, 3 fixed quads, 1 triple, 2 doubles + surface), 48 trails; longest run 'is 5,300 feet long, or just over a mile' (converted 5,300 ft = 1.0 mi). Annual snowfall stated as 'between 50-56 inches' - upper figure recorded. Not on Indy, Ikon or Epic lists.

### christie-mountain  (WI, Northwest Wisconsin)
Operator: https://www.christiemountain.com  |  cams: https://www.christiemountain.com/trail-map
- coords 45.5092, -91.3808; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q48976629
- Added 1 cam(s):
  - Live Camera (iframe) `https://g1.ipcamlive.com/player/player.php?alias=61a27d760cd67&autoplay=1` credit Christie Mountain
- Notes: Squarespace site. The trail-map page embeds one IPCamLive player (alias 61a27d760cd67) labelled only 'Live Camera.'; view/kind not stated. /the-mountain link in the nav currently redirects to /shop-online. No terms or privacy page linked in the footer. No 2026-27 opening date published.
- Profile notes: Trail-map page 'Stats' block: Number of Runs 33, Vertical 350, Longest Run 0.8mi, Terrain Parks 4, Night Skiing 70%. Lift types listed (Chair Lift, T-Bar, Tube Park) without counts; acres, elevations and snowfall not published. Indy Midwest list includes 'christie-mountain'.

### devils-head  (WI, Southern Wisconsin)
Operator: https://www.devilsheadresort.com  |  no cam page
- coords 43.4186, -89.6224; base/summit — / — ft (operator publishes none); station: none qualifies; passes ikon; wikidata Q5267162
- No cams added.
- Notes: WordPress (TravelNet Solutions). No webcam on the site: snow-report, main ski page, home, sitemap and page-sitemap.xml contain no cam page, iframe, image feed or the word 'cam'; the competitor's 2-cam count could not be reproduced from the operator. Only a privacy policy and cookie policy are linked (no terms of use). Snow report still shows last season's 'officially closed for the season' note; no 2026-27 opening date.
- Profile notes: Mountain Stats page: Skiable Area 300 acres, Vertical 500 ft, Longest Run 3,500 ft (converted to 0.66 mi), 30 ski trails, 8 lifts (6 quads + 2 wonder carpets), lift capacity 16,500/hr, 100% snowmaking. No base/summit elevation or snowfall published. Ikon: listed as a Bonus Mountain (2 days) on ikonpass.com/en/bonus-mountain-program for 26/27; operator confirms on /ikon-pass/.

### trollhaugen  (WI, Northwest Wisconsin)
Operator: https://trollhaugen.com  |  no cam page
- coords 45.3496, -92.6202; base/summit 920 / 1200 ft; station: none qualifies; passes indy; wikidata Q17142405
- No cams added.
- Notes: WordPress (Elementor). No webcam: snow-report page has only a YouTube promo video (youtu.be/icUipyDpAus), wp-sitemap lists no cam page, 'cam' absent from page text. Only a privacy policy + cookie policy linked (no terms of use). www.trollhaugen.com redirects to trollhaugen.com. Hours page already shows '2026/2027 regular season' rates but no opening date; home banner text is stale ('24/25 season passes').
- Profile notes: Trail-map page Stats: 30 runs, 280' vertical, 80 acres skiable, 2,500' longest run (converted to 0.47 mi), 3 terrain parks, 100% snowmaking/grooming/night skiing. Snow-report 'Mountain Info': Peak Elevation 1200 ft, Vertical Drop 280 ft, Average Snowfall 50 in. Base elevation derived as peak minus vertical (1200-280=920). Lift count not published by the operator (Indy's listing says 8). Indy Pass Midwest list includes Trollhaugen.

### tyrol-basin  (WI, Southern Wisconsin)
Operator: https://tyrolbasin.com  |  cams: https://tyrolbasin.com/live-cam/
- coords 43.0445, -89.7863; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q7861546
- Added 4 cam(s):
  - Chairlift A (youtube) `https://www.youtube.com/embed/Am3rSF2FRD4` credit Tyrol Basin
  - Chairlift B (youtube) `https://www.youtube.com/embed/N85Uaxz26MM` credit Tyrol Basin
  - Tubing (youtube) `https://www.youtube.com/embed/RWppm5SMnOs` credit Tyrol Basin
  - Chairlift C (youtube) `https://www.youtube.com/embed/QbYGbaZ-14E` credit Tyrol Basin
- Notes: WordPress (Divi). /live-cam/ ('Live Cameras') embeds four CamStreamer iframes labelled Chairlift A, Chairlift B, Tubing, Chairlift C; each 302s to a YouTube live embed (ids recorded; oEmbed 200). Whether each chairlift cam looks at the lift base or top is not stated, so kind is blank. The footer says 'Follow us on social media!' but no social URLs appear in the HTML. Only a privacy policy is linked (no terms of use). Slope report still says 'open for the 2025-2026 season'; no 2026-27 date. www.tyrolbasin.com redirects to tyrolbasin.com.
- Profile notes: Operator publishes no mountain-stats page: map, slope-report, FAQ, hours-contact and home contain no elevation, vertical, acreage, run, lift or snowfall figures (Indy's listing says 300 ft vertical, not used). Indy Pass Midwest list includes 'Tyrol Basin Ski and Snowboard'; operator has an /indy-pass/ page.

### whitecap-mountain  (WI, Northwest Wisconsin)
Operator: https://whitecapresort.com  |  cams: https://webcam.whitecapresort.com/
- coords 46.4069, -90.3970; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q7995758
- Added 1 cam(s):
  - Webcam (iframe, base) `https://webcam.whitecapresort.com/` credit Whitecap Mountains Resort
- Notes: Joomla site. The lead's domain skiwhitecap.com does not resolve (DNS SERVFAIL); the operator is whitecapresort.com. The only cam is a header icon link (images/webcam-64.png, no text label - named 'Webcam') to webcam.whitecapresort.com, an IIS/ARR MJPEG push stream (multipart/x-mixed-replace, boundary ==STILLIMAGEBOUNDARY==) rather than a still JPEG or a player page; it renders in <img> or <iframe> in browsers but is not an image/* content type, so the maintainer may want to treat it specially. The frame shows the base-area slope and lake looking up at a lift. Snow report last updated Mar 29 2026 ('LAST DAY TODAY'); no 2026-27 opening date.
- Profile notes: Trail-map page: '43 runs over 400 acres' across three mountains, 'average of 200 inches of snow per year'; About page: 'Five chairlifts, 43 ski and snowboard runs'. Home page hero says '48 runs' - the 43 on the trail-map/about/tickets pages is used. No vertical, elevation or longest-run figure published (Indy's listing says 400 ft vertical, not used). Indy Pass Midwest list includes 'Whitecap Mountains Resort'.

### wilmot-mountain  (WI, Southern Wisconsin)
Operator: https://www.wilmotmountain.com  |  cams: https://www.wilmotmountain.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 42.4998, -88.1904; base/summit 770 / 960 ft; station: none qualifies; passes epic; wikidata Q8022836
- No cams added.
  - skipped: Wilmot Live Mountain Cams — page is an app promo only - 'Download My Epic App: Live Webcams and Weather'; rendered HTML (Firecrawl) contains no iframe/img/stream for any camera
- Notes: Vail Resorts .aspx site behind Akamai (curl gets a 1.8 KB stub; Firecrawl renders it). Mountain Cams page exists (200) but only promotes the My Epic App; cams are app-only. Page banner still reads 'Wilmot Mountain is now closed for the 25/26 winter season'; no 2026-27 opening date. Lead coords (42.5,-88.19) match OSM/Wikidata. Operator policies link is https://www.wilmotmountain.com/policies (generic Vail terms).
- Profile notes: Mountain Statistics table: Highest Elevation 960 ft (293 m), Base Elevation 770 ft (235 m), Skiable Terrain 120 acres, Lifts 10, Trails 25, Terrain Parks 3, 100% snowmaking. Vertical derived as summit minus base. Snowfall and longest run not published. Vail Resorts-owned; site sells Epic Pass / Epic Local / Epic Day / Wilmot Pass.

### afton-alps  (MN, Twin Cities)
Operator: https://www.aftonalps.com  |  cams: https://www.aftonalps.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 44.8576, -92.7879; base/summit 350 / 700 ft; station: none qualifies; passes epic; wikidata Q4690826
- No cams added.
- Notes: Vail Resorts Sitecore site behind Akamai (curl gets a stub; fetched with Firecrawl). The Mountain Cams page returns 200 but renders no cam embeds off-season: the only content is 'Afton Alps is now closed for the 25/26 winter season' plus the My Epic App banner and resort links; no iframe/img/YouTube/HD Relay ids in the rendered HTML. Re-scrape once the resort opens (Vail cam components appear in-season). Hours page says 'Closed for the 25/26 Season' with no 26/27 opening date announced. Footer terms link goes to /policies (Vail generic terms).
- Profile notes: Operator stats: highest 700 ft, base 350 ft, 300 acres, 17 lifts, 50 trails, 3 terrain parks, 100% snowmaking. Vertical derived as summit minus base. Snowfall and longest run not published. Epic verified on epicpass.com Epic Day Pass Midwest list (Afton Alps, MN).

### buck-hill  (MN, Twin Cities)
Operator: https://buckhill.com  |  cams: https://buckhill.com/skiing-snowboarding/webcams/
- coords 44.7241, -93.2839; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q4982867
- Added 1 cam(s):
  - Plaza Cam (youtube, base) `https://www.youtube.com/embed/2WzUGFz03v8` credit Buck Hill Ski & Snowboard Area
- Notes: WordPress site, plain curl works. Webcams page embeds one CamStreamer YouTube relay (Plaza Cam). Terms page is generic copyright/trademark boilerplate with no framing/embedding language. No 2026-27 opening date on the homepage or contact/hours page.
- Profile notes: Operator does not publish a mountain-stats page. History page: '15 different runs ... 11 lifts including 2 Quads and a Triple chairlift'; trail-map page lists '15 Runs of Fun'. No elevation, vertical, acreage, snowfall or longest-run figures on the site. Not on the Indy Pass Midwest list, not Epic/Ikon/MC.

### giants-ridge  (MN, Iron Range)
Operator: https://www.giantsridge.com  |  cams: https://www.giantsridge.com/live-webcam/
- coords 47.5765, -92.3034; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q85763460
- Opening 2026-27: 2026-11-27 (projected) — https://www.giantsridge.com/
- Added 1 cam(s):
  - Outside Main Chalet (youtube, base) `https://www.youtube.com/embed/cStMNmvOmOI` credit Giants Ridge
  - skipped: Top of Sarajevo — YouTube qSVohsdTkeo stream ended (liveBroadcastDetails endTimestamp 2026-04-15, isLiveNow:false; embed shows 'This live stream recording is not available'); oembed still 200. Re-check for a new video id when the resort o
- Notes: WordPress site behind a WAF (plain curl gets 403; fetched with Firecrawl). Live Webcam page has two YouTube iframes: Main Chalet (live) and Sarajevo Hill Top (ended). Footer links only a Privacy Policy (guestservices.com/privacy-policy and a PDF); no website terms-of-use page, so verdict 'none'. Twitter handle @GiantsRidge appears only in twitter:site meta, not the footer, so x_url left empty. Operated by Guest Services, Inc. under contract with Minnesota IRRR.
- Profile notes: Operator stats page: Runs 35, Lifts 5 (1 detachable quad, 1 fixed quad, 1 fixed triple, 2 fixed doubles) plus 3 surface lifts listed separately, 2 terrain parks, Vertical Rise 500 ft, Skiable Acreage 202 acres. Base/summit elevations, snowfall and longest run not published. Not on Indy Pass Midwest list; not Epic/Ikon/MC.

### welch-village  (MN, Twin Cities)
Operator: https://www.welchvillage.com  |  no cam page
- coords 44.5606, -92.7272; base/summit 700 / 1060 ft; station: none qualifies; passes none; wikidata Q7980565
- No cams added.
- Notes: WordPress site (nxt), plain curl works. No webcam page or cam embeds anywhere on the site (homepage, snow report, trail map, hours checked); competitor also lists 0 cams. Hours page: 'historically opens in late November or early December ... Opening day is announced on the snow report page and on Instagram once the season dates are set' - no 2026-27 date yet. Terms page is generic.
- Profile notes: Operator 'Mountain Stats': valley floor 700 ft, summit 1,060 ft, vertical rise 360 ft, 140 acres, trails '50+' (recorded as 50), lift system 7 quads + 1 triple + 1 moving carpet + 1 rope tow (10 total; 8 chairlifts), average annual snowfall 45 inches, 100% snowmaking. Longest run not published. Not on Indy Pass Midwest list; not Epic/Ikon/MC.

### wild-mountain  (MN, Twin Cities)
Operator: https://www.wildmountain.com  |  no cam page
- coords 45.4888, -92.7053; base/summit — / — ft (operator publishes none); station: none qualifies; passes none; wikidata Q8000723
- **No cams added: terms hold.** https://www.wildmountain.com/terms-of-use — "Engage in unauthorized framing of or linking to the Services.". Verified embeds, for the maintainer's decision:
- Notes: Joomla site (serve gzip; use curl --compressed). No webcam page or cam embeds on the site (homepage, snow report, trail map, FAQ, hours checked); competitor lists 0 cams. Terms of Use prohibit 'unauthorized framing of or linking to the Services' -> verdict hold; moot while there are no cams, but ask permission before embedding anything. Hours page says 'Reopening November 2026' with no specific date, so opening left null.
- Profile notes: Operator trail-map page: 100 acres, 26 trails, 4 chairlifts, 4 rope tows, 1 conveyor lift (9 lifts total). No elevation, vertical, snowfall or longest-run figures published anywhere on the site. Not on Indy Pass Midwest list; not Epic/Ikon/MC.

### boston-mills  (OH, Cuyahoga Valley)
Operator: https://www.bmbw.com  |  cams: https://www.bmbw.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 41.2641, -81.5639; base/summit 607 / 871 ft; station: none qualifies; passes epic; wikidata Q4947991
- No cams added.
- Notes: Vail Resorts Sitecore site behind Akamai (Firecrawl). Mountain Cams page is 200 but rendered HTML contains only the 'BMBW Live Mountain Cams' heading, My Epic App banner and resource links - no iframe/img/YouTube/HD Relay ids off-season. Hours page: 'Now Closed for 25/26 Season', holiday hours TBD, no 26/27 opening date. Row covers the combined Boston Mills/Brandywine site; the two hills are 5 min apart and this record's coordinates are Boston Mills.
- Profile notes: Operator stats (combined Boston Mills + Brandywine): highest elevation 871 ft, longest vertical drop 264 ft, 88 acres, 15 lifts, 18 trails, 3 terrain parks. Base elevation DERIVED as 871 - 264 = 607 ft (operator publishes summit and vertical only). Snowfall/longest run not published. Epic verified on epicpass.com (Boston Mills, OH / Brandywine, OH).

### mad-river-mountain  (OH, Central Ohio)
Operator: https://www.skimadriver.com  |  cams: https://www.skimadriver.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 40.3163, -83.6806; base/summit 1160 / 1460 ft; station: none qualifies; passes epic; wikidata Q14716653
- No cams added.
- Notes: Vail Resorts Sitecore site behind Akamai (Firecrawl). Mountain Cams page is 200 but rendered HTML has only the 'Live Mountain Cams - Get a sneak peak of the slopes' heading, My Epic App banner and resource links; no cam embeds off-season. Hours page: 'Closed for the 25/26 Season', no 26/27 opening date.
- Profile notes: Operator stats: highest elevation 1,460 ft, longest vertical drop 300 ft, 144 acres, 9 lifts, 16 trails, 3 terrain parks. Base elevation DERIVED as 1460 - 300 = 1160 ft. Snowfall/longest run not published. Epic verified on epicpass.com (Mad River Mountain, OH).

### hidden-valley  (MO, St. Louis)
Operator: https://www.hiddenvalleyski.com  |  cams: https://www.hiddenvalleyski.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 38.5359, -90.6507; base/summit 540 / 860 ft; station 2227:MO:SCAN Shaw Nature Reserve 580 ft at 15.0 km; passes epic; wikidata Q5752020
- No cams added.
- Notes: Vail Resorts Sitecore site behind Akamai (Firecrawl). Mountain Cams page is 200 but rendered HTML shows only the 'Hidden Valley Resort Live Mountain Cams' heading, My Epic App banner and resource links; no cam embeds off-season. Hours page: 'Closed for the 25/26 Season ... welcoming you back next season', no 26/27 opening date; tubing 'opening date information coming soon'. Operator calls itself 'Hidden Valley' / 'Hidden Valley, MO' / 'Hidden Valley Resort'.
- Profile notes: Operator stats: highest elevation 860 ft, longest vertical drop 320 ft, 65 acres, 10 lifts, 13 trails, 2 terrain parks (intro text says '16 trails and two peaks'; stats block says 13). Base elevation DERIVED as 860 - 320 = 540 ft. Snowfall/longest run not published (lead-list 135 in is not on the operator site). Epic verified on epicpass.com (Hidden Valley, MO).

### snow-creek  (MO, Kansas City)
Operator: https://www.skisnowcreek.com  |  cams: https://www.skisnowcreek.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 39.4672, -94.9715; base/summit 800 / 1100 ft; station: none qualifies; passes epic; wikidata —
- Added 1 cam(s):
  - Snow Creek Main Lodge (iframe, base, 800 ft) `https://player.brownrice.com/embed/snowcreek1` credit Snow Creek
- Notes: Vail Resorts Sitecore site behind Akamai (curl gets a stub; fetched with Firecrawl). Cam page embeds one Brownrice player (sn=snowcreek1, 'Snow Creek Main Lodge') plus Brownrice timelapses (player.brownrice.com/embed/snowcreek1/timelapse/<id>); the Brownrice snapshot alias https://player.brownrice.com/snapshot/snowcreek1 is a stable image alternative. Page banner on 2026-10-20 still says 'Snow Creek is now closed for the 25/26 winter season'; no 2026-27 opening date announced (homepage only says '2026/27 Passes On Sale' and mentions a 40th-anniversary 'banner break on opening day'). Elevation 'elevation' for the cam is the base elevation from the stats page. Lead coordinates (39.469,-94.972) confirmed within 0.2 km.
- Profile notes: vertical derived as summit 1,100 minus base 800; operator stats page lists 'Trails 14', 'Lifts 5', 'Skiable Terrain 25 Acres', 100% snowmaking, 1 terrain park; no annual snowfall or longest-run figure published. Vail Resorts property: Epic Pass / Epic Local / Epic Day / Snow Creek Pass sold on epicpass.com. No Wikidata item found for the ski area (wbsearchentities 'Snow Creek' only returns streams/settlements).

### paoli-peaks  (IN, Southern Indiana)
Operator: https://www.paolipeaks.com  |  cams: https://www.paolipeaks.com/the-mountain/mountain-conditions/mountain-cams.aspx
- coords 38.5559, -86.5122; base/summit 600 / 900 ft; station: none qualifies; passes epic; wikidata Q7132127
- No cams added.
  - skipped: Live Mountain Cams (page) — operator cam page renders no camera at all on 2026-10-20 (Firecrawl rendered HTML, waitFor 4 s: no iframe, no Brownrice/YouTube/HD Relay reference, only the 'Download My Epic App' block and a static offline-resources PNG
- Notes: Vail Resorts Sitecore site behind Akamai (curl gets a stub; fetched with Firecrawl). The 'Live Mountain Cams' page exists (200) but contains no embed, so no cam could be added - do not invent one; re-check once the 2026-27 season starts. No 2026-27 opening date announced (homepage: '2026/27 Passes On Sale' only). Coordinates corrected by ~3.9 km from the lead list.
- Profile notes: vertical derived as summit 900 minus base 600; operator stats page lists 'Trails 15', 'Lifts 8', 1 terrain park, 100% snowmaking; skiable acres, annual snowfall and longest run are not published (lead list's 65 acres not confirmed). Vail Resorts property: Epic Pass / Epic Local / Epic Day / Paoli Peaks Pass sold on epicpass.com.

### canaan-valley  (WV, Appalachians)
Operator: https://www.canaanresort.com  |  cams: https://www.canaanresort.com/resort-webcam
- coords 39.0080, -79.4379; base/summit 3430 / 4280 ft; station: none qualifies; passes indy; wikidata Q3364026
- Added 2 cam(s):
  - Canaan Valley Resort Webcam - Golf Course & Valley (iframe) `https://g1.ipcamlive.com/player/player.php?alias=6788f7b7d0365&autoplay=1` credit Canaan Valley Resort State Park
  - Canaan Valley Resort Webcam - Slope Base (iframe) `https://g1.ipcamlive.com/player/player.php?alias=67588ef2adde5&autoplay=1` credit Canaan Valley Resort State Park
  - skipped: ipcamlive alias 6911368c776d3 (1st player on page) — player page loads (200) but streamid is empty and the snapshot endpoint returns 404 on 2026-10-20 - stream offline / not configured
  - skipped: ipcamlive alias 689fab99423ec (2nd player on page) — player page loads (200) but streamid is empty and the snapshot endpoint returns 404 on 2026-10-20 - stream offline / not configured
  - skipped: Dyacon weather widget (dyacon.net/websiteWidget.php) — weather-station widget, not a camera
- Notes: Regency Hotel Management site (static HTML, curl works). Webcam page embeds four unlabeled IPCamLive players (g1.ipcamlive.com/player/player.php?alias=...) with the caption 'Our mountain webcams provide the perfect way to check current weather & golf course traffic'; the operator gives NO per-camera names, so the two live cams are named descriptively from their current view - maintainer should confirm names/kinds in season. Two of the four players are offline (no stream). The ipcamlive snapshot.php endpoint 302s to a server-specific s###.ipcamlive.com/streams/<id>/snapshot.jpg which may change, so the iframe player URL is stored rather than the image. Footer links only a Privacy Policy (no terms page) -> verdict 'none'. Trail report page says 'Trails are Closed for the Season' (last updated Feb 10 2026); no 2026-27 opening date announced. Operator site name is 'Canaan Valley Resort State Park'; socials from footer (also TikTok and YouTube @canaanvalleyresortstatepark).
- Profile notes: Operator stats page: 'Summit elevation: 4,280 feet', 'Vertical drop: 850 feet', 'Number of trails: 26', 'Number of lifts: 1 quad, 2 triples, and 1 magic carpet' (=4; trail report counts 6 incl. two tubing lifts), 'Average annual snowfall: more than 117 inches'. Base elevation DERIVED as 4,280 - 850 = 3,430 ft. Snowfall conflict: the Winter Activities overview says 'around 180 inches of snowfall annually'; stats page value used. Skiable acres and longest run not published (lead list's 91 acres unconfirmed). Indy Pass: listed on indyskipass.com Mid-Atlantic page as 'Canaan Valley' (Davis, WV). Wikidata Q3364026 is the state park item (P31 state park), which is the operator entity; no separate ski-area item exists.

### bryce-resort  (VA, Blue Ridge Mountains)
Operator: https://bryceresort.com  |  cams: https://bryceresort.com/mountain-info/conditions
- coords 38.8175, -78.7658; base/summit — / — ft (operator publishes none); station: none qualifies; passes indy; wikidata Q19865758
- Added 1 cam(s):
  - Bryce Resort (iframe, base) `https://www.resortcams.com/webcams/bryce-resort/iframe/` credit Bryce Resort via ResortCams.com
- Notes: Craft/Laravel-style static site (curl works). The Conditions page embeds a single ResortCams.com iframe (https://www.resortcams.com/webcams/bryce-resort/iframe/); ResortCams describes it as a PTZ cam 'located at base of the mountain'. Terms are a Termly-generated boilerplate (no-reproduction / no-scraper clauses, nothing on framing or embedding) -> 'ok'. Ski & Snowboard page states 'Regular Season (2026/27 Opening Day TBD)' and an early-season rate window 'Opening Day Through Dec. 10, 2026', so no projected date yet -> opening null. No X/Twitter link in footer (Facebook, Instagram, YouTube @BryceVA only).
- Profile notes: The operator site publishes NO mountain statistics (no elevation, vertical, acreage, trail or lift counts anywhere on bryceresort.com: checked home, mountain-info, conditions, ski-and-snowboard, FAQs, mountain-maps, directions; site search for 'vertical/elevation' returns only the homepage). Left null rather than copied from third parties. For reference only, the Indy Pass Mid-Atlantic listing shows 'Bryce Resort Vertical 500ft Trails 8 Lifts 4'. Trail map is a JPG (bryce_trailmap_2026_web.jpg) on the Mountain Maps page. Indy Pass: listed on indyskipass.com Mid-Atlantic page as 'Bryce Resort' (Basye, VA).

### massanutten  (VA, Blue Ridge Mountains)
Operator: https://www.massresort.com  |  cams: https://www.massresort.com/play/snow-sports/snow-webcams/
- coords 38.4060, -78.7560; base/summit 1812 / 2922 ft; station: none qualifies; passes indy; wikidata —
- Added 3 cam(s):
  - Massanutten Resort Summit Cam (iframe, summit, 2922 ft) `https://www.resortcams.com/webcams/massanutten-resort-summit-cam/iframe/` credit Massanutten Resort via ResortCams.com
  - Massanutten Resort Base Cam (iframe, base, 1812 ft) `https://www.resortcams.com/webcams/massanutten-base/iframe/` credit Massanutten Resort via ResortCams.com
  - Massanutten Resort Tubing Cam (iframe) `https://www.resortcams.com/webcams/massanutten/iframe/` credit Massanutten Resort via ResortCams.com
- Notes: Great Eastern Resort Management CMS site (static HTML, curl works). Webcam page embeds three unlabeled ResortCams.com iframes; names taken from the ResortCams cam pages (Summit Cam / Base Cam / Tubing Cam). Cam elevations are the operator's summit figure and the derived base figure. Terms of Use (Great Eastern Resort Management) contain generic no-reproduction / no-bots boilerplate and nothing about framing, hot-linking or embedding -> 'ok'. Snow-conditions page (updated Mar 17 2026) says slopes closed for the season; Hours & Rates says 'We normally begin making snow in early to mid-December' - no 2026-27 opening date announced. Socials from footer (also YouTube user/MassanuttenResort and TikTok); no X/Twitter link.
- Profile notes: Hours & Rates page: 'At 2,922 ft. elevation, Massanutten offers 83 skiable acres, 23 runs, 7 lifts'. Scenic Chairlift page: 'carried 1,110 vertical feet ... to an elevation of 2,925 feet' (3 ft inconsistency with the 2,922 figure; 2,922 used). Base elevation DERIVED as 2,922 - 1,110 = 1,812 ft. Snow-conditions page confirms 23 trails / 7 lifts. Annual snowfall and longest run not published. Indy Pass: listed on indyskipass.com Mid-Atlantic page as 'Massanutten Resort' (Massanutten, VA). No Wikidata item for the resort/ski area (only Massanutten Mountain Q6784529 and the CDP Q1374774).

### beech-mountain  (NC, Blue Ridge Mountains)
Operator: https://www.beechmountainresort.com  |  cams: https://www.beechmountainresort.com/mountain/webcams/
- coords 36.1930, -81.8776; base/summit 4675 / 5506 ft; station: none qualifies; passes none; wikidata —
- Opening 2026-27: 2026-11-21 (projected) — https://www.beechmountainresort.com/hours-of-operation-winter/
- Added 1 cam(s):
  - 5506' Cam (iframe, summit, 5506 ft) `https://www.resortcams.com/webcams/beech-mountain-summit/iframe/` credit Beech Mountain Resort / ResortCams.com
- Notes: WordPress (Impreza/us-core theme) site, curl-renderable. Webcam page embeds a single ResortCams.com iframe labelled "5506' Cam" ('Webcam Hosting Provided by ResortCams.com'); the iframe is an HLS player with a still fallback. The HLS playlist and the JPEG thumbnail (stable URL, no cache-buster) are listed in the cam verification as alternatives. The only policy page linked is /policies/ (slope/ticket/safety policies, not website terms) and there is no privacy or terms page in the footer, so terms verdict is 'none'. Lead coords (36.179,-81.89) moved ~1.9 km to the base-lift cluster next to the operator's 1007 Beech Mountain Pkwy address. Beech also runs YouTube channel UCITmCXbNd6CzK8Dz-_Hei2w but it is not used for cams.
- Profile notes: Stats page: 9 total lifts (4 quads, 2 doubles, 1 rope tow, 2 carpets), 17 total trails (3/9/4 + 1 freestyle terrain), 95 skiable acres, peak 5,506 ft, base 4,675 ft, vertical rise 830 ft, lift capacity 10,858/hr, 100% snowmaking. Annual snowfall and longest run are not published on the stats page. No Wikidata item for the ski resort (only the mountain Q4879594 and the town Q2026889). Not on the Indy Pass Mid-Atlantic or East lists, Powder Alliance or Mountain Collective lists; not on the Ikon destinations list (ikonpass.com/en/destinations, rendered via Firecrawl); epicpass.com blocked curl but the operator's season-pass page makes no multi-resort pass claim.

### cataloochee  (NC, Great Smoky Mountains)
Operator: https://cataloochee.com  |  cams: https://cataloochee.com/the-mountain/webcams/
- coords 35.5627, -83.0882; base/summit 4660 / 5400 ft; station: none qualifies; passes indy; wikidata Q5051346
- Added 1 cam(s):
  - Base of Mountain (iframe, base, 4660 ft) `https://www.resortcams.com/webcams/cataloochee/iframe/` credit Cataloochee Ski Area / ResortCams.com
  - skipped: Top of Mountain — operator notice on the cam page: 'This camera is offline due to damage from a weather-related incident. We are actively working to restore the feed' (ResortCams slug cataloochee-liftcam, stream cataloochee2; the relay st
  - skipped: Aerial View — feed dead: ResortCams slug cataloochee-hemphill, HLS cataloochee3.stream/playlist.m3u8 404 and thumbnail 404 (2026-10-20T03:24Z); view from Hemphill Bald toward the ski area
- Notes: WordPress (Impreza/us-core) site, curl-renderable. Cam page has one ResortCams.com iframe plus Base/Top/Aerial buttons that call changeCam('<slug>', ...) and swap the iframe src to https://www.resortcams.com/webcams/<slug>/iframe/ (slugs: cataloochee, cataloochee-liftcam, cataloochee-hemphill). No 2026-27 opening date announced: the operator's Instagram embed says 'Dates for the 2026-2027 season will be available soon'; stats page gives season as 'Early November - Late March' and last season 11/12/25-3/11/26. No terms or privacy page linked in the footer; /the-mountain/policies-education/ is mountain-safety education. Lead coords (35.588,-83.088) moved 2.8 km south to the operator's lodge address (FLAG: > 2 km).
- Profile notes: Stats page: 50 acres, peak 5,400 ft, base 4,660 ft, vertical drop 740 ft, longest run 3,500 ft (Upper & Lower Snowbird) = 0.66 mi (converted from feet), 18 trails, five lifts (1 triple, 2 quads, 2 conveyors), 100% snowmaking, all slopes lit. Annual snowfall is not published. Listed on the official Indy Pass Mid-Atlantic resort list (indyskipass.com/our-resorts/cataloochee-ski-area). Not on Powder Alliance or Mountain Collective lists; not on the Ikon destinations list (ikonpass.com/en/destinations, rendered via Firecrawl); epicpass.com blocked curl and the operator makes no Epic claim.

### sugar-mountain  (NC, Blue Ridge Mountains)
Operator: https://skisugar.com  |  cams: https://skisugar.com/cams/
- coords 36.1301, -81.8591; base/summit 4100 / 5300 ft; station: none qualifies; passes none; wikidata —
- Added 6 cam(s):
  - Base (iframe, base, 4100 ft) `https://player.castr.com/live_fe980e10d22b11f0affbc9f04d80c8bf` credit Sugar Mountain Resort
  - Easy Street (iframe, base) `https://player.castr.com/live_7603aa40cecb11f093049346b8bbe416` credit Sugar Mountain Resort
  - Grandfather View (iframe) `https://player.castr.com/live_f373e500cfbe11f0b06b595bb3be6c70` credit Sugar Mountain Resort
  - Tennis/Golf (iframe, village) `https://player.castr.com/live_fbb6bff0d3b311f08758231ac7e26e0b` credit Sugar Mountain Resort
  - Oma's (iframe, mid) `https://player.castr.com/live_c3cb3b10cfbd11f094eff94566b39e7c` credit Sugar Mountain Resort
  - Oma's Top Lift (iframe, mid) `https://player.castr.com/live_6e6c0df06f2e11f1862cc590260dd311` credit Sugar Mountain Resort
  - skipped: Summit — stream offline: operator frame /library/camnew-summit.html points at Castr HLS live_da100dd0d3b211f089454b7c25f2965f/index.m3u8 which returns 404 'not found' (2026-10-20T03:22Z); re-check after the season opens (summit 5
- Notes: WordPress site, curl-renderable. /cams/ loads an iframe named 'camview' that starts on /library/camoff.html and is switched by seven text links to /library/camnew-<cam>.html; each of those is a tiny Clappr HLS player page pointing at a Castr stream (stream-hls.castr.net/692db5cbd4b7bb92e22b15c8/<id>/index.m3u8) with a 10-minute meta-refresh back to camoff. The operator's frame pages send X-Frame-Options: SAMEORIGIN so they cannot be iframed; the stored embed_url is Castr's hosted player for the same stream id (https://player.castr.com/<id>), which returns 200 with no framing headers. If PeakCam prefers raw HLS, the index.m3u8 URLs are in each verification string. Cam labels are the operator's; kinds for Easy Street (beginner slope by the base), Oma's / Oma's Top Lift (Oma's Meadow mid-mountain lift) and Tennis/Golf (summer activity area) are best-effort, Grandfather View left blank. No 2026-27 opening date found on the home, mountain-info, snow report or press-release pages (last season opened 11/11/25, stats page says typical season November-March). Only a Privacy Policy is linked in the footer (no terms page); it has no framing/hot-linking language, verdict 'ok'. No Facebook or X link on the site, Instagram only (plus YouTube channel UCKJgt5G1RkLKRaO4RYZLOFQ). Lead coords (36.116,-81.869) moved ~1.8 km to the operator's base address.
- Profile notes: Stats page: 125 skiable acres, vertical drop 1,200 ft, longest run 1 1/2 miles, summit 5,300 ft, base 4,100 ft, 20 slopes (14 lit), 'twenty-five year average annual snowfall: 74 inches', lift network = 1 six-pack + 2 HS quads + 1 fixed quad + 2 doubles + 2 magic carpets (one is the tubing-park carpet) = 8 counted; 6 chairlifts if carpets are excluded. Uphill capacity 12,935/hr. No Wikidata item for the resort (Q1926685 is the village). Not on the Indy Pass Mid-Atlantic/East lists, Powder Alliance or Mountain Collective lists; not on the Ikon destinations list (ikonpass.com/en/destinations, rendered via Firecrawl); epicpass.com blocked curl and the operator makes no Epic claim.

## Station near misses (rule applied strictly; override by hand if wanted)

- bristol-mountain: no active SNOTEL within 25 km
- buffalo-ski-center: no active SNOTEL within 25 km
- catamount: no active SNOTEL within 25 km
- greek-peak: no active SNOTEL within 25 km
- holiday-valley: no active SNOTEL within 25 km
- holimont: no active SNOTEL within 25 km
- kissing-bridge: no active SNOTEL within 25 km
- labrador-mountain: no active SNOTEL within 25 km
- plattekill: no active SNOTEL within 25 km
- snow-ridge: no active SNOTEL within 25 km
- song-mountain: no active SNOTEL within 25 km
- swain: no active SNOTEL within 25 km
- titus-mountain: no active SNOTEL within 25 km
- west-mountain: no active SNOTEL within 25 km
- magic-mountain: no active SNOTEL within 25 km
- middlebury-snowbowl: no active SNOTEL within 25 km
- quechee: no active SNOTEL within 25 km
- black-mountain-nh: no active SNOTEL within 25 km
- crotched: no active SNOTEL within 25 km
- gunstock: no active SNOTEL within 25 km
- mount-sunapee: no active SNOTEL within 25 km
- pats-peak: no active SNOTEL within 25 km
- ragged-mountain: no active SNOTEL within 25 km
- big-moose: no active SNOTEL within 25 km
- black-mountain-of-maine: no active SNOTEL within 25 km
- camden-snow-bowl: no active SNOTEL within 25 km
- lost-valley: no active SNOTEL within 25 km
- mt-abram: no active SNOTEL within 25 km
- pleasant-mountain: no active SNOTEL within 25 km
- saddleback: no active SNOTEL within 25 km
- berkshire-east: no active SNOTEL within 25 km
- bousquet: no active SNOTEL within 25 km
- butternut: no active SNOTEL within 25 km
- big-boulder: no active SNOTEL within 25 km
- blue-knob: no active SNOTEL within 25 km
- elk-mountain: no active SNOTEL within 25 km
- jack-frost: no active SNOTEL within 25 km
- laurel-mountain: no active SNOTEL within 25 km
- liberty-mountain: no active SNOTEL within 25 km
- montage-mountain: no active SNOTEL within 25 km
- roundtop: no active SNOTEL within 25 km
- whitetail: no active SNOTEL within 25 km
- mountain-creek: no active SNOTEL within 25 km
- big-powderhorn: no active SNOTEL within 25 km
- caberfae-peaks: no active SNOTEL within 25 km
- crystal-mountain-michigan: no active SNOTEL within 25 km
- mount-bohemia: no active SNOTEL within 25 km
- mt-brighton: no active SNOTEL within 25 km
- otsego-resort: no active SNOTEL within 25 km
- pine-mountain: no active SNOTEL within 25 km
- schuss-mountain: no active SNOTEL within 25 km
- ski-brule: no active SNOTEL within 25 km
- snowriver: no active SNOTEL within 25 km
- the-highlands: no active SNOTEL within 25 km
- alpine-valley: no active SNOTEL within 25 km
- cascade-mountain: no active SNOTEL within 25 km
- christie-mountain: no active SNOTEL within 25 km
- devils-head: no active SNOTEL within 25 km
- trollhaugen: no active SNOTEL within 25 km
- tyrol-basin: no active SNOTEL within 25 km
- whitecap-mountain: no active SNOTEL within 25 km
- wilmot-mountain: no active SNOTEL within 25 km
- afton-alps: no active SNOTEL within 25 km
- buck-hill: no active SNOTEL within 25 km
- giants-ridge: no active SNOTEL within 25 km
- welch-village: no active SNOTEL within 25 km
- wild-mountain: no active SNOTEL within 25 km
- boston-mills: no active SNOTEL within 25 km
- mad-river-mountain: no active SNOTEL within 25 km
- snow-creek: no active SNOTEL within 25 km
- paoli-peaks: no active SNOTEL within 25 km
- canaan-valley: no active SNOTEL within 25 km
- bryce-resort: no active SNOTEL within 25 km
- massanutten: no active SNOTEL within 25 km
- beech-mountain: no active SNOTEL within 25 km
- cataloochee: no active SNOTEL within 25 km
- sugar-mountain: no active SNOTEL within 25 km

