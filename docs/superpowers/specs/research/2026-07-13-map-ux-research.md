# PeakCam Map UI/UX Improvement Report

## Executive Summary

PeakCam's map has a good foundation (MapLibre + supercluster, condition-color-coded markers, RainViewer radar, a genuinely well-designed but currently invisible popup component) but three structural problems are costing more than any visual polish would gain: **(1) the desktop popup path is dead code** — every click hard-navigates or opens a bottom sheet before the 1200ms flyTo/popup can ever be seen, so real users only ever experience the off-brand, legacy-styled `MapBottomSheet`; **(2) the map's core visual encoding is thinner than it looks** — the 3-way metric toggle only swaps a text label while color stays pinned to `cond_rating`, clusters are flat ink blobs with zero aggregate signal, and there's no distinct state for off-season resorts, which is now a live, dated bug given the hemisphere-spanning 148-resort roster (NA is off-season and will render as false "Poor" red dots right now); **(3) the map is unverified since the rebrand** — the test plan is checked off against a pre-rebrand dark-theme UI, so filter sync, radar toggle, and the mobile flow are all effectively untested against what ships today, and two real bugs (tablet dead button, browse-page radar completely absent) confirm that blind spot. Fixing the navigation-vs-popup contradiction, wiring cluster/off-season/snowing-now signals into the color and shape channels, and closing the QA gap are the three highest-leverage moves — each is cheap relative to impact and each directly serves the "which resort has the goods right now" job. Everything below is scoped to keep MapLibre/react-map-gl and the retro-poster brand intact.

---

## Tier 1 — Quick Wins (hours to 1 day each)

### 1. Decide and fix the popup-vs-navigate contradiction
**Problem:** In the sidebar, `onResortClick` triggers `window.location.href` (hard nav) at the same instant `MapView` kicks off a 1200ms `flyTo` + opens `MapPopupCard` — the page starts unloading before either can render. In `FullPageMap` desktop, `router.push` does the same thing faster. On mobile, `MapBottomSheet`'s `fixed inset-0 z-40` backdrop physically covers the popup. Net effect: `selectedSlug`, `selectedResort`, the Popup, `handlePopupClose`, `handleViewResort`, and all of `MapPopupCard.tsx` — the most fully on-brand piece of the map UI — are wired up and never seen. (`components/map/MapView.tsx:94,103-106,200-245,247-258,444-461`; `app/map/FullPageMap.tsx:32-50`; `components/browse/BrowsePage.tsx:631`; `components/map/MapBottomSheet.tsx:24-27`)
**Change:** Pick one model and commit to it everywhere: click → popup/card shows resort summary + a "View resort" button that navigates; navigation only happens on explicit second action. Kill the flyTo-then-immediately-unload sequence. On mobile, either drop the bottom-sheet backdrop overlap or drop the Popup — don't ship both racing each other.
**Why it works:** Airbnb's click→sync pattern keeps map and detail in the same view without full navigation (cross-domain stream); this also removes the wasted flyTo compute happening on a page about to unload.
**Effort:** 2-4 hours. **Risk:** Low — this is un-breaking an already-broken flow, not introducing new UX.

### 2. Add radar to the browse-page sidebar map
**Problem:** `app/page.tsx` never calls `getLatestRadarTileUrl`; `BrowsePage.tsx` never passes `radarTileUrl` to `MapView`; `MapControls`'s `radarAvailable = !!radarTileUrl` is therefore always false on browse. No comment or product rationale exists — it reads as an oversight. (`app/page.tsx:53,94`; `components/browse/BrowsePage.tsx:627-633`; `components/map/MapControls.tsx:54`)
**Change:** Fetch the radar tile URL alongside resorts in `app/page.tsx` and pass it through to the sidebar `MapView`.
**Why it works:** Trivial prop-threading of existing, working functionality — no new component needed. Competitor teardown flags "is a storm coming" as core to the conditions job; this closes a surface where PeakCam already built the feature but shipped it half-wired.
**Effort:** 1-2 hours. **Risk:** None — purely additive, uses existing code paths.

