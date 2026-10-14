# PeakCam card camera-preview data audit

Generated 2026-10-14 against live Supabase (`resorts`, `cams`; 148 resorts, 374 cams). Preview logic replicated verbatim from `origin/feat/seo-audit-fixes:lib/cam-preview.ts`. Scripts: `pull.mjs`, `audit.mjs`, `probe2.mjs`, `report.mjs` in this scratchpad; raw output `audit.json`.

## How a card gets its image (evidence)
- `app/page.tsx:60-63` → `getAllResorts()`; `lib/supabase.ts:46-97` loads **all** resorts with `is_active=true` (line 50) and cams with `is_active=true` (line 70), using the **anon key** (`lib/supabase.ts:11`; RLS also hides the 29 inactive cams from anon). No curated subset: every active resort (148, none inactive) gets a `SummitResortCard`; `BrowsePage.tsx:474-490` sorts "popular" (16 curated slugs from `lib/popular-resorts.ts` first, then condition → 24h snow → name) and paginates 24 at a time (`BrowsePage.tsx:519`).
- `SummitResortCard.tsx:82` `cams = availableCameras(resort.cams)`; `:113` renders `<CardCameraPreview cams={cams}>`.
- `CardCameraPreview.tsx:11` `cameraPreviews(cams).find(item => !failed.has(item.src))`; on `<img onError>` (`:26`) it advances to the next src; with no preview it renders the "Take a look around. / Preview unavailable · Open cameras" topo placeholder (`:27-32`). File is identical on main and seo-audit-fixes.
- seo `lib/cam-preview.ts:10-14` `availableCameras`: `is_active && !auto_disabled && (youtube ? 11-char id : http(s) embed_url)`.
- seo `lib/cam-preview.ts:34-47` `previewSource`: `image` + `https://` → embed_url itself (35); `youtube` → `i.ytimg.com/vi/<id>/hqdefault.jpg` (36); anything not `iframe` (i.e. **`link`**) → null (37); `iframe` only if host is exactly `player.brownrice.com` with path `/embed/<stream>/?` → `/snapshot/<stream>` (40-43), else lookup of `url.href` in `scripts/data/camera-previews/roundshot.json` (12 entries) (45-46), else null.
- seo `lib/cam-preview.ts:49-53` `cameraPreviews`: sorted by `consecutive_failures`, YouTube last. `SnowCams.tsx` (home "Snow forecast" strip) does not use `cameraPreview(s)` at all — it renders its own per-cam card, so it is out of scope for card stills.
- The 14 cams added by `origin/feat/seo-audit-fixes:data/cams.csv` (vail ×2, breckenridge, mammoth ×7 new + 3 updated ids, northstar, stevens-pass ×2) are **already in the live DB** — the DB, not the CSV, is what the site renders.

## (a) Cards with NO preview: 47 of 148

### A. No cams in DB — 4

| resort | popular-sort position | cams (DB total / site-loaded) | detail | evidence for a fix |
|---|---|---|---|---|
| batea-mahuida | 45 | 0 / 0 | no rows in `cams` | — |
| cerro-mirador | 63 | 0 / 0 | no rows in `cams` | — |
| cerro-perito-moreno | 64 | 0 / 0 | no rows in `cams` | — |
| lagunillas | 19 (page 1) | 0 / 0 | no rows in `cams` | — |

### B. All cams inactive/auto-disabled — 6

| resort | popular-sort position | cams (DB total / site-loaded) | detail | evidence for a fix |
|---|---|---|---|---|
| antillanca | 20 (page 1) | 2 / 0 | image auto_disabled (cf 3); image auto_disabled (cf 3) | — |
| la-parva | 25 | 3 / 0 | youtube auto_disabled (cf 3); youtube manually inactive; youtube manually inactive | — |
| loveland | 87 | 3 / 0 | image auto_disabled (cf 3); image auto_disabled (cf 3); image auto_disabled (cf 3) | — |
| mt-bachelor | 95 | 3 / 0 | youtube auto_disabled (cf 3); youtube auto_disabled (cf 3); youtube auto_disabled (cf 3) | — |
| mt-baldy | 97 | 1 / 0 | youtube auto_disabled (cf 3) | — |
| snowshoe | 120 | 1 / 0 | link manually inactive | — |

### C. Only `link` (link-out) cams — 18

| resort | popular-sort position | cams (DB total / site-loaded) | detail | evidence for a fix |
|---|---|---|---|---|
| camelback | 59 | 1 / 1 | link `camelbackresort.com` | link-out page: https://camelbackresort.com/resort-information/live-cameras |
| deer-valley | 69 | 1 / 1 | link `www.deervalley.com` | link-out page: https://www.deervalley.com/explore-the-mountain/webcams |
| donner-ski-ranch | 71 | 1 / 1 | link `www.donnerskiranch.com` | link-out page: https://www.donnerskiranch.com |
| granby-ranch | 74 | 1 / 1 | link `camstreamer.com` | link-out page: https://camstreamer.com/live/stream/1865 |
| jiminy-peak | 81 | 1 / 1 | link `jiminypeak.com` | link-out page: https://jiminypeak.com/webcams/ |
| lookout-pass | 85 | 1 / 1 | link `skilookout.com` | link-out page: https://skilookout.com/webcams/ |
| monarch-mountain | 37 | 1 / 1 | link `skimonarch.com` | link-out page: https://skimonarch.com/conditions/cams/ |
| mt-ashland | 94 | 1 / 1 | link `mtashland.com` | link-out page: https://mtashland.com/webcams/ |
| nubs-nob | 101 | 1 / 1 | link `nubsnob.com` | link-out page: https://nubsnob.com/cam/ |
| powder-mountain | 105 | 1 / 1 | link `www.powdermountain.com` | link-out page: https://www.powdermountain.com/resort/the-mountain/conditions/webcams |
| red-lodge | 107 | 1 / 1 | link `redlodgemountain.com` | link-out page: https://redlodgemountain.com/webcam/ |
| red-river | 108 | 1 / 1 | link `redriverskiarea.com` | link-out page: https://redriverskiarea.com/explore/about/webcams/ |
| seven-springs | 110 | 1 / 1 | link `7springs.com` | link-out page: https://7springs.com/the-mountain/mountain-conditions/mountain-cams.aspx |
| ski-bowl | 40 | 1 / 1 | link `skibowl.com` | link-out page: https://skibowl.com/jet-popup/video-cam-menu/ |
| snow-summit | 117 | 1 / 1 | link `www.bigbearmountainresort.com` | link-out page: https://www.bigbearmountainresort.com/webcams/snow-summit |
| solitude | 30 | 1 / 1 | link `solitudemountain.com` | link-out page: https://solitudemountain.com/mountain-and-village/webcams |
| sugar-bowl | 125 | 1 / 1 | link `www.sugarbowl.com` | link-out page: https://www.sugarbowl.com/webcams |
| tahoe-donner | 132 | 1 / 1 | link `www.tahoedonner.com` | link-out page: https://www.tahoedonner.com/community/webcams/ |

