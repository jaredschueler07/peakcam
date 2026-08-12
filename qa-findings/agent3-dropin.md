# Agent 3 — Drop-in, A11y & Edge Cases

QA date: 2026-08-10 · Site: https://peakcam.io (redirects to www.peakcam.io) · Next.js frontend
Scope: drop-in arcade feature, accessibility spot check (home + 2 resort pages), edge cases (robots/sitemap, no-data resort, long slug), console errors on every navigation.

## Executive summary

- **Drop-in feature is NOT auth-walled.** It loads and plays fully signed-out. The "auth wall" from the prior context was not observed at any point (entry, launch, or in-game HUD). The only `auth` string found in `engine.html` suggests a possible score-save/leaderboard hook, but nothing gates play.
- **The feature has near-zero discoverability.** No nav link, no home-page mention, no sitemap entry; `/drop-in` itself 404s. The only entry points are per-resort "DROP IN BETA" pills on exactly 3 whitelisted resorts.
- 3D engine (three.js-style WebGL) loads and renders correctly: 2 canvases, WebGL context OK, HUD live, **zero console errors across all 12 navigations**.
- No `<img>` elements anywhere sampled — all icons are inline SVGs (many with labels). Heading structure is orderly (H1→H2→H3, no skips). Skip-to-content link present on every page.
- robots.txt + sitemap.xml: 200, sane. 404 pages are friendly with recovery links.

## BUGS

1. **Drop-in has no global entry point — feature is effectively hidden**
   - severity: Medium · category: Discoverability / feature exposure
   - url: https://peakcam.io (home), nav on all pages, https://peakcam.io/drop-in
   - repro: Load home page; search nav, hero, footer, and any link mentioning "drop-in/arcade/play/game" → none. Visit /drop-in, /dropin, /arcade, /play, /ski-game → all 404. Grep of sitemap.xml (153 URLs) → no drop-in URLs. Grep of all 16 home JS chunks → feature only exists in chunk `f19d4a3e58524c8a.js`, rendered only on 3 whitelisted resort pages.
   - expected: A promoted, linked feature entry (nav item, home card, or at minimum a working /drop-in landing/hub page).
   - actual: Feature reachable only via `/resorts/{ski-portillo|breckenridge|heavenly}/drop-in` pills or direct URL guessing.
   - console: none · screenshot: https://peakcam.io home — `/Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_4c2d684f319b4fb9bb6ae72db49d24d3.png`

2. **Misleading "RESORT NOT FOUND" on drop-in URL for existing non-whitelisted resorts**
   - severity: Low · category: UX copy / error messaging
   - url: https://peakcam.io/resorts/vail/drop-in (also any non-whitelisted resort)
   - repro: Visit /resorts/vail/drop-in (Vail exists with 3 cams on the site).
   - expected: "Drop In not available for this resort yet" + links to whitelisted resorts (Portillo, Breckenridge, Heavenly).
   - actual: Custom page reads "RESORT NOT FOUND" with "Browse all resorts" — factually wrong copy; Vail is not "not found", it just isn't whitelisted.
   - console: none · screenshot: not captured (text-only page; snapshot verified)

3. **Resort cam heading text bug: "LIVE CAMS3 AVAILABLE" / "LIVE CAMS0 AVAILABLE"**
   - severity: Low · category: Copy/polish
   - url: https://peakcam.io/resorts/vail, /resorts/breckenridge, /resorts/cerro-perito-moreno (all resort pages)
   - repro: Inspect the LIVE CAMS section heading (H2). a11y snapshot shows heading text "LIVE CAMS3 AVAILABLE" / "LIVE CAMS4 AVAILABLE" / "LIVE CAMS0 AVAILABLE" — count glued to "CAMS" with no separator.
   - expected: "LIVE CAMS · 3 AVAILABLE" (or styled count badge).
   - actual: "CAMS3"/"CAMS4"/"CAMS0" reads as one word; also exposes the 0 case awkwardly.
   - console: none · screenshot: breckenridge page — `/Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_2c168dcb99ef4275bbb64341032a2b21.png` (heading visible top of conditions section)

