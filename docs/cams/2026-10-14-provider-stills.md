# PeakCam cam-provider still-image audit

Audit run 2026-10-14, about 13:35–13:55 UTC. Every probe used the User-Agent `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36` (`$UA` below).

## Inputs

| Source | Rows |
|---|---|
| Live Supabase `cams` table (`/rest/v1/cams?select=*,resorts(slug)`) | 374 (iframe 137, youtube 100, image 116, link 21) |
| `data/cams.csv` (local) | 357 |
| `origin/feat/seo-audit-fixes:data/cams.csv` | 370 |

All three sources have the same set of non-covered iframe and link URLs. The tables and counts below use the live table. Rows already covered were excluded: `player.brownrice.com`, the roundshot-mapped URLs, `youtube`, and `image`.

Scratch artifacts:
- `cams_live.json`, `by_host.json`
- `img/` holds every downloaded or captured still
- `rtspme.py` is the rtsp.me resolver

ffmpeg is installed: `/opt/homebrew/bin/ffmpeg` (ffmpeg 9.0.2).

## Summary table

| Hostname | Cams (live) | Still URL pattern | Verified | Stability | Hotlink / Referer | Recommendation |
|---|---|---|---|---|---|---|
| g1/g3/www.ipcamlive.com | 23 (12+7+4) | `https://{host}/player/snapshot.php?alias={alias}` (302 to `https://sNN.ipcamlive.com/streams/{streamid}/snapshot.jpg`) | 18/23 return 200 image/jpeg, 19 KB–312 KB, up to 2688x1520. 5 return 404 because the stream is offline (`streamavailable=0`) | **Stable URL** (alias based; the redirect target changes, the URL you store does not) | No referer needed. `Access-Control-Allow-Origin: *`. `no-store` on both hops | **Add pattern to cam-preview.ts** |
| live1/live2/live3/live4.brownrice.com | 13 | `https://player.brownrice.com/snapshot/{stream}` (the og:image on the liveN embed page) | 12/13 return 200 image/jpeg, 9 KB–266 KB. `homewood5` returns 200 text/html "Invalid webcam name." (dead cam) | **Stable URL** | Works with or without a Referer. ACAO `*` | **Add pattern**: widen the existing brownrice rule to `/^(player\|live\d+)\.brownrice\.com$/` and strip `&...` from the stream segment |
| tsvweather.brownrice.com | 1 | `https://tsvweather.brownrice.com/img/poco.jpg` (the page's `<img>`) | 200 image/jpeg, 51157 B, 640x512, Last-Modified current | **Stable URL** | No referer needed | **Add per-URL mapping** (static JSON entry), or convert the row to `embed_type=image` |
| relay.ozolio.com | 2 | `https://relay.ozolio.com/pub.api?cmd=poster&oid={oid}` (from ozx_player.js) | 2/2 return 200 image/jpeg (210752 B and 128892 B, 1920x1080, EXIF timestamp from today) | **Stable URL**, `max-age=900` (about 15 minutes fresh) | Works with or without a Referer. ACAO `*` | **Add pattern to cam-preview.ts** |
| camstreamer.com (`/embed/{key}`) | 5 iframe (+1 link) | 302 to `https://www.youtube.com/embed/{ytid}`, then `https://i.ytimg.com/vi/{ytid}/hqdefault.jpg` | 4/5 resolve to YouTube with live thumbnails (200, 1280x720 maxres available). 1 (Big Sky `4caf8cbab6999c9/S-16675`) returns 200 HTML "Stream isn't live now." | **Needs harvesting**: the ytid is whatever broadcast is current and changes when the stream restarts | i.ytimg.com has no restrictions | **Harvest into JSON map** (`camstreamer.json`: embed URL to ytid or thumbnail), re-run on a schedule |
| api.wetmet.net | 5 | None exposed. Only HLS: `https://{wms-host}.wetmet.net/live/{id}/playlist.m3u8?wmsAuthSign=…` (token `validminutes=30`) | ffmpeg frame capture worked: Mt Hood `1be5f08…` gave 1280x720 JPEG, 108925 B, 0.66 s. 4/5 manifests return 200. Wachusett `ae0a41d…` returns 404 (offline) | Token expires after 30 minutes and must be refetched from frame.php on every run | No Referer or Origin needed. A tokenless or bogus token returns 403 | **Server-side frame capture** |
| rtsp.me | 2 | Signed `poster` from `{url}/token/{token}`: `https://ny.rtsp.me/{sig}/{expiry}/poster/{id}.jpg` | 200 image/jpeg, 251178 B, 3840x2160. ffmpeg on `hls` also works (550170 B, 1.1 s) | **Needs harvesting**: the poster signature expires about 600 s after issue. A tampered expiry returns 403, and the unsigned path redirect-loops | The token API **requires an rtsp.me Referer** (403 `forbidden_origin` without one or with a peakcam Referer). The signed poster itself has no Referer check (ACAO `*`, `max-age=30`) | **Server-side proxy/cache** (resolve token, then poster, then store). It cannot go in a static JSON map |
| skicooper.com:8443 (self-hosted MediaMTX) | 3 | None. HLS at `https://skicooper.com:8443/{path}/index.m3u8` (302 to `?cookieCheck=1`) | `ridge`: ffmpeg gave 2688x1512 JPEG, 486530 B, 1.6 s. `stake` and `top_mtn` return 404 (not publishing). `snapshot.jpg`/`thumbnail.jpg` do not exist | URL is stable, frames need capturing | No referer needed | **Server-side frame capture** |
| tv.streamcasthd.com | 1 | None. HLS `https://tv.streamcasthd.com:3895/live/laslenaslive.m3u8` | ffmpeg gave 1920x1080 JPEG, 178917 B, 0.5 s. `.jpg` guesses return 404 | Stable manifest URL | ACAO `*`, no token | **Server-side frame capture** |
| player.livespotting.com | 1 | og:image / oEmbed `thumbnail_url`: `https://video.skyfiberinternet.com/memfs/alta1aac.jpg` (datarhei-core snapshot) | Currently **404** `{"code":404,"message":"File not found"}`. The HLS variant playlist is empty, so the source is offline right now | Stable URL (when live) | No referer check observed | **Harvest og:image into JSON map** (or a pattern from oEmbed). Needs `onError` fallback |
| vauth.command.verkada.com | 2 (both `auto_disabled`) | None. 302 to `command.verkada.com/embed.html#{json}` with `urlSD`/`urlHD` m3u8 (token in path) | Purgatory: ffmpeg gave 800x600 JPEG, 75078 B (real lift photo). Sundance: 408 (offline) | Token per redirect, so it has to be re-resolved on each run | Embed is domain-locked (`domains: www.purgatory.ski`), which is likely why the iframe failed health checks. The m3u8 itself was fetchable without Referer | **Server-side frame capture** (resolve redirect, then ffmpeg). The iframe will not play on peakcam.io |
| player.timecam.tv / timecam.tv | 2 (both `auto_disabled`) | n/a | `player.timecam.tv:443` connection timeout (173.244.209.244). `timecam.tv` 302s to it | n/a | n/a | **Dead**: replace or remove |
| share.earthcam.net | 1 (`auto_disabled`) | n/a | 404 HTML | n/a | n/a | **Dead**: replace or remove |
| explore.org | 1 | n/a for this cam | The `/live-cams/player/lake-tahoe-homewood-mountain-resort-cam` link redirects to `/livecams/zen-den/…`. That feed is absent from all 90 cam groups in `omega.explore.org/api/get_cam_group_info.json?id=N` | n/a | n/a | **Dead**: replace. (Live explore.org feeds expose `thumbnail_large_url`, `stillframe_imageset`, and a YouTube `video_id` via that API if one is ever re-added) |

### Coverage if implemented

| Approach | Working cams |
|---|---|
| Pure URL patterns (ipcamlive + liveN brownrice + ozolio + tsvweather map) | 18 + 12 + 2 + 1 = **33** |
| Harvested map (camstreamer) | **4** |
| Server-side capture/proxy (wetmet 4, rtsp.me 2, skicooper 1, streamcast 1, verkada-Purgatory 1) | **9** |
| Dead or offline at test time | ipcamlive 5, homewood5, Big Sky camstreamer, livespotting, wetmet Wachusett 1, skicooper 2, Sundance, timecam 2, earthcam, explore.org |

---

## Evidence per provider

### ipcamlive.com (g1, g3, www)

```
$ curl -sL -A "$UA" 'https://g1.ipcamlive.com/player/player.php?alias=jointpoint&autoplay=1'
  var address = 'http://s94.ipcamlive.com/'
  var streamid = '5e7pz8mn0213newab'
  var domainlockenabled  = 0

$ curl -sI 'https://g1.ipcamlive.com/player/snapshot.php?alias=jointpoint'
HTTP/2 302
location: https://s94.ipcamlive.com/streams/5e7pz8mn0213newab/snapshot.jpg
access-control-allow-origin: *
cache-control: no-store, no-cache, must-revalidate

$ curl -sI https://s94.ipcamlive.com/streams/5e7pz8mn0213newab/snapshot.jpg
HTTP/1.1 200 OK  Content-Length: 47518  Last-Modified: Wed, 14 Oct 2026 13:37:44 GMT
Cache-Control: no-cache, no-store, must-revalidate  Access-Control-Allow-Origin: *
(file: JPEG 1920x1080)

$ curl -sL -e 'https://peakcam.io/' '.../snapshot.php?alias=jointpoint'  ->  200 image/jpeg 47518
```

Results for all aliases (`https://{host}/player/snapshot.php?alias=X`, following the redirect):

```
g1 5c6d8ba5a8388 200 image/jpeg 279056   g1 6333584f5ea45 200 18990    g1 63335f1b76211 200 45314
g1 63c1cffd31643 404                     g1 663aa2e1bf523 404          g1 6894a26492e8d 200 59000
g1 8h08e8bpagfd912 200 43066             g1 bonvivant 200 76305        g1 jointpoint 200 47518
g1 plazacam 200 166593                   g1 sopris 200 50394           g1 sunlightsnowstake 200 311648
g3 6a2c31a02eaf9 404                     g3 escuela 200 73749          g3 laguna 200 79993
g3 pistanovicios 404                     g3 plateau 200 75681          g3 plazatata 200 83196
g3 tiobobs 404                           www hotel 200 180144          www recornisa 200 113938
www vista1600 200 194833                 www zcbski 200 278427 (2688x1520)
```

All 404s were confirmed offline with `getcamerastreamstate.php?alias=X`, which returns `"streamavailable":"0"` for 63c1cffd31643 (Bretton Woods), 663aa2e1bf523 (Heavenly), 6a2c31a02eaf9 (Cerro Catedral), pistanovicios (Nevados), and tiobobs (Portillo).

Integration sketch:

```ts
if (/^(g\d+|www)\.ipcamlive\.com$/.test(url.hostname) && url.pathname === "/player/player.php") {
  const alias = url.searchParams.get("alias");
  if (alias) return { cam, src: `https://${url.hostname}/player/snapshot.php?alias=${encodeURIComponent(alias)}`, label: "Camera still" };
}
```

Two caveats:
- The `<img>` needs an `onError` fallback, because an offline stream returns 404.
- Because of `no-store`, Next/Image optimization would re-fetch on every request. Use a plain `<img>`, or a proxy with a short TTL.

### liveN.brownrice.com

```
$ curl -sL -A "$UA" https://live2.brownrice.com/embed/wolfcreeksummit | grep og:image
<meta property="og:image" content="https://player.brownrice.com/snapshot/wolfcreeksummit" />

