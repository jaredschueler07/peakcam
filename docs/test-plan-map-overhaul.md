# Map Overhaul — Manual Test Plan

**Tester:** Antigravity
**Branch:** `feat/map-overhaul`
**Date:** 2026-03-22
**Setup:** `npm run dev` → `localhost:3000`

---

## Pre-Flight

- [ ] Pull branch `feat/map-overhaul`
- [ ] Confirm `.env.local` has `NEXT_PUBLIC_MAPTILER_KEY=guCHrtCSAe1r8NgZ4BY5`
- [ ] Run `npm install && npm run dev`
- [ ] Open Chrome DevTools (Console tab visible for errors)

---

## 1. Browse Page — Sidebar Map (`/`)

### 1.1 Map Loads
- [x] Navigate to `localhost:3000`
- [x] Scroll down past hero to the resort grid section
- [x] Sidebar map should be visible on the right (desktop only, `lg:` breakpoint)
- [x] Map shows **dark terrain tiles with visible mountain relief** (not flat black)
- [x] No console errors related to MapLibre or tiles
- [x] Map attribution visible in bottom-right corner

### 1.2 Resort Markers
- [x] Colored circle markers appear for all resorts
- [x] Marker colors match condition ratings:
  - Green (`#2ECC8F`) = Great
  - Cyan/blue (`#60C8FF`) = Good
  - Muted blue (`#8AA3BE`) = Fair
  - Red (`#f87171`) = Poor
- [x] Markers are clickable (cursor changes to pointer on hover)

### 1.3 Hover Sync (Card ↔ Map)
- [x] Hover over a resort card in the grid → corresponding map marker should enlarge and get a white border
- [x] Hover over a map marker → verify it highlights (larger, white stroke)
- [x] Move mouse off → marker returns to normal size

### 1.4 Marker Click → Popup
- [ ] Click a marker on the map
- [ ] Map flies/zooms to the clicked resort
- [ ] Dark-themed popup appears with:
  - Resort name + region/state
  - Condition badge (colored pill)
  - Snow stats grid (base depth, 24h, trails)
  - Cam count
  - "View Resort →" link
- [ ] Popup close button (×) works
- [ ] Click "View Resort →" → navigates to `/resorts/[slug]`

### 1.5 Zoom Labels
- [x] Zoom in to level 6+ → data labels appear above markers (base depth numbers)
- [x] Zoom in to level 8+ → resort names appear below markers
- [x] Labels don't overlap excessively (allow-overlap is off)

### 1.6 Filter Sync
- [ ] Click a state filter chip (e.g. "CO") → map markers update to show only Colorado resorts
- [ ] Map auto-zooms/fits to show the filtered set
- [ ] Click "All" → all markers return, map zooms back out
- [ ] Apply "Fresh Snow" filter → only resorts with 8"+ show on map
- [ ] Apply condition filter (e.g. "Great") → markers update
- [ ] Clear all filters → all markers return

### 1.7 Map Controls
- [x] Zoom +/- buttons work (top-right)
- [x] Compass control visible → click to reset north
- [x] Scale bar visible (bottom-left)

### 1.8 Metric Toggle
- [x] Top-left overlay shows 3 buttons: "Base Depth" / "24h Snow" / "Condition"
- [x] "Base Depth" is selected by default (cyan highlight)
- [x] Click "24h Snow" → active style changes, data labels update at zoom 6+
- [x] Click "Condition" → labels show condition rating text
- [x] Click back to "Base Depth" → returns to default

### 1.9 Radar Toggle
- [ ] Radar button visible below metric toggle
- [ ] Click "Radar OFF" → button changes to "Radar ON" with orange/alpenglow styling
- [ ] Semi-transparent weather radar overlay appears on map (precipitation patterns)
- [ ] Click again → radar turns off, overlay disappears
- [ ] If no radar data available, button should not appear (graceful handling)

### 1.10 Map Toggle
- [ ] "Hide map" button in the filter bar → map sidebar disappears
- [ ] Resort grid expands to full width
- [ ] "Show map" → sidebar returns

---

## 2. Full-Page Map (`/map`)

### 2.1 Navigation
- [ ] Click "Map" in the header nav bar → navigates to `/map`
- [ ] Full-viewport map fills the screen (no header, no scrollbar)
- [ ] "← Resorts" back link visible in top-left area
- [ ] Click "← Resorts" → returns to `/`

