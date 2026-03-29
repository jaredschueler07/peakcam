# PeakCam UX Audit V2 — Execution Plan

> **Purpose:** Post-implementation review of the V1 UX audit uncovered 9 new findings. This plan provides actionable code changes for each, structured for Claude Code agent teams.
>
> **How to use:** `Read UX-AUDIT-PLAN-V2.md, create an agent team with team create to execute the full plan.`

---

## Agent 1 — Compare Page Bugs (P0-1, P0-2, P3-7)

### Task 1.1 — Fix raw `||` delimiter leaking into CONDITIONS row
- **File:** `components/compare/ComparePage.tsx`
- **Problem:** The conditions cell in the comparison grid displays the raw `snow.conditions` string, which contains a `||` delimiter separating tags from narrative text (e.g., `Standard Conditions||Expect breezy conditions today.`). The resort detail page's `ConditionsStrip` component correctly splits on `||`, but the compare page does not.
- **Change:** In the `statRows` array, find the `CONDITIONS` entry (around the area where stat rows are defined). Currently it does:
  ```tsx
  display: r.snow_report?.conditions ?? r.cond_rating?.toUpperCase() ?? "—",
  ```
  Replace with logic that strips the `||` format:
  ```tsx
  display: (() => {
    const raw = r.snow_report?.conditions;
    if (!raw) return r.cond_rating?.toUpperCase() ?? "—";
    if (raw.includes("||")) {
      const [, narrative] = raw.split("||");
      return narrative || raw;
    }
    return raw;
  })(),
  ```
  This extracts just the narrative portion for the compare cell. The tags are redundant here since the condition badge is already shown in the column header.

### Task 1.2 — Suppress "best" highlighting when the best value is 0 or all values are equal
- **File:** `components/compare/ComparePage.tsx`
- **Problem:** The `isBestHigh` helper returns true when `value === Math.max(...valid)`, even when the max is 0. This causes both resorts to show cyan + ▲ for 0" snow, which is misleading — there's nothing "best" about zero snowfall.
- **Change:** Update the `isBestHigh` function to exclude zero and ties-at-zero:
  ```tsx
  function isBestHigh(value: number | null, allValues: (number | null)[]): boolean {
    if (value === null) return false;
    const valid = allValues.filter((v): v is number => v !== null);
    if (valid.length < 2) return false;
    const max = Math.max(...valid);
    if (max === 0) return false; // Nothing is "best" at zero
    const countAtMax = valid.filter(v => v === max).length;
    if (countAtMax === valid.length) return false; // All tied — no winner
    return value === max;
  }
  ```
  Apply the same pattern to `isBestLow` — suppress when all values are equal:
  ```tsx
  function isBestLow(value: number | null, allValues: (number | null)[]): boolean {
    if (value === null) return false;
    const valid = allValues.filter((v): v is number => v !== null);
    if (valid.length < 2) return false;
    const min = Math.min(...valid);
    const countAtMin = valid.filter(v => v === min).length;
    if (countAtMin === valid.length) return false; // All tied — no winner
    return value === min;
  }
  ```