$ for s in ...; curl -sL https://player.brownrice.com/snapshot/$s
afbasearea 200 image/jpeg 63483        swsummit 200 97305            wolfcreektreasure 200 48775
wolfcreeksummit 200 8889 (real, fogged-in) wolfcreektresurlift 200 47582 tsv 200 145896
tsvridge 200 71620                     tsvbav 200 134187             mtrose1 200 160844
mtroseslidebowl 200 20564              mtrosecam 200 265824          afchileunload 200 122608
homewood5 200 text/html 362  -> body "Invalid webcam name."   (live4 embed og:image is empty: ".../snapshot/")

$ curl -sI https://player.brownrice.com/snapshot/tsvridge  -> 200, Access-Control-Allow-Origin: *
$ curl -s -e https://peakcam.io/ .../snapshot/tsvridge     -> 200 image/jpeg 71620
```

The DB row `https://live2.brownrice.com/embed/wolfcreektreasure&em=1` has `&em=1` inside the path. The current regex `^/embed/([a-zA-Z0-9_-]+)\/?$` rejects it. Strip everything from `&` onward before matching. The Homewood `homewood5` cam is dead and should be disabled.

### tsvweather.brownrice.com/poco-webcam.php

```
page contains: <img class="pure-img-responsive" alt="Poco Webcam" src="/img/poco.jpg">
$ curl -s -D - https://tsvweather.brownrice.com/img/poco.jpg
HTTP/1.1 200 OK  Last-Modified: Wed, 14 Oct 2026 13:32:01 GMT  Content-Length: 51157  Content-Type: image/jpeg
(JPEG 640x512, EXIF Campbell Scientific CC5MPX)
```

