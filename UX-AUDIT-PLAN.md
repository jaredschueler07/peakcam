# PeakCam UX Audit — Execution Plan

> **Purpose:** This document is an actionable engineering plan. Each task maps a UX finding to a specific file, describes the current problem, and provides the exact code change to make. Assign each task group to an agent.
>
> **How to use:** `Read UX-AUDIT-PLAN.md, create an agent team with team create to execute the full plan.`

---

## Agent 1 — Hero & Navigation Fixes (P1-1, P1-2, P1-5)

### Task 1.1 — Add overlay navigation to the hero
- **File:** `components/home/PeakHero.tsx`
- **Problem:** The hero is `h-screen` with no navigation. The `<Header>` only renders inside `<BrowsePage>`, which sits below the hero in `app/page.tsx`. First-time visitors see zero nav links.
- **Change:** Import `Link` from `next/link` and add a transparent overlay nav bar inside PeakHero's outer div, above the content div. Position it with `absolute top-0 left-0 right-0 z-20 px-7 py-4 flex items-center justify-between`. Render the PEAKCAM logo on the left and key nav links (Resorts, Map, Compare, Snow Report, Sign In) on the right. Use `text-text-base/70 hover:text-text-base` for link styling. Do NOT import the full Header component — keep it lightweight and transparent.

### Task 1.2 — Add a product description below the tagline
- **File:** `components/home/PeakHero.tsx`
- **Problem:** "Real conditions. No marketing noise." is a differentiator, not a description. New visitors don't know what PeakCam does.
- **Change:** After the existing `<motion.p>` tagline element, add a second `<motion.p>` with:
  - Text: `Live webcams + real-time snow reports for 128+ ski resorts across North America.`
  - Classes: `text-base text-text-base/60 mb-16 max-w-xl mx-auto`
  - Animation: `initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }}`
- Also remove the `mb-16` from the tagline `<motion.p>` and replace with `mb-4`.