### Task 1.3 — Add fallback cam thumbnails for non-YouTube resorts
- **File:** `components/compare/ComparePage.tsx`
- **Problem:** The `ResortColumnHeader` component tries to render a YouTube thumbnail via `getFirstYoutubeCam()`. For resorts with only image-type cams (like Alta and Snowbird), this returns null, leaving a blank empty box with just a camera icon and "N cams" text.
- **Change:** Update `ResortColumnHeader` to fall back to the first active image cam:
  ```tsx
  function getFirstCamThumbnail(resort: ResortWithData) {
    // Prefer YouTube thumbnail
    const ytCam = resort.cams.find((c) => c.embed_type === "youtube" && c.youtube_id);
    if (ytCam) return { type: "youtube" as const, url: `https://img.youtube.com/vi/${ytCam.youtube_id}/mqdefault.jpg` };
    // Fall back to image cam URL
    const imgCam = resort.cams.find((c) => c.embed_type === "image" && c.embed_url && c.is_active);
    if (imgCam) return { type: "image" as const, url: imgCam.embed_url! };
    return null;
  }
  ```
  Then update `ResortColumnHeader` to use this new function instead of `getFirstYoutubeCam`, rendering the thumbnail for both types:
  ```tsx
  const thumb = getFirstCamThumbnail(resort);
  // ... in the JSX:
  {thumb ? (
    <Link href={`/resorts/${resort.slug}`} tabIndex={-1}>
      <img src={thumb.url} alt={`${resort.name} webcam`} className="w-full h-full object-cover" />
      ...
    </Link>
  ) : (
    // existing fallback with camera icon
  )}
  ```

### Verification
- Visit `/compare?resorts=alta,snowbird` — CONDITIONS row should show narrative text without `||`. Snow values at 0" should NOT show cyan highlighting. Cam thumbnails should show actual cam snapshots.
- Try comparing two resorts with different base depths — confirm only the higher one gets cyan + ▲.

---

## Agent 2 — Hero Mobile Nav Fix (P1-3, P1-4)

### Task 2.1 — Add mobile hamburger menu to PeakHero overlay nav
- **File:** `components/home/PeakHero.tsx`
- **Problem:** The hero overlay nav uses `hidden md:flex` on the nav links, which hides them below the `md` breakpoint. But there is no hamburger menu alternative. On mobile, users see only the PEAKCAM logo and have no way to navigate until they scroll past the hero to the BrowsePage Header.
- **Change:** Add a mobile hamburger toggle. Import `Menu` and `X` from `lucide-react` and add state:
  ```tsx
  import { Menu, X } from "lucide-react";
  // Inside PeakHero component (must convert to use useState — it's currently a simple functional component):
  const [menuOpen, setMenuOpen] = useState(false);
  ```
  After the `hidden md:flex` nav links div, add a mobile toggle button:
  ```tsx
  <button
    className="md:hidden text-text-base/70 hover:text-text-base transition-colors"
    onClick={() => setMenuOpen(!menuOpen)}
    aria-label="Toggle menu"
  >
    {menuOpen ? <X size={24} /> : <Menu size={24} />}
  </button>
  ```
  Then add a mobile dropdown panel below the nav bar (still inside the `<nav>` or as a sibling):
  ```tsx
  {menuOpen && (
    <div className="absolute top-full left-0 right-0 bg-bg/95 backdrop-blur-md border-b border-text-base/10 p-4 flex flex-col gap-3 md:hidden z-20">
      <Link href="/resorts" className="text-text-base/80 hover:text-text-base py-2 transition-colors" onClick={() => setMenuOpen(false)}>Resorts</Link>
      <Link href="/map" className="text-text-base/80 hover:text-text-base py-2 transition-colors" onClick={() => setMenuOpen(false)}>Map</Link>
      <Link href="/compare" className="text-text-base/80 hover:text-text-base py-2 transition-colors" onClick={() => setMenuOpen(false)}>Compare</Link>
      <Link href="/snow-report" className="text-text-base/80 hover:text-text-base py-2 transition-colors" onClick={() => setMenuOpen(false)}>Snow Report</Link>
      <Link href="/auth" className="text-cyan font-semibold py-2 transition-colors" onClick={() => setMenuOpen(false)}>Sign In</Link>
    </div>
  )}
  ```

### Task 2.2 — Add "Sign In" link to the desktop hero overlay nav
- **File:** `components/home/PeakHero.tsx`
- **Problem:** The desktop hero nav shows Resorts, Map, Compare, Snow Report, About — but no Sign In link. First-time visitors on the hero see no auth entry point until they scroll down to the sticky Header.
- **Change:** In the `hidden md:flex` nav links section, either replace the "About" link with "Sign In" or add "Sign In" as an additional link after "About". Use a slightly differentiated style to make it stand out as a CTA:
  ```tsx
  <Link href="/auth" className="text-text-base/90 hover:text-text-base font-semibold border border-text-base/30 rounded-full px-4 py-1.5 transition-all hover:border-text-base/60">
    Sign In
  </Link>
  ```
  Keep the "About" link if space allows — it's a reasonable navigation target. The key is that Sign In must be present.

### Task 2.3 — Share nav links between PeakHero and Header to prevent drift
- **File:** Create a shared constant, or add to an existing shared file like `lib/constants.ts` or top of `components/layout/Header.tsx`
- **Problem:** PeakHero and Header maintain separate hardcoded arrays of nav links. If one gets updated and the other doesn't, they'll drift out of sync.
- **Change:** Extract the public nav links into a shared constant:
  ```tsx
  // In lib/nav-links.ts (new file) or at top of Header.tsx as an export:
  export const PUBLIC_NAV_LINKS = [
    { label: "Resorts", href: "/" },
    { label: "Map", href: "/map" },
    { label: "Compare", href: "/compare" },
    { label: "Snow Report", href: "/snow-report" },
    { label: "About", href: "/about" },
  ] as const;
  ```
  Import and use this in both PeakHero.tsx (for the overlay nav) and Header.tsx (for the navLinks array, keeping authOnly items as additions). This way both components always render the same public links.

### Verification
- On mobile viewport (≤768px), the hero should show a hamburger icon. Tapping it reveals a dropdown with all nav links + Sign In.
- On desktop, "Sign In" is visible in the hero overlay nav alongside the other links.
- Confirm the links match between hero overlay and the sticky Header.

---

## Agent 3 — Snow Report & Browse Polish (P2-5, P2-6, P3-8, P3-9)

### Task 3.1 — Conditionally hide empty Trails and Lifts columns in Snow Report
- **File:** `components/snow-report/SnowReportPage.tsx`
- **Problem:** The % Normal and Trend columns are correctly hidden when no data exists (using `hasPctNormal`/`hasTrend`), but the same logic was not applied to Trails Open and Lifts Open. Currently every resort shows "—" for both columns, wasting horizontal space.
- **Change:** Add two more `useMemo` checks alongside the existing ones:
  ```tsx
  const hasTrails = useMemo(() => resorts.some(r => r.snow_report?.trails_open != null), [resorts]);
  const hasLifts = useMemo(() => resorts.some(r => r.snow_report?.lifts_open != null), [resorts]);
  ```
  Then wrap the Trails `<th>` and corresponding `<td>` with `{hasTrails && (...)}`, and the Lifts `<th>` and `<td>` with `{hasLifts && (...)}`. Follow the exact same pattern already used for `hasPctNormal` and `hasTrend`.

### Task 3.2 — Reduce filter chip visual overwhelm
- **File:** `components/browse/BrowsePage.tsx`
- **Problem:** The sticky filter bar renders 35+ interactive elements in 2 rows: 24 state abbreviation chips + feature chips + condition chips + sort buttons + map toggle. This is cognitively overwhelming.
- **Change:** Group the state chips behind a collapsible section. Replace the inline state chip row with a two-step approach:
  1. Show a "States" dropdown button that toggles a panel:
  ```tsx
  const [showStates, setShowStates] = useState(false);
  ```
  2. Render a compact trigger button:
  ```tsx
  <button
    onClick={() => setShowStates(v => !v)}
    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 min-h-[44px] text-sm font-medium border cursor-pointer select-none transition-colors duration-200 whitespace-nowrap ${
      stateFilter !== "All"
        ? "bg-cyan/20 border-cyan/50 text-cyan"
        : "bg-text-base/10 border-text-base/20 text-text-subtle hover:bg-text-base/20"
    }`}
  >
    <MapPin size={14} />
    {stateFilter === "All" ? "All States" : `${stateFilter} — ${STATE_NAMES[stateFilter] ?? stateFilter}`}
    <ChevronDown size={14} className={`transition-transform ${showStates ? "rotate-180" : ""}`} />
  </button>
  ```
  3. Render the full state chips grid in a collapsible panel below the filter row:
  ```tsx
  {showStates && (
    <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border">
      <FilterChip label="All" active={stateFilter === "All"} onClick={() => { setStateFilter("All"); setShowStates(false); }} />
      {availableStates.map((s) => (
        <FilterChip key={s} label={s} active={stateFilter === s}
          onClick={() => { setStateFilter(stateFilter === s ? "All" : s); setShowStates(false); }}
          title={STATE_NAMES[s] ?? s} />
      ))}
    </div>
  )}
  ```
  Import `MapPin` and `ChevronDown` from `lucide-react`. This collapses 24+ chips into a single button, dramatically reducing the filter bar height and cognitive load.