### relay.ozolio.com

The embed page only loads `ozx_player.js`. In that script (801 KB):

```
if(!this.params.auto_play){a.objects.output=({poster:{source:a.make_url("/pub.api?cmd=poster&oid="+this.params.object) ...
```

```
$ curl -s -D - 'https://relay.ozolio.com/pub.api?cmd=poster&oid=EMB_ZIGI00000147'
200 image/jpeg 210752   access-control-allow-origin: *   cache-control: max-age=900, must-revalidate
(JPEG 1920x1080, EXIF DateTime 2026:10:14 06:34:45 = today, live frame)
$ ... oid=EMB_EIFC0000015B  -> 200 image/jpeg 128892
$ curl -s -e https://peakcam.io/ '...cmd=poster&oid=EMB_ZIGI00000147' -> 200 image/jpeg 210752
```

Pattern: hostname `relay.ozolio.com`, `searchParams.get("cmd")==="embed"`, `oid`. The poster URL is `https://relay.ozolio.com/pub.api?cmd=poster&oid={oid}`.

### camstreamer.com

```
$ curl -sI https://camstreamer.com/embed/{key}
lp5EwsubCtc7WSvvfEoZ3OBCcnLw3YpUQxhBpdtB -> 302 https://www.youtube.com/embed/tb1p-VdL774?autoplay=1&mute=1   (Brundage)
zsX6U58XfcHSS3TOLj7fCHwA7vVguMBu7HiJOJeO -> 302 .../embed/KQuMkATRbKM   (Brundage)
RFmy0SK1VyqlMtIBCgVJyJCWSju2Jd6wruSW8T7X -> 302 .../embed/IjopOQByGiY   (Bear Valley)
DhlhgO70iUnmfRQuuejOIZO59FrW09AIcUg1iNYb -> 302 .../embed/E_dnBJd6OZQ   (Sugarbush)
4caf8cbab6999c9/S-16675                  -> 200 HTML "Stream isn't live now."  (Big Sky)
link row camstreamer.com/live/stream/1865 -> og:image https://i.ytimg.com/vi/yxNKeXh22nE/hqdefault_live.jpg -> 404 (ended broadcast)
```