### D. Brownrice cam on a host/path the resolver rejects — 7

| resort | popular-sort position | cams (DB total / site-loaded) | detail | evidence for a fix |
|---|---|---|---|---|
| angel-fire | 33 | 3 / 3 | iframe `live1.brownrice.com`, iframe `live3.brownrice.com`, iframe `live1.brownrice.com` | `player.brownrice.com/snapshot/<stream>` returns 200 image/jpeg for all 3 (afbasearea, afchileunload, swsummit) |
| homewood | 77 | 3 / 3 | iframe `explore.org`, iframe `player.livespotting.com`, iframe `live4.brownrice.com` | `player.brownrice.com/snapshot/homewood5` returns 200 **text/html** (362B) — not usable; explore.org / livespotting unresolved |
| mt-rose | 98 | 3 / 3 | iframe `live3.brownrice.com`, iframe `live3.brownrice.com`, iframe `live3.brownrice.com` | `player.brownrice.com/snapshot/<stream>` 200 image/jpeg for all 3 |
| ski-santa-fe | 114 | 2 / 2 | iframe `player.brownrice.com`, iframe `player.brownrice.com` | embed_url is already `https://player.brownrice.com/snapshot/<stream>` (200 image/png & image/jpeg) but stored as `embed_type=iframe`; path is `/snapshot/` not `/embed/` so line 40 regex fails. Data fix: embed_type → `image` (or resolver: accept /snapshot/) |
| taos | 134 | 4 / 4 | iframe `live3.brownrice.com`, iframe `live2.brownrice.com`, iframe `tsvweather.brownrice.com`, iframe `live2.brownrice.com` | snapshot 200 for tsvbav, tsv, tsvridge (3/4; `tsvweather.brownrice.com/poco-webcam.php` has no stream id) |
| windham | 144 | 1 / 1 | iframe `player.brownrice.com` | path `/embed/windhammountainclub/timelapse/24hr` has extra segments, regex `^/embed/([\w-]+)/?$` fails; `/snapshot/windhammountainclub` returns 200 image/jpeg |
| wolf-creek | 148 | 3 / 3 | iframe `live2.brownrice.com`, iframe `live2.brownrice.com`, iframe `live2.brownrice.com` | snapshot 200 for wolfcreeksummit/tresurlift/treasure (note DB row has literal `&em=1` in the path: `/embed/wolfcreektreasure&em=1`) |

### E. Iframe provider with no snapshot pattern — 12

