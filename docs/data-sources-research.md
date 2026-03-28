# Data Sources Research

Research on open source ski data projects and paid API options for PeakCam.

---

## 1. PowderCast (greenido/PowderCast)

**Stack:** Next.js 15, TypeScript, better-sqlite3, Tailwind CSS

### NWS API Pinpointing

PowderCast stores **base and summit lat/lng coordinates** for each resort in a SQLite database (22 major US resorts). Their weather endpoint accepts `GET /api/weather?lat=39.27&lon=-120.12` and proxies to the NWS API using the standard two-step flow:

1. `GET https://api.weather.gov/points/{lat},{lng}` → resolves grid office + coordinates
2. `GET https://api.weather.gov/gridpoints/{office}/{gridX},{gridY}/forecast` → gets the forecast

They toggle between **base and summit** elevation queries, giving users both perspectives.

### Powder Alert Thresholds

- **Powder alert:** 6+ inches of snow in 24 hours
- **Bluebird day:** cloud cover < 25% AND wind speed < 15 mph
- **Frostbite risk:** wind chill below -20°F (4 severity tiers down to -50°F)
- **Wind hold risk:** gusts > 40 mph (tiers up to 50+ mph)

### Snow Quality Classification (Temperature-Based)

| Temp Range | Classification | Description |
|------------|---------------|-------------|
| < 15°F | Champagne Powder | Ultra-light, dry |
| 15-26°F | Premium Packed | Classic powder |
| 27-34°F | Sierra Cement | Heavy, wet |
| > 34°F | Mashtatoes/Slush | Spring conditions |

Special case: **Ice Coast** detected when current temp < 32°F while recent highs > 33°F (freeze-thaw cycles).

### Techniques to Adopt

- **Snow quality scoring from precipitation temperature** — we can compute this from NWS forecast temps during snowfall periods. Straightforward to add to our blender.
- **Dual-elevation queries** — query NWS at both base and summit coords for each resort. We already have resort lat/lng; we could add summit coords from OpenSkiStats elevation data.
- **Bluebird day detection** — combine cloud cover + wind from NWS. Simple conditions check.
- **1-hour localStorage caching** — client-side cache pattern for weather data.

---

## 2. OpenSkiStats / OpenSkiData