4. **Forecast wind cells render dangling "Wind from " with missing direction**
   - severity: Low · category: Data display
   - url: https://peakcam.io/resorts/vail and /resorts/breckenridge (5-Day Forecast table; e.g. Vail row "0 Wind from ", Breckenridge Wed-PM "1 Wind from ")
   - repro: Read WIND column for some forecast periods — direction data absent, cell reads "0 Wind from " / "1 Wind from " with trailing space; the SVG icon alt is also "Wind from " (incomplete).
   - expected: Graceful fallback e.g. "5 mph" or "—" when direction is missing.
   - actual: Awkward half-sentence with trailing space; screen readers announce "zero Wind from".
   - console: none

5. **Low-contrast small text: "SORT:" label (and similar muted labels) fail WCAG AA for small text**
   - severity: Low-Medium · category: Accessibility (contrast)
   - url: https://peakcam.io (resort list toolbar, "SORT:" 11px label next to sort buttons; similar faint small labels on resort pages per visual review: "PRECIP CHANCE" label, "Outlook" caption, "Updated … · Source:" metadata)
   - repro: Compute contrast of 11px `rgb(122,90,58)` text on cream background (~#e9e1d0) → ≈2.3:1 (WCAG AA requires 4.5:1 for normal text). Visual review of screenshots flagged the same labels as faint.
   - expected: ≥4.5:1 for these small text labels.
   - actual: Sub-threshold contrast on secondary labels.
   - console: none · screenshot: home — `/Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_4c2d684f319b4fb9bb6ae72db49d24d3.png`; resort — `/Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_2c168dcb99ef4275bbb64341032a2b21.png`

6. **Thin, sometimes custom-tinted focus indicators (1px outline)**
   - severity: Low · category: Accessibility (keyboard focus)
   - url: all pages (tested: https://peakcam.io/resorts/breckenridge)
   - repro: Tab through header — focus does move (Skip link → nav). Computed outline is `auto` 1px; nav links use custom `outline-color: rgba(250,244,230,0.8)` (cream, 80% alpha) which on light backgrounds is low-visibility. First Tab test: vision review could not detect the skip-link ring at 1px.
   - expected: ≥2px high-contrast `:focus-visible` ring on all interactive elements.
   - actual: Focus exists but is easy to miss (1px; cream-on-light). Verified programmatically: `outlineStyle:auto`, `outlineWidth:1px` on focused nav link; visible ring confirmed on dark header.
   - console: none · screenshot: focused nav link — `/Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_2c168dcb99ef4275bbb64341032a2b21.png`

## Non-issues verified (no bugs)

- **Auth wall**: none. /resorts/breckenridge/drop-in loads a start screen ("CLICK OR PRESS ENTER TO DROP IN"); game launches to full 3D (WebGL OK, 2 canvases, HUD: velocity/time/vertical/altitude/score/trail/weather), all signed-out. engine.html contains one "auth" string (likely score-save hook), no gating.
- **3D engine**: renders correctly (skier, snow, trees, lift, falling snow, peaks). HUD showed "10 FPS · 1.1x" — likely headless-environment artifact; worth a perf check on low-end devices.
- **/drop-in 404**: friendly custom page (H1 "PAGE NOT FOUND" + "Back to PeakCam" link), zero console errors. Same for /dropin, /arcade, /play, /game.
- **Long resort slug** (/resorts/this-is-a-very-long-resort-name-that-definitely-does-not-exist-1234567890): clean 404 + "Back to PeakCam".
- **No-data resort** (/resorts/cerro-perito-moreno, 0 cams): "No cams indexed yet for this resort." — graceful, no layout break.
- **robots.txt**: HTTP 200, `Disallow: /auth /alerts /favorites`, Sitemap declared.
- **sitemap.xml**: HTTP 200, 153 URLs (home, snow-report, map, compare, about, 148 resorts). No drop-in URLs (see Bug 1).
- **A11y baseline**: skip-to-content on every page; heading order H1→H2→H3 with no skips (home: 1 H1, ~5 H2, ~130 H3; resort: H1→4 H2→2 H3); 0 `<img>` missing alt (0 img elements at all — SVG icons; several carry aria-labels like "7-day trend: Stable", "Wind from W"); no unnamed buttons (0/0 on resort page); forecast tables use proper `columnheader`; game iframe has a meaningful title ("Drop In — Breckenridge arcade ski descent"); "DROP IN" pill has proper aria-label "Drop In — ski Breckenridge in an arcade descent"; community-report submit button correctly disabled until input + "Sign in to Submit Report" state.
- **Console errors**: 0 across home, /drop-in, engine.html, 404 pages, vail, breckenridge, cerro-perito-moreno, long-slug 404, standalone engine deep link.

## ENHANCEMENTS

1. **Global discoverability for drop-in**: home-page hero card or "Play" section, nav/footer link, and sitemap entries for the 3 live drop-in pages; consider a `/drop-in` hub page listing whitelisted resorts instead of 404.
2. **Expand the whitelist** beyond ski-portillo / breckenridge / heavenly (Zod enum + config object in chunk f19d4a3e58524c8a.js makes this data-driven; add a few marquee resorts like Vail, Aspen, Park City).
3. **First-run onboarding in the game**: a 3–5s auto-play tutorial descent or an animated controls overlay (controls are currently only a static text strip on the start screen); add pause-menu "How to play" replay.
4. **Post-run engagement**: score summary screen with "Sign in to save your score / leaderboard" CTA — the engine already references auth; wire it up to convert signed-out players.
5. **"Drop In BETA" pill on whitelisted resort pages**: add a subtle glow/animation + a one-line explainer ("An arcade ski descent. New: 3 resorts.") to hint the beta nature.
6. **Fix 404 copy for existing-but-unwhitelisted resorts** (Bug 2) with cross-links to whitelisted resorts.
7. **Fix "LIVE CAMS{n}" heading formatting** (Bug 3) — use a badge or em-space separator.
8. **Wind direction fallback** (Bug 4): render "5 mph" without dangling "from".
9. **Contrast pass** (Bug 5): bump secondary labels ("SORT:", "PRECIP CHANCE", "Outlook", update timestamps) to ≥4.5:1; consider a muted-but-dark taupe instead of mid-brown.
10. **Focus visibility** (Bug 6): 2px `:focus-visible` ring in an accent color that works on both cream and dark backgrounds; keep the custom outline only on dark surfaces.
11. **A11y depth for the game**: `aria-live="polite"` on HUD score/speed changes (optional, could be noisy), and `role="application"` + keyboard-legend landmark inside the iframe so SR users know it's a game; ensure ESC exits pointer lock cleanly (already shown: "ESC cursor" in legend — good).
12. **Performance check**: HUD showed 10 FPS in headless; verify on a low-end laptop and consider an auto-quality fallback (reduce pixel ratio / tree density) below 30 FPS.

## Testing notes

- Environment: remote headless Chrome (Browserbase, no residential proxy). WebGL ran in software/headless mode — FPS readings are indicative only.
- 12 navigations total; `browser_console` read after each — zero console messages or JS errors on every page, including the game engine.
- Contrast figures measured via JS computed styles + WCAG relative-luminance formula; lab() colors converted for the sort label. Visual-only observations (e.g. faint "PRECIP CHANCE") flagged from screenshots are marked as such.
- The drop-in page `alert` role at top of every page body (from a11y snapshot) appears to be a toast host — no issue observed.
- Screenshots (host paths):
  - drop-in start screen: /Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_86ee9f28b86d44b7b679d76ccc7bc176.png
  - game running (3D render + HUD): /Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_7aed526e90994859b1face07e59b4cba.png
  - home page: /Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_4c2d684f319b4fb9bb6ae72db49d24d3.png
  - resort page + focus ring: /Users/maestro_admin/.hermes/cache/screenshots/browser_screenshot_2c168dcb99ef4275bbb64341032a2b21.png
- One oddity: a JS navigation via browser_console once landed the browser on about:blank ("Blocked: page URL targets a private or internal address") — a transient driver issue, not a site bug; recovered by re-navigating.
