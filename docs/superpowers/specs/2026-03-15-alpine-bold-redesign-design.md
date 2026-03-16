# Alpine Bold UI Redesign — Design Spec

**Date**: 2026-03-15
**Goal**: Replace AI-generated-looking UI with a bold, modern sport aesthetic using warm contrast colors.

## Problem Statement

The current PeakCam UI exhibits telltale signs of AI-generated design:
- Uniform card grid with identical sizing and spacing
- Generic cyan-on-navy dark theme (the default LLM palette)
- No visual hierarchy — everything has equal weight
- Single font family (Inter) with uniform sizing
- Gradient glows and rounded borders that feel like a component library demo
- No brand personality or design opinion

## Design Direction

**Personality**: Bold / Modern Sport (Slopes, Strava, Arc'teryx digital)
**Color**: Warm contrast — dark backgrounds with amber/burnt orange/gold
**Density**: Cards with breathing room, stronger hierarchy, variable sizing

---

## 1. Color System

### Strategy: Value replacement, NOT token rename

**Important**: We keep the existing Tailwind token names (`cyan`, `powder`, `snow`, etc.) but change their hex values. This avoids a massive class-name refactor across every file. The token names become semantic aliases rather than color descriptions — which is fine since `cyan` is "primary accent" and `powder` is "highlight accent." Code references like `text-cyan`, `bg-cyan/10`, `border-cyan` all stay the same in the source — only the resolved color changes.

### Tokens to update in `tailwind.config.ts` and `globals.css`

| Token | Current | New | Notes |
|-------|---------|-----|-------|
| `bg` | `#070B11` (blue-black) | `#0c0c0e` (true dark) | Neutral, not blue-tinted |
| `surface` | `#0C1220` (navy) | `#161618` (warm charcoal) | Slightly warm |
| `surface2` | `#111928` (dark navy) | `#1e1e20` (mid charcoal) | Card backgrounds |
| `surface3` | `#172035` (blue-gray) | `#282828` (light charcoal) | Hover states |
| `border` | `#1E2D47` (blue border) | `#2a2826` (warm border) | Subtle, warm |
| `border-hi` | `#2A3F5F` (bright blue) | `#3d3a36` (warm highlight) | Hover borders |
| `cyan` | `#22D3EE` | `#e08a3a` (burnt amber) | Primary accent — token name stays |
| `cyan-dim` | `#0A2A35` | `#2a1f14` | Accent background |
| `cyan-mid` | `#0E3D4D` | `#3d2a18` | Mid accent |
| `powder` | `#22D3EE` | `#f5c542` (gold) | Snow/highlight accent |
| `good` | `#60A5FA` (blue) | `#4ade80` (green) | Good conditions |
| `snow.DEFAULT` | `#BAE6FD` (light blue) | `#f5c542` (gold) | Snow data accent |
| `snow.dim` | `#0C2034` | `#2a2210` | Snow data background |
| `text-base` | `#F1F5F9` (cool white) | `#e8e6e3` (warm off-white) | Primary text |
| `text-subtle` | `#94A3B8` (cool gray) | `#a8a4a0` (warm gray) | Secondary text |
| `text-muted` | `#64748B` (blue-gray) | `#7a7775` (warm muted) | Tertiary text |

### Semantic colors (kept as-is)
- `success`: `#34D399` — no change
- `warning`: `#FBBF24` — no change
- `danger`/`poor`: `#F87171` — no change

### Condition colors (warmed backgrounds)
- `great`: keep `powder` token value (`#f5c542`) — condition badge bg: `#2a2210`
- `good`: `#4ade80` (green) — condition badge bg: `#142a18`
- `fair`: `#fbbf24` (amber) — condition badge bg: `#2a2210`
- `poor`: `#f87171` (red) — condition badge bg: `#2a1414`

Note: `great` condition and `powder` token intentionally share the same hex value (`#f5c542`).

### Remove from tailwind config
- `shadow-cyan-glow` — no more colored glow effects
- `shadow-card-hover` (old) — replaced with dark shadow version
- `bg-cyan-gradient` background image — no more gradients
- `purple` color token — unused in new palette

### Add to tailwind config
- `shadow-card-hover`: `0 4px 20px rgba(0,0,0,0.5)` — simple dark shadow, no color
- `shadow-card-lift`: `0 8px 30px rgba(0,0,0,0.6)` — stronger lift on featured cards

### hero-gradient update
Replace `bg-hero-gradient` value from `linear-gradient(180deg, #111928 0%, #070B11 100%)` to `linear-gradient(180deg, #1e1e20 0%, #0c0c0e 100%)` (surface2 → bg, using new values).

---

## 2. Typography

### Font loading approach
Use CSS `@import` in `globals.css` (matching existing pattern — Inter is loaded this way already). Do NOT use `next/font/google` to avoid mixing two font loading methods.

```css
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
```

Replace the existing Inter-only import.

### Tailwind config
```
fontFamily: {
  heading: ["Barlow Condensed", "sans-serif"],
  sans: ["DM Sans", "Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
}
```

### Application
- Page titles (`h1`): `font-heading text-3xl md:text-4xl font-bold uppercase tracking-wide`
- Section headers (`h2`): `font-heading text-xl font-semibold uppercase tracking-wider`
- Card titles: `font-sans text-[15px] font-semibold` (stays body font)
- Data numbers: `font-sans tabular-nums font-bold`
- Body text: `font-sans` (default)

### globals.css body font
Update to: `font-family: 'DM Sans', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;`

---

## 3. Header (`components/layout/Header.tsx`)

### Changes
- **Logo**: Replace gradient mountain emoji box with text-only bold logo:
  `PEAK` in `text-text-base font-heading font-bold tracking-wider text-lg` + `CAM` in `text-cyan font-heading font-bold tracking-wider text-lg`
  Remove: the `div` with gradient bg, shadow glow, and emoji. Replace with a simple `span`.
- **Search input**: Replace `focus:border-cyan focus:shadow-[0_0_0_3px_rgba(34,211,238,0.1)]` with `focus:border-cyan focus:bg-surface3` (no ring glow, simple border color change). The `focus:border-cyan` stays because the token value will resolve to amber now.
- **Nav links**: Active state uses `text-cyan` instead of `text-text-base bg-surface3`. Remove background pill on active. Just color change.
- **Border bottom**: Keep `border-b border-border` — new warm border color applies automatically.

---

## 4. Browse Page (`components/browse/BrowsePage.tsx`)

### Page header section
- Title: `BROWSE RESORTS` using `font-heading uppercase tracking-wider`
- Subtitle count remains the same

### Featured row (new)
- Above the main grid, add a "Featured" row showing top 3 resorts by condition or fresh snow
- Featured cards: wider (span `sm:col-span-2`), slightly taller, show more data
- Only show if there are resorts with conditions data
- Section label: `TOP CONDITIONS` in `font-heading text-sm uppercase tracking-widest text-text-muted`

### Search input focus states
- Replace `focus:border-cyan focus:ring-1 focus:ring-cyan/30` with `focus:border-cyan` only (no ring glow). The token value change handles the color automatically.

### Filter bar
- Chip active states auto-update via token value change (no class changes needed)
- Sort buttons: same — `bg-cyan/10 border-cyan/40 text-cyan` auto-resolves to amber

### Resort cards
- **Snow depth bar**: Replace `bg-gradient-to-r from-cyan to-powder` with solid `bg-cyan`
- **Hover**: Replace `hover:shadow-glow` with `hover:shadow-card-hover` (dark shadow, no color)
- **Focus ring**: `focus-visible:ring-cyan` auto-resolves to amber
- **"Clear all filters" button**: `text-cyan` auto-resolves to amber
- **Data blocks**: `text-powder` and `text-cyan` auto-resolve to gold and amber
- **Card title hover**: `group-hover:text-cyan` auto-resolves to amber
- All other styles auto-update via token value changes

### Powder Alert banner
- All `text-cyan`, `bg-cyan/10`, `border-cyan/30`, `text-powder` auto-resolve via token changes

### Map sidebar
- No changes to Leaflet map tile layer (stays CartoDB dark)
- Leaflet CSS overrides update in `globals.css` (see section 8)

---

## 5. Resort Detail Page (`components/resort/ResortDetailPage.tsx`)

### Hero section
- Title: add `font-heading uppercase tracking-wide`
- Back link: `hover:text-cyan` auto-resolves to amber
- Condition badge: auto-resolves via Badge.tsx changes
- "Resort site" button: `hover:text-cyan` auto-resolves

### Snow report cards
- `text-powder` and `text-cyan` auto-resolve to gold and amber
- Fix: `text-cyan-dim` on "48h New Snow" (line 136) — this is a background color being used as text. Replace with `text-text-subtle` since it's the least-prominent stat.

### Weather strip
- `text-powder` snow indicator auto-resolves to gold

### Cam player
- Play button: `bg-cyan/10 border-cyan/30 text-cyan` auto-resolve to amber
- Link-out cam card: remove `hover:shadow-glow`, replace with `hover:shadow-card-hover`
- Link-out icon: `group-hover:border-cyan group-hover:text-cyan` auto-resolve
- Cam name text: `group-hover:text-cyan` auto-resolves (line 38)
- "View all on resort site" link: `hover:text-cyan` auto-resolves (line 268)
- Inline "View on resort website" link: `text-cyan` auto-resolves (line 280)

### Footer nav
- `hover:text-cyan` auto-resolves

---

## 6. UI Components

### Badge.tsx (`components/ui/Badge.tsx`)
- `great` condition: change from `bg-cyan-dim border border-cyan-400/20 text-cyan-400` to `bg-snow-dim border border-powder/20 text-powder` (uses snow-dim bg token `#2a2210`, powder token `#f5c542`)
- `good` condition: change from `bg-blue-950/40 border border-blue-400/20 text-blue-400` to `bg-[#142a18] border border-good/20 text-good`
- `fair` condition: change from `bg-yellow-950/40 border border-yellow-400/20 text-yellow-400` to `bg-[#2a2210] border border-fair/20 text-fair`
- `poor` condition: change from `bg-red-950/40 border border-red-400/20 text-red-400` to `bg-[#2a1414] border border-poor/20 text-poor`
- Dot colors: `great` → `bg-powder`, `good` → `bg-good`, `fair` → `bg-fair`, `poor` → `bg-poor`

### Chip.tsx (`components/ui/Chip.tsx`)
- Active state: `border-cyan-400/30 bg-cyan-dim text-cyan shadow-cyan-glow` → remove `shadow-cyan-glow` class. Rest auto-resolves via token changes.
- Active dot: `bg-cyan` auto-resolves

### Button.tsx (`components/ui/Button.tsx`)
- `primary` variant: `bg-cyan-dim border border-cyan-400/30 text-cyan hover:bg-cyan-mid hover:shadow-cyan-glow active:scale-[0.98]`
  → Remove `hover:shadow-cyan-glow`. All `cyan-dim`, `cyan-400`, `text-cyan`, `cyan-mid` auto-resolve via token changes.
  → Result: `bg-cyan-dim border border-cyan/30 text-cyan hover:bg-cyan-mid active:scale-[0.98]`
- `ghost` and `outline` variants: no changes needed (use surface/border/text tokens that auto-resolve)

### Modal.tsx (`components/ui/Modal.tsx`)
- No class changes needed — uses `surface2`, `surface3`, `border`, `border-hi`, `text-muted`, `text-base` which all auto-resolve via token value changes.
- Verify visually: dark overlay (`bg-black/88`) against warmer surface colors should look fine.

---

## 7. 404 Page (`app/resorts/[slug]/not-found.tsx`)

- Title: add `font-heading uppercase`
- "Browse all resorts" link: `text-cyan` auto-resolves to amber
- Suggestion cards: `hover:text-cyan` — add this hover color to card links

---

## 8. ResortMap.tsx (`components/browse/ResortMap.tsx`)

### Hardcoded hex values (must update — cannot rely on CSS token changes)

**`markerColor()` function** (lines 20-28):
Replace hardcoded hex values:
- `#64748B` → `#7a7775` (text-muted equivalent)
- `#22D3EE` → `#e08a3a` (cyan/accent equivalent)
- `#BAE6FD` → `#f5c542` (powder/gold equivalent)
- `#7DD3FC` → `#c9a84c` (mid-tone warm) — fair depth color
- `#94A3B8` → `#a8a4a0` (text-subtle equivalent)

**Marker inline styles** (lines 96-106):
- `box-shadow` glow color updates automatically since it uses the `color` variable from `markerColor()`.

**Tooltip inline styles** (lines 117-121):
- `color:#22D3EE` → `color:#e08a3a`
- `color:#94A3B8` → `color:#a8a4a0`
- `color:#BAE6FD` → `color:#f5c542`

**Container background** (line 142):
- `background: "#070B11"` → `background: "#0c0c0e"`

---

## 9. Leaflet Map Styles (`globals.css`)

Update all Leaflet dark overrides:
- `.leaflet-container` background: `#0c0c0e`
- `.leaflet-popup-content-wrapper` background: `#1e1e20`, border: `#3d3a36`
- `.leaflet-popup-tip` background: `#1e1e20`
- `.leaflet-popup-content` color: `#e8e6e3`
- `.leaflet-popup-close-button` color: `#7a7775`
- `.leaflet-control-zoom a` background: `#1e1e20`, color: `#e8e6e3`, border: `#2a2826`
- `.leaflet-control-zoom a:hover` background: `#282828`
- Remove Leaflet font-family overrides (will inherit from body)

---

## 10. globals.css Root Variables

Replace all `:root` CSS custom properties with new warm values:
```css
:root {
  --bg:          #0c0c0e;
  --surface:     #161618;
  --surface2:    #1e1e20;
  --surface3:    #282828;
  --border:      #2a2826;
  --border-hi:   #3d3a36;
  --cyan:        #e08a3a;
  --cyan-dim:    #2a1f14;
  --cyan-mid:    #3d2a18;
  --snow:        #f5c542;
  --text-base:   #e8e6e3;
  --text-subtle: #a8a4a0;
  --text-muted:  #7a7775;
  --success:     #34D399;
}
```

---

## 11. Removed Elements

- All `shadow-cyan-glow` box shadow references (Button.tsx primary variant, Chip.tsx active state)
- All `hover:shadow-glow` references (BrowsePage.tsx cards, ResortDetailPage.tsx link-out cams)
- `bg-cyan-gradient` background image from tailwind config
- `purple` color token from tailwind config
- Mountain emoji and gradient box from Header logo
- `focus:ring-cyan/30` ring effects from search inputs (keep `focus:border-cyan` only)

---

## Files Changed

1. `tailwind.config.ts` — Color palette values, font families, shadows, remove gradient/glow/purple
2. `app/globals.css` — Root variables, font imports (Barlow Condensed + DM Sans), Leaflet overrides, body font
3. `app/layout.tsx` — No changes needed (fonts loaded via CSS, not next/font)
4. `components/layout/Header.tsx` — Logo (text-only), search focus, nav active states
5. `components/browse/BrowsePage.tsx` — Featured row, snow depth bar solid color, search focus, section headings typography
6. `components/resort/ResortDetailPage.tsx` — Hero heading typography, fix `text-cyan-dim` bug, remove `hover:shadow-glow`
7. `components/ui/Badge.tsx` — Condition badge backgrounds (use project tokens instead of Tailwind built-in colors)
8. `components/ui/Chip.tsx` — Remove `shadow-cyan-glow` from active state
9. `components/ui/Button.tsx` — Remove `hover:shadow-cyan-glow` from primary variant, use `cyan/30` instead of `cyan-400/30`
10. `components/ui/Modal.tsx` — No code changes, verify visually
11. `app/resorts/[slug]/not-found.tsx` — Add heading typography
12. `components/browse/ResortMap.tsx` — Update all hardcoded hex values in markerColor(), tooltip HTML, and container background

## Out of Scope

- Layout restructuring beyond featured row addition
- New pages or routes (note: `/snow-report` and `/about` routes don't exist yet)
- Backend/data changes
- Map tile provider changes
- Responsive breakpoint changes