All four resolved ids return 200 thumbnails (hqdefault 480x360 and maxresdefault 1280x720). The embed key is stable, but the YouTube id behind it changes per broadcast. Harvest with a script: `fetch(embed,{redirect:"manual"})`, then read `Location`, then extract the ytid. Store the result in `scripts/data/camera-previews/camstreamer.json` and re-run it in the same job as `discover-camera-previews.mjs`.

### api.wetmet.net

The frame.php page has a video.js player with `poster="../PoweredbyWM_16x9.jpg"` (a vendor logo, not a still), plus:

```
var vurl = 'https://wms-prod-5.wetmet.net/live/262-02-01/playlist.m3u8?wmsAuthSign=<token>';
token base64-decodes to: server_time=10/14/2026 1:38:32 PM&hash_value=…&validminutes=30
```

Guessed still endpoints all return 404: `widgets/stream/{thumb,snapshot,image,still}.php`, `widgets/{still,snapshot}/frame.php`, `{wms}/live/{id}/thumbnail.jpg`. A web search found no public still API.

```
uid                       manifest                                               noRef  Referer=frame.php
ae0a41d92d6d4c74d5c696e2d18ae88f wms-prod-5 /live/262-02-01/playlist.m3u8       404    404   (Wachusett, offline)
c5d9979a7622e03eb89b208a83d65810 wms-prod-5 /live/262-01-02/playlist.m3u8       200    200
1be5f08dfca10d15d5e4ec9627c17c7c wmso-us-ea1 /live/260-01-02/playlist.m3u8      200    200
c878c340832e23aab90526673b71cc17 wmso-us-ea1 /live/260-01-04/playlist.m3u8      200    200
eec27f8164fc1105656ea4d46df4cd37 wmso-us-ea1 /live/260-01-01/playlist.m3u8      200    200
tokenless or ?wmsAuthSign=abc -> 403

$ ffmpeg -loglevel error -y -user_agent "$UA" -i "<fresh vurl for 1be5f08…>" -frames:v 1 -q:v 3 img/wetmet_mthood.jpg
real 0.66s -> JPEG 1280x720, 108925 B (verified visually: real night IR frame of Mt Hood Meadows base)
```

