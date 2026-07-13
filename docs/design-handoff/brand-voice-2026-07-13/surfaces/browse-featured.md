# Surface — Browse featured + conditions header

**Live component:** `components/browse/BrowsePage.tsx`  
- `FeaturedRow` — “Today’s Top”  
- Section header — “Today’s conditions”  
- Optional `SouthernSeasonBanner`  
- Powder alert pills  

---

## Featured row

### ★ Copy

```
[eyebrow]  TODAY'S TOP
[headline] Best right now.
[sub]      Ranked by condition rating and recent snowfall.
```

Alternates for headline: `Looking solid.` · `Worth the drive.`

### Image / design objects

- Card chrome: cream-50, ink border, stamp shadow (existing system)  
- Optional photo texture behind cards: `images/05-card-texture-vintage.jpg`  
- Do not put “Got the goods” on this strip  

### Card content hierarchy (existing, keep)

1. State chip (mono) — may show `Chile` / `Argentina` full words  
2. Resort name (Fraunces) — must wrap long Spanish names e.g. *Nevados de Chillán*  
3. Condition chip  
4. Base / 24h / Runs stats  

---

## Conditions section header

```
[eyebrow]  REAL-TIME · {filtered} of {total}
[headline] Today's conditions.
```

“conditions” can stay alpenglow italic (existing pattern).

---

## Southern Hemisphere banner

```
[eyebrow]  SOUTHERN HEMISPHERE · IN SEASON NOW
[body]     Chile & Argentina are live — {N} Andes resorts with
           cams and snow reports.
[actions]  [Chile] [Argentina]   ← same FilterChip pattern
```

Images: not required; if illustration needed use `13-dual-hemisphere.jpg` small or abstract topo `08`.

---

## Powder day strip

Keep **Pow day** as mono badge + resort links with `+N"`.  
Do not rebrand to lifestyle slogans.

---

## Search placeholder

```
Search {N} resorts…
```

Dynamic count only — never hardcode 128/147.
