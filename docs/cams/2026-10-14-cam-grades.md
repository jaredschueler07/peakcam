# Cam-by-cam grading — 2026-10-14

Every cam in the live `cams` table (374) was probed (provider still, or an ffmpeg frame for click-to-play players) and the image was graded by a vision model. Grades: great / good / poor (fog, night-ish, stale, snow-stake close-up, low-res) / dark / blank / placeholder / no_image. `card_preview=false` was written for placeholder/blank/wrong; `preview_rank` follows the per-resort ranking below. October frames: many northern cams show bare ground, southern cams are end-of-season — re-grade in winter daylight.

| Grade | Cams |
|---|---|
| good | 123 |
| poor | 121 |
| no_image | 59 |
| great | 40 |
| dark | 16 |
| placeholder | 12 |
| blank | 3 |

## Per resort (best cam first)

### 49 Degrees North Mountain Resort (`49-degrees-north`) — best: Summit
_Both fine; summit is the scenic pick (no snow in Oct)._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | image | great | summit chairlift over layered forested ridges, timestamped, no snow | yes |
| 2 | Lodge | image | good | autumn base area with chairlift and shade sails, bare ground, overcast | yes |

### Alta Ski Area (`alta`) — best: Mt Baldy

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Mt Baldy | image | good | snowy slope with fir trees and lift towers under heavy cloud | yes |
| 2 | Albion Basin | image | dark | murky olive-grey frame, nothing discernible, only Alta logo | yes |
| 3 | High Rustler | image (inactive) | no_image | not an image (404 application/xml 301B) | yes |
| 4 | Snow Stake | image (inactive) | no_image | not an image (404 application/xml 301B) | yes |

### Angel Fire Resort (`angel-fire`) — best: Summit

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | iframe | good | summit view over valley and distant ranges, clouds, evergreen ridge in foreground | yes |
| 2 | Chile Unload | iframe | good | close view of empty chairlift chair at unload ramp, summer, signs and utility vehicle | yes |
| 3 | Base | iframe | poor | summer bike-park base: bare dirt and gravel, ski school sign, lift terminal at top | yes |

### Antillanca (`antillanca`) — best: none usable
_No usable image: all cams dead, offline, link-out or night/black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Vista Don Pedro (Haique lift view) | image (inactive) | no_image | not an image (404 application/json; charset=UTF-8 32B) | yes |
| 2 | Vista Flecha | image (inactive) | no_image | not an image (404 application/json; charset=UTF-8 32B) | yes |

### Arapahoe Basin (`arapahoe-basin`) — best: none usable
_Base cam is best; summit is foggy._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | image | good | base area with lift and light dusting of snow, pavement foreground | yes |
| 2 | Summit | image | poor | snowy upper basin with lift, heavy fog and lens droplets | yes |
| 3 | Snow Stake | image | poor | snow stake close-up covered in snow, trees | yes |

### Arizona Snowbowl (`arizona-snowbowl`) — best: Gondola

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Gondola | youtube | good | dusk gondola base with snowy slopes and lit gondola station | yes |
| 2 | Grand Canyon Express | youtube | good | dusk snowy slope with lit lift terminal and lodge, dim light | yes |

### Aspen Snowmass (`aspen-snowmass`) — best: Highlands
_No card-quality image: only thin/low-res panoramas and a snow stake. Sam's Knob is a 6px sliver (broken). Highlands panorama is the least bad._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Highlands | iframe | poor | thin snowy panorama of fir trees and ridge in fog | yes |
| 2 | Aspen Mountain | iframe | poor | tiny 482px panorama of lodge with light snow, low-res | yes |
| 3 | Snow Stake | iframe | poor | Snowmass snow stake close-up with watch graphic in snowfall | yes |
| 4 | Snowmass Sam's Knob | iframe | poor | 6px-wide sliver image, essentially unusable/corrupt | yes |

### Attitash Mountain Resort (`attitash`) — best: Base
_Best cam is usable but not a strong hero._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | iframe | good | lift base terminal and lodge area, autumn foliage, no snow | yes |
| 2 | Bear Peak | iframe | poor | bare grassy slope with sun glare, no snow, lift parts at right | yes |

### Bear Mountain (`bear-mountain`) — best: Midway
_Base is black at capture (night/dead); Midway best._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Midway | youtube | good | base lodge and chairlift terminal on hillside, backlit by low sun with lens flare | yes |
| 2 | Summit | youtube | good | green lift tower over dry scrubby slope with forest behind, low-res | yes |
| 3 | Base | youtube | dark | black frame, nothing visible | yes |

### Bear Valley Mountain Resort (`bear-valley`) — best: Summit
_No cam is a good hero thumbnail; best available is mediocre._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | iframe | good | dry autumn chairlift terminal, trees, distant horizon, no snow | yes |

### Beaver Creek Resort (`beaver-creek`) — best: none usable
_Snow Stake fetch failed (may be transient); check before retiring._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Spruce Saddle | iframe | good | mountain ridges and valley above treeline with cloud bands, lens droplets, autumn colors | yes |
| 2 | Village | iframe | good | Beaver Creek village plaza with lodges and aspens, no snow | yes |
| 3 | McCoy Park | iframe | good | McCoy Park Express lift terminal, evergreens, no snow, partly cloudy | yes |
| 4 | Snow Stake | iframe (inactive) | no_image | fetch failed | yes |

### Belleayre Mountain (`belleayre`) — best: Overlook

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Overlook | image | good | lift line over patchy snow trail with ridges and dramatic clouds | yes |
| 2 | Discovery | image | good | autumn foliage hillside with chairlift over green lawn, no snow, hazy | yes |