Capture job outline:
1. GET frame.php (no Referer needed).
2. Regex out `var vurl = '…'`.
3. Run `ffmpeg -frames:v 1`.
4. Upload the JPEG to Supabase Storage or Vercel Blob at a stable key, for example `cam-stills/{cam_id}.jpg`.

### rtsp.me

The embed HTML is a Vite bundle (`/assets/embed-*.js`). Its flow:

```
GET https://rtsp.me/api/embed/{id}/token   -> {"status":"ok","token":"…","url":"https://ny.rtsp.me","cam":{…},"expiresAt":…}  (TTL 3600 s)
GET {url}/token/{token}                     -> {"hls":…,"hlsHd":…,"poster":"https://ny.rtsp.me/{sig}/{exp}/poster/{id}.jpg","status":…}
```

Referer behaviour on the token API:

```
no Referer                          -> 403 {"error":"forbidden_origin"}
Referer https://peakcam.io/         -> 403 {"error":"forbidden_origin"}
Referer https://rtsp.me/embed/{id}/ -> 200
```

Poster checks:

```
poster (no Referer)           -> 200 image/jpeg 251178, 3840x2160, cache-control: public, max-age=30, ACAO *
poster with tampered {exp}    -> 403
unsigned /poster/{id}.jpg     -> 302 loop
poster exp = issue time + 600 s (1791986098 vs now 1791985506)
hls via ffmpeg -frames:v 1    -> 3840x2160 JPEG 550170 B in 1.1 s (hls URLs carry ?ip=<requester IP>, so they must be resolved and consumed by the same server)
```

Both Burke cams (Ne77N52Z, RQyhZSN2) resolved. Because posters are signed for about 10 minutes, the result cannot be stored as a static map. Use a server route or cron that resolves and caches the bytes. Using the rtsp.me Referer is required to get the token, which is spoofing their own embed origin; treat it as a ToS gray area.

### skicooper.com:8443 (MediaMTX)

```
page: hls.loadSource("index.m3u8" + window.location.search)
$ curl -s https://skicooper.com:8443/ridge/index.m3u8   -> 302 ?cookieCheck=1 -> 200 (EXT-X-STREAM-INF 2688x1512)
stake/index.m3u8, top_mtn/index.m3u8 -> 302 -> 404 (stream not publishing). Pages themselves 200.
ridge/{snapshot,thumbnail,preview}.jpg -> 302 (no image endpoint)
$ ffmpeg -user_agent "$UA" -i https://skicooper.com:8443/ridge/index.m3u8 -frames:v 1 -q:v 3 img/skicooper_ridge.jpg
real 1.60s -> JPEG 2688x1512, 486530 B
```

ffmpeg follows the cookieCheck redirect on its own.

### tv.streamcasthd.com

```
page: const masterUrl = "https://tv.streamcasthd.com:3895/live/laslenaslive.m3u8";
$ curl -s <masterUrl>  -> #EXTM3U … laslenaslive-138494.ts ; Access-Control-Allow-Origin: *
.../live/laslenaslive.jpg -> 404
$ ffmpeg -i <masterUrl> -frames:v 1 -> JPEG 1920x1080, 178917 B, 0.52s
```