**Source:** [github.com/dhimmel/openskistats](https://github.com/dhimmel/openskistats) / [openskistats.org](https://openskistats.org)

### Dataset Availability

The underlying data comes from **OpenSkiMap** (which refines OpenStreetMap data). A daily-updated GeoJSON is downloadable:

```
https://tiles.openskimap.org/geojson/ski_areas.geojson
```

- **Format:** GeoJSON FeatureCollection (~3.9 MB)
- **Total features:** 12,143 ski areas worldwide
- **US resorts:** ~1,941 features
- **License:** Open Data Commons Open Database License (ODbL)
- **Update frequency:** Daily

### Data Schema

Each feature contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | SHA hash ID (e.g., `9030998fda4f92b141a2cd0eb7b272290bccefae`) |
| `name` | string | Ski area name |
| `type` | string | Always `"skiArea"` |
| `status` | string | `"operating"`, `"abandoned"`, etc. |
| `activities` | string[] | `["downhill"]`, `["nordic"]`, etc. |
| `websites` | string[] | Official website URLs |
| `places` | object[] | Location info with `iso3166_2` (e.g., `"US-CO"`), country, region, locality |
| `sources` | object[] | Data source with `type` (`"openstreetmap"` or `"skimap.org"`) and `id` |
| `statistics.runs` | object | Run counts/lengths by difficulty (easy, intermediate, advanced, expert) |
| `statistics.lifts` | object | Lift counts by type |
| `statistics.maxElevation` | number | Summit elevation (meters) |
| `statistics.minElevation` | number | Base elevation (meters) |
| `wikidataID` | string? | Wikidata entity ID |
| `runConvention` | string | `"north_america"` or `"europe"` |
| `geometry` | Polygon/Point | Resort boundary or center point |

### Mapping to PeakCam Resorts

Our `resorts.csv` uses slugs like `vail`, `breckenridge`, `keystone`. The OpenSkiData `name` field uses display names like `"Vail"`, `"Breckenridge"`. Mapping strategy:

1. **Fuzzy name matching** — normalize both names (lowercase, strip "ski resort", "mountain", etc.) and match
2. **Website URL matching** — compare `websites[]` against our `website_url` column
3. **Coordinate proximity** — match by lat/lng within ~5km radius
4. **Manual overrides** — a mapping file for edge cases

### What We Can Import

- **Elevation data** (base/summit) — critical for dual-elevation NWS queries and vertical drop display
- **Run statistics** — counts by difficulty, total length in km
- **Lift counts** — by type (chair, gondola, etc.)
- **Resort boundaries** — polygon geometry for map overlays
- **OpenStreetMap IDs** — for cross-referencing

### Import Script

See `scripts/seed-openskistats.ts` for the import implementation.

---

## 3. PowderHound (b-dulaney/powder-hound)

**Stack:** SvelteKit, Supabase, Go (scraper), Tailwind, Vercel

### Supabase Alert Pipeline Architecture

```
CAIC API ──→ Supabase Edge Function (hourly cron) ──→ snow_data table
                                                          │
                                                          ▼
                                              Scheduled Alert Check
                                              (4:30pm MT / 6:00am MT)
                                                          │
                                                          ▼
                                              Resend Email API ──→ User
```

**Key design decisions:**

1. **Hourly data collection** — A scheduled Supabase edge function fetches CAIC point forecast data every hour and stores it.
2. **Two alert windows:**
   - **4:30 PM MT** — Forecast alerts: "24-hour snowfall forecast exceeds your threshold"
   - **6:00 AM MT** — Overnight alerts: "Recent overnight snowfall hit your threshold"
3. **User-defined thresholds** — Each user sets their own snowfall threshold (not a global 6" like PowderCast).
4. **Email via Resend** — Clean, transactional email delivery.
5. **Separate scraper service** — A Go-based scraper (powder-hound-go) handles resort terrain data collection, keeping the main app clean.

### Techniques to Adopt

- **User-configurable alert thresholds** — let users pick their powder threshold (4", 6", 8", 12")
- **Dual alert timing** — forecast alerts (afternoon) + overnight actuals (morning) is smart UX
- **Supabase edge function cron** — we already use Supabase; scheduling data collection as edge functions keeps infra simple
- **Separate data collection from alerting** — collect data on a fast cycle (hourly), but only check alert conditions at specific times

---

## 4. Mountain News / OnTheSnow Partner API

**URL:** [partner.docs.onthesnow.com](https://partner.docs.onthesnow.com/)

### Overview

Mountain News (since 1968) is the authoritative source for real-time ski resort data, powering OnTheSnow, Skiing Magazine, and many third-party apps. Their Partner API provides:

- Snowfall totals (24/48/72 hour)
- Base and summit snow depths
- Lift and trail counts (open/total)
- Primary surface conditions
- 7-day mountain weather forecasts
- Live resort webcams
- Resort metadata and profiles

### API Structure

| Endpoint Category | Description |
|-------------------|-------------|
| Resorts | List resorts with region filters |
| Snowreports & Snowfall | Snow conditions, trail/lift status |
| Webcams | Live webcam feeds |
| Profiles | Resort location and details |
| Weather | Daily and hourly forecasts |
| Regions | Active region listing |

- **Auth:** API key via `x-api-key` HTTP header
- **Format:** RESTful JSON
- **Rate limits:** 10 req/sec, 5,000 req/day (default)
- **Coverage:** 2,000+ ski areas worldwide

### Pricing

**Not publicly listed.** Contact their sales team with use case. Likely tiered by:
- Number of resorts
- Request volume
- Data scope (snow only vs. full suite)

**Contact:** Sales form on [mountainnews.com/data-distribution](https://www.mountainnews.com/data-distribution/)

### Assessment

This would be the **gold standard** data source — resort-reported snow data, lift status, and official conditions. However, cost is unknown and could be significant for a startup. Worth reaching out to understand pricing tiers.

---

## 5. OpenSnow API

**Contact:** api@opensnow.com

### Overview

OpenSnow provides meteorologist-crafted snow reports and forecasts. Their API returns data in XML, JSON, or CSV format. Known for high-quality forecasts that go beyond raw NWS data.

### Consumer Pricing (not API)

- Base: $49.99/year (1 person) or $89.99/year (4 people)
- Premium: $99.99/year (1 person) or $179.99/year (4 people)

### API Pricing

**Not publicly documented.** Must contact api@opensnow.com for developer/commercial API access and pricing.

### Assessment

OpenSnow's value is their **meteorologist-enhanced forecasts** — better than raw NWS for mountain-specific conditions. If affordable, this could complement our NWS data with higher-quality predictions. Contact to explore.

---

## 6. Other APIs Discovered

### Weather Unlocked Ski Resort API

**URL:** [developer.weatherunlocked.com/skiresort](https://developer.weatherunlocked.com/skiresort)

| Plan | Price/mo | Resorts | Daily Requests |
|------|----------|---------|----------------|
| Free | $0 | 1 | 1,000 |
| 5 Resorts | $14 | 5 | 2,000 |
| 25 Resorts | $40 | 25 | 12,500 |
| 50 Resorts | $70 | 50 | 25,000 |
| 100 Resorts | $120 | 100 | 50,000 |
| 250 Resorts | $220 | 250 | 150,000 |
| All (850+) | $420 | All | 1,000,000 |

Data includes: mountain forecasts, webcam links, resort stats, snowfall history, piste maps, 7-day snow charts, 31-day outlook. **Most transparent pricing** of all paid options.

### Ski API (skiapi.com)

Free tier with rate limiting. Provides lift status, snow conditions, resort location. Accessed via RapidAPI.

### SnoCountry (feeds.snocountry.net)

Provides resort conditions in JSON. Free developer key available (`SnoCountry.example` for testing). Limitations on batch/regional queries. North America focused.

---

## Recommendations & Next Steps

### Immediate (Free, No API Key)

1. **Import OpenSkiStats data** — Run `scripts/seed-openskistats.ts` to enrich our `resorts` table with elevation, run stats, lift counts, and boundary polygons. This data updates daily and is freely licensed.

2. **Adopt PowderCast's snow quality logic** — Add temperature-based snow quality classification to our blender. The thresholds are well-tested and simple to implement.

3. **Add bluebird day detection** — Cloud cover < 25% + wind < 15 mph from NWS data. Easy win for UX.

4. **Implement dual-elevation NWS queries** — Once we have summit elevations from OpenSkiStats, query NWS at both base and summit coordinates.

### Short-Term (Contact Required)

5. **Email Mountain News sales** — Understand pricing for the OnTheSnow Partner API. Even a basic tier would give us resort-reported snow data (the most trusted source).

6. **Email OpenSnow** (api@opensnow.com) — Ask about developer API access and pricing. Their meteorologist forecasts are a differentiator.

7. **Evaluate Weather Unlocked** — At $70/mo for 50 resorts, this is the most accessible paid option. Could be a good starting point for resort-reported data while we negotiate with Mountain News.

### Architecture Pattern (from PowderHound)

8. **Build Supabase edge function cron** — Hourly data collection from NWS/SNOTEL, with alert checks at 4:30 PM and 6:00 AM MT. User-configurable thresholds.

### Data Source Priority Matrix

| Source | Cost | Data Quality | Coverage | Effort |
|--------|------|-------------|----------|--------|
| NWS API | Free | Good (raw) | All US | Already built |
| SNOTEL | Free | Excellent (measured) | Western US | Already built |
| OpenSkiData | Free | Good (metadata) | Global | Low (script ready) |
| SnoCountry | Free? | Good | North America | Medium |
| Weather Unlocked | $70-420/mo | Good | 850+ resorts | Low |
| Mountain News | Unknown | Excellent | 2,000+ resorts | Low (API ready) |
| OpenSnow | Unknown | Excellent (forecasts) | US | Low (API ready) |