### Task 1.3 — Fix hero CTA and subtitle contrast
- **File:** `components/home/PeakHero.tsx`
- **Problem:** CTA button uses `bg-text-base/10` and `border-text-base/30` — nearly invisible on the dark mountain image. Subtitle uses `text-text-subtle` (#8AA3BE) which is too low contrast. Animation starts at `opacity: 0` making content fully invisible during load.
- **Changes:**
  1. CTA button: change `bg-text-base/10` → `bg-text-base/20`, change `border-text-base/30` → `border-text-base/50`, add `backdrop-blur-lg`
  2. Subtitle: change `text-text-subtle` → `text-text-base/80`
  3. Hero title animation: change `initial={{ opacity: 0, y: 40 }}` → `initial={{ opacity: 0.3, y: 20 }}` so the text is never fully invisible

### Verification
- Load `localhost:3000` and confirm: nav links visible on hero, product description visible, CTA button clearly readable, subtitle legible against mountain image.

---

## Agent 2 — Search & Filter UX Fixes (P1-3, P2-10, P3-15, P4-18)

### Task 2.1 — Eliminate dual search bars
- **File:** `components/browse/BrowsePage.tsx`
- **Problem:** BrowsePage renders its own `<Header />` (which includes a search bar) AND a second full-width search input in the filter section below. Both search the same data. Two search bars confuse users.
- **Change:** On the `<Header />` call inside BrowsePage (around line 310 area, inside the return JSX), add `showSearch={false}`:
  ```tsx
  <Header showSearch={false} />
  ```
  This keeps the in-content search (which is better positioned alongside filter chips) and removes the redundant nav bar search. The Header component already supports this prop.

### Task 2.2 — Add tooltips to state filter chips
- **File:** `components/browse/BrowsePage.tsx`
- **Problem:** State filter chips show only 2-letter abbreviations (AZ, BC, CO…) with no full names. International users or casual visitors won't recognize all codes.
- **Change:** Add a state name lookup map at the top of the file:
  ```tsx
  const STATE_NAMES: Record<string, string> = {
    AZ: "Arizona", BC: "British Columbia", CA: "California", CO: "Colorado",
    ID: "Idaho", MA: "Massachusetts", MD: "Maryland", ME: "Maine",
    MI: "Michigan", MN: "Minnesota", MT: "Montana", NH: "New Hampshire",
    NM: "New Mexico", NV: "Nevada", NY: "New York", OR: "Oregon",
    PA: "Pennsylvania", UT: "Utah", VA: "Virginia", VT: "Vermont",
    WA: "Washington", WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
  };
  ```
  Then update the `FilterChip` component to accept an optional `title` prop and pass it to the underlying `<button>`. In the state chip mapping, pass `title={STATE_NAMES[s] ?? s}`.

### Task 2.3 — Improve map toggle discoverability
- **File:** `components/browse/BrowsePage.tsx`
- **Problem:** The "Hide map" / "Show map" button is a small text button at the far right of the search row, easy to miss. The map takes ~25% of viewport width.
- **Change:** Move the map toggle button from the search row into the filter chips row, next to the Sort controls (at the `ml-auto` div). Use a compact icon-only button with a map icon and tooltip. Change the default: `const [showMap, setShowMap] = useState(false)` so the map is hidden by default — users who want it can toggle it on, and the resort grid gets the full 3-column layout.

### Task 2.4 — Increase filter chip touch targets
- **File:** `components/browse/BrowsePage.tsx` (FilterChip component)
- **Problem:** FilterChip uses `px-4 py-2` yielding ~34px height. WCAG recommends minimum 44px touch targets.
- **Change:** In the FilterChip component, change the className from `px-4 py-2` to `px-4 py-2.5 min-h-[44px]`. This matches the pattern already used in ConditionVoter.tsx buttons.

### Verification
- Load homepage, confirm only ONE search bar visible (the full-width one in the filter section).
- Hover over state chips and confirm full state names appear as tooltips.
- Confirm map is hidden by default and toggle button is visible near Sort controls.
- Inspect filter chip height — should be ≥44px.

---


## Agent 3 — Resort Detail Page Fixes (P1-4, P2-6, P2-7)

### Task 3.1 — Auto-load first webcams instead of requiring click
- **File:** `components/resort/ResortDetailPage.tsx` (CamPlayer component)
- **Problem:** Image cams initialize with `loaded=false`, showing a "Click to load snapshot" placeholder. This hides PeakCam's core value prop behind an unnecessary click.
- **Change:** The CamPlayer component currently does:
  ```tsx
  const [loaded, setLoaded] = useState(cam.embed_type !== "image");
  ```
  YouTube/iframe cams already auto-load. For image cams, add an `index` prop to CamPlayer and auto-load the first 2:
  ```tsx
  // In CamPlayer function signature, add index param:
  function CamPlayer({ cam, resortSlug, index = 99 }: { cam: Cam; resortSlug: string; index?: number }) {
    const [loaded, setLoaded] = useState(cam.embed_type !== "image" || index < 2);
  ```
  Then in the grid rendering where CamPlayer is called, pass the index:
  ```tsx
  {activeCams.map((cam, i) => (
    <div key={cam.id}>
      <CamPlayer cam={cam} resortSlug={resort.slug} index={i} />
  ```
  This auto-loads the first 2 image cams while lazy-loading the rest.

### Task 3.2 — Consolidate the two report forms
- **Files:** `components/resort/ConditionVoter.tsx`, `components/resort/UserConditionsForm.tsx`, `components/resort/ResortDetailPage.tsx`
- **Problem:** Two separate forms appear on every resort page — ConditionVoter ("How's it skiing?" — anonymous, snow+comfort) and UserConditionsForm ("Submit a Report" — auth required, snow+visibility+wind+trail). They use conflicting snow quality taxonomies: ConditionVoter has "crud" and "spring"; UserConditionsForm has "icy" and "slush".
- **Change:** In ResortDetailPage.tsx, wrap both forms in a single `<section>` with one heading. Rename ConditionVoter's heading from "How's it skiing?" to "Quick Conditions Vote" and add a subtitle: "Anonymous — no sign-in required." Rename UserConditionsForm heading to "Detailed Conditions Report" and add subtitle: "Sign in for a full report with visibility, wind, and trail conditions." This differentiates purpose without requiring a full data model merge. Also align the snow quality options: add "crud" and "spring" to UserConditionsForm's snowOptions OR replace ConditionVoter's "crud"/"spring" with "icy"/"slush" — pick one taxonomy and use it in both.

### Task 3.3 — Add sign-in value proposition hints
- **Files:** `components/layout/Header.tsx`, `components/resort/ResortDetailPage.tsx`
- **Problem:** The "Sign in" button and favorite hearts give no indication of what an account unlocks.
- **Changes:**
  1. In `Header.tsx`, add `title="Sign in to save favorites, set powder alerts, and submit reports"` to the Sign In `<Link>` element.
  2. In `ResortDetailPage.tsx`, on the non-authed favorite heart button, change the `title` from `"Add to favorites"` to `"Sign in to save favorites"`.
  3. Below the ConditionVoter component, add a subtle prompt for non-authed users:
     ```tsx
     {!user && (
       <p className="text-text-muted text-xs text-center mt-2">
         <Link href="/auth" className="text-cyan hover:underline">Sign in</Link> to save favorites and get powder alerts.
       </p>
     )}
     ```

### Verification
- Load a resort page (e.g., `/resorts/alta`). Confirm first 2 webcam images load automatically.
- Confirm both report forms have clear, differentiated headings and consistent snow quality options.
- Hover over "Sign in" in nav — tooltip should appear. Hover heart icon when logged out — should say "Sign in to save favorites."

---


## Agent 4 — Compare, Snow Report & Engagement Fixes (P2-8, P2-9, P3-12, P3-13, P3-14)

### Task 4.1 — Add suggested comparisons to the Compare empty state
- **File:** `components/compare/ComparePage.tsx`
- **Problem:** Empty state shows a skier emoji and "No resorts selected" with no suggestions or preview of what a comparison looks like.
- **Change:** Replace the empty state block (around line 397, the `resorts.length === 0` conditional) with a richer empty state that includes 2-3 pre-built comparison suggestions. Use the `allResorts` prop to find interesting pairs:
  ```tsx
  {resorts.length === 0 && (
    <div className="text-center py-16">
      <div className="text-5xl mb-4">⛷</div>
      <h2 className="text-text-base font-semibold text-xl mb-2">No resorts selected</h2>
      <p className="text-text-muted text-sm mb-8">
        Search above to add resorts, or try a popular comparison:
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {[["alta", "snowbird"], ["jackson-hole-mountain-resort", "big-sky-resort"], ["vail", "breckenridge"]].map(([a, b]) => {
          const ra = allResorts.find(r => r.slug === a);
          const rb = allResorts.find(r => r.slug === b);
          if (!ra || !rb) return null;
          return (
            <button key={`${a}-${b}`}
              onClick={() => { addResort(ra); addResort(rb); }}
              className="px-4 py-2.5 bg-surface2 border border-border hover:border-cyan/50 rounded-lg text-text-subtle hover:text-cyan text-sm transition-colors">
              {ra.name} vs {rb.name}
            </button>
          );
        })}
      </div>
    </div>
  )}
  ```
  Adjust the slug pairs to match actual slugs in the database. If a pair doesn't resolve, it won't render (the `if (!ra || !rb) return null` handles this).

### Task 4.2 — Promote the Powder Alert CTA
- **File:** `components/browse/BrowsePage.tsx`
- **Problem:** PowderAlertSignup is a small pill button at the far right of the section header. It's one of the best retention hooks but gets zero visual emphasis.
- **Change:** Move `<PowderAlertSignup resorts={resorts} />` from the section header row into its own inline banner between `<FeaturedRow>` and `<PowderAlert>`. Wrap it in a styled container:
  ```tsx
  <div className="flex items-center justify-between gap-4 px-5 py-4 bg-surface border border-border rounded-lg mb-8">
    <div>
      <p className="text-text-base font-semibold text-sm">Never miss a powder day</p>
      <p className="text-text-muted text-xs">Get email alerts when your resorts hit your snow threshold.</p>
    </div>
    <PowderAlertSignup resorts={resorts} />
  </div>
  ```

### Task 4.3 — Add context to "Today's Top Conditions" ranking
- **File:** `components/browse/BrowsePage.tsx` (FeaturedRow component)
- **Problem:** All 4 featured resorts show "FAIR" and users don't understand the ranking logic.
- **Change:** Add a subtitle below the h2 heading:
  ```tsx
  <p className="text-text-muted text-sm mb-4">
    Ranked by condition rating and recent snowfall
  </p>
  ```

### Task 4.4 — Conditionally hide empty Snow Report columns
- **File:** `components/snow-report/SnowReportPage.tsx`
- **Problem:** "% Normal" and "Trend" columns show dashes for every resort when data isn't populated, wasting space.
- **Change:** Add two useMemo checks at the top of the component:
  ```tsx
  const hasPctNormal = useMemo(() => resorts.some(r => r.snow_report?.pct_of_normal != null), [resorts]);
  const hasTrend = useMemo(() => resorts.some(r => r.snow_report?.trend_7d != null), [resorts]);
  ```
  Then wrap the `% Normal` `<th>` and corresponding `<td>` cells with `{hasPctNormal && (...)}`. Same for `Trend` with `{hasTrend && (...)}`.

### Task 4.5 — Fix page title duplication
- **File:** `app/snow-report/page.tsx` (and check other page files)
- **Problem:** Browser tab shows "... | PeakCam | PeakCam" — the brand suffix appears twice.
- **Change:** Check `app/layout.tsx` for a `metadata.title.template` that appends "| PeakCam". If present, remove the "| PeakCam" suffix from the title in `app/snow-report/page.tsx` and any other page-level metadata that includes it manually. The template should handle the suffix consistently.

### Verification
- Visit `/compare` with no resorts — confirm suggested comparisons appear and are clickable.
- Visit homepage — confirm powder alert banner is visible between featured row and resort grid.
- Visit `/snow-report` — confirm empty columns are hidden. Check browser tab title has "PeakCam" only once.

---


## Agent 5 — Footer, Accessibility & Polish (P3-11, P4-16, P4-17)

### Task 5.1 — Flesh out the footer
- **File:** `components/home/PeakFooter.tsx`
- **Problem:** Footer exists but is sparse. Resources only has Resorts and Snow Reports. Company only has About. No privacy policy, terms, social links, or secondary CTAs.
- **Change:** Add links to the existing sections:
  - **Resources:** Add "Compare" (`/compare`), "Map" (`/map`), "Powder Alerts" (`/alerts/manage`)
  - **Company:** Add "Privacy Policy" (`/about#privacy`), "Terms of Service" (`/about#terms`), "Contact" (`mailto:hello@peakcam.io`)
  - **Brand column:** Add social media icon links below the description paragraph. Use simple SVG icons for Instagram, X (Twitter), and any other PeakCam socials. Use `text-text-muted hover:text-cyan` styling.
  - **Bottom bar:** Add a small inline powder alert signup nudge: "Get powder alerts →" as a Link to `/alerts/manage`.

### Task 5.2 — Add accessible labels to icon-only elements
- **File:** `components/browse/SummitResortCard.tsx`
- **Problem:** Camera icon + count and trend indicators have no accessible labels. Screen readers get no context.
- **Changes:**
  1. On the camera count container div, add `role="img"` and `aria-label`:
     ```tsx
     <div className="flex items-center gap-1 text-text-subtle"
          role="img" aria-label={`${camCount} webcam${camCount !== 1 ? 's' : ''} available`}>
     ```
  2. On the TrendBadge `<span>`, add `role="img"` and `aria-label={`7-day trend: ${cfg.label}`}` (it already has a title, but aria-label is better for screen readers).
  3. On the outlook indicator span, add `role="img"` and `aria-label={outlookConfig[outlook].label}`.

### Task 5.3 — Add skip-to-content link
- **File:** `app/layout.tsx`
- **Problem:** No skip navigation link exists. Keyboard users must tab through the full nav on every page.
- **Change:** As the very first child inside the `<body>` tag, add:
  ```tsx
  <a href="#main-content"
     className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100]
                focus:px-4 focus:py-2 focus:bg-cyan focus:text-bg focus:rounded-lg focus:text-sm focus:font-semibold">
    Skip to main content
  </a>
  ```
  Then add `id="main-content"` to the main content wrapper in each page. For `app/page.tsx`, add it to the fragment's first meaningful section (the `<PeakHero>` wrapper or a new `<main>` element). For other pages, add it to the content div inside each page component.

### Verification
- Tab through the page with keyboard — skip link should appear on first Tab press and jump to content.
- Use a screen reader (or browser accessibility inspector) on a resort card — confirm camera count and trend read correctly.
- Check footer has all new links and they navigate correctly.

---


## Execution Order & Dependencies

Agents can run **in parallel** — there are no cross-agent dependencies. Each agent touches different files.

| Agent | Files Modified | Estimated Scope |
|-------|---------------|-----------------|
| Agent 1 | `PeakHero.tsx` | 3 changes to 1 file |
| Agent 2 | `BrowsePage.tsx` | 4 changes to 1 file |
| Agent 3 | `ResortDetailPage.tsx`, `ConditionVoter.tsx`, `UserConditionsForm.tsx`, `Header.tsx` | 3 changes across 4 files |
| Agent 4 | `ComparePage.tsx`, `BrowsePage.tsx`, `SnowReportPage.tsx`, `snow-report/page.tsx` | 5 changes across 4 files |
| Agent 5 | `PeakFooter.tsx`, `SummitResortCard.tsx`, `layout.tsx` | 3 changes across 3 files |

**Note:** Agents 2 and 4 both touch `BrowsePage.tsx`. Agent 2 modifies the Header call, FilterChip, and map toggle. Agent 4 modifies the PowderAlertSignup placement and FeaturedRow subtitle. These are in different sections of the file and should not conflict, but if running in parallel, merge carefully.

## Quick Wins (do these first if time-constrained)

1. **Task 2.1** — Add `showSearch={false}` to Header. One prop change, instant UX improvement.
2. **Task 1.3** — Fix hero contrast. Two class changes in PeakHero.tsx.
3. **Task 3.1** — Auto-load first 2 webcams. One useState change in CamPlayer.

These three changes are the highest ROI per line of code changed.

## Files Reference

```
components/
  home/
    PeakHero.tsx          — Agent 1 (hero nav, description, contrast)
    PeakFooter.tsx        — Agent 5 (footer links)
  layout/
    Header.tsx            — Agent 3 (sign-in tooltip)
  browse/
    BrowsePage.tsx        — Agent 2 (search, filters, chips) + Agent 4 (alert CTA, featured row)
    SummitResortCard.tsx  — Agent 5 (aria labels)
  resort/
    ResortDetailPage.tsx  — Agent 3 (cam autoload, form consolidation, sign-in hints)
    ConditionVoter.tsx    — Agent 3 (snow quality taxonomy alignment)
    UserConditionsForm.tsx — Agent 3 (snow quality taxonomy alignment)
  compare/
    ComparePage.tsx       — Agent 4 (empty state suggestions)
  snow-report/
    SnowReportPage.tsx    — Agent 4 (conditional columns)
app/
  layout.tsx              — Agent 5 (skip link)
  snow-report/page.tsx    — Agent 4 (title dedup)
```