### 3. Fix the tablet dead-click gap on the map toggle
**Problem:** The "Show map" button is `hidden md:flex` (visible ≥768px) but the map wrapper is `hidden lg:block` (visible only ≥1024px) — between 768-1023px, tapping the button does nothing observable. (`components/browse/BrowsePage.tsx:500-512,625-626`)
**Change:** Align both breakpoints to the same value (`md:` or `lg:`, pick one) so the control and the thing it controls agree.
**Why it works:** One-line fix for a real, currently-shipping dead interaction; segmented-control best practice (cross-domain stream) assumes the toggle always has an effect.
**Effort:** 15 minutes. **Risk:** None.

### 4. Throttle the marker hover handler
**Problem:** `onMouseMove` fires `onResortHover` on every native mousemove with no throttling, re-rendering hover-highlight state across up to 148 grid cards on every pixel of movement. (`components/map/MapView.tsx:184-198`; `components/browse/BrowsePage.tsx:312,610-611`)
**Change:** Debounce/throttle to ~16-32ms (one requestAnimationFrame tick), or switch to `onMouseEnter`/`onMouseLeave`-per-feature-id diffing instead of raw mousemove.
**Why it works:** Mobile/perf research stream flags GPU/CPU cost of unthrottled map interaction; this is a compounding risk as resort count keeps growing.
**Effort:** 1-2 hours. **Risk:** Low — verify hover-highlight still feels responsive, not laggy.

### 5. Give "fair"/"good" markers a guaranteed accessible stroke, and stop relying on it by accident
**Problem:** Computed contrast: mustard `#e2a740` ("fair") against cream `#f1e7cf` is 1.74:1, against legend cream-50 is 1.95:1 — both fail WCAG's 3:1 non-text minimum; moss `#6d8a4a` ("good") is marginal at 3.17:1. Both currently only pass visually because of the always-on ink circle-stroke, which is a coincidence of current styling, not a documented requirement. (data-viz stream; `app/globals.css` `--pc-fair`/`--pc-good` vs `--pc-cream`)
**Change:** Formalize the ink stroke (`#2a1f14`) as a required, never-optional layer (comment it in code as an a11y requirement), and slightly bump stroke width (1.5→2px) or fill saturation on "fair"/"good" specifically so contrast has real margin, not a hair's-width pass.
**Why it works:** WCAG 1.4.11 non-text contrast (3:1 minimum) — closes an accidental near-fail before a future "cleaner look" redesign drops the stroke.
**Effort:** 1 hour. **Risk:** None — purely defensive/documentation + minor value tuning.

### 6. Fix radar-over-markers z-order
**Problem:** `MapWeatherOverlay`'s radar layer is mounted after (below in JSX, but rendered on top in the style stack) the resorts `Source`, with no `beforeId`, so radar draws over condition markers rather than beneath them — the reverse of standard weather-map layering (basemap → radar → labels/markers on top). (`components/map/MapView.tsx` lines ~286-439; data-viz stream, external Xweather/Wet Dog layering guidance)
**Change:** Pass `beforeId="resort-markers-hit"` (or the first resort layer id) to the radar `Layer` so MapLibre inserts it below markers; consider dropping opacity to 0.35-0.45 in that configuration.
**Why it works:** One-line fix restores the exact "radar as background context, markers as figure" hierarchy the whole map is designed around — critical for reading "is it snowing here right now, and what's the base."
**Effort:** 30 minutes. **Risk:** None.

### 7. Fix the WeatherIcon dark-theme hardcode
**Problem:** `WeatherIcon` hardcodes dark-theme-era hex (`STROKE #E8E8E8`, `CYAN #22D3EE`) with no light/poster variant, sitting inside an otherwise fully on-brand `MapControls` pill. (`components/map/MapControls.tsx:63`; `components/weather/WeatherIcon.tsx:24-25`)
**Change:** Recolor to poster tokens (ink stroke, forest/alpen accent) matching the rest of `MapControls`.
**Effort:** 30 minutes - 1 hour. **Risk:** None.