| resort | popular-sort position | cams (DB total / site-loaded) | detail | evidence for a fix |
|---|---|---|---|---|
| bear-valley | 47 | 1 / 1 | iframe `camstreamer.com` | camstreamer.com embed — no known still pattern |
| bretton-woods | 55 | 2 / 1 | iframe `g1.ipcamlive.com` (+1 inactive) | remaining ipcamlive alias 63c1cffd31643 snapshot.php → 404; EarthCam cam auto-disabled |
| burke-mountain | 58 | 2 / 2 | iframe `rtsp.me`, iframe `rtsp.me` | rtsp.me embed — no known still pattern |
| china-peak | 65 | 3 / 3 | iframe `g1.ipcamlive.com`, iframe `g1.ipcamlive.com`, iframe `g1.ipcamlive.com` | ipcamlive snapshot.php 200 image/jpeg for all 3 |
| corralco | 22 (page 1) | 4 / 4 | iframe `www.ipcamlive.com`, iframe `www.ipcamlive.com`, iframe `www.ipcamlive.com`, iframe `www.ipcamlive.com` | ipcamlive snapshot.php 200 image/jpeg for all 4 aliases |
| las-lenas (curated #16) | 16 (page 1) | 3 / 1 | iframe `tv.streamcasthd.com` (+2 inactive) | 2 snow2day image cams auto-disabled (3 failures); remaining `tv.streamcasthd.com` widget has no known still |
| mt-hood-meadows | 38 | 3 / 3 | iframe `api.wetmet.net`, iframe `api.wetmet.net`, iframe `api.wetmet.net` | api.wetmet.net stream widget — no known still pattern |
| nevados-de-chillan | 26 | 2 / 2 | iframe `g3.ipcamlive.com`, iframe `g3.ipcamlive.com` | ipcamlive snapshot.php 200 for plazatata (pistanovicios 404) |
| ski-portillo (curated #13) | 13 (page 1) | 4 / 4 | iframe `g3.ipcamlive.com`, iframe `g3.ipcamlive.com`, iframe `g3.ipcamlive.com`, iframe `g3.ipcamlive.com` | `https://ipcamlive.com/player/snapshot.php?alias=<alias>` 200 image/jpeg for laguna, plateau, escuela (tiobobs 404) |
| ski-cooper | 113 | 3 / 3 | iframe `skicooper.com:8443`, iframe `skicooper.com:8443`, iframe `skicooper.com:8443` | self-hosted `skicooper.com:8443/<cam>/` player — no known still pattern |
| sunlight | 27 | 2 / 2 | iframe `g1.ipcamlive.com`, iframe `g1.ipcamlive.com` | ipcamlive snapshot.php 200 image/jpeg for both |
| wachusett | 137 | 2 / 2 | iframe `api.wetmet.net`, iframe `api.wetmet.net` | api.wetmet.net stream widget — no known still pattern |

Notes:
- Every `link` cam is rejected at `cam-preview.ts:37`. Several are resort webcam pages, a few point at media (`granby-ranch` → camstreamer.com/live/stream/1865).
- Category B resorts render the "No cameras available yet" state and also disable the Live look button (`SummitResortCard.tsx:210-212`).
- Only `ski-portillo` (#13) and `las-lenas` (#16) of the no-preview set are curated "popular" resorts; with today's conditions/snow the first page (24 cards) also contains: antillanca, corralco, lagunillas.

## (b) Cards whose preview is broken / placeholder / stale

Probed every preview src (266 distinct) with GET, redirects followed, 10s timeout, browser UA. 264 returned 200 image/*. The card shows the **first** src that does not fire `onError` (`CardCameraPreview.tsx:11,26`); an HTTP 4xx whose body is still a decodable image (YouTube's 120x90 grey) does **not** fire onError, so it is shown.

### Card's displayed image is bad

| resort | shown src (idx) | problem | clean alternatives among its previews |
|---|---|---|---|
| brighton | youtube "Cam 3" https://i.ytimg.com/vi/HD1S-bdI1AA/hqdefault.jpg (0) | all-black frame (2139B) | 2 of 4: Cam 2, Cam 4 |
| crystal-mountain | image "Snow Stake" https://webcams.opensnow.com/current/2003.jpg (0) | stale: Last-Modified 2026-06-15 (121d) | 1 of 3: Summit Roundshot |
| eldora | image "Snow Stake" https://b14.hdrelay.com/camera/b7ceb08f-5cbb-42f1-9a9f-920f2ac5c4dc/snapshot (0) | stale: Last-Modified 2026-04-05 (192d) | 0 of 2 |
| spirit-mountain | image "Live Cam" https://tools.hbi.com/wx/wdio/dynamic_weather_spiritmtn.jpg (0) | stale: Last-Modified 2026-03-17 (211d) | 0 of 1 |
| telluride | iframe "Revelation Bowl 360" https://tellurideskiresort.roundshot.com/cams/983/thumbnail (0) | stale: Last-Modified 2026-09-12 (32d) | 0 of 1 |
| whitefish | iframe "Summit Roundshot" https://skiwhitefish.roundshot.com/cams/849/thumbnail (0) | stale: Last-Modified 2026-10-01 (13d) | 0 of 1 |

### Bad previews that are NOT shown (a better one sorts earlier)

| resort | idx | src | problem |
|---|---|---|---|
| bear-mountain | 2 | https://i.ytimg.com/vi/f_OUEF4csuo/hqdefault.jpg | all-black frame (2170B) |
| brian-head | 1 | https://b14.hdrelay.com/camera/66e069aee2c05fceb65b6688/snapshot | stale: Last-Modified 2026-08-18 (57d) |
| bridger-bowl | 1 | https://webcam-images.s3-us-west-1.amazonaws.com/RidgeEast.jpg | stale: Last-Modified 2026-10-11 (3d) |
| brighton | 2 | https://i.ytimg.com/vi/XLzKPufaAts/hqdefault.jpg | all-black frame (2195B) |
| cerro-catedral | 4 | https://varitech.ar/cameras/cam006/latest.jpg | stale: Last-Modified 2026-09-03 (41d) |
| crystal-mountain | 2 | https://webcams.opensnow.com/current/2005.jpg | HTTP 403 |
| dodge-ridge | 1 | https://i.ytimg.com/vi/l1gateQVYr4/hqdefault.jpg | HTTP 404 (image body 120x90, 1097B); placeholder 120x90 |
| eldora | 1 | https://b14.hdrelay.com/camera/0e9787f3-7961-4ae4-bd59-8cbbcd79ed31/snapshot | stale: Last-Modified 2026-04-05 (192d) |
| kirkwood | 2 | https://cache.snow.com/Mtncams/KWSnowStake.jpg | stale: Last-Modified 2026-08-24 (51d) |
| mammoth | 5 | https://i.ytimg.com/vi/UpfvBbw6kSY/hqdefault.jpg | all-black frame (2230B) |
| ski-bluewood | 1 | https://cameraftpapi.drivehq.com/api/Camera/LastImageaspx/shareID17403860/bwdsummit.jpg | placeholder 160x120; stale: Last-Modified 2026-07-09 (97d) |
| steamboat | 1 | https://i.ytimg.com/vi/8w4tZE2k7AE/hqdefault.jpg | all-black frame (2168B) |
| steamboat | 2 | https://i.ytimg.com/vi/fI30YzAmCHw/hqdefault.jpg | all-black frame (2218B) |
| snoqualmie | 1 | https://i.ytimg.com/vi/BxM71UffjpU/hqdefault.jpg | all-black frame (2206B) |

Observations: YouTube `hqdefault` for a dead id returns HTTP 404 + 1097B 120x90 grey JPEG (dodge-ridge `l1gateQVYr4`; oEmbed still 200, so it is likely an upcoming/never-started live). Live-stream thumbnails of ~2.1–2.2 KB at 480x360 are solid black frames (night or dead stream; verified visually for brighton-0). No preview src was a non-image redirect. Brownrice snapshots carry no Last-Modified, so staleness there can't be measured from headers. Roundshot thumbnails are live except telluride (2026-09-12) and whitefish (2026-10-01).

## (c) Provider hostnames across ALL cams

Snapshot path = does `previewSource` produce a still for this host/type? (image→itself, youtube→ytimg, iframe→brownrice `player.` /embed/ or roundshot.json). Counts include inactive cams (in parentheses).

| embed_type | host | cams (inactive) | yields still | resorts | flag |
|---|---|---|---|---|---|
| iframe | player.brownrice.com | 63 | 60/63 | attitash, park-city, crested-butte, stevens-pass, northstar, whistler-blackcomb, breckenridge, stowe, hunter, ski-santa-fe, white-pass, purgatory, mount-snow, wildcat, heavenly, vail, okemo, keystone, kirkwood, beaver-creek, ski-apache, windham | PARTIAL |
| iframe | g1.ipcamlive.com | 12 | 0/12 | sunlight, china-peak, cannon, telluride, heavenly, bretton-woods, aspen-snowmass | NO SNAPSHOT PATH |
| iframe | g3.ipcamlive.com | 7 | 0/7 | nevados-de-chillan, ski-portillo, cerro-catedral | NO SNAPSHOT PATH |
| iframe | live3.brownrice.com | 5 | 0/5 | taos, mt-rose, angel-fire | NO SNAPSHOT PATH |
| iframe | live2.brownrice.com | 5 | 0/5 | taos, wolf-creek | NO SNAPSHOT PATH |
| iframe | api.wetmet.net | 5 | 0/5 | mt-hood-meadows, wachusett | NO SNAPSHOT PATH |
| iframe | camstreamer.com | 5 | 0/5 | brundage, big-sky, bear-valley, sugarbush | NO SNAPSHOT PATH |
| iframe | www.ipcamlive.com | 4 | 0/4 | corralco | NO SNAPSHOT PATH |
| iframe | aspen.roundshot.com | 3 | 3/3 | aspen-snowmass | covered |
| iframe | skicooper.com:8443 | 3 | 0/3 | ski-cooper | NO SNAPSHOT PATH |
| iframe | rtsp.me | 2 | 0/2 | burke-mountain | NO SNAPSHOT PATH |
| iframe | relay.ozolio.com | 2 | 0/2 | palisades-tahoe | NO SNAPSHOT PATH |
| iframe | live1.brownrice.com | 2 | 0/2 | angel-fire | NO SNAPSHOT PATH |
| iframe | lonemountainland.roundshot.com | 2 | 2/2 | big-sky | covered |
| iframe | vauth.command.verkada.com | 2 (2) | 0/0 | purgatory, sundance | NO SNAPSHOT PATH |
| iframe | skiwhitefish.roundshot.com | 1 | 1/1 | whitefish | covered |
| iframe | palisadestahoe.roundshot.com | 1 | 1/1 | palisades-tahoe | covered |
| iframe | lutsen.roundshot.com | 1 | 1/1 | lutsen | covered |
| iframe | schweitzer.roundshot.com | 1 | 1/1 | schweitzer | covered |
| iframe | tsvweather.brownrice.com | 1 | 0/1 | taos | NO SNAPSHOT PATH |
| iframe | share.earthcam.net | 1 (1) | 0/0 | bretton-woods | NO SNAPSHOT PATH |
| iframe | explore.org | 1 | 0/1 | homewood | NO SNAPSHOT PATH |
| iframe | crystalmountainresort.roundshot.com | 1 | 1/1 | crystal-mountain | covered |
| iframe | player.timecam.tv | 1 (1) | 0/0 | beaver-creek | NO SNAPSHOT PATH |
| iframe | tv.streamcasthd.com | 1 | 0/1 | las-lenas | NO SNAPSHOT PATH |
| iframe | player.livespotting.com | 1 | 0/1 | homewood | NO SNAPSHOT PATH |
| iframe | timecam.tv | 1 (1) | 0/0 | vail | NO SNAPSHOT PATH |
| iframe | live4.brownrice.com | 1 | 0/1 | homewood | NO SNAPSHOT PATH |
| iframe | killington.roundshot.com | 1 | 1/1 | killington | covered |
| iframe | tellurideskiresort.roundshot.com | 1 | 1/1 | telluride | covered |
| link | www.deervalley.com | 1 | 0/1 | deer-valley | NO SNAPSHOT PATH |
| link | www.bigbearmountainresort.com | 1 | 0/1 | snow-summit | NO SNAPSHOT PATH |
| link | solitudemountain.com | 1 | 0/1 | solitude | NO SNAPSHOT PATH |
| link | camelbackresort.com | 1 | 0/1 | camelback | NO SNAPSHOT PATH |
| link | skilookout.com | 1 | 0/1 | lookout-pass | NO SNAPSHOT PATH |
| link | camstreamer.com | 1 | 0/1 | granby-ranch | NO SNAPSHOT PATH |
| link | www.tahoedonner.com | 1 | 0/1 | tahoe-donner | NO SNAPSHOT PATH |
| link | yullrstorage.s3.us-east-1.amazonaws.com | 1 (1) | 0/0 | cranmore | NO SNAPSHOT PATH |
| link | www.powdermountain.com | 1 | 0/1 | powder-mountain | NO SNAPSHOT PATH |
| link | www.sugarbowl.com | 1 | 0/1 | sugar-bowl | NO SNAPSHOT PATH |
| link | 7springs.com | 1 | 0/1 | seven-springs | NO SNAPSHOT PATH |
| link | mtashland.com | 1 | 0/1 | mt-ashland | NO SNAPSHOT PATH |
| link | redlodgemountain.com | 1 | 0/1 | red-lodge | NO SNAPSHOT PATH |
| link | skimonarch.com | 1 | 0/1 | monarch-mountain | NO SNAPSHOT PATH |
| link | redriverskiarea.com | 1 | 0/1 | red-river | NO SNAPSHOT PATH |
| link | jiminypeak.com | 1 | 0/1 | jiminy-peak | NO SNAPSHOT PATH |
| link | www.donnerskiranch.com | 1 | 0/1 | donner-ski-ranch | NO SNAPSHOT PATH |
| link | skibowl.com | 1 | 0/1 | ski-bowl | NO SNAPSHOT PATH |
| link | nubsnob.com | 1 | 0/1 | nubs-nob | NO SNAPSHOT PATH |
| link | snowshoemtn.com | 1 (1) | 0/0 | snowshoe | NO SNAPSHOT PATH |
| link | photos.bogusbasin.org | 1 | 0/1 | bogus-basin | NO SNAPSHOT PATH |
| youtube | youtube (youtube_id) | 100 (10) | 90/90 | valle-nevado, stratton, mt-bachelor, breckenridge, la-parva, dodge-ridge, mammoth, mountain-high, sunday-river, sugarbush, snow-valley, winter-park, brighton, volcan-osorno, june-mountain, snoqualmie, arizona-snowbowl, mission-ridge, snow-king, sierra-at-tahoe, pillan, sugarloaf, bolton-valley, smugglers-notch, steamboat, mt-baldy, boyne-mountain, cranmore, bear-mountain, mad-river-glen, cerro-castor, loon, el-colorado, willamette-pass, cannon, tamarack |  |
| image | img.hdrelay.com | 29 (2) | 27/27 | powderhorn, arapahoe-basin, pico, gore, whiteface, jay-peak, killington, brian-head, diamond-peak, copper-mountain, granite-peak, snowbasin, eldora, mt-shasta |  |
| image | varitech.ar | 10 | 10/10 | cerro-catedral, chapelco, la-hoya |  |
| image | ipcamlive.com | 6 (1) | 5/5 | cerro-bayo |  |
| image | b14.hdrelay.com | 5 | 5/5 | waterville-valley, eldora, brian-head |  |
| image | oavv.segemar.gob.ar | 4 | 4/4 | caviahue |  |
| image | ftp.resortcams.com | 4 | 4/4 | wisp, wintergreen |  |
| image | timberlinelodge.com | 4 | 4/4 | timberline |  |
| image | webcam-images.s3-us-west-1.amazonaws.com | 4 | 4/4 | bridger-bowl |  |
| image | b15.hdrelay.com | 3 | 3/3 | snowbird, boreal |  |
| image | www.mountainwatch.com | 3 | 3/3 | sun-peaks |  |
| image | b9.hdrelay.com | 3 | 3/3 | sun-valley |  |
| image | santiampsp.org | 3 | 3/3 | hoodoo |  |
| image | photosskiloveland.com | 3 (3) | 0/0 | loveland |  |
| image | www.bigwhite.com | 3 | 3/3 | big-white |  |
| image | www.antillanca.cl | 2 (2) | 0/0 | antillanca |  |
| image | backend.roundshot.com | 2 | 2/2 | jackson-hole |  |
| image | storage.googleapis.com | 2 | 2/2 | jay-peak, bogus-basin |  |
| image | app.prismcam.com | 2 | 2/2 | alta |  |
| image | www.ski49n.com | 2 | 2/2 | 49-degrees-north |  |
| image | snow2day.com | 2 (2) | 0/0 | las-lenas |  |
| image | altaskiarea.s3-us-west-2.amazonaws.com | 2 (2) | 0/0 | alta |  |
| image | webcams.opensnow.com | 2 | 2/2 | crystal-mountain |  |
| image | cache.snow.com | 2 | 2/2 | keystone, kirkwood |  |
| image | images-webcams.windy.com | 2 | 2/2 | belleayre |  |
| image | cameraftpapi.drivehq.com | 2 | 2/2 | ski-bluewood |  |
| image | imgproxy.windy.com | 2 | 2/2 | mt-baker |  |
| image | manage.hdrelay.com | 1 | 1/1 | snowbird |  |
| image | assets1.webcam.io | 1 | 1/1 | pillan |  |
| image | www.skiutah.com | 1 | 1/1 | sundance |  |
| image | b7.hdrelay.com | 1 | 1/1 | mt-shasta |  |
| image | tools.hbi.com | 1 | 1/1 | spirit-mountain |  |
| image | brundage.com | 1 | 1/1 | brundage |  |
| image | it.nmu.edu | 1 | 1/1 | marquette-mountain |  |
| image | ftp.purchus.io | 1 | 1/1 | arapahoe-basin |  |

## (d) Appendix — per-resort table (all 148 active resorts)

Columns: DB cams total; site = active (what getAllResorts loads); by type among site cams; hosts; previews = cameraPreviews() length; first src status.

| resort | pos | DB | site | iframe/youtube/image/link | hosts | previews | first preview (status, type, bytes) | no-preview reason |
|---|---|---|---|---|---|---|---|---|
| vail | 1 | 6 | 5 | 5/0/0/0 | player.brownrice.com | 5 | 200 image/jpeg 60245B player.brownrice.com |  |
| aspen-snowmass | 2 | 4 | 4 | 4/0/0/0 | aspen.roundshot.com g1.ipcamlive.com | 3 | 200 image/jpeg 25180B aspen.roundshot.com |  |
| park-city | 3 | 4 | 4 | 4/0/0/0 | player.brownrice.com | 4 | 200 image/jpeg 118084B player.brownrice.com |  |
| jackson-hole | 4 | 2 | 2 | 0/0/2/0 | backend.roundshot.com | 2 | 200 image/jpeg 249492B backend.roundshot.com |  |
| whistler-blackcomb | 5 | 4 | 4 | 4/0/0/0 | player.brownrice.com | 4 | 200 image/jpeg 227558B player.brownrice.com |  |
| mammoth | 6 | 12 | 11 | 0/11/0/0 | youtube | 11 | 200 image/jpeg 7745B i.ytimg.com |  |
| breckenridge | 7 | 5 | 5 | 3/2/0/0 | youtube player.brownrice.com | 5 | 200 image/jpeg 39818B player.brownrice.com |  |
| palisades-tahoe | 8 | 3 | 3 | 3/0/0/0 | palisadestahoe.roundshot.com relay.ozolio.com | 1 | 200 image/jpeg 14832B palisadestahoe.roundshot.com |  |
| big-sky | 9 | 3 | 3 | 3/0/0/0 | lonemountainland.roundshot.com camstreamer.com | 2 | 200 image/jpeg 12741B lonemountainland.roundshot.com |  |
| killington | 10 | 3 | 3 | 1/0/2/0 | img.hdrelay.com killington.roundshot.com | 3 | 200 image/jpeg 41864B img.hdrelay.com |  |
| stowe | 11 | 2 | 2 | 2/0/0/0 | player.brownrice.com | 2 | 200 image/jpeg 48757B player.brownrice.com |  |
| alta | 12 | 4 | 2 | 0/0/2/0 | app.prismcam.com | 2 | 200 image/jpeg 130549B app.prismcam.com |  |
| ski-portillo | 13 | 4 | 4 | 4/0/0/0 | g3.ipcamlive.com | 0 | — | iframe provider w/o snapshot pattern (g3.ipcamlive.com) ×4 |
| valle-nevado | 14 | 4 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 14799B i.ytimg.com |  |
| cerro-catedral | 15 | 7 | 7 | 1/0/6/0 | g3.ipcamlive.com varitech.ar | 6 | 200 image/jpeg 67328B varitech.ar |  |
| las-lenas | 16 | 3 | 1 | 1/0/0/0 | tv.streamcasthd.com | 0 | — | inactive ×2; iframe provider w/o snapshot pattern (tv.streamcasthd.com) ×1 |
| snowbird | 17 | 2 | 2 | 0/0/2/0 | manage.hdrelay.com b15.hdrelay.com | 2 | 200 image/jpeg 169306B manage.hdrelay.com |  |
| caviahue | 18 | 4 | 4 | 0/0/4/0 | oavv.segemar.gob.ar | 4 | 200 image/png 202356B oavv.segemar.gob.ar |  |
| lagunillas | 19 | 0 | 0 | 0/0/0/0 |  | 0 | — | no cams |
| antillanca | 20 | 2 | 0 | 0/0/0/0 |  | 0 | — | inactive ×2 |
| chapelco | 21 | 3 | 3 | 0/0/3/0 | varitech.ar | 3 | 200 image/jpeg 83383B varitech.ar |  |
| corralco | 22 | 4 | 4 | 4/0/0/0 | www.ipcamlive.com | 0 | — | iframe provider w/o snapshot pattern (www.ipcamlive.com) ×4 |
| dodge-ridge | 23 | 2 | 2 | 0/2/0/0 | youtube | 2 | 200 image/jpeg 25166B i.ytimg.com |  |
| el-colorado | 24 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 7511B i.ytimg.com |  |
| la-parva | 25 | 3 | 0 | 0/0/0/0 |  | 0 | — | inactive ×3 |
| nevados-de-chillan | 26 | 2 | 2 | 2/0/0/0 | g3.ipcamlive.com | 0 | — | iframe provider w/o snapshot pattern (g3.ipcamlive.com) ×2 |
| sunlight | 27 | 2 | 2 | 2/0/0/0 | g1.ipcamlive.com | 0 | — | iframe provider w/o snapshot pattern (g1.ipcamlive.com) ×2 |
| brian-head | 28 | 2 | 2 | 0/0/2/0 | img.hdrelay.com b14.hdrelay.com | 2 | 200 image/jpeg 15301B img.hdrelay.com |  |
| brighton | 29 | 4 | 4 | 0/4/0/0 | youtube | 4 | 200 image/jpeg 2139B i.ytimg.com |  |
| solitude | 30 | 1 | 1 | 0/0/0/1 | solitudemountain.com | 0 | — | link-out (no still) ×1 |
| powderhorn | 31 | 3 | 3 | 0/0/3/0 | img.hdrelay.com | 3 | 200 image/jpeg 76130B img.hdrelay.com |  |
| telluride | 32 | 4 | 4 | 4/0/0/0 | g1.ipcamlive.com tellurideskiresort.roundshot.com | 1 | 200 image/jpeg 19307B tellurideskiresort.roundshot.com |  |
| angel-fire | 33 | 3 | 3 | 3/0/0/0 | live1.brownrice.com live3.brownrice.com | 0 | — | iframe provider w/o snapshot pattern (live1.brownrice.com) ×2; iframe provider w/o snapshot pattern (live3.brownrice.com) ×1 |
| arapahoe-basin | 34 | 3 | 3 | 0/0/3/0 | img.hdrelay.com ftp.purchus.io | 3 | 200 image/jpeg 112556B img.hdrelay.com |  |
| crystal-mountain | 35 | 3 | 3 | 1/0/2/0 | webcams.opensnow.com crystalmountainresort.roundshot.com | 3 | 200 image/jpeg 45559B webcams.opensnow.com |  |
| keystone | 36 | 4 | 4 | 3/0/1/0 | cache.snow.com player.brownrice.com | 4 | 200 image/jpeg 456920B cache.snow.com |  |
| monarch-mountain | 37 | 1 | 1 | 0/0/0/1 | skimonarch.com | 0 | — | link-out (no still) ×1 |
| mt-hood-meadows | 38 | 3 | 3 | 3/0/0/0 | api.wetmet.net | 0 | — | iframe provider w/o snapshot pattern (api.wetmet.net) ×3 |
| ski-apache | 39 | 1 | 1 | 1/0/0/0 | player.brownrice.com | 1 | 200 image/jpeg 96789B player.brownrice.com |  |
| ski-bowl | 40 | 1 | 1 | 0/0/0/1 | skibowl.com | 0 | — | link-out (no still) ×1 |
| timberline | 41 | 4 | 4 | 0/0/4/0 | timberlinelodge.com | 4 | 200 image/jpeg 251017B timberlinelodge.com |  |
| 49-degrees-north | 42 | 2 | 2 | 0/0/2/0 | www.ski49n.com | 2 | 200 image/jpeg 97797B www.ski49n.com |  |
| arizona-snowbowl | 43 | 2 | 2 | 0/2/0/0 | youtube | 2 | 200 image/jpeg 11435B i.ytimg.com |  |
| attitash | 44 | 2 | 2 | 2/0/0/0 | player.brownrice.com | 2 | 200 image/jpeg 17253B player.brownrice.com |  |
| batea-mahuida | 45 | 0 | 0 | 0/0/0/0 |  | 0 | — | no cams |
| bear-mountain | 46 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 17913B i.ytimg.com |  |
| bear-valley | 47 | 1 | 1 | 1/0/0/0 | camstreamer.com | 0 | — | iframe provider w/o snapshot pattern (camstreamer.com) ×1 |
| beaver-creek | 48 | 4 | 3 | 3/0/0/0 | player.brownrice.com | 3 | 200 image/jpeg 28773B player.brownrice.com |  |
| belleayre | 49 | 2 | 2 | 0/0/2/0 | images-webcams.windy.com | 2 | 200 image/jpeg 366370B images-webcams.windy.com |  |
| big-white | 50 | 3 | 3 | 0/0/3/0 | www.bigwhite.com | 3 | 200 image/jpeg 1281885B www.bigwhite.com |  |
| bogus-basin | 51 | 2 | 2 | 0/0/1/1 | storage.googleapis.com photos.bogusbasin.org | 1 | 200 image/jpeg 637979B storage.googleapis.com |  |
| bolton-valley | 52 | 2 | 2 | 0/2/0/0 | youtube | 2 | 200 image/jpeg 11228B i.ytimg.com |  |
| boreal | 53 | 2 | 2 | 0/0/2/0 | b15.hdrelay.com | 2 | 200 image/jpeg 93299B b15.hdrelay.com |  |
| boyne-mountain | 54 | 3 | 2 | 0/2/0/0 | youtube | 2 | 200 image/jpeg 16792B i.ytimg.com |  |
| bretton-woods | 55 | 2 | 1 | 1/0/0/0 | g1.ipcamlive.com | 0 | — | inactive ×1; iframe provider w/o snapshot pattern (g1.ipcamlive.com) ×1 |
| bridger-bowl | 56 | 4 | 4 | 0/0/4/0 | webcam-images.s3-us-west-1.amazonaws.com | 4 | 200 image/jpeg 629975B webcam-images.s3-us-west-1.amazonaws.com |  |
| brundage | 57 | 3 | 3 | 2/0/1/0 | camstreamer.com brundage.com | 1 | 200 image/jpeg 170446B brundage.com |  |
| burke-mountain | 58 | 2 | 2 | 2/0/0/0 | rtsp.me | 0 | — | iframe provider w/o snapshot pattern (rtsp.me) ×2 |
| camelback | 59 | 1 | 1 | 0/0/0/1 | camelbackresort.com | 0 | — | link-out (no still) ×1 |
| cannon | 60 | 2 | 2 | 1/1/0/0 | g1.ipcamlive.com youtube | 1 | 200 image/jpeg 26545B i.ytimg.com |  |
| cerro-bayo | 61 | 6 | 5 | 0/0/5/0 | ipcamlive.com | 5 | 200 image/jpeg 37396B ipcamlive.com |  |
| cerro-castor | 62 | 1 | 1 | 0/1/0/0 | youtube | 1 | 200 image/jpeg 18196B i.ytimg.com |  |
| cerro-mirador | 63 | 0 | 0 | 0/0/0/0 |  | 0 | — | no cams |
| cerro-perito-moreno | 64 | 0 | 0 | 0/0/0/0 |  | 0 | — | no cams |
| china-peak | 65 | 3 | 3 | 3/0/0/0 | g1.ipcamlive.com | 0 | — | iframe provider w/o snapshot pattern (g1.ipcamlive.com) ×3 |
| copper-mountain | 66 | 3 | 3 | 0/0/3/0 | img.hdrelay.com | 3 | 200 image/jpeg 106589B img.hdrelay.com |  |
| cranmore | 67 | 2 | 1 | 0/1/0/0 | youtube | 1 | 200 image/jpeg 37130B i.ytimg.com |  |
| crested-butte | 68 | 3 | 3 | 3/0/0/0 | player.brownrice.com | 3 | 200 image/jpeg 42319B player.brownrice.com |  |
| deer-valley | 69 | 1 | 1 | 0/0/0/1 | www.deervalley.com | 0 | — | link-out (no still) ×1 |
| diamond-peak | 70 | 3 | 3 | 0/0/3/0 | img.hdrelay.com | 3 | 200 image/jpeg 381004B img.hdrelay.com |  |
| donner-ski-ranch | 71 | 1 | 1 | 0/0/0/1 | www.donnerskiranch.com | 0 | — | link-out (no still) ×1 |
| eldora | 72 | 3 | 2 | 0/0/2/0 | b14.hdrelay.com | 2 | 200 image/jpeg 114645B b14.hdrelay.com |  |
| gore | 73 | 3 | 3 | 0/0/3/0 | img.hdrelay.com | 3 | 200 image/jpeg 3146568B img.hdrelay.com |  |
| granby-ranch | 74 | 1 | 1 | 0/0/0/1 | camstreamer.com | 0 | — | link-out (no still) ×1 |
| granite-peak | 75 | 2 | 2 | 0/0/2/0 | img.hdrelay.com | 2 | 200 image/jpeg 109316B img.hdrelay.com |  |
| heavenly | 76 | 4 | 4 | 4/0/0/0 | player.brownrice.com g1.ipcamlive.com | 3 | 200 image/jpeg 33918B player.brownrice.com |  |
| homewood | 77 | 3 | 3 | 3/0/0/0 | explore.org player.livespotting.com live4.brownrice.com | 0 | — | iframe provider w/o snapshot pattern (explore.org) ×1; iframe provider w/o snapshot pattern (player.livespotting.com) ×1; iframe provider w/o snapshot pattern (live4.brownrice.com) ×1 |
| hoodoo | 78 | 3 | 3 | 0/0/3/0 | santiampsp.org | 3 | 200 image/jpeg 571800B santiampsp.org |  |
| hunter | 79 | 3 | 3 | 3/0/0/0 | player.brownrice.com | 3 | 200 image/jpeg 155687B player.brownrice.com |  |
| jay-peak | 80 | 3 | 3 | 0/0/3/0 | img.hdrelay.com storage.googleapis.com | 3 | 200 image/jpeg 91989B img.hdrelay.com |  |
| jiminy-peak | 81 | 1 | 1 | 0/0/0/1 | jiminypeak.com | 0 | — | link-out (no still) ×1 |
| june-mountain | 82 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 36206B i.ytimg.com |  |
| kirkwood | 83 | 3 | 3 | 2/0/1/0 | player.brownrice.com cache.snow.com | 3 | 200 image/jpeg 94034B player.brownrice.com |  |
| la-hoya | 84 | 1 | 1 | 0/0/1/0 | varitech.ar | 1 | 200 image/jpeg 241747B varitech.ar |  |
| lookout-pass | 85 | 1 | 1 | 0/0/0/1 | skilookout.com | 0 | — | link-out (no still) ×1 |
| loon | 86 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 23449B i.ytimg.com |  |
| loveland | 87 | 3 | 0 | 0/0/0/0 |  | 0 | — | inactive ×3 |
| lutsen | 88 | 1 | 1 | 1/0/0/0 | lutsen.roundshot.com | 1 | 200 image/jpeg 25160B lutsen.roundshot.com |  |
| mad-river-glen | 89 | 1 | 1 | 0/1/0/0 | youtube | 1 | 200 image/jpeg 8234B i.ytimg.com |  |
| marquette-mountain | 90 | 1 | 1 | 0/0/1/0 | it.nmu.edu | 1 | 200 image/jpeg 1537387B it.nmu.edu |  |
| mission-ridge | 91 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 10820B i.ytimg.com |  |
| mount-snow | 92 | 3 | 3 | 3/0/0/0 | player.brownrice.com | 3 | 200 image/jpeg 60445B player.brownrice.com |  |
| mountain-high | 93 | 8 | 8 | 0/8/0/0 | youtube | 8 | 200 image/jpeg 19993B i.ytimg.com |  |
| mt-ashland | 94 | 1 | 1 | 0/0/0/1 | mtashland.com | 0 | — | link-out (no still) ×1 |
| mt-bachelor | 95 | 3 | 0 | 0/0/0/0 |  | 0 | — | inactive ×3 |
| mt-baker | 96 | 2 | 2 | 0/0/2/0 | imgproxy.windy.com | 2 | 200 image/jpeg 3587B imgproxy.windy.com |  |
| mt-baldy | 97 | 1 | 0 | 0/0/0/0 |  | 0 | — | inactive ×1 |
| mt-rose | 98 | 3 | 3 | 3/0/0/0 | live3.brownrice.com | 0 | — | iframe provider w/o snapshot pattern (live3.brownrice.com) ×3 |
| mt-shasta | 99 | 2 | 2 | 0/0/2/0 | b7.hdrelay.com img.hdrelay.com | 2 | 200 image/jpeg 96636B b7.hdrelay.com |  |
| northstar | 100 | 4 | 4 | 4/0/0/0 | player.brownrice.com | 4 | 200 image/jpeg 75116B player.brownrice.com |  |
| nubs-nob | 101 | 1 | 1 | 0/0/0/1 | nubsnob.com | 0 | — | link-out (no still) ×1 |
| okemo | 102 | 3 | 3 | 3/0/0/0 | player.brownrice.com | 3 | 200 image/jpeg 132394B player.brownrice.com |  |
| pico | 103 | 2 | 2 | 0/0/2/0 | img.hdrelay.com | 2 | 200 image/jpeg 25478B img.hdrelay.com |  |
| pillan | 104 | 3 | 3 | 0/2/1/0 | assets1.webcam.io youtube | 3 | 200 image/jpeg 31310B assets1.webcam.io |  |
| powder-mountain | 105 | 1 | 1 | 0/0/0/1 | www.powdermountain.com | 0 | — | link-out (no still) ×1 |
| purgatory | 106 | 3 | 2 | 2/0/0/0 | player.brownrice.com | 2 | 200 image/jpeg 75727B player.brownrice.com |  |
| red-lodge | 107 | 1 | 1 | 0/0/0/1 | redlodgemountain.com | 0 | — | link-out (no still) ×1 |
| red-river | 108 | 1 | 1 | 0/0/0/1 | redriverskiarea.com | 0 | — | link-out (no still) ×1 |
| schweitzer | 109 | 1 | 1 | 1/0/0/0 | schweitzer.roundshot.com | 1 | 200 image/jpeg 9055B schweitzer.roundshot.com |  |
| seven-springs | 110 | 1 | 1 | 0/0/0/1 | 7springs.com | 0 | — | link-out (no still) ×1 |
| sierra-at-tahoe | 111 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 8968B i.ytimg.com |  |
| ski-bluewood | 112 | 2 | 2 | 0/0/2/0 | cameraftpapi.drivehq.com | 2 | 200 image/jpeg 737150B cameraftpapi.drivehq.com |  |
| ski-cooper | 113 | 3 | 3 | 3/0/0/0 | skicooper.com:8443 | 0 | — | iframe provider w/o snapshot pattern (skicooper.com) ×3 |
| ski-santa-fe | 114 | 2 | 2 | 2/0/0/0 | player.brownrice.com | 0 | — | brownrice non-/embed/ path ×2 |
| smugglers-notch | 115 | 2 | 2 | 0/2/0/0 | youtube | 2 | 200 image/jpeg 15859B i.ytimg.com |  |
| snow-king | 116 | 1 | 1 | 0/1/0/0 | youtube | 1 | 200 image/jpeg 17667B i.ytimg.com |  |
| snow-summit | 117 | 1 | 1 | 0/0/0/1 | www.bigbearmountainresort.com | 0 | — | link-out (no still) ×1 |
| snow-valley | 118 | 2 | 2 | 0/2/0/0 | youtube | 2 | 200 image/jpeg 7540B i.ytimg.com |  |
| snowbasin | 119 | 2 | 1 | 0/0/1/0 | img.hdrelay.com | 1 | 200 image/jpeg 238245B img.hdrelay.com |  |
| snowshoe | 120 | 1 | 0 | 0/0/0/0 |  | 0 | — | inactive ×1 |
| spirit-mountain | 121 | 1 | 1 | 0/0/1/0 | tools.hbi.com | 1 | 200 image/jpeg 149004B tools.hbi.com |  |
| steamboat | 122 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 23630B i.ytimg.com |  |
| stevens-pass | 123 | 5 | 5 | 5/0/0/0 | player.brownrice.com | 5 | 200 image/jpeg 8320B player.brownrice.com |  |
| stratton | 124 | 4 | 4 | 0/4/0/0 | youtube | 4 | 200 image/jpeg 15891B i.ytimg.com |  |
| sugar-bowl | 125 | 1 | 1 | 0/0/0/1 | www.sugarbowl.com | 0 | — | link-out (no still) ×1 |
| sugarbush | 126 | 4 | 4 | 1/3/0/0 | youtube camstreamer.com | 3 | 200 image/jpeg 23874B i.ytimg.com |  |
| sugarloaf | 127 | 2 | 2 | 0/2/0/0 | youtube | 2 | 200 image/jpeg 7139B i.ytimg.com |  |
| sun-peaks | 128 | 3 | 3 | 0/0/3/0 | www.mountainwatch.com | 3 | 200 image/jpeg 470724B www.mountainwatch.com |  |
| sun-valley | 129 | 3 | 3 | 0/0/3/0 | b9.hdrelay.com | 3 | 200 image/jpeg 100289B b9.hdrelay.com |  |
| sundance | 130 | 2 | 1 | 0/0/1/0 | www.skiutah.com | 1 | 200 image/jpeg 136626B www.skiutah.com |  |
| sunday-river | 131 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 9906B i.ytimg.com |  |
| tahoe-donner | 132 | 1 | 1 | 0/0/0/1 | www.tahoedonner.com | 0 | — | link-out (no still) ×1 |
| tamarack | 133 | 1 | 1 | 0/1/0/0 | youtube | 1 | 200 image/jpeg 9981B i.ytimg.com |  |
| taos | 134 | 4 | 4 | 4/0/0/0 | live3.brownrice.com live2.brownrice.com tsvweather.brownrice.com | 0 | — | iframe provider w/o snapshot pattern (live3.brownrice.com) ×1; iframe provider w/o snapshot pattern (live2.brownrice.com) ×2; iframe provider w/o snapshot pattern (tsvweather.brownrice.com) ×1 |
| snoqualmie | 135 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 15221B i.ytimg.com |  |
| volcan-osorno | 136 | 2 | 2 | 0/2/0/0 | youtube | 2 | 200 image/jpeg 5862B i.ytimg.com |  |
| wachusett | 137 | 2 | 2 | 2/0/0/0 | api.wetmet.net | 0 | — | iframe provider w/o snapshot pattern (api.wetmet.net) ×2 |
| waterville-valley | 138 | 2 | 2 | 0/0/2/0 | b14.hdrelay.com | 2 | 200 image/jpeg 85520B b14.hdrelay.com |  |
| white-pass | 139 | 3 | 3 | 3/0/0/0 | player.brownrice.com | 3 | 200 image/jpeg 214334B player.brownrice.com |  |
| whiteface | 140 | 2 | 2 | 0/0/2/0 | img.hdrelay.com | 2 | 200 image/jpeg 1200275B img.hdrelay.com |  |
| whitefish | 141 | 1 | 1 | 1/0/0/0 | skiwhitefish.roundshot.com | 1 | 200 image/jpeg 6502B skiwhitefish.roundshot.com |  |
| wildcat | 142 | 2 | 2 | 2/0/0/0 | player.brownrice.com | 2 | 200 image/jpeg 81849B player.brownrice.com |  |
| willamette-pass | 143 | 1 | 1 | 0/1/0/0 | youtube | 1 | 200 image/jpeg 23492B i.ytimg.com |  |
| windham | 144 | 1 | 1 | 1/0/0/0 | player.brownrice.com | 0 | — | brownrice non-/embed/ path ×1 |
| winter-park | 145 | 3 | 3 | 0/3/0/0 | youtube | 3 | 200 image/jpeg 15951B i.ytimg.com |  |
| wintergreen | 146 | 2 | 2 | 0/0/2/0 | ftp.resortcams.com | 2 | 200 image/jpeg 181509B ftp.resortcams.com |  |
| wisp | 147 | 2 | 2 | 0/0/2/0 | ftp.resortcams.com | 2 | 200 image/jpeg 393640B ftp.resortcams.com |  |
| wolf-creek | 148 | 3 | 3 | 3/0/0/0 | live2.brownrice.com | 0 | — | iframe provider w/o snapshot pattern (live2.brownrice.com) ×3 |
