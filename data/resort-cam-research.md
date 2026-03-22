# PeakCam Resort Webcam & Snow Report Research
**Date:** 2026-03-22
**Coverage:** 128 resorts across 10 research agents

---

## Cam Technology Summary

| Provider | Count | Embed Type | Resorts |
|----------|-------|------------|---------|
| **BrownRice** | ~50 cams | iframe `player.brownrice.com/embed/{slug}` | All Vail/Epic (Vail, Breck, Keystone, Beaver Creek, Crested Butte, Stowe, Okemo, Mt Snow, Hunter, Seven Springs, Stevens Pass, Wildcat, Attitash, Whistler), Wolf Creek, Ski Santa Fe, Taos, Angel Fire, Ski Apache, White Pass, Northstar, Heavenly, Kirkwood, Park City, Windham |
| **YouTube Live** | ~80+ cams | iframe `youtube.com/embed/{videoId}` | Steamboat, Winter Park, Mammoth, Brighton, Dodge Ridge, June Mtn, Snow Valley, Mt Baldy, AZ Snowbowl, Snoqualmie, Mission Ridge, Mt Bachelor (3), Willamette Pass, Tamarack, Boyne Mtn (9), Loon (4), Sunday River (3), Sugarloaf (4), Stratton (4), Sugarbush (6), Smugglers (2), Bolton Valley (2), Mad River Glen, Cranmore, Ski Cooper (3), Breckenridge (2) |
| **HDRelay** | ~40 cams | image `img.hdrelay.com/frames/{id}/default/last.jpg` or `b{N}.hdrelay.com/camera/{id}/snapshot` | Copper Mtn, A-Basin, Killington, Jay Peak, Pico, Snowbird, Snowbasin, Brian Head, Powderhorn, Boreal, Eldora, Granite Peak, Sun Valley, Whiteface, Gore Mtn, Mt Shasta, Waterville Valley, Diamond Peak, Sugar Bowl |
| **Roundshot 360** | ~12 cams | iframe `{resort}.roundshot.com/{cam}/` | Aspen (6), Telluride, Jackson Hole (2), Schweitzer, Whitefish, Lutsen, Crystal Mtn, Killington, Palisades Tahoe (2) |
| **IPCamLive** | ~12 cams | iframe `g1.ipcamlive.com/player/player.php?alias={alias}` | Telluride (4), Aspen, Heavenly (3), China Peak (5), Sunlight Mtn, Cannon Mtn |
| **Static JPEG** (self-hosted) | ~50+ cams | direct image URL | Loveland, Bridger Bowl (13), Timberline (9), Sun Peaks (9), Big White (12), Hoodoo (8), 49 North (3), Alta (6 on S3), Brundage, Bogus Basin |
| **CamStreamer** | ~10 cams | iframe `camstreamer.com/embed/{id}` | Sugarbush, Big Sky, Brundage, Bear Valley, Granby Ranch, Loon (alt) |
| **WetMet** | ~8 cams | iframe `api.wetmet.net/widgets/stream/frame.php?uid={uid}` | Mt Hood Meadows (4), Wachusett (4) |
| **PrismCam** | ~8 cams | image `storage.googleapis.com/prism-cam-{id}/1080-watermark.jpg` | Alta (2 live), Deer Valley (3), Powder Mountain, Jay Peak, Bogus Basin |
| **Livespotting** | 4 cams | iframe `player.livespotting.com/lsplayer.html?alias={a}&ch={ch}` | Homewood (4) |
| **TimeCam** | ~5 cams | iframe `timecam.tv/view_cam_embed.aspx?C={id}` | Vail (2), Keystone, Beaver Creek, Kirkwood |
| **Verkada** | ~3 cams | iframe `vauth.command.verkada.com/embed/html/{id}` | Aspen, Sundance, Purgatory |
| **ResortCams FTP** | 7 cams | image `ftp.resortcams.com/{resort}/{name}.jpg` | Wintergreen (5), Wisp (2) |
| **Ozolio** | 5 cams | iframe `relay.ozolio.com/pub.api?cmd=embed&oid={id}` | Palisades Tahoe (5) |
| **Google Nest** | 3 cams | embed `video.nest.com/live/{id}` | Ski Bowl (3) |
| **Angelcam** | 2 cams | iframe click2stream player | Red River |
| **CityNet HLS** | ~4 cams | HLS stream `stream.citynet.net/Snowshoe/smil:{name}.smil/playlist.m3u8` | Snowshoe |
| **EarthCam** | 1 cam | iframe `share.earthcam.net/{id}` | Bretton Woods |
| **timelapseview.io** | 3-5 cams | iframe with config | Monarch Mountain |
| **Windy** | ~5 cams | image `images-webcams.windy.com/{id}/current/full/{id}.jpg` | Mt Baker, Belleayre, Boreal, Mt Rose (road) |
| **DriveHQ CameraFTP** | 2 cams | image API | Ski Bluewood |
| **SeeJH.ai** | 3 cams | YouTube via seejh.ai | Snow King |