### player.livespotting.com

```
<meta property="og:image" content="https://video.skyfiberinternet.com/memfs/alta1aac.jpg">
oEmbed https://player.livespotting.com/embed?format=json&alias=7njvla68&ch=alta1aac -> "thumbnail_url":"https://video.skyfiberinternet.com/memfs/alta1aac.jpg"
$ curl -s https://video.skyfiberinternet.com/memfs/alta1aac.jpg -> 404 {"code":404,"message":"File not found","details":["/alta1aac.jpg"]}
/memfs/alta1aac.m3u8 -> 200, variant ?session=… -> empty playlist (no segments)  => source offline now
/api -> {"app":"datarhei-core","version":{"number":"16.0.0"}}
```

The pattern is provider-declared (og:image), but the cam was offline at test time. Harvest it like roundshot, using og:image or the oEmbed `thumbnail_url`.

### vauth.command.verkada.com (both rows auto_disabled)

```
$ curl -sI <embed>  -> 302 https://command.verkada.com/embed.html#{"entityId":…,"domains":"www.purgatory.ski","token":"v2_…","urlSD":"https://vstream.command.verkada.com/filter/transcode/v2_…/{entity}/low_res/livevideo.m3u8", …}
Purgatory urlSD: no Referer 200, Referer purgatory 200 ; ffmpeg -frames:v 1 -> 800x600 JPEG 75078 B (lift + base area, verified visually)
Sundance (domains "*.sundanceresort.com,…"): 408 with and without Referer -> offline
```

The iframe is domain-locked to the resort's site, which explains `auto_disabled`. The only way to show this cam on PeakCam is server-side capture (re-resolve the 302 on each run, because the token sits in the path).

### Dead providers

```
$ curl -sv https://player.timecam.tv/express/index.html?C=1B67AJEJ8032  -> Connection timed out after 15002 ms (173.244.209.244:443)
$ curl -sI http://timecam.tv/view_cam_embed.aspx?C=FDBEBCIPC5B3        -> 302 https://player.timecam.tv/... (same dead host)
$ curl -sL https://share.earthcam.net/…/bretton_woods/camera/live       -> 404 text/html
explore.org/live-cams/player/lake-tahoe-homewood-mountain-resort-cam   -> redirects to /livecams/zen-den/…; feed not present in
   omega.explore.org/api/get_cam_group_info.json?id=50 (Zen Den: 32 feeds, no homewood) nor any of the 90 groups listed in the page
```

---

## YouTube thumbnail variants

There are 90 distinct active YouTube ids. Variants were tested on 8 ids (4 resolved from camstreamer plus 4 from the table):

```
id            hqdefault  sddefault  maxresdefault  hq720      hqdefault_live  maxresdefault_live
tb1p-VdL774   200 480x360 200 640x480 200 1280x720 200 1280x720 200 480x360    200 1280x720
KQuMkATRbKM   200         200         200 (184961B) 200 (=maxres) 200 (=hqdefault bytes) 200
IjopOQByGiY / E_dnBJd6OZQ / MwHWDokyUhw / gelXqzE1Xi0 / ELdPHcv-2vI: same shape, all 200
yxNKeXh22nE   404 120x90 1097B for every variant (ended broadcast; grey placeholder)
```

- **`hqdefault_live.jpg` returned byte-identical content to `hqdefault.jpg`** for every live id tested. **`hq720.jpg` is byte-identical to `maxresdefault.jpg`.**
- Both `hqdefault` and `hqdefault_live` send `cache-control: public, max-age=300`. YouTube refreshes the live thumbnail, so `hqdefault` already shows a near-current frame.
- The grey placeholder comes back with **HTTP 404** (1097 B, 120x90). A browser `<img onError>` fires on it, and a server-side check can key on status.

Full scan of all 90 active ids:

