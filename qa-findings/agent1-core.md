# Agent 1 — Core Browse & Resort Detail

QA of live site https://peakcam.io (ski resort webcams + snow reports), focused on core browse (home/directory) and resort detail pages. Tested 2026-08-10 ~18:20–19:35 UTC (site timezone). Browser: headless Chromium (no residential proxy). All pages redirect `peakcam.io` → `www.peakcam.io`.

**Pages tested (8 navigations):** `/` (3 loads), `/resorts/bear-mountain`, `/resorts/caviahue`, `/resorts/vail`, `/map`, `/resorts/this-resort-does-not-exist` (404), plus curl checks of `/resorts` and the og:image endpoint.

**Headline:** Zero JavaScript errors on every page (0 console errors across all navigations). Core browse + resort detail work: cams load real video frames (YouTube embeds), snow reports carry "Updated …" timestamps, 404 handling is correct. Issues found are content/UX polish + one data-consistency concern, nothing Critical.

## BUGS

1. **Home directory cards show wrong base-depth values during count-up animation (resets to 0 and climbs on each data refresh)**
   - severity: Medium
   - category: Content (also Accessibility)
   - url: https://peakcam.io/ (directory section "Today's conditions")
   - repro: Load home; repeatedly read the "BASE DEPTH" value of any in-season card (e.g. Caviahue, Portillo) across ~1–2 min. Observed over 3 loads + timed DOM sampling: Caviahue card read 31″ → 56″ → 6″ before settling at 94″; Portillo read 26″ → 46″ → 5″ → 78″ before settling at 78″. 250ms-interval sampling after settle shows a constant correct value, so the fluctuation is a count-up animation that re-runs (from ~0) on each data refresh.
   - expected: Base depth displayed statically equals the resort's current report value at all times.
   - actual: Transient values 5″–78″ shown while animating; the DOM/accessibility tree contains wrong snow data during the animation window. A user glancing at a refresh (or a screen reader announcing the live region) can read e.g. "6″ base" for a resort whose true base is 94″.
   - console: none
   - screenshot: /Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_bfdc490808a445c183f00a60239bf768.png
   - note: Detail page for Caviahue confirmed 94″ base at the same time (screenshot of detail page also shows 94″), so the card's final value is correct — this is purely an animation/AX exposure problem. Recommend no-op when value unchanged or animate opacity/fade instead of the number itself.

2. **"LIVE CAMS3 AVAILABLE" heading missing space — "Cams3" typo on resort detail pages**
   - severity: Low
   - category: Content
   - url: https://peakcam.io/resorts/bear-mountain and https://peakcam.io/resorts/caviahue (heading above webcams)
   - repro: Open any resort detail page with webcams; read the cams section heading.
   - expected: "LIVE CAMS · 3 AVAILABLE" (or similar) with proper spacing.
   - actual: Heading renders "LIVE CAMS3 AVAILABLE" (AX text: "Live Cams3 available") — missing space between "Cams" and the count.
   - console: none
   - screenshot: /Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_0a8a2dfae51f4b43912a04f494934323.png (heading above cams)

3. **`/resorts` directory URL returns HTTP 404 while the nav "Resorts" item points to the homepage**
   - severity: Low
   - category: Functional (SEO/deep-linking)
   - url: https://peakcam.io/resorts
   - repro: curl -L https://peakcam.io/resorts → HTTP 404 (final URL https://www.peakcam.io/resorts). Meanwhile nav link "Resorts" → https://www.peakcam.io/ (verified in DOM).
   - expected: The obvious directory path either serves the directory or redirects to `/`.
   - actual: 404 page. Bookmarks, search engines, or shared links to /resorts hit a dead end; the browse page is only reachable via `/`.
   - console: none (curl-verified status)
   - screenshot: n/a

4. **Caviahue cam captions inconsistent — one cam's caption text missing, cam load behavior differs within the same page**
   - severity: Low
   - category: Content (UX)
   - url: https://peakcam.io/resorts/caviahue
   - repro: Scroll to LIVE CAMS section. Cam 1 (AER) shows caption "Copahue Volcano - Aerodrome Node (AER)"; cam 2 (AGS) shows an empty caption paragraph (name only appears inside its "Report … broken" button). Cams 3–4 (ESC, MLZ) show "Click to load snapshot" placeholders while cams 1–2 auto-loaded images.
   - expected: Every cam shows its name caption; load behavior is consistent across cams on one page.
   - actual: Missing caption for AGS; mixed auto-load vs click-to-load in the same grid (lazy load works — clicked ESC, image then loaded, verified 3/3 imgs loaded).
   - console: none
   - screenshot: n/a (covered by cams grid)