### 8. Wire `snowing_now` into the map (minimal version)
**Problem:** `snowing_now` exists on the data model but `resortsToGeoJSON()` never copies it into `ResortFeatureProperties` — the map has zero visibility into current snowfall despite it being one of the most "right now" signals available. (`lib/types.ts`; `lib/map-utils.ts` `ResortFeatureProperties`)
**Change:** Add `snowingNow: boolean` to the properties interface and pass it through. As a quick-win version (full animated ring is a Medium item below), just add a small static snowflake glyph badge on markers where true, paired with a text label in the popup/sheet — never color-only.
**Why it works:** WCAG 1.4.1 / data-viz stream: redundant non-color encoding; also closes a stated brief requirement ("snowing now... never wired into the map layer").
**Effort:** 2-3 hours for data plumbing + static glyph (animated version is Medium tier).
**Risk:** Low.

### 9. Full-width, positioned map/grid toggle
**Problem:** Not fully audited for spacing, but cross-domain research is explicit: segmented map/list controls should be full-width on mobile, directly above the content they control, left/right-aligned, never centered.
**Change:** Audit and adjust the existing `hidden md:flex` "Show map" button against this pattern once breakpoints are fixed (item 3).
**Effort:** 1-2 hours. **Risk:** None.

---

## Tier 2 — Medium (a few days each)

### 10. Add an off-season/closed marker state
**Problem:** `ConditionRating` is a closed 4-value enum (great/good/fair/poor) with no off-season/closed state; anything failing the "fair" threshold implicitly falls to "poor." Today (Northern Hemisphere summer, per the current date), NA resorts are off-season while Chile/Argentina are in-season — meaning the entire NA half of the 148-resort map will render as red "Poor" dots, falsely implying terrible conditions rather than "closed for summer." (`lib/types.ts` `ConditionRating`; `lib/conditions-engine.ts` `RATING_THRESHOLDS`; data-viz stream)
**Change:** Add a 5th categorical state (`off-season`/`closed`) rendered in a desaturated neutral (e.g. bark-50 `#b59b74`, chosen because it carries no hue information and is colorblind-neutral by construction) with a distinct glyph (sun icon, or outline-only circle) instead of the rating dot. Exclude it from the "poor" bucket in `conditions-engine.ts`. Add a filter chip / map toggle: "Show only in-season" as a competitor-differentiating feature (no competitor surfaced offers explicit hemisphere/season toggling — cross-domain + competitor streams both flag this as a real PeakCam advantage given the two-hemisphere expansion).
**Why it works:** Directly fixes a dated, currently-live misrepresentation; competitor stream explicitly calls out season-badging as a feature "no competitor offers explicitly."
**Effort:** 2-3 days (data model + engine + rendering + legend update). **Risk:** Moderate — need to correctly define "off-season" thresholds per hemisphere/resort without misclassifying a real early/late-season closure as "off-season."