| Variant | 200 | 404 |
|---|---|---|
| `hqdefault.jpg` | 89 | 1 (`l1gateQVYr4`, Dodge Ridge Summit) |
| `maxresdefault.jpg` | 86 | 4 (`1Z98cHpO0Pg` Cranmore MWOBS, `MSl7Gy9tZiA` Cannon MWOBS, `RVuTqjTyrr0` Cerro Castor, and `l1gateQVYr4`) |

Recommendation:
- Use `maxresdefault.jpg` (1280x720) with `hqdefault.jpg` as the fallback, via `srcset` or `onError`.
- `hqdefault` is 4:3 with letterboxing. `maxres` and `hq720` are true 16:9 and look better in cards.
- `_live` variants add nothing.
- Flag `l1gateQVYr4` as dead.

---

## Link-type rows (21, out of scope but cheap wins)

Many `embed_type=link` resort pages embed providers that this audit now covers:

| Resort page | Embedded provider | Embeds |
|---|---|---|
| camelbackresort.com | api.wetmet.net | 5 (uids 3215d5a1…, 53cf5492…, 7db2868a…, 87ad025e…, c0ca7829…) |
| redriverskiarea.com | live2.brownrice.com | 5 (rrsabroadway, rrsacoppermidchair, rrsagold, rrsaplatinum, rrsasummitcam). Snapshot pattern applies directly |
| skimonarch.com | player.brownrice.com | 3 (skimonarchgarfield, skimonarchpanoflats, skimonarchsundeck) |
| mtashland.com | player.brownrice.com | 1 (mtashlandlodge) |
| skilookout.com | g1.ipcamlive.com | 3 (6345e3cb46ea4, 6345e54d48886, 63485bb43c85b) |
| bigbearmountainresort.com | camstreamer | 4 |
| deervalley.com | camstreamer | 8 |
| tahoedonner.com | static JPEGs + camstreamer + YouTube | 4 JPEGs (`http://webcams.tahoedonner.com/{skicam,Golf,ACAC180Square,DSLTop180Square}.jpg`; http only), 3 camstreamer, 1 YouTube |
| solitudemountain.com | YouTube | 8 |
| powdermountain.com | prismcam | uses `/current.jpg` (not probed) |

Their og:images, where present, are marketing hero shots, not camera stills.

Converting these rows into proper iframe or image rows would add roughly 40 cams that get previews through the patterns above.

---

## Recommended cam-preview.ts additions (pure, no network)

```ts
// ipcamlive: provider redirect to the live stream's snapshot.jpg (404 when offline)
if (/^(g\d+|www)\.ipcamlive\.com$/.test(host) && url.pathname === "/player/player.php" && alias)
  -> `https://${host}/player/snapshot.php?alias=${alias}`
// brownrice liveN hosts: same snapshot service as player.brownrice.com (og:image)
if (/^(player|live\d+)\.brownrice\.com$/.test(host)) stream = pathname.match(/^\/embed\/([\w-]+)/)  // tolerate "&em=1" suffix
  -> `https://player.brownrice.com/snapshot/${stream}`
// ozolio: player's own poster command
if (host === "relay.ozolio.com" && params.cmd === "embed" && params.oid)
  -> `https://relay.ozolio.com/pub.api?cmd=poster&oid=${oid}`
```

Also add a static map entry: `https://tsvweather.brownrice.com/poco-webcam.php` maps to `https://tsvweather.brownrice.com/img/poco.jpg`.

Other integrations:

- **Harvested JSON**, extending `discover-camera-previews.mjs`: camstreamer (redirect to ytid) and livespotting (og:image).
- **Server-side capture job** (cron, ffmpeg available locally; on Vercel use a separate worker or GitHub Action with ffmpeg) writing to storage at stable keys:
  - wetmet: 4 live, token from frame.php
  - skicooper: 1 live
  - streamcasthd: 1
  - verkada Purgatory: 1, re-resolve the 302
  - rtsp.me: 2, poster or HLS, needs the rtsp.me Referer for the token
- **Data cleanup**: disable these dead rows:
  - timecam x2
  - earthcam
  - explore.org Homewood
  - brownrice homewood5
  - YouTube `l1gateQVYr4`

  Watch the 5 offline ipcamlive aliases, wetmet Wachusett `ae0a41d…`, and skicooper stake/top_mtn.