### Task 3.3 — Suppress featured row when no resort rates "Good" or above
- **File:** `components/browse/BrowsePage.tsx` (FeaturedRow component)
- **Problem:** All four "Today's Top Conditions" cards show FAIR with 0" new snow during end-of-season. The ranking is technically correct but visually hollow and undermines trust.
- **Change:** In the `FeaturedRow` component, add a quality gate after the sort:
  ```tsx
  const featured = useMemo(() => {
    const sorted = resorts
      .filter((r) => r.snow_report && r.cond_rating)
      .sort((a, b) => {
        const condDiff = (CONDITION_ORDER[a.cond_rating] ?? 99) - (CONDITION_ORDER[b.cond_rating] ?? 99);
        if (condDiff !== 0) return condDiff;
        return (b.snow_report?.new_snow_24h ?? 0) - (a.snow_report?.new_snow_24h ?? 0);
      })
      .slice(0, 4);
    // Only show featured row if at least one resort is "good" or better
    const hasGoodOrBetter = sorted.some(r => r.cond_rating === "great" || r.cond_rating === "good");
    return hasGoodOrBetter ? sorted : [];
  }, [resorts]);
  ```
  This way the featured row disappears gracefully during off-season rather than showcasing mediocre conditions.

### Task 3.4 — Remove duplicate favorite button from resort cards
- **File:** `components/browse/SummitResortCard.tsx`
- **Problem:** Each resort card renders BOTH a heart icon (bottom-right in the data strip, via `onToggleFavorite`) AND a star `FavoriteButton` component (top-right absolute positioned). These are two different favorite mechanisms on the same card, which is confusing.
- **Change:** Remove the top-right `FavoriteButton` overlay. Delete this block from the end of the card (just before the closing `</div>` of the outer card div):
  ```tsx
  {/* Favorite Button (top right, on top of everything) */}
  <div className="absolute top-3 right-3 z-50">
    <FavoriteButton itemId={resort.id} itemType="resort" />
  </div>
  ```
  Keep the heart button in the data strip row (bottom-right, alongside the camera count), as it's contextually placed and uses the card's toggle callback. Also remove the `FavoriteButton` import if it's no longer used elsewhere in the file.