## ENHANCEMENTS

1. **Home page lacks og:image** — home has og:title/description/url/type but no og:image, so social/link previews of the root page will be image-less. Resort pages do it right (dynamic `opengraph-image` endpoint, verified HTTP 200 PNG 1200×630 at https://peakcam.io/resorts/bear-mountain/opengraph-image?29b6301c5916bf84).
2. **YouTube embed suggestions leak off-topic content into cam players** — Bear Mountain cams show the channel's unrelated uploads inside the player ("Trump & the DOJ…", "Aeon Flux", etc.). Consider `rel=0`/`modestbranding`, hiding the suggestion rail, or a wrapper player. (Not a functional break; players render real live video frames, verified visually.)
3. **404 page is minimal** — correct status + noindex + "Back to PeakCam", but no nav, no search box, no popular-resort suggestions. Add search or related links to recover lost users.
4. **Duplicate favoriting affordances on resort pages** — "Add to Favorites" appears in the header AND in the snow-report card AND per-cam; consider consolidating.
5. **Hero is text-on-solid-beige with no imagery** — a live cam thumbnail or mountain image would sell the product; currently the strongest visual hook is the "Snowing now" strip below.
6. **Map page renders no visible content in WebGL-disabled contexts** — MapLibre canvas was blank in headless capture (style + tiles.json requests confirmed loading, so likely fine in real browsers). Consider a graceful fallback message or raster layer for WebGL-blocked browsers, and add an `og:image` here too.
7. **Inconsistent snow-report data sources across resorts** — Bear Mountain/Caviahue show "Source: open_meteo", Vail shows "Source: snotel"; fine functionally, but consider surfacing the source consistently per data type (base depth vs forecast) and one "last updated" per card on the home directory.
8. **Home directory cards could show "Updated" freshness inline** — detail pages have timestamps; directory cards don't, so users can't tell how fresh the listing data is (especially relevant given the animated-counter refresh pattern in Bug 1).
9. **MapTiler API key visible client-side** (api.maptiler.com calls carry `key=…` in the URL) — normal for browser maps, but worth domain-restricting the key.

## Testing notes

- **What I tested:** Home (hero, nav, "Snowing now" strip, directory cards, filters/sort buttons present), home → resort detail navigation (Vail card link → /resorts/vail loads: h1 "Vail Mountain", 0″ base, "Updated Aug 10, 7:31 PM · Source: snotel", 3 cams); Bear Mountain (SoCal, off-season) — full snow report w/ "Updated Aug 10, 6:29 PM · Source: open_meteo", 5-day forecast w/ "Updated hourly" + NWS link, 48-Hour Detail toggle, 3 YouTube cams (Base/Midway/Summit) that DO render live video frames, "Report … broken" buttons, community conditions quick-vote + sign-in-gated detailed report; Caviahue (Argentina, in-season: 94″ base, FLAT LIGHT/WIND HOLD RISK conditions) — cams 2/4 auto-load, 2/4 lazy "Click to load snapshot" (click verified working); 404 route (correct HTTP 404, noindex, clean message); /map (148-resort sidebar with per-resort status, MapLibre init + MapTiler requests confirmed, no JS errors).
- **Meta tags:** Home: title "Live Ski Resort Webcams, Snow Reports & Conditions", og:title/description/url/type, canonical OK, description OK — no og:image. Resort page: title "Bear Mountain Live Webcams — Snow Report & Ski Conditions | PeakCam", full OG set incl. og:image (dynamic PNG, 1200×630, verified 200), og:site_name, canonical.
- **Console:** 0 JS errors / 0 console messages on all 6 navigations (checked after each navigation and interaction). No failed-request or hydration errors observed.
- **Blockers/caveats:** (1) Screenshots taken via browser_vision are saved on the host at the paths recorded above (not accessible from my docker terminal, so not copied into this folder); (2) MapLibre WebGL canvas and first-paint of YouTube frames don't composite in headless screenshots — blank-looking map/cam captures were verified as render artifacts by DOM/network inspection (tiles.json/style fetched; cam iframes contain live players with seek sliders); recommend a quick real-browser visual pass on /map; (3) one browser_click on a stale card ref did nothing (page re-renders during data refresh), retried via fresh ref/navigation — not a site bug; (4) untested: search box, Compare, Snow Report, About, auth/sign-in flows, favorites persistence, mobile viewport, /drop-in (other agent's scope).