---

## Snow Report Data Sources

| Source | Type | Resorts | Notes |
|--------|------|---------|-------|
| **Vail Resorts DDO API** | REST API | Vail, Breck, Keystone, Beaver Creek, Crested Butte, Park City, Stowe, Okemo, Mt Snow, Hunter, Seven Springs, Whistler, Stevens Pass, Wildcat, Attitash, Heavenly, Northstar, Kirkwood | `ddo.vailresorts.com/api/orchestrators/DDO-In-Orchestrator` |
| **Ski Utah API** | REST API | All 10 UT resorts | Free with membership — overnight, 24h, 48h, 7-day, base depth, NOAA forecast, updated every 10 min |
| **Alta window.Alta JS** | JSON in page | Alta only | Richest structured data — hourly obs, historical records, forecasts |
| **mtnfeed.com v4 API** | REST API | Deer Valley, Schweitzer | `https://v4.mtnfeed.com/{resort}` |
| **Mt Bachelor API** | REST API | Mt Bachelor | `api.mtbachelor.com/api/v1/cams/mtn/{id}` |
| **Brundage API** | REST API | Brundage | `brundage.com/api/get-snow-recap` |
| **AZ Snowbowl JSON** | JSON files | Arizona Snowbowl | `snowbowl.ski/wp-content/uploads/sites/9/m-json/weather.json` |
| **Sugar Bowl JS** | JS data | Sugar Bowl | `sugarbowl.com/js/conditions_vars.js.cfm` |
| **Official (scrape)** | HTML | All remaining | Dynamic page loading, no public API |
| **SNOTEL** | USDA API | All western resorts | Already integrated via snotel-sync.mjs |
| **OpenSnow** | Third-party | Many resorts | LocationId-based |

---

## Key Findings

### Cam Coverage Stats
- **Total cams discovered:** ~400+ across 128 resorts
- **YouTube-embeddable (easiest):** ~80+ cams at 30+ resorts
- **Static image (simple img tag):** ~50+ cams at 20+ resorts
- **iframe-embeddable (BrownRice, HDRelay, etc.):** ~100+ cams
- **Resorts with 0 or broken cams:** Donner Ski Ranch, Nub's Nob (unknown), Tahoe Donner (defunct)

### Embed Priority by Ease
1. **YouTube** — `<iframe src="youtube.com/embed/{id}">` — works everywhere, no auth
2. **Static JPEG** — `<img src="{url}">` with refresh — simplest, no iframe needed
3. **BrownRice** — `<iframe src="player.brownrice.com/embed/{slug}">` — reliable, widely used
4. **HDRelay snapshot** — `<img src="img.hdrelay.com/frames/{id}/default/last.jpg">` — direct image
5. **IPCamLive** — `<iframe src="g1.ipcamlive.com/player/...">` — reliable iframe
6. **Roundshot** — `<iframe src="{resort}.roundshot.com/">` — 360 panoramic, premium
7. **Others** — CamStreamer, WetMet, Ozolio, PrismCam — all iframe-embeddable

### Notable API Discoveries
- **Vail Resorts DDO API** covers ~18 resorts with structured snow data
- **Ski Utah API** covers all 10 UT resorts with real-time data
- **Alta's `window.Alta` object** has the richest structured data of any resort
- **mtnfeed.com v4** serves Deer Valley and Schweitzer lift/trail data
- **Arizona Snowbowl** exposes JSON endpoints for weather/alerts/sales

### Resorts Needing Attention
- **Donner Ski Ranch** — webcam subdomain returns 406, cams likely offline
- **Tahoe Donner** — HDOnTap stream discontinued
- **Nub's Nob** — cams load dynamically, need browser inspection
- **Red Lodge** — minimal cam offering, dynamic loading
- **Burke Mountain** — uses rtsp.me which has iframe compatibility issues
- **Jiminy Peak** — cam URLs not extractable from static HTML