### 2.2 Map Features
- [ ] Same terrain tiles, markers, and popups as sidebar map
- [ ] Geolocate button appears (top-right, below zoom controls) — not present in sidebar
- [ ] Click geolocate → browser asks for location permission (if granted, map centers on user)
- [ ] All markers clickable with fly-to + popup behavior
- [ ] Metric toggle and radar toggle work same as sidebar

### 2.3 Popup → Resort Navigation
- [ ] Click a marker → popup appears
- [ ] Click "View Resort →" → navigates to `/resorts/[slug]`
- [ ] Use browser back → returns to `/map`

---

## 3. Mobile Testing (resize to <1024px or use device)

### 3.1 Browse Page Mobile
- [ ] Resize browser to mobile width (<1024px)
- [ ] Map sidebar should be **hidden** (map is desktop-only on browse page)
- [ ] Resort cards display in single column
- [ ] All filters still work

### 3.2 Full-Page Map Mobile (`/map`)
- [ ] Navigate to `/map` at mobile width
- [ ] Map fills viewport, markers visible
- [ ] Tap a marker → **bottom sheet** slides up from bottom (not a popup)
- [ ] Bottom sheet shows:
  - Drag handle bar at top
  - Resort name + region/state
  - Condition badge
  - 4-column snow stats (base, 24h, 48h, trails)
  - "View Resort" button (cyan) + Cams button
- [ ] Tap backdrop (dark overlay behind sheet) → sheet dismisses
- [ ] Tap "View Resort" → navigates to resort detail page
- [ ] Map is still interactive behind the bottom sheet (can pan)

### 3.3 Touch Interactions
- [ ] Pinch-to-zoom works on map
- [ ] Two-finger pan works
- [ ] Single-finger pan moves the map (not page scroll)

---

## 4. Header Nav

- [ ] "Map" link appears in header nav between "Resorts" and "Compare"
- [ ] Active state: "Map" text turns cyan when on `/map`
- [ ] All other nav links still work (Resorts, Compare, Snow Report, About)

---

## 5. Cross-Page Smoke Tests

These verify nothing else broke during the migration.

### 5.1 Resort Detail (`/resorts/[any-slug]`)
- [ ] Pick any resort from browse page, click through
- [ ] Page loads with snow report, weather forecast, cams
- [ ] No console errors about Leaflet or missing modules
- [ ] "All Resorts" back link works

### 5.2 Compare Page (`/compare`)
- [ ] Navigate to Compare → page loads
- [ ] Can add resorts to compare

### 5.3 Snow Report (`/snow-report`)
- [ ] Navigate → table loads with resort data

### 5.4 About (`/about`)
- [ ] Navigate → page loads

---

## 6. Performance Checks

- [ ] Open DevTools → Network tab
- [ ] On `/map`, map tiles load without 4xx/5xx errors
- [ ] No "Failed to load resource" errors for MapTiler URLs
- [ ] Map is smooth when panning/zooming (no jank — WebGL rendering)
- [ ] On `/`, browse page loads in <3s (map doesn't block page render)

---

## 7. Edge Cases

- [ ] Reload `/map` directly (not navigated from `/`) → page loads correctly
- [ ] Rapidly click multiple markers → popups transition cleanly, no stacking
- [ ] Zoom all the way out → markers don't pile up unreadably
- [ ] Zoom all the way in on a single resort → terrain detail visible

---

## Bug Report Template

If something fails, note:

```
**What:** [what you clicked/did]
**Expected:** [what should happen]
**Actual:** [what happened instead]
**Screenshot:** [attach if visual]
**Console errors:** [paste any red text from DevTools]
**Browser/viewport:** [e.g. Chrome 120, 1440x900 or iPhone 15 Pro]
```

---

## Sign-Off

| Area | Pass/Fail | Notes |
|------|-----------|-------|
| Sidebar map loads | | |
| Terrain tiles visible | | |
| Marker colors correct | | |
| Hover sync works | | |
| Click popup works | | |
| Zoom labels appear | | |
| Filters update map | | |
| Metric toggle works | | |
| Radar toggle works | | |
| Full-page /map works | | |
| Mobile bottom sheet | | |
| Nav links correct | | |
| No regressions | | |
| Performance OK | | |

**Tester:** _______________  **Date:** _______________
