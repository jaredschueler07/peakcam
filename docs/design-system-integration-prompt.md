# Design System Integration Task

## Context

We are on branch `feat/design-system`. The PeakCam design system (retro ski-poster aesthetic) has been delivered by Claude Design and lives at `docs/design-system/`. The key files are:

- `docs/design-system/tokens.css` — all CSS custom properties (colors, fonts, radii, shadows, grain texture)
- `docs/design-system/Components.html` — full component specimen page (buttons, chips, cards, nav, cam-tile, stickers, voice)
- `docs/design-system/README.md` — design direction, palette, type, voice

## Design System Summary

**Aesthetic**: 70s/80s retro ski-poster nostalgia — chunky humanist display type, thick strokes, flat color fills, layered topo lines, badge shapes, hand-stamped feel.

**Palette** (earth + snow):
- Background: `--pc-cream` (#f1e7cf) — cream paper
- Text: `--pc-ink` (#2a1f14) — ink-stamp black-brown
- Primary: `--pc-forest` (#3c5a3a) — forest green
- Accent: `--pc-alpen` (#d9552f) — persimmon/alpenglow
- Secondary: `--pc-mustard` (#e2a740) — mustard gold
- Conditions: great=forest, good=moss(#6d8a4a), fair=mustard, poor=alpen-dk

**Typography**:
- Display: `Fraunces` (weight 500/700/900, optical sizing) — for all headings, stats, hero text
- Body: `DM Sans` (weight 400/500/600/700) — for all UI text
- Mono: `JetBrains Mono` (weight 500/700) — for data readouts, state chips, eyebrows

**Signature effects**:
- Hard "stamp" shadow: `3px 3px 0 var(--pc-ink)` — pins controls to the paper
- Pill borders: `border-radius: 999px` for buttons and chips
- Topo background: `repeating-radial-gradient` concentric contour lines
- Paper grain: SVG fractalNoise texture overlay

## What to Implement

### 1. `app/globals.css`
Replace the current dark Summit Light CSS variables with the `--pc-*` tokens from `docs/design-system/tokens.css`. Keep the existing animation keyframes and MapLibre overrides but update their colors to match the new palette. Add the paper/topo background utilities.

### 2. `tailwind.config.ts`
Remap all color/font/shadow/radius tokens to the new design system values:
- Replace dark palette colors with earth tones
- Replace Bebas Neue with Fraunces for `font-display`
- Replace Inter with DM Sans for `font-sans`
- Add stamp shadow variants
- Update condition colors to great/good/fair/poor earth tones

### 3. `app/layout.tsx`
- Replace `Inter` + `Bebas_Neue` font imports with `Fraunces` + `DM_Sans` from `next/font/google`
- Keep `JetBrains_Mono` (already loaded)
- Update CSS variable names to `--font-fraunces` and `--font-dm-sans`

### 4. `components/ui/Button.tsx`
Restyle to the `pc-btn` pattern:
- Base: white bg, ink border, stamp shadow, pill radius, 700 weight
- Primary variant: forest green bg, cream text
- Accent variant: alpen bg, cream text  
- Ghost variant: transparent, no shadow
- Hover: translate(-1px,-1px) + larger stamp shadow
- Active: translate(2px,2px) + smaller stamp shadow

### 5. `components/ui/Badge.tsx`
Restyle condition chips to `pc-chip` pattern:
- great: forest bg, cream text
- good: moss (#6d8a4a) bg, cream text
- fair: mustard bg, ink text
- poor: alpen-dk bg, cream text
- State chips: ink bg, cream text, mono font

### 6. `components/layout/Header.tsx`
Restyle to the dark ink navbar from the design system:
- Background: `--pc-ink` (dark brown-black)
- Logo: `PEAK` in cream + `CAM` in alpen, Fraunces display font, italic
- Nav links: cream text, alpen active state, pill hover
- Search input: cream bg, ink border, stamp shadow, pill radius

### 7. `components/home/PeakHero.tsx`
Apply the poster aesthetic:
- Background: cream paper with topo lines (`pc-topo` class)
- Headline: Fraunces 900 weight, massive, ink color with alpen italic accent
- Subhead: DM Sans body
- CTA buttons: use new pc-btn patterns
- Remove dark gradient overlays, replace with paper texture

### 8. `components/browse/SummitResortCard.tsx`
Restyle to the `cam-tile` card pattern from the design system:
- Card: cream-50 bg, ink border, stamp shadow, 18px radius
- Resort name: Fraunces 900, 24px
- Region: DM Sans 13px, bark color
- Stats grid: 4-col, dashed bark border top/bottom, mono numbers
- Footer: condition chip + ghost compare button
- Preserve all existing data props and logic

## Important Notes

- **Do NOT break existing functionality** — all data fetching, Supabase queries, auth, favorites, and map logic must remain intact
- **Preserve TypeScript types** — no type changes needed
- **Use `next/font/google`** for font loading (already the pattern in layout.tsx)
- **MapLibre popup overrides** in globals.css should be updated to use cream/ink colors instead of dark navy
- After each file, run `npx tsc --noEmit` to check for type errors
- Commit each logical group of changes with a descriptive message following the Co-Authored-By convention

## Superpowers

Use the superpowers plugin for any browser preview or visual verification tasks.

## Commit Convention

```
feat: apply PeakCam design system — [component/area]

[description of what changed]

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```