### Big Sky Resort (`big-sky`) — best: Moonlight
_Only thin 10-12:1 panoramas work; need special crop. Ramcharger YouTube is not live._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Moonlight | iframe | good | thin panorama of snowy peak, sun and valley fog, 12:1 aspect | yes |
| 2 | Town | iframe | good | thin overcast panorama of Big Sky town and buildings, 10:1 aspect | yes |
| 3 | Ramcharger | iframe | no_image | no youtube redirect (200)  Stream isn’t live now. body{ margin: 0; min-height: 100vh; display: grid; place-items: center; background-color:  | yes |

### Big White Ski Resort (`big-white`) — best: Snow Ghost

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Snow Ghost | image | good | Snow Ghost Express lift terminal, evergreen forest, distant ranges, no snow | yes |
| 2 | Village | image | good | village centre buildings and pedestrian plaza in sun, no snow | yes |
| 3 | Pow | image | poor | snow stake board with thermometer and moose plush, close-up | yes |

### Bogus Basin Mountain Recreation Area (`bogus-basin`) — best: Summit PrismCam
_Summit PrismCam is a great hero; Snow Marker is link-out only._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit PrismCam | image | great | blue summit lift terminal over huge panorama of mountains, clear sky, good light | yes |
| 2 | Snow Marker | link | no_image | link-out page, no feed | yes |

### Bolton Valley Resort (`bolton-valley`) — best: Base

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | youtube | good | base area with lift, autumn foliage, overcast and misty, no snow | yes |
| 2 | Vista Peak | youtube | poor | heavy fog and rain-streaked lens, lift towers barely visible | yes |

### Boreal Mountain Resort (`boreal`) — best: none usable
_Both weak: base cam has heavy lens flare, other is a stake close-up. Best available is Base Area._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base Area | image | poor | lift terminal on bare hill with heavy sun lens flare and haze | yes |
| 2 | Snow Stake | image | poor | snow stake close-up, pond and pines, glare | yes |

### Boyne Mountain Resort (`boyne-mountain`) — best: Clock Tower

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Clock Tower | youtube | good | village clock tower, pond and shuttle bus in autumn, no snow | yes |
| 2 | Snow Stake | youtube | poor | snow stake close-up against autumn foliage, portrait crop | yes |
| 3 | Hemlock | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |

### Breckenridge (`breckenridge`) — best: Peak 7
_Weak overall (fog, bare). Peak 8 stream is a uniform grey frame._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Peak 7 | iframe | good | chairlift terminal and bare hillside with light snow patches, cloudy | yes |
| 2 | Peak 8 from Peak 9 | iframe | good | forested mountainside with dusting of snow, overexposed hazy sky | yes |
| 3 | Peak 9 | iframe | poor | gravel foreground, bare slope, distant lodge, low interest | yes |
| 4 | Main Street | youtube | poor | wet town street with parked car and weather overlay, no slopes | yes |
| 5 | Peak 8 | youtube | blank | uniform grey frame with timestamp and weather overlay only | no |

### Bretton Woods Mountain Resort (`bretton-woods`) — best: none usable
_NO USABLE IMAGE._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | iframe | no_image | not an image (404 text/html; charset=UTF-8 0B) | yes |
| 2 | Rosebrook | iframe (inactive) | no_image | page 404, no og:image/m3u8 | yes |

### Brian Head Resort (`brian-head`) — best: none usable
_No usable (good/great) image for card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Giant Steps Base | image | poor | heavy snowfall/whiteout, almost nothing visible except railing | yes |
| 2 | Snow Stake | image | poor | snow stake close-up with Brian Head board among trees | yes |

### Bridger Bowl Ski Area (`bridger-bowl`) — best: Bridger Lift
_Ridge East is dark (night/stale Oct 10); recheck by day before retiring. Lift cam is the standout._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Bridger Lift | image | great | lift above sea of clouds, blue sky, distant ranges, sun | yes |
| 2 | Alpine Lift | image | great | chairlift tower and chairs over frosted slope, sunrise cloud sky | yes |
| 3 | Base | image | poor | snowy parking lot and trees under flat grey overcast sky | yes |
| 4 | Ridge East | image | dark | black night frame with timestamp from Oct 10, stale | yes |

### Brighton Resort (`brighton`) — best: none usable
_Only Cam 4 shows a real view and it is low-res, 4:3 letterboxed, so poor for a card. Cam 2 is a logo placeholder; Cams 1 and 3 are black at mid-morning local time (dead streams)._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Cam 4 | youtube | poor | snowy lift terminal and lodge in snowfall, low-res letterboxed 4:3 with black bars | yes |
| 2 | Cam 1 | youtube | dark | black frame, stream shows nothing | yes |
| 3 | Cam 2 | youtube | placeholder | Brighton "Live Parking Lot Camera" logo card over stock parking lot image, low-res | no |
| 4 | Cam 3 | youtube | dark | black frame, stream shows nothing | yes |

### Brundage Mountain Resort (`brundage`) — best: Centennial

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Centennial | iframe | good | distant rocky mountain top under hazy sky, timestamp overlay | yes |
| 2 | Base Snow | image | poor | snow box with stake close-up, no mountain view | yes |
| 3 | Top Bird | iframe | poor | summit conifers and sky, hazy lens, no slopes visible | yes |

### Burke Mountain (`burke-mountain`) — best: Cam 1
_Cam 1 is the better card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Cam 1 | iframe | good | Sherburne base lodge chairlift and snowmaking, autumn foliage, overcast | yes |
| 2 | Cam 2 | iframe | poor | heavy fog at Mid Burke Express summit, chairlift barely visible | yes |

### Camelback Mountain Resort (`camelback`) — best: none usable
_NO USABLE IMAGE._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Cannon Mountain (`cannon`) — best: none usable
_Summit frame carries a 2025-07-30 timestamp (stale); Tram is real but foggy. Neither is a good hero. No usable (good/great) image for card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | youtube | poor | summer summit slope with lift and hazy valley; overlay timestamp 2025-07-30 so frame is stale (~15 months old) | yes |
| 2 | Tram | iframe | poor | chairlift tower and chairs in dense fog, little visible | yes |

### Caviahue (`caviahue`) — best: Copahue Volcano - Agrio Superior Station (AGS)
_Volcano monitoring cams, not ski-area views; AGS is the best option. ESC is stale offline-icon frame._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Copahue Volcano - Agrio Superior Station (AGS) | image | good | snowy volcanic terrain under clouds, cable pole in frame, volcano monitoring cam | yes |
| 2 | Copahue Volcano - Aerodrome Node (AER) | image | poor | overcast sky over snowy volcano ridge, mostly cloud, volcano monitoring cam | yes |
| 3 | Copahue Volcano - Mellizas Station (MLZ) | image | poor | close-up of equipment box, solar panel and cables in snow | yes |
| 4 | Copahue Volcano - Laguna Escondida Station (ESC) | image | placeholder | stale Nov 2025 frame with camera-offline icon overlay on mountain | no |

### Cerro Bayo (`cerro-bayo`) — best: none usable
_All cams are foggy now; Copitos Pista 3 is the clearest. Cumbre returns 404._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Copitos Pista 3 (1500m) | image | good | "Pista 3" snowy slope with fence and trees, hazy | yes |
| 2 | Principiantes Pista 2 | image | poor | "Pista 2" snow slope in fog, small low-res | yes |
| 3 | Telecabina 1500 | image | poor | Telecabina top station with chairlift in dense fog | yes |
| 4 | Principiantes 1500 | image | poor | beginner run and gondola station in heavy fog | yes |
| 5 | Telesilla Lagos | image | poor | Lagos chairlift tower and chairs in fog, clock shows 1970 | yes |
| 6 | Cumbre (Summit 1800m) | image (inactive) | no_image | not an image (404 text/html; charset=UTF-8 0B) | yes |

### Cerro Castor (Ushuaia) (`cerro-castor`) — best: Cerro Castor Live Stream

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Cerro Castor Live Stream | youtube | good | snowy base slope with skiers and lodge during snowfall | yes |

### Cerro Catedral (Bariloche) (`cerro-catedral`) — best: Centro Superior (Desembarque)
_Centro Superior is stunning but its timestamp reads 03-09-2026 (likely frozen/stale; verify). Live Punta Princesa is 404 (static snapshot works). Plaza Catalina lens is smeared._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Centro Superior (Desembarque) | image | great | sunny snowy slopes, chairlift with skiers, lake and mountains; timestamp 03-09 looks stale | yes |
| 2 | Pista Eventos (vista desde la base) | image | good | blue lift terminal under snow-patchy mountain, spring conditions; camera clock reset to 2000 | yes |
| 3 | Playpark (Base) | image | good | playpark base with magic carpet, patchy melting snow, mountains | yes |
| 4 | Punta Princesa (static snapshot) | image | good | snowy slopes and lake valley under heavy cloud, low contrast | yes |
| 5 | Diente de Caballo Sur | image | poor | near-whiteout fog, only tiny hut visible | yes |
| 6 | Plaza Catalina Reynal (Base) | image | poor | blurry smeared frame, lens obscured, nothing identifiable | yes |
| 7 | Punta Princesa (live) | iframe | no_image | not an image (404 text/html; charset=UTF-8 0B) | yes |

### Chapelco (Cerro Chapelco Ski Resort) (`chapelco`) — best: Pradera del Puma

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Pradera del Puma | image | good | chairlift over snowy bowl with rocky ridge, overcast | yes |
| 2 | Rancho Grande (Desenganche Silla Rancho Grande, hacia la cordillera) | image | good | chairlift tower over snowfield under dark dramatic clouds | yes |
| 3 | Lift del Puente | image | good | snow-covered groomed run beneath chairlift line, overcast | yes |

### China Peak Mountain Resort (`china-peak`) — best: Summit

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | iframe | great | summit chairlift with lake and forested mountains behind, clear blue sky | yes |
| 2 | Buckhorn | iframe | good | wooden lodge with deck, bare ski slopes behind, early morning, no snow | yes |
| 3 | Mid Mountain | iframe | good | mid-mountain lift base and bare ski slope with small lodge on right, hazy | yes |

### Copper Mountain (`copper-mountain`) — best: Aerie
_Aerie is best; others are fog or snow stake._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Aerie | image | good | trailhead pavilion, evergreens, snowy peaks under moody clouds | yes |
| 2 | Snow Stake | image | poor | snow stake close-up in forest, no snow, little scenery | yes |
| 3 | Union Peak | image | poor | near whiteout grey fog and falling snow, ridge corner only | yes |

### Corralco (`corralco`) — best: none usable
_Four good to great cams; Vista 1600 shows the mountain best._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Vista 1600 | iframe | great | snowy slope with chairlift lines and lift hut, big mountain | yes |
| 2 | Retorno Cornisa | iframe | great | chairlift with skiers, blue terminal, snowy valley and peaks | yes |
| 3 | ZCB Ski Area | iframe | good | snowy base bowl with picnic tables, lift and volcano, overcast | yes |
| 4 | Hotel | iframe | good | hotel pool deck with snowy volcano behind, no ski terrain | yes |

### Cranmore Mountain Resort (`cranmore`) — best: Meister

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Meister | youtube | good | summer valley and village view from mountain, hazy, logo overlays | yes |
| 2 | Snow Cam | link (inactive) | no_image | link-out page, no feed | yes |

### Crested Butte Mountain Resort (`crested-butte`) — best: Base
_Autumn, no snow. Umbrella Bar is muddy/foggy._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | iframe | good | autumn base area with chairlift and mountain, light mist | yes |
| 2 | Paradise | iframe | good | autumn lift terminal and forested slope seen from deck, overcast | yes |
| 3 | Umbrella Bar | iframe | poor | muddy road and deck tables in fog, lift towers in background | yes |

### Crystal Mountain Resort (`crystal-mountain`) — best: Base
_No attractive cam; all poor. No good/great cam; best is only poor._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | image | poor | dark grainy low-res night-ish base view, smudged lens, 800x600 | yes |
| 2 | Snow Stake | image | poor | snow stake close-up at night, stale June timestamp, no-wifi icon | yes |
| 3 | Summit Roundshot | iframe | poor | tiny 1148x150 summit panorama in thick fog | yes |

### Deer Valley Resort (`deer-valley`) — best: none usable
_Only cam is a link-out with no feed; no usable image. No usable (good/great) image for card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Diamond Peak Ski Resort (`diamond-peak`) — best: Summit
_Summit is the clear hero._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | image | great | Lake Tahoe view from summit, clear blue sky, dry ground | yes |
| 2 | Base Lodge | image | poor | hazy dry slope and deck railing, lens fog, no snow | yes |
| 3 | Mid Mountain | image | poor | deck picnic tables and trees, blown-out sky, no snow | yes |

### Dodge Ridge Mountain Resort (`dodge-ridge`) — best: none usable
_Base Lodge is low-res and letterboxed, with a Sep 26 timestamp (stale feed). Summit returns 404. No card-worthy image._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base Lodge | youtube | poor | dry slope with magic carpet, low-res letterboxed, timestamp Sep 26 (stale) | yes |
| 2 | Summit | youtube | no_image | not an image (404 image/jpeg 1097B) | yes |

### Donner Ski Ranch (`donner-ski-ranch`) — best: none usable
_No good/great image; no usable image at all_

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### El Colorado (`el-colorado`) — best: none usable
_No usable image: all three YouTube thumbnails are night frames stamped Aug 2026 (stale/not live)._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Mirador Cima | youtube | poor | night snow scene stamped 02-08-2026, dim, barely visible | yes |
| 2 | Parador Pista | youtube | dark | night frame stamped 2026-08-10, glare, nothing useful visible | yes |
| 3 | Liebre Base | youtube | dark | near-black night frame stamped 13-08-2026, nothing visible | yes |

### Eldora Mountain Resort (`eldora`) — best: Alpenglow

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Alpenglow | image | good | lift and ski slopes with patchy snow, blue sky, trees | yes |
| 2 | Snow Stake | image | poor | snow stake tube close-up against pine trees, no snow | yes |
| 3 | Lower Mountain | image (inactive) | no_image | not an image (404 text/plain; charset=utf-8 9B) | yes |

### Gore Mountain (`gore`) — best: Bear Mountain
_Base cam is night IR at capture time (likely just timing)._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Bear Mountain | image | good | forested ridge with ski trails and lift line in autumn color, light fog on top | yes |
| 2 | Summit | image | good | lift line under construction/maintenance with excavators, fog, autumn | yes |
| 3 | Base | image | poor | night infrared ultra-wide panorama of base area, grainy, partly visible | yes |

### Granby Ranch Ski Area (`granby-ranch`) — best: none usable
_No usable image: all cams dead, offline, link-out or night/black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | link | no_image | link-out page, no feed | yes |

### Granite Peak Ski Area (`granite-peak`) — best: none usable
_Dasher is best (chairs over fall foliage)._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Dasher | image | good | chairlift over autumn forest and distant plains | yes |
| 2 | Base Area | image | poor | bare grass hill with chairlift behind trees, roof in foreground, no snow | yes |

### Heavenly Mountain Resort (`heavenly`) — best: Gondola Mid Station

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Gondola Mid Station | iframe | great | Lake Tahoe vista from gondola mid station at golden hour, no snow | yes |
| 2 | Tram Summit | iframe | great | Tahoe lake and village view from tram summit with lift towers, golden light | yes |
| 3 | Hwy 50 | iframe | no_image | not an image (404 text/html; charset=UTF-8 0B) | yes |
| 4 | Snow Stake | iframe | placeholder | black card "webcam currently scheduled to be offline" | no |

### Homewood Mountain Resort (`homewood`) — best: none usable
_No usable image. Lake Tahoe View is a ZEN CAMS stock graphic; Ellis Lift has no feed; Snow Stake returns HTML._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Lake Tahoe View | iframe | placeholder | ZEN CAMS stock graphic: sunflower photo with text, not a camera | no |
| 2 | Ellis Lift | iframe | no_image | page 200, no og:image/m3u8 | yes |
| 3 | Snow Stake | iframe | no_image | not an image (200 text/html; charset=UTF-8 362B) | yes |

### Hoodoo Ski Area (`hoodoo`) — best: Base

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | image | good | base area lodge, lift terminals and mountain peak at dawn, bare ground | yes |
| 2 | Summit | image | good | Green Chair top unload on bare cinder hilltop, mountain view, washed-out sky | yes |
| 3 | Top of Ed | image | good | Ed chairlift top on bare hill, distant peak, hazy sky | yes |

### Hunter Mountain (`hunter`) — best: Summit

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | iframe | great | summit lift tower with sweeping autumn mountain vista under dramatic clouds | yes |
| 2 | Base | iframe | good | base plaza with flag, tents and food stands, green slopes with autumn foliage, lifts | yes |
| 3 | Mid Mountain | iframe | good | chairlift on green slope with autumn trees and rocky cliff, blue sky, tree trunk frames left | yes |

### Jackson Hole Mountain Resort (`jackson-hole`) — best: Rendezvous
_Both cams are great but ultra-wide panoramas; need a center crop for 16:9._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Rendezvous | image | great | ultra-wide panorama of lift over inversion cloud sea and ridge | yes |
| 2 | Summit | image | great | ultra-wide summit panorama, snowy peaks, tram station, cloud inversion | yes |

### Jay Peak Resort (`jay-peak`) — best: none usable
_Stateside is the only decent view; Tramside is foggy and Summit is a night shot._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Stateside | image | good | chairlift terminals on green slope, fall foliage, low cloud | yes |
| 2 | Tramside | image | poor | lift terminal and base in dense fog | yes |
| 3 | Summit | image | poor | night shot through fog, house lights and dark silhouette | yes |

### Jiminy Peak Mountain Resort (`jiminy-peak`) — best: none usable
_No good/great image; no usable image at all_

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### June Mountain (`june-mountain`) — best: J3
_All YouTube thumbs look like old footage (Chalet and J3 stamped 2022-11-09); snowy and attractive but not current. Verify streams._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | J3 | youtube | great | snowy slope with J3 lift and bluebird sky, but stamped 2022-11-09 (stale) | yes |
| 2 | Chalet | youtube | good | snowy lift top terminal, but stamped 2022-11-09 (stale old stream frame) | yes |
| 3 | Ski Patrol | youtube | good | sunlit snowy hillside with shadows and trees, no timestamp | yes |

### Keystone Resort (`keystone`) — best: Dercum

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Dercum | iframe | good | dusting of snow on slope with valley and lake below under cloud | yes |
| 2 | North Peak | iframe | good | North Peak ski runs with light snow dusting, forested ridges, overcast | yes |
| 3 | River Run | iframe | poor | River Run bridge toward hazy lift line, bare slope, washed-out sky | yes |
| 4 | Snow Stake | image | poor | snow stake and thermometer close-up with light frost | yes |

### Killington Resort (`killington`) — best: Peak 360

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Peak 360 | iframe | good | ultra-wide 360 panorama of autumn ski slopes and base lodges; very wide aspect | yes |
| 2 | North Ridge | image | poor | dense fog over tree-covered slope with chairlift, very low visibility | yes |
| 3 | Superstar | image | poor | heavy lens flare and haze washing out forested hillside, near-unreadable | yes |

### Kirkwood Mountain Resort (`kirkwood`) — best: Cornice

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Cornice | iframe | great | lift terminals and rocky peak above forest, clear blue sky, dusting of snow | yes |
| 2 | Red Cliffs | iframe | good | shaded ski slope with trees and rocky ridge, clear sky | yes |
| 3 | Snow Stake | image | poor | snow stake close-up on dirt, stale Aug 24 timestamp | yes |

### La Hoya (Esquel) (`la-hoya`) — best: none usable
_Single cam, clear snowy peaks and blue sky. Good hero image._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Principiantes / Plano Base 1600 | image | great | "Principiantes" snowy peaks and beginner area, blue sky, La Hoya logo | yes |

### La Parva (`la-parva`) — best: none usable
_No good/great image; no usable image at all_

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base Manzanito | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |
| 2 | Parva Chica | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |
| 3 | Parva Comercial | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |

### Las Leñas (`las-lenas`) — best: Base / Live Cam (official)
_Base/Live cam is excellent. Pirámide and Principal are 404 and already auto_disabled._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base / Live Cam (official) | iframe | great | snowy peaks above red-roofed base lodge and lifts, clear light | yes |
| 2 | Pirámide | image (inactive) | no_image | not an image (404 text/html; charset=utf-8 202B) | yes |
| 3 | Principal | image (inactive) | no_image | not an image (404 text/html; charset=utf-8 203B) | yes |

### Lookout Pass Ski Area (`lookout-pass`) — best: none usable
_NO USABLE IMAGE._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Loon Mountain Resort (`loon`) — best: none usable
_All three feeds are YouTube placeholder/promo/maintenance cards; no usable live image. No usable (good/great) image for card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Kancamagus | youtube | placeholder | "Kancamagus 8 Summit Live Stream" promo/play-button card, not live video | no |
| 2 | Octagon | youtube | placeholder | "Octagon Base Area Live Stream" promo/play-button card with stock aerial image | no |
| 3 | Peak | youtube | placeholder | "Webcam is currently down for maintenance" card with Loon logo | no |

### Loveland Ski Area (`loveland`) — best: none usable
_No usable image: all cams dead, offline, link-out or night/black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Basin | image (inactive) | no_image | not an image (200 text/html 114B) | yes |
| 2 | Ptarmigan | image (inactive) | no_image | not an image (200 text/html 114B) | yes |
| 3 | Snow Stake | image (inactive) | no_image | not an image (200 text/html 114B) | yes |

### Lutsen Mountains (`lutsen`) — best: none usable
_Real panorama, but 788x150-style aspect will crop poorly to 16:9. Consider a card treatment or another cam._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Roundshot 360 | iframe | good | wide panorama of Lake Superior and ridges, autumn color, very wide aspect | yes |

### Mad River Glen (`mad-river-glen`) — best: none usable
_No good/great image; only poor cams available_

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Single Chair | youtube | poor | snowmaking guns, shed and parking area in fall mist | yes |

### Mammoth Mountain (`mammoth`) — best: Summit
_All 480x360 letterboxed YouTube thumbs. Summit top station is the best. Main Lodge is black (dead?). Duplicate McCoy b378 is 404 and auto_disabled. Tamarack is a plain road._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | youtube | great | summit top station with Minarets skyline, blue sky, no snow, letterboxed | yes |
| 2 | Eagle Lodge | youtube | good | sunny Eagle Lodge chairlift on bare ground with peak, letterboxed 480px | yes |
| 3 | Woolly Cam at Main Lodge | youtube | good | Mammoth Mountain mascot statue roundabout, small letterboxed frame | yes |
| 4 | The Village | youtube | poor | village plaza fire pit and stage, no slopes visible | yes |
| 5 | Unbound Main Park | youtube | poor | hazy bare park terrain and lodge, stamped 2026-10-12 (stale) | yes |
| 6 | Tube Park | youtube | poor | red groomer on gravel at tube park, treeline, no snow | yes |
| 7 | The Outpost | youtube | poor | forested slope with rock outcrops, overcast, dull | yes |
| 8 | McCoy Station | youtube | poor | sun flare and smeared lens, dark hillside | yes |
| 9 | Canyon Lodge | youtube | poor | dim dawn Canyon Lodge sign board and rooftops, low-res letterboxed | yes |
| 10 | Tamarack XC Ski Center | youtube | poor | paved road through scrubby woods, XC center, no snow | yes |
| 11 | Main Lodge | youtube | dark | pure black frame, no overlay, likely dead stream | yes |
| 12 | McCoy Station | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |

### Marquette Mountain (`marquette-mountain`) — best: Trail Cam

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Trail Cam | image | good | autumn foliage over Marquette town and Lake Superior from mountain | yes |

### Mission Ridge Ski & Board Resort (`mission-ridge`) — best: Midway
_Winter scene in October suggests Midway stream may be stale; Mimi and Sunspot are current-looking but modest._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Midway | youtube | good | snow-covered slope with lift terminal and tower, cloudy; winter scene in October suggests stale stream | yes |
| 2 | Mimi | youtube | good | summer lift line and green slope, tower and forest, low-res letterboxed | yes |
| 3 | Sunspot | youtube | good | hillside overlook to dry valley, pine tree in foreground, low-res letterboxed | yes |

### Monarch Mountain (`monarch-mountain`) — best: none usable
_No usable image: all cams dead, offline, link-out or night/black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Mount Snow (`mount-snow`) — best: none usable
_Carinthia is best; Summit is in dense fog._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Carinthia | iframe | good | Carinthia chairlift on green slope, autumn foliage | yes |
| 2 | Summit | iframe | poor | summit hillside in dense fog with lift line and snowguns | yes |
| 3 | Snow Stake | iframe | poor | snow stake board with clock and thermometer in woods, no snow | yes |

### Mountain High Resort (`mountain-high`) — best: Upper Chisholm

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Upper Chisholm | youtube | good | dry grass slope and rugged mountain peak under blue sky | yes |
| 2 | Borderline | youtube | good | bare chairlift line under trees with desert valley beyond, no snow | yes |
| 3 | East Summit | youtube | good | dry east summit with lift terminal and mountain, burnt trees, no snow | yes |
| 4 | North Lodge | youtube | poor | lodge patio with tables and chairs under trees, no slopes | yes |
| 5 | Playground | youtube | poor | bare dark ground slope with lifts and trees, no snow | yes |
| 6 | West Base | youtube | poor | west base lodge with heavy lens flare, bare ground | yes |
| 7 | WSC Bullwheel | youtube | poor | night infrared frame of tent and trees, barely visible | yes |
| 8 | Yeti's Snowplay | youtube | poor | bare slope with lift terminal and trees in low sun, no snow | yes |

### Mt. Ashland Ski Area (`mt-ashland`) — best: none usable
_No usable image: link-out page only._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Mt. Bachelor Ski Resort (`mt-bachelor`) — best: none usable
_NO USABLE IMAGE._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Cloudchaser | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |
| 2 | Pine Marten | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |
| 3 | Snow Stake | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |

### Mt. Baker Ski Area (`mt-baker`) — best: none usable
_No usable (good/great) image for card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Heather Meadow | image | poor | overcast haze over treetops and rooftops, no mountain visible, tiny timestamp | yes |
| 2 | Shuksan | image | poor | gloomy overcast through evergreen branches, no ski terrain visible | yes |

### Mt. Baldy Ski Lifts (`mt-baldy`) — best: none usable
_No usable image: all cams dead, offline, link-out or night/black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | 7800ft Cam | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |

### Mt. Hood Meadows (`mt-hood-meadows`) — best: none usable
_Bottom Vista (sunrise above cloud inversion) is striking; Blue #2 is blocked by railings._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Bottom Vista | iframe | great | sunrise over cloud inversion and valley, lift terminal on gravel | yes |
| 2 | Top of Blue | iframe | good | Mt. Hood Express top terminal on gravel, forest and cliff, no snow | yes |
| 3 | Blue #2 | iframe | poor | Blue lodge in distance with railings and posts blocking foreground | yes |

### Mt. Rose Ski Tahoe (`mt-rose`) — best: Main Lodge

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Main Lodge | iframe | great | base with snow-dusted slope, forested peak, lifts and sunny patio | yes |
| 2 | Summit | iframe | great | summit lift terminal with snow patches and sweeping valley view, sunburst | yes |
| 3 | Slide Bowl | iframe | good | chairlift terminal on dry slope with Lake Tahoe in distance | yes |

### Mt. Shasta Ski Park (`mt-shasta`) — best: Douglas Cam
_Douglas Cam is a great hero shot._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Douglas Cam | image | great | sunlit Mt Shasta summit above forested ski slopes, blue sky | yes |
| 2 | Base Cam | image | good | chairlift base terminal and forested bare hillside, hazy sun | yes |

### Nevados de Chillán (`nevados-de-chillan`) — best: Plaza Tata

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Plaza Tata | iframe | good | sunny base with snowy peaks, lift station foreground, lens glare | yes |
| 2 | Novicios (Pista Novicios) | iframe | no_image | not an image (404 text/html; charset=UTF-8 0B) | yes |

### Northstar California (`northstar`) — best: Mid Mountain

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Mid Mountain | iframe | good | Zephyr Express lift terminal with dry golden hillside, warm morning light, no snow | yes |
| 2 | Northstar Village | iframe | good | Northstar village plaza with empty rink, lodging buildings, fire pit, no snow | yes |
| 3 | Snow Stake | iframe | poor | snow stake close-up on gravel ground, blurry foreground | yes |
| 4 | Summit | iframe | poor | heavy pink lens flare through tree branches, unusable | yes |

### Nub's Nob Ski Area (`nubs-nob`) — best: none usable
_No usable image: all cams dead, offline, link-out or night/black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Live Cam | link | no_image | link-out page, no feed | yes |

### Okemo Mountain Resort (`okemo`) — best: none usable
_Summit has the best view._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | iframe | good | summit chairlift with valley and hills below, overcast | yes |
| 2 | Sugar House | iframe | poor | paved road curving across grass slope, fall trees, mostly empty | yes |
| 3 | Snow Stake | iframe | poor | snow stake and date board in front of fence, no snow | yes |

### Palisades Tahoe (`palisades-tahoe`) — best: Base Area

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base Area | iframe | good | Funitel terminal in village with steep mountain behind, no snow | yes |
| 2 | Silverado 360 | iframe | good | ultra-wide panorama of dry ridge at sunrise, extreme aspect ratio | yes |
| 3 | Scope | iframe | poor | high camp deck with strong lens flare and smudged lens | yes |

### Park City Mountain (`park-city`) — best: Top OBX
_Top OBX snowy lift is the best card; Lookout Cabin is dense fog._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Top OBX | iframe | great | snow-covered trees and lift tower with orange gondola cabin | yes |
| 2 | Mountain Village | iframe | good | Payday lift base plaza with pedestrians, foggy autumn hills | yes |
| 3 | High Meadow | iframe | good | dusting of snow on base area with chairlift, fisheye bezel at top | yes |
| 4 | Lookout Cabin | iframe | poor | dense fog at Lookout Cabin with snowy tree tops, nothing visible | yes |

### Pico Mountain (`pico`) — best: Base Cam
_Best cam is usable but not a strong hero._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base Cam | image | good | green grassy slope with autumn trees, cloud-covered upper mountain, no snow | yes |
| 2 | Horizon Cam | image | poor | summit sign in dense fog, almost nothing visible | yes |

### Pillán (Centro de Ski Volcán Villarrica) (`pillan`) — best: none usable
_Frames stamped 2026-08-07 (stale); POVI is purple haze. No usable image. No usable (good/great) image for card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Mirador Pillán Lago | youtube | poor | snow-covered trailer and fence in heavy snow; overlay date 2026-08-07 so frame is stale (~2 months) | yes |
| 2 | Volcán Villarrica (POVI) | image | poor | volcano webcam image of purple-grey haze/cloud, volcano not visible, Fundacion Volcanes copyright banner | yes |
| 3 | Mirador Pillán Volcan | youtube | blank | uniform grey/white overcast frame with stale overlay date 2026-08-07, nothing visible | no |

### Powder Mountain (`powder-mountain`) — best: none usable
_No usable image: all cams dead, offline, link-out or night/black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Powderhorn Mountain Resort (`powderhorn`) — best: none usable
_Cam 2 shows fresh snow on a chairlift, best option. Cam 3 is a stake close-up._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Cam 2 | image | great | chairlift through frosted aspens and conifers, fresh snow | yes |
| 2 | Cam 1 | image | good | chairlift line over grassy slope with aspens in fall color | yes |
| 3 | Cam 3 | image | poor | snow stake board covered in snow in aspen woods | yes |

### Purgatory Resort (`purgatory`) — best: Village Plaza

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Village Plaza | iframe | good | rainy village plaza with condos and autumn trees, no snow | yes |
| 2 | Base | iframe (inactive) | poor | red lift terminal on grassy slope, foggy with lens droplets, 4:3 low-res | yes |
| 3 | Express Summit | iframe | poor | whiteout snowfall with conifers and lift tower barely visible | yes |

### Red Lodge Mountain (`red-lodge`) — best: none usable
_No usable image: link-out page only._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcam | link | no_image | link-out page, no feed | yes |

### Red River Ski Area (`red-river`) — best: none usable
_NO USABLE IMAGE._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | The Face | link | no_image | link-out page, no feed | yes |

### Schweitzer Mountain Resort (`schweitzer`) — best: Summit Roundshot

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit Roundshot | iframe | good | ultra-wide summit panorama at sunrise over ridges and chairlift, very wide aspect | yes |

### Seven Springs Mountain Resort (`seven-springs`) — best: none usable
_No usable image: all cams dead, offline, link-out or night/black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Sierra-at-Tahoe (`sierra-at-tahoe`) — best: none usable
_All three are low-res 4:3 letterboxed and mediocre. Plaza image is dated 03/13/2026 (stale); West Bowl timestamp is illegible and looks stale. Grandview is current but dim dawn. No card-quality image; recheck feeds._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | West Bowl | youtube | poor | sunny bare hillside with lift towers, low-res letterboxed, stale-looking | yes |
| 2 | Grandview | youtube | poor | dim dawn hillside with lift tower, low-res letterboxed | yes |
| 3 | Plaza | youtube | poor | base plaza with crowd and tables, low-res, timestamp 03/13/2026 (stale) | yes |

### Ski Apache (`ski-apache`) — best: Base PTZ

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base PTZ | iframe | good | close view of chairlift and operator shed on green slope, no snow | yes |

### Ski Bluewood (`ski-bluewood`) — best: Base
_Summit is an FTP placeholder icon._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | image | good | Bluewood base with chairlift, snowmaking pipes and deck, no snow | yes |
| 2 | Summit | image | placeholder | FTP camera cloud icon placeholder, no image | no |

### Ski Bowl at Mt. Hood (`ski-bowl`) — best: none usable
_NO USABLE IMAGE._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Ski Cooper (`ski-cooper`) — best: Ridgeview
_Ridgeview is a great preview; Snow Stake and Top o the Mountain streams return 404._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Ridgeview | iframe | great | RidgeCam: snow-dusted mountain over spruce forest and meadow, fall light, branches frame top | yes |
| 2 | Snow Stake | iframe | no_image | [in#0 @ 0x7a99010000] Error opening input: Server returned 404 Not Found | yes |
| 3 | Top o' the Mountain | iframe | no_image | [in#0 @ 0x7b83010000] Error opening input: Server returned 404 Not Found | yes |

### Portillo (`ski-portillo`) — best: Laguna (Inca Lake)

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Laguna (Inca Lake) | iframe | great | heated pools beside frozen Inca Lake, snowy peaks, blue sky | yes |
| 2 | Escuela (Ski School) | iframe | great | yellow Hotel Portillo with snowy mountain and groomed snow, sunny | yes |
| 3 | Plateau | iframe | good | wide snowy slope with tracks, lift terminal at edge, hazy light | yes |
| 4 | Tío Bob's | iframe | no_image | not an image (404 text/html; charset=UTF-8 0B) | yes |

### Ski Santa Fe (`ski-santa-fe`) — best: none usable
_Chair 5 shows an "offline" placeholder card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | iframe | good | Santa Fe Express lift terminal and base below forested hill | yes |
| 2 | Chair 5 | iframe | placeholder | black card "This webcam is currently scheduled to be offline" | no |

### Smugglers' Notch Resort (`smugglers-notch`) — best: none usable
_No good/great image; only poor cams available_

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base Lodge | youtube | poor | dense fog over lift line and green slope | yes |
| 2 | Village | youtube | poor | condo building and lawn, overcast, no slopes | yes |

### The Summit at Snoqualmie (`snoqualmie`) — best: Central Express
_Central Express and Alpental frames carry 04-09-2025 overlays (stale ~6 months; probably old streams). Central is black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Central Express | youtube | great | snowy trees, peaks and lift tower, bluebird; overlay 04-09-2025 (stale) | yes |
| 2 | Alpental | youtube | good | Alpental base snowy slopes and lifts; overlay 04-09-2025 (stale ~6 months) | yes |
| 3 | Central | youtube | dark | pure black frame, likely dead stream | yes |

### Snow King Mountain (`snow-king`) — best: Mid Mtn
_No good/great cam; best is only poor._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Mid Mtn | youtube | poor | foggy mid-mountain with lift and alpine coaster, 480x360 letterboxed thumbnail | yes |

### Snow Summit (`snow-summit`) — best: none usable
_Only cam is a link-out with no feed; no usable image. No usable (good/great) image for card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Snow Valley Mountain Resort (`snow-valley`) — best: Summit

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | youtube | good | summit lift terminal on bare ground, forested hills, blue sky | yes |
| 2 | Base Lodge | youtube | good | dry lift line through forest on hazy morning, no snow | yes |

### Snowbasin Resort (`snowbasin`) — best: none usable
_Needles looks like a summer scene with green slopes and may be stale; Earl's Plaza returns 404._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Needles | image | good | summer green mountain slopes and rocky peaks, blue sky, roof in foreground (likely stale) | yes |
| 2 | Earl's Plaza | image (inactive) | no_image | not an image (404 text/plain; charset=utf-8 9B) | yes |

### Snowbird (`snowbird`) — best: Base Area

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base Area | image | good | snow-laden conifers with misty snowy slope and lift towers | yes |
| 2 | Snow Stake | image | poor | snow stake close-up buried in fresh snow | yes |

### Snowshoe Mountain Resort (`snowshoe`) — best: none usable
_No usable image: link-out page only (already inactive)._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link (inactive) | no_image | link-out page, no feed | yes |

### Solitude Mountain Resort (`solitude`) — best: none usable
_NO USABLE IMAGE._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Spirit Mountain (`spirit-mountain`) — best: Live Cam
_Single cam shows winter snow in October; may be stale image._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Live Cam | image | good | Express cam: snowy run with chairlift and Lake Superior behind; winter scene in October suggests stale image | yes |

### Steamboat Ski Resort (`steamboat`) — best: Thunderhead
_Champagne and Christie are black frames (night/offline); recheck by day._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Thunderhead | youtube | good | gondola summit terminal roof over Yampa valley, summer green, clear | yes |
| 2 | Champagne Powder | youtube | dark | black night frame, nothing visible | yes |
| 3 | Christie Peak | youtube | dark | black night frame, nothing visible | yes |

### Stevens Pass Mountain Resort (`stevens-pass`) — best: none usable
_All foggy; Courtyard is the best. Skyline is uniform grey (fog or lens) and should be rechecked._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Courtyard | iframe | good | base courtyard with ticket building, clock tower, fog | yes |
| 2 | Jupiter | iframe | poor | lift hut and gravel top terminal in fog | yes |
| 3 | Ski and Snowboard School | iframe | poor | Daisy lift base and snowguns in dense fog | yes |
| 4 | Snow Stake | iframe | poor | snow stake close-up on bare ground | yes |
| 5 | Skyline | iframe | blank | uniform grey, nothing visible | no |

### Stowe Mountain Resort (`stowe`) — best: Stowe Village 2

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Stowe Village 2 | iframe | great | village buildings under foliage-covered mountain, cloud on peak | yes |
| 2 | Spruce Peak | iframe | poor | village lawn blocked by blue beam and branches in foreground | yes |

### Stratton Mountain Resort (`stratton`) — best: Mid Mountain
_Letterboxed 480px thumbs; summit is fogged out._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Mid Mountain | youtube | good | mid mountain autumn foliage slope under low cloud, letterboxed | yes |
| 2 | Base | youtube | good | main base picnic tables, forklift, autumn foliage, lift, letterboxed | yes |
| 3 | Snowbowl | youtube | good | Snow Bowl bare slope with lift tower and autumn trees, overcast | yes |
| 4 | Summit | youtube | poor | heavy fog at Stratton summit, gondola barely visible | yes |

### Sugar Bowl Resort (`sugar-bowl`) — best: none usable
_NO USABLE IMAGE._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Sugarbush Resort (`sugarbush`) — best: Castle Rock
_Youtube cams look stale or seasonal (winter/spring/summer scenes in October); Snow Stake is foliage-blocked. Re-check streams._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Castle Rock | youtube | good | top of lift area in snow with snowmobile and lift staff, low-res; winter scene in October suggests stale stream | yes |
| 2 | Gatehouse | youtube | good | bare melting slope with patchy snow below lift terminal, forested hillside, low-res; likely stale spring frame | yes |
| 3 | Super Bravo | youtube | good | summer base area with lift, lodge buildings, excavator, trucks, lush green; not current autumn | yes |
| 4 | Snow Stake | iframe | poor | Sugarbush snow stake board hidden by foliage, low-res | yes |

### Sugarloaf (`sugarloaf`) — best: The Beach
_Off-season, no snow; Beach is more ski-area than Golf Course._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | The Beach | youtube | good | base plaza and lodge with autumn foliage, misty ridge, no snow | yes |
| 2 | Golf Course | youtube | poor | golf course green with fall trees under overcast, not slopes | yes |

### Sun Peaks Resort (`sun-peaks`) — best: none usable
_All captured at night (about 5am local). Village is lit and recognizable; the others are nearly black. Re-grade in daylight._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Village | image | poor | night view of Sundance Lodge and village lit up with snow | yes |
| 2 | Top of Sundance | image | dark | night infrared view of road and dark slope, logo | yes |
| 3 | Mt Tod | image | dark | near-black night frame with lens drops and logo | yes |

### Sun Valley Resort (`sun-valley`) — best: River Run

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | River Run | image | good | River Run gondola terminal, patio and autumn trees, frosty ground | yes |
| 2 | Bowls | image | poor | lift terminal under construction with equipment and trucks | yes |
| 3 | Snow Stake | image | poor | snow stake close-up with light dusting of snow | yes |

### Sundance Mountain Resort (`sundance`) — best: Mandan Summit
_Bearclaw (Verkada) stream fails and is auto_disabled._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Mandan Summit | image | great | Mandan Summit slopes with fall foliage, lifts, peaks | yes |
| 2 | Bearclaw | iframe (inactive) | no_image | [in#0 @ 0x7997010000] Error opening input: Server returned 4XX Client Error, but not one of 40{0,1,3,4} | yes |

### Sunday River (`sunday-river`) — best: Barker 6
_Only YouTube thumbnails; none is a good current live still. Jordan 8 is promo footage. No good/great cam; best is only poor._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Barker 6 | youtube | poor | summer scene with pond and lift, stale-looking 480x360 thumbnail | yes |
| 2 | Peak Lodge | youtube | poor | autumn hillside with lift terminal and logo, low-res 480x360 thumbnail | yes |
| 3 | Jordan 8 | youtube | placeholder | aerial drone snowy summit promo thumbnail, not a current live view | no |

### Sunlight Mountain Resort (`sunlight`) — best: none usable
_No usable (good/great) image for card._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Leonards Lookout | iframe | poor | dense fog over grass field with wooden gate, almost nothing visible | yes |
| 2 | Snow Stake | iframe | poor | snow stake and thermometer close-up with autumn foliage | yes |

### Tahoe Donner Downhill Ski Area (`tahoe-donner`) — best: none usable
_No usable image: all cams dead, offline, link-out or night/black._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Webcams | link | no_image | link-out page, no feed | yes |

### Tamarack Resort (`tamarack`) — best: none usable
_Only cam is a stale Feb 5 frame, low-res and letterboxed. Effectively no usable current image._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit | youtube | poor | flat snow field with weather widget, dated Feb 5, low-res letterboxed (stale) | yes |

### Taos Ski Valley (`taos`) — best: Highline

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Highline | iframe | great | sweeping autumn mountain ridges and valley from Highline Ridge | yes |
| 2 | Base | iframe | good | Taos lift base with aspens and snowless slope, overcast | yes |
| 3 | Kachina Basin | iframe | good | Taos chairlift base with mountain peak behind, overcast, no snow | yes |
| 4 | Poco Snow Stake | iframe | poor | snow stake close-up on forest floor, low-res | yes |

### Telluride Ski Resort (`telluride`) — best: Village
_Village is the only decent card; others whiteout/close-up/dark._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Village | iframe | good | snow-dusted ski slope, lodge buildings and aspens in falling snow | yes |
| 2 | Black Iron | iframe | poor | close-up of fresh snow on ground, no landmarks | yes |
| 3 | See Forever | iframe | poor | whiteout fog with snowy tree tops only | yes |
| 4 | Revelation Bowl 360 | iframe | dark | twilight thin panorama, mostly black silhouettes | yes |

### Timberline Lodge Ski Area (`timberline`) — best: Lodge

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Lodge | image | good | Timberline Lodge exterior with parked cars in warm morning light | yes |
| 2 | Palmer | image | good | Palmer lift and rocky Mt Hood summit with patches of snow | yes |
| 3 | Summit | image | poor | misty forest and grass slope, Timberline Summit Pass sign, heavy fog | yes |
| 4 | Snow Stake | image | placeholder | "No signal" error card, camera timeout | no |

### Vail Mountain (`vail`) — best: Back Bowl
_Back Bowl and Eagles Nest are great; Snow Stake cam (already auto-disabled) fetch failed._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Back Bowl | iframe | great | sweeping golden Back Bowls hills under big clouds, good light | yes |
| 2 | Eagle's Nest | iframe | great | moody mountain valley with cloud inversion and dusted peaks, warm light on slopes | yes |
| 3 | Gore Range | iframe | poor | smeared lens with blurry fog/dirt covering the view | yes |
| 4 | Snow Stake Summit | iframe | poor | Vail snow stake board in front of wooden fence, close-up | yes |
| 5 | Sun Up Bowl | iframe | poor | large water/dirt blob on lens obscuring lift tower and hill | yes |
| 6 | Snow Stake | iframe (inactive) | no_image | fetch failed | yes |

### Valle Nevado (`valle-nevado`) — best: Hotel Puerta del Sol

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Hotel Puerta del Sol | youtube | great | sunny snow-covered mountain with lifts and trails, blue sky | yes |
| 2 | La Fourchette Terrace | youtube | great | skiers on bright snowy slope with hut, deep blue sky | yes |
| 3 | Pool (Piscina) | youtube | good | hotel pool terrace with snow piles, snowy mountain behind, sunny | yes |
| 4 | La Góndola | youtube (inactive) | no_image | not an image (404 image/jpeg 1097B) | yes |

### Volcán Osorno (Centro de Ski y Montaña Volcán Osorno) (`volcan-osorno`) — best: none usable
_No usable image: Cono is an infrared night frame with Oct 8 timestamp (stale), Boleterias is a "Reconectando..." placeholder._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Camara VO - Cono VO | youtube | dark | night infrared, snow streaks, timestamp Oct 8 (stale) | yes |
| 2 | Camara VO - Zona Boleterias | youtube | placeholder | black card "Volcan Osorno - Zona Boleterias Reconectando..." | no |

### Wachusett Mountain Ski Area (`wachusett`) — best: none usable
_No good/great image; only poor cams available_

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | NASTAR | iframe | poor | empty cut grass trail beside autumn foliage, no lifts or base | yes |
| 2 | Summit | iframe | no_image | [in#0 @ 0x79ed010000] Error opening input: Server returned 404 Not Found | yes |

### Waterville Valley Resort (`waterville-valley`) — best: Base
_Base cam great with fall colors; Summit foggy._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | image | great | blue lift terminal, fall foliage and lodge, sunny | yes |
| 2 | Summit | image | poor | dense fog over summit deck tables, little visible | yes |

### Whistler Blackcomb (`whistler-blackcomb`) — best: 7th Heaven
_Strong resort; 7th Heaven is a clear hero shot._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | 7th Heaven | iframe | great | chairlift above cloud inversion with sunlit peaks at sunrise | yes |
| 2 | Roundhouse | iframe | good | sunrise-lit ridge with ski runs, drifting cloud, lift building corner | yes |
| 3 | Village | iframe | good | Blackcomb gondola base plaza in fog, autumn trees, no snow | yes |
| 4 | Peak | iframe | poor | mostly fog bank with a sliver of rocky ridge, cropped | yes |

### White Pass Ski Area (`white-pass`) — best: Base

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | iframe | good | base chairlift and Tudor lodge on dry hillside, highway in foreground, no snow | yes |
| 2 | High Camp | iframe | good | High Camp lodge in fog with evergreens and grass slope, low visibility | yes |
| 3 | Snow Stake | iframe | poor | White Pass snow stake close-up with snow guns and slope behind | yes |

### Whiteface Mountain (`whiteface`) — best: Bear Den
_Only night frames at capture; recheck by day. Both are poor now but real views._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Bear Den | image | poor | night panorama with soffit in frame, base lift dimly lit, fisheye | yes |
| 2 | Legacy Lodge | image | poor | night grayscale panorama of lifts and lodge deck, grainy | yes |

### Whitefish Mountain Resort (`whitefish`) — best: none usable
_No usable image: roundshot is near-black at mid-morning local time._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Summit Roundshot | iframe | dark | very wide near-black frame with a few tiny lights | yes |

### Wildcat Mountain (`wildcat`) — best: Base

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | iframe | great | base lodge, lift and fall foliage hills under clear blue sky | yes |
| 2 | Snow Stake | iframe | poor | snow stake with clock and thermometer close-up | yes |

### Willamette Pass Resort (`willamette-pass`) — best: Base
_Single cam, usable._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | youtube | good | dry ski slope with lift line and base shed, blue sky, letterboxed | yes |

### Windham Mountain (`windham`) — best: Base

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | iframe | great | base lodge and lifts under colorful autumn hillside, blue sky | yes |

### Winter Park Resort (`winter-park`) — best: Village
_Village is best but snow scenes in October suggest possibly stale stream; verify._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Village | youtube | good | Winter Park village lodges with snowy ski slopes behind, afternoon light; snow in October suggests possibly stale stream | yes |
| 2 | Lunch Rock | youtube | good | Lunch Rock area bare ground with sun in cloudy sky, evergreens, low-res | yes |
| 3 | Snow Stake | youtube | poor | Winter Park snow stake close-up with snowy trees; winter scene in October suggests stale | yes |

### Wintergreen Resort (`wintergreen`) — best: Classic

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Classic | image | good | autumn base slope with chairlift, hills and condos, sunny, no snow | yes |
| 2 | Lookout | image | good | mountain coaster track and hills in autumn, sunny, clear | yes |

### Wisp Resort (`wisp`) — best: none usable
_Base is best (slope and lift, lens smudge). Mountain Park shows mini golf, not skiing._

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | image | good | long green slope with chairlift and snowguns, lens smudge, no snow | yes |
| 2 | Mountain Park | image | poor | mini golf and adventure park with barn and parking lot | yes |

### Wolf Creek Ski Area (`wolf-creek`) — best: Base

| # | Cam | Type | Grade | View | Card? |
|---|---|---|---|---|---|
| 1 | Base | iframe | good | snow-dusted base lodge and lift area in fog | yes |
| 2 | Lift Line | iframe | good | snowy lift line with excavator in fog | yes |
| 3 | Summit | iframe | poor | dense fog and snow, almost nothing visible | yes |