### Verification
- Visit `/snow-report` — confirm Trails and Lifts columns are hidden when all values are dashes.
- Visit homepage — filter bar should show a single "All States" dropdown button instead of 24 inline chips. Feature, condition, and sort controls remain inline.
- If all resorts are FAIR or worse, the "TODAY'S TOP CONDITIONS" section should not appear.
- Resort cards should have only ONE favorite button (the heart in the bottom-right data strip).

---

## Execution Order & Dependencies

Agents can run **in parallel** — there are minimal cross-agent dependencies.

| Agent | Files Modified | Estimated Scope |
|-------|---------------|-----------------|
| Agent 1 | `ComparePage.tsx` | 3 changes to 1 file |
| Agent 2 | `PeakHero.tsx`, `Header.tsx` (or new `lib/nav-links.ts`) | 3 changes across 2-3 files |
| Agent 3 | `SnowReportPage.tsx`, `BrowsePage.tsx`, `SummitResortCard.tsx` | 4 changes across 3 files |

**Note:** Agent 3 touches `BrowsePage.tsx` (filter collapse + featured row gate) and `SummitResortCard.tsx` (duplicate button removal). These are independent sections and should not conflict with each other.

## Quick Wins (do these first if time-constrained)

1. **Task 1.1** — Fix `||` delimiter in compare CONDITIONS. One string operation, instant visual fix.
2. **Task 1.2** — Fix zero-value "best" highlighting. Two function updates, removes misleading UI.
3. **Task 3.4** — Remove duplicate favorite button. Delete one JSX block, eliminates user confusion.

These three changes are the highest ROI per line of code changed.

## Files Reference

```
components/
  compare/
    ComparePage.tsx         — Agent 1 (conditions format, best highlighting, cam thumbnails)
  home/
    PeakHero.tsx            — Agent 2 (mobile hamburger, sign-in link, shared nav)
  layout/
    Header.tsx              — Agent 2 (shared nav links import)
  browse/
    BrowsePage.tsx          — Agent 3 (filter collapse, featured row gate)
    SummitResortCard.tsx    — Agent 3 (duplicate favorite removal)
  snow-report/
    SnowReportPage.tsx      — Agent 3 (conditional Trails/Lifts columns)
lib/
  nav-links.ts (new)        — Agent 2 (shared nav link constant)
```