### 11. Make cluster bubbles show aggregate condition, not a flat ink count
**Problem:** Cluster circles render flat ink (`#2a1f14`) regardless of the condition mix inside — at world/regional zoom (which is now every user's first view, given the two-continent spread), the map shows "here are N resorts" with zero signal about whether the region is having a good season. (`components/map/MapView.tsx` clusters Layer; data-viz + competitor + cross-domain streams all independently flag this)
**Change:** Use supercluster's `getLeaves()` to compute per-cluster condRating proportions client-side (no new query needed), and render a small multi-color donut/ring (arc lengths ∝ proportion of great/good/fair/poor/off-season) instead of the flat ink circle. Keep the count label inside.
**Why it works:** Redfin's "aggregated-metric" clusters (cross-domain stream) outperform bare-count clusters; this turns the map's default zoomed-out view into the actual "which region has the goods" answer instead of requiring zoom-in first — a strong differentiator per the competitor stream's "clustering failure pattern" finding.
**Effort:** 2-4 days (arc-donut rendering as a MapLibre layer or a custom canvas/HTML marker is the fiddly part). **Risk:** Moderate — donut rendering in pure MapLibre paint expressions is awkward; may need custom Marker components with SVG, trading some GPU perf for flexibility. Budget time for a fallback (simplest fallback: cluster color = single dominant/best condition among leaves, not full donut).

### 12. Sequential color ramp when metric = baseDepth/snow24h
**Problem:** The 3-way metric toggle only swaps the printed text; `circle-color` stays keyed to `condRating` regardless of `metric`. A dark-green "great" marker can show a low base-depth number if the rating was driven by fresh snow — color and number can visually disagree. `MapLegend` never changes to explain this. (`components/map/MapView.tsx` textFieldExpr vs circle-color paint; `components/map/MapLegend.tsx:6-11`; data-viz stream)
**Change:** When `metric !== "conditions"`, derive `circle-color` from an `["interpolate"]` sequential ramp on `baseDepth`/`snow24h` (e.g. light `#dbe6d4` → dark `#1f3322`, staying in-family with pc-forest so it still reads as brand). Make `MapLegend` metric-aware: render a small gradient bar with min/max labels in sequential modes instead of the 4 categorical swatches.
**Why it works:** Categorical vs. sequential encoding is a standard data-viz distinction (data-viz stream); fixes a real "the color answers a different question than the number" mismatch, and makes the toggle's third option actually mean something instead of being cosmetic.
**Effort:** 2-3 days. **Risk:** Low-moderate — need to pick sensible domain min/max per metric (likely per-season, since 14" base in July Chile vs July NA mean very different things) and test that the ramp remains legible against cream at both ends.

### 13. Animate the radar into a short loop, not a static frame
**Problem:** `getRadarFrames()` fetches 6 past frames plus nowcast frames — clearly built for a scrubbable timeline — but `getLatestRadarTileUrl()`, the only consumer, discards everything but the single latest frame. (`lib/weather-radar.ts:28-50` vs `:56-67`; `app/map/page.tsx:23`)
**Change:** Build a lightweight play/scrub control (even just "now / -1hr / -2hr" three-position toggle, not a full Windows-style timeline) using the frame data that's already fetched and thrown away.
**Why it works:** Competitor stream (Windy, OpenSnow) and cross-domain stream both independently identify animated radar as materially stronger than a static frame for "is the storm coming or going" — and roughly half the implementation (frame fetching) already exists unused.
**Effort:** 2-3 days (UI control + frame-cycling logic + preloading frames to avoid flicker). **Risk:** Low — purely additive; keep it toggle-gated/off-by-default per the "radar as supporting context, not default-on clutter" principle from the competitor stream.

### 14. Migrate `MapBottomSheet` off legacy tokens onto the poster system
**Problem:** `MapPopupCard.tsx` is fully migrated to poster tokens (`font-display`, `pc-eyebrow`, `text-alpen`, dashed bark rule) but `MapBottomSheet.tsx` — the component mobile users actually see, since the popup is unreachable (item 1) — is still built on legacy alias tokens (`text-text-base`, `bg-bg/60`, `text-cyan`, `text-powder`, `bg-surface2`, `border-border`), rendering correctly only by coincidence of `tailwind.config.ts` remapping. CLAUDE.md itself flags this as tech debt. (`components/map/MapBottomSheet.tsx:40-110` vs `MapPopupCard.tsx:32-84`)
**Change:** Port `MapPopupCard`'s token usage and layout language (Fraunces display, stamp-shadow card, dashed rule) into `MapBottomSheet`, since it's the component with actual production traffic.
**Why it works:** Closes the "off-brand component is what real users see" gap directly — this is arguably higher priority than most cosmetic popup work precisely because it's the one mobile users experience today.
**Effort:** 2-3 days (careful visual QA against gorhom/native-style bottom sheet expectations). **Risk:** Low-moderate — don't let the alias-layer coincidence mean visual regression is invisible in a quick check; test explicitly against both token systems removed.

### 15. Accessible fallback list + basic keyboard support for the map
**Problem:** Markers have zero keyboard/screen-reader affordance — only mouse handlers on canvas circle layers, no ARIA roles, no tabIndex, no keyboard equivalent. This isn't in the test plan at all. (`components/map/MapView.tsx:270-275`; a11y stream, multiple findings on react-map-gl/MapLibre's known lack of native a11y)
**Change:** (a) Add a hidden-but-accessible "List View" region (or reuse the existing resort grid, which is already accessible) explicitly linked from the map as the screen-reader path — "map has no native text alternative" is a documented, unfixable-at-the-library-level gap, so the fix is procedural, not a MapLibre patch. (b) Add basic keyboard support: Tab reaches map controls (zoom, radar toggle, locate), Enter/Space activates them, arrow keys pan the viewport per MapLibre's built-in `KeyboardHandler` (verify it's not disabled). (c) Ensure controls meet 44×44px touch target minimum (WCAG 2.5.8/2.5.5).
**Why it works:** A11y stream findings are consistent across sources (NVDA/JAWS/VoiceOver testing, WCAG 2.1.1/2.5.8) — this is table-stakes accessibility, not a nice-to-have, and today the grid is described as "the only accessible path to resort data," which should be made an explicit, documented fallback rather than an accidental one.
**Effort:** 2-4 days. **Risk:** Low — mostly additive; verify no focus traps introduced (a11y stream flags auto-opening popups stealing focus as a known MapLibre gotcha — relevant given item 1's popup-timing rework).

### 16. Default view: region-aware, not naive fitBounds across both hemispheres
**Problem:** Default view state is a fixed zoom 4 / lon -108 / lat 41.5 (NA-centric), and any future "zoom to fit all 148 markers" would span the antimeridian-adjacent, ocean-heavy NA+SA extent — `fitBounds()` is documented to handle such extents poorly (under/over-zoom, doesn't respect uneven marker distribution). (`lib/map-utils.ts:157-163`; cross-domain stream, citing mapbox-gl-js issues #2415/#11617)
**Change:** Default to the user's likely hemisphere/region via IP/geolocation (fits the existing "where near me" job) rather than a fixed NA-centric constant or a naive both-hemispheres fitBounds; add an explicit "view whole map" reset control for users who want the global view.
**Why it works:** Matches PeakCam's own core job ("where near me") and avoids the specific, named fitBounds failure mode the cross-domain stream surfaced.
**Effort:** 2-3 days (geolocation/IP-region detection + fallback logic + reset control). **Risk:** Moderate — needs graceful fallback for denied geolocation permission (show explanatory micro-copy before prompting, per a11y stream's permission-UX finding) and for users physically in neither hemisphere's ski regions.

### 17. Shape-based "is anything open" encoding, decoupled from the color channel
**Problem:** `liftsOpen`/`liftsTotal`/`trailsOpen`/`trailsTotal` already exist in `ResortFeatureProperties` but are entirely unrendered — every marker is one fixed circle shape regardless of open/closed status, so "is it actually open right now" is unencoded. (`lib/map-utils.ts`; `components/map/MapView.tsx` fixed `type: "circle"`; data-viz stream, citing bivariate Color×Shape separability research)
**Change:** Add a small SDF icon symbol layer (filled-mountain glyph when `liftsOpen > 0`, outline/greyed glyph when closed) layered with the existing circle, putting "open now" on shape and "how good" on color — two independent channels instead of cramming both into hue.
**Why it works:** Research on bivariate symbol maps (data-viz stream) finds Color×Shape the most separable, robust pairing for two independent categorical variables — directly buildable from data already in the properties object.
**Effort:** 3-4 days (icon asset creation matching poster brand, SDF sprite setup, paint expression wiring). **Risk:** Moderate — risk of visual clutter at small marker sizes; test legibility at 14-16px marker radius before committing.

---

## Tier 3 — Ambitious (bigger bets / redesign-level)

### 18. Rebuild the QA record from scratch against the current rebrand
**Problem:** `docs/test-plan-map-overhaul.md` is dated pre-rebrand, references dead colors and a dark-theme UI that no longer exists, and every substantive interaction section (marker-click-to-popup, filter sync, radar toggle, mobile bottom sheet, full-page map, cross-page/perf/edge-cases) is unchecked with a blank sign-off table. It creates false confidence that the map has been validated when it hasn't. (`docs/test-plan-map-overhaul.md`, multiple line ranges)
**Change:** This isn't really "ambitious" in engineering effort, but it's ambitious in scope: write and actually execute a new test plan covering filter-sync-to-map, radar toggle (both surfaces, post item 2), the full mobile bottom-sheet flow, keyboard/screen-reader paths (item 15), and performance under the current 148-resort/two-hemisphere load — and treat every item above as unverified until it's in this plan and checked with a real tester/date.
**Why it works:** This is the connective tissue that prevents the next redesign pass from repeating the same "shipped but never actually tested" pattern the audit found.
**Effort:** Ongoing process change + 3-5 days to write and execute the first real pass. **Risk:** None technically; risk is organizational (skipping it again under time pressure).

### 19. "Live snowing" pulsing ring + trend arrows as a proper animated layer
**Problem:** Item 8 covers the minimal static version; the full ambitious version is a GPU-cheap animated pulsing ring per data-viz stream's specific guidance (animate `circle-radius`/`circle-opacity` via requestAnimationFrame-updated paint properties, never `box-shadow`/`filter` which repaint every frame), plus wiring `trend_7d` into the marker/popup as a trend arrow icon.
**Change:** Build the animated layer as a second circle Layer keyed on `snowingNow`, paired always with the static "Snowing" text badge (never sole-carrier). Add `trend` to `ResortFeatureProperties` and render trend arrows in popup/sheet.
**Why it works:** Directly requested in the brief ("conditions encoding proposal" below formalizes this); data-viz stream gives concrete, tested implementation guidance to avoid perf pitfalls.
**Effort:** 1 week (animation perf tuning across desktop/mobile, respecting `prefers-reduced-motion` per a11y stream). **Risk:** Moderate — animated layers are the most likely thing to blow the mobile GPU/battery budget the a11y stream warns about (WebGL can drain 4-7W at peak); must be tested on real low-end devices and gated behind `prefers-reduced-motion` and possibly a low-battery check.

### 20. Bottom-sheet-first mobile redesign (replace hard map/grid toggle)
**Problem:** Mobile browse currently has a binary map-vs-grid toggle (once item 3's breakpoint bug is fixed) rather than a persistent, draggable resort list over a live map.
**Change:** Replace the toggle with a non-modal, draggable bottom sheet (peek: 2-3 resort cards + drag handle; half: scrollable list; full: hides map) so map context stays visible at all sheet heights except full-expand — following the Google/Apple Maps/Airbnb pattern. Build with full a11y compliance from item 15's foundation: explicit close button (not swipe-only), focus trap, Escape-to-dismiss, `aria-modal`, `prefers-reduced-motion`-respecting snap animations.
**Why it works:** Cross-domain stream identifies this as the dominant modern pattern precisely because it avoids the "map disappears entirely" cost of a hard toggle; fits PeakCam's existing stamp-card treatment naturally.
**Effort:** 1-2 weeks (new component, gesture handling, a11y compliance, replacing existing toggle + `MapBottomSheet` single-resort-detail use case, which would need to coexist or be merged with this list sheet). **Risk:** Higher — significant interaction-model change; requires real device testing across sheet-height states and gesture conflicts with map pan.

### 21. Region-based season/hemisphere framing at the information-architecture level
**Problem:** Beyond the off-season marker fix (item 10), the deeper opportunity the competitor stream flags is that no competitor handles two-hemisphere, always-in-season coverage as a first-class feature.
**Change:** Add a top-level "Peak Season" framing to the map/browse experience — not just a marker state but a filter/mode (e.g., a header toggle "Northern Hemisphere winter / Southern Hemisphere winter") that changes default zoom region, cluster emphasis, and filter defaults together, making PeakCam's global-season coverage a marketed, structural feature rather than an incidental side effect of the resort roster.
**Why it works:** Both the competitor stream ("no competitor offers this explicitly") and cross-domain stream (fitBounds/hemisphere framing) independently converge on this as differentiation-worthy.
**Effort:** 1-2 weeks (touches routing/filters/map defaults/marketing copy, not just the map component). **Risk:** Higher — this is closer to a product decision than a pure engineering task; needs product buy-in on framing before building.

---

## Conditions Encoding Proposal (color-blind-safe, brand-fit)

Keep the existing four brand hues for sighted/non-CVD users (they're load-bearing for brand identity — don't replace them), but make every channel redundant:

| State | Color (existing/proposed) | Shape/Glyph (new) | Text (existing, keep) |
|---|---|---|---|
| Great | `#3c5a3a` forest | filled circle, thick ink stroke | "Great" label, cream text |
| Good | `#6d8a4a` moss | filled circle, thick ink stroke | "Good" label, cream text |
| Fair | `#e2a740` mustard | filled circle, **thicker** ink stroke (contrast fix, item 5) | "Fair" label, ink text (unchanged) |
| Poor | `#a93f20` rust | filled circle, thick ink stroke | "Poor" label, cream text |
| **Off-season/closed (new)** | `#b59b74` bark-50 (desaturated, hue-neutral) | **outline-only ring, no fill** — visually distinct silhouette, not just a paler dot | "Closed"/"Off-season" label |
| Snowing now (overlay) | unchanged base color | **pulsing ink-ringed halo** (item 19) | "Snowing" text badge, always paired |
| Open/closed lifts (overlay, item 17) | unchanged base color | filled-mountain icon (open) vs. outline-mountain icon (closed) | trails/lifts open count in popup |
| Sequential metrics (base depth / 24h snow, item 12) | single-hue ramp `#dbe6d4`→`#1f3322` (forest family) | none needed — ramp is legend-anchored | numeric label + gradient legend bar |

This gives every critical distinction at least two channels (color + shape, or color + text), satisfies WCAG 1.4.1, and specifically separates the off-season state onto a hue-neutral color + distinct silhouette so it can never visually collapse into "poor" for CVD users the way great/good/fair/poor's green→yellow→red-orange range currently risks doing.

---

## What NOT To Do

- **Don't switch map engines.** MapLibre + react-map-gl + supercluster is well within capability for 148 points; deck.gl/WebGL-tier rendering is over-engineering at this scale (cross-domain stream: the clustering "ceiling" is in the thousands-to-millions range).
- **Don't make radar the default-on, primary visual.** Every competitor that leads with weather-first UI (OpenSnow, Windy) does so at the cost of resort-conditions clarity; keep radar toggle-off by default, subordinate to condition markers (also fixes item 6's z-order).
- **Don't auto-open popups on map load** — MapLibre's keyboard handler has documented focus-stealing issues when popups auto-open, causing unexpected scroll/tab-order problems (a11y stream).
- **Don't treat "showing a legend" as sufficient accessibility** — color-only encoding fails ~8% of male users regardless of whether a legend exists elsewhere; every critical map distinction needs a non-color channel on the marker itself, not just in a side panel.
- **Don't let the metric toggle stay cosmetic.** Shipping a 3-way toggle where 2 of 3 options only relabel a fixed-color dot actively undercuts user trust once they notice the color doesn't move — either wire real sequential color (item 12) or reduce the toggle to what it actually does.
- **Don't reuse rating-palette hues for anything else** (favorites, selection state, open/closed) — Zillow's own documented critique (cross-domain stream) is that its saved-heart red is too close to its default listing red, hurting discoverability; any new marker state (off-season, favorited, snowing) needs a genuinely distinct hue or shape, not a tint of an existing rating color.
- **Don't ship new interaction work without updating the test plan.** The existing plan's blank sign-off table already proves this failure mode once; treat "add to test plan and execute" as part of the definition of done for any map change.
- **Don't build the bottom-sheet mobile redesign (item 20) before fixing the underlying `MapBottomSheet` token debt (item 14) and popup contradiction (item 1)** — redesigning the interaction shell around a component that's both off-brand and racing a competing popup will just relocate the bug.
---

## Critic's Additions & Corrections (post-synthesis review)

A rigor/completeness pass flagged three overstated claims (corrected here) and six well-evidenced, PeakCam-specific opportunities the 21-item report missed. These are as high-value as much of Tier 1/2.

### Corrections to claims above
- **Item 11** — "Redfin's aggregated-metric clusters *outperform* count clusters": the source only distinguishes the two taxonomies and notes Redfin exposes a metric on hover; there's no comparative/performance evidence. Treat aggregated clusters as a *reasonable pattern*, not a proven winner.
- **Item 10** — the "no competitor offers hemisphere/season toggling" advantage is supported by the *competitor* stream only, not the cross-domain stream (which only discussed fitBounds across the antimeridian). Still a real differentiator; just single-sourced.
- **Item 1** — Airbnb's click→sync pattern is about hover-highlight + scroll-card-into-view *within its own list*; it does not establish "avoid full navigation to a detail page." The popup-vs-navigate fix stands on its own merits (the dead-code race), independent of that framing.

### Missed opportunities (add to the backlog — mostly Tier 1/low-Tier 2)
- **[HIGH] Webcam-on-map integration** — the product is named *PeakCam*, `camCount` is already a rendered field, yet no item touches webcams on the map. Competitor stream explicitly recommends clickable pins with a live thumbnail / "LIVE" badge, summit-cam priority, and the "one view = conditions + map + webcam + radar" dashboard pattern. This is the most on-brand gap in the whole report. **~Tier 2.**
- **[HIGH] Data-freshness / "updated Xh ago" on pin hover** — competitor stream ties this directly to PeakCam's own documented live-data-drift problem; transparency about freshness builds trust vs. competitors who hide it. Cheap, high-trust. **~Tier 1.**
- **One-tap "Show great/good only" condition filter** — competitor stream calls this PeakCam's potential *killer feature* (it's literally the core user job). Report only proposed an in-season filter, not a rating filter. **~Tier 1.**
- **`cooperativeGestures: true` on the browse sidebar map** — one-line a11y-stream fix to stop accidental map-pan hijacking vertical list scroll. **Tier 1.**
- **camCount-driven marker radius** — radius is currently spent only on hover state; the data-viz stream names it as an idle encoding slot (bigger dot = more cams). **Tier 1–2.**
- **Brand-fit topo-line skeleton loading state** — cross-domain stream: a static topo placeholder tile doubles as an on-brand perceived-performance win during map init. **Tier 1.**

### Reprioritizations (pulled out of bigger items as standalone quick wins)
- **Port the existing `GeolocateControl` to the sidebar map** — it already works on `/map`; adding it to the sidebar is a Tier-1 port, not part of item 16's 2–3 day IP-geolocation feature.
- **Single-dominant-color clusters** — item 11's own footnote fallback (cluster = best/dominant condition among leaves) fixes the "flat ink cluster" problem at a fraction of the donut-rendering cost; worth shipping first as its own low-Tier-2 item.
- **Touch-target (44×44px) + keyboard-handler enablement** — item 15's CSS/config sub-parts are Tier-1-caliber and shippable in hours, separate from the hidden-list-view a11y architecture.
