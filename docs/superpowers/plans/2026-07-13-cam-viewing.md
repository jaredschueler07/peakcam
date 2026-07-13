# Cam Viewing Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop showing dead cams (auto-disable with recovery), make image feeds feel live (freshness badge, hidden-tab pause, placeholder fallback), add a keyboard-navigable lightbox on resort pages, and close the SA cam-coverage gaps (Pillán + 3 cam-light resorts + 5 unverified sets).

**Architecture:** Backend: two new tracking columns on `cams` + a pure, unit-tested state-transition function wired into the existing daily `cam-health-check.mjs`. Frontend: extract the embed rendering out of `CamPlayer` into a shared `CamEmbed` (gaining the image-cam polish), add a `CamLightbox` modal consuming the same component. Data: one research pass, CSV appends, importer run.

**Tech Stack:** Postgres (Supabase, hand-applied migrations), Node zero-dep scripts (node:test), Next.js 16 / React 19 client components, Tailwind v4 poster tokens.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-13-cam-viewing-design.md` — all design decisions there are settled; do not reopen them.
- Migrations applied by hand via Supabase MCP `apply_migration` (project `owsxnogvufankayfwczl`); no Supabase CLI.
- Tests: node's built-in `node:test`; `.mjs` scripts tested via `node --test`, TS via `npx tsx --test`. No new test frameworks.
- New components use the poster design tokens (`pc-*` utilities, `cream-*`/`ink`/`bark`/`alpen` palette, `shadow-stamp`, `font-mono` readouts) — never the legacy alias tokens (`bg-surface`, `text-cyan`, …), even though surrounding `ResortDetailPage` code still uses them.
- Auto-disable threshold is **3 consecutive failed checks**; recovery is automatic on the first success **only when `auto_disabled=true`**. Manually-disabled cams are untouched.
- Image-cam refresh cadence: **30s in tiles, 15s in the lightbox**; refresh fully paused while `document.hidden`.
- `scripts/cam-health-check.mjs` currently has NO module-level execution guard; if the test file imports it, guard `main()` with the same `import.meta.url` pattern used in `scripts/import-resorts-standalone.mjs` (added there for exactly this reason).

---

### Task 1: Migration 014 + `Cam` type fields

**Files:**
- Create: `supabase/migrations/014_cam_health_tracking.sql`
- Modify: `lib/types.ts` (the `Cam` interface, currently lines 31-42)

**Interfaces:**
- Produces: `cams.consecutive_failures` (integer, not null, default 0), `cams.auto_disabled` (boolean, not null, default false); TS `Cam` gains `consecutive_failures: number; auto_disabled: boolean;`.

- [ ] **Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────────────────────
-- Migration 014 — cam health tracking
-- Adds the failure-count state that lets cam-health-check.mjs
-- auto-disable dead cams (3 consecutive failed daily checks) and
-- auto-recover them on the next success. auto_disabled distinguishes
-- script-disabled cams (safe to auto-re-enable) from manually
-- disabled ones (never touched by the script).
-- ─────────────────────────────────────────────────────────────

alter table cams add column if not exists consecutive_failures integer not null default 0;
alter table cams add column if not exists auto_disabled boolean not null default false;
```

- [ ] **Step 2: Apply live** via MCP `apply_migration` (name `014_cam_health_tracking`), then verify: `select column_name, column_default from information_schema.columns where table_name='cams' and column_name in ('consecutive_failures','auto_disabled');` → 2 rows.

- [ ] **Step 3: Extend the `Cam` interface** in `lib/types.ts` — add after `is_active`:

```typescript
  consecutive_failures: number;
  auto_disabled: boolean;
```

- [ ] **Step 4: Verify** `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit** `feat(db): migration 014 — cam health tracking columns`

---

### Task 2: cam-health-check auto-disable (TDD)

**Files:**
- Modify: `scripts/cam-health-check.mjs`
- Test: `scripts/cam-health-check.test.mjs` (new)

**Interfaces:**
- Produces: exported pure `computeCamUpdate(cam, isAlive)` → `{ body, transition }` where `body` is the PATCH payload and `transition` is `null | "disabled" | "recovered"`.
- The script currently exports nothing and runs `main()` at import — add the `import.meta.url` guard FIRST (Global Constraints) so importing it in tests is side-effect-free.

- [ ] **Step 1: Write the failing tests** (`scripts/cam-health-check.test.mjs`):

```javascript
import { test } from "node:test";
import assert from "node:assert";
import { computeCamUpdate, DISABLE_THRESHOLD } from "./cam-health-check.mjs";

const cam = (over = {}) => ({ id: "c1", is_active: true, auto_disabled: false, consecutive_failures: 0, ...over });

test("threshold constant is 3", () => {
  assert.strictEqual(DISABLE_THRESHOLD, 3);
});

test("alive + healthy cam: resets counter, no transition", () => {
  const { body, transition } = computeCamUpdate(cam({ consecutive_failures: 2 }), true);
  assert.strictEqual(body.consecutive_failures, 0);
  assert.strictEqual(transition, null);
  assert.ok(!("is_active" in body));
});

test("dead cam below threshold: increments only", () => {
  const { body, transition } = computeCamUpdate(cam({ consecutive_failures: 1 }), false);
  assert.strictEqual(body.consecutive_failures, 2);
  assert.strictEqual(transition, null);
  assert.ok(!("is_active" in body));
});

test("dead cam reaching threshold: auto-disables", () => {
  const { body, transition } = computeCamUpdate(cam({ consecutive_failures: 2 }), false);
  assert.strictEqual(body.consecutive_failures, 3);
  assert.strictEqual(body.is_active, false);
  assert.strictEqual(body.auto_disabled, true);
  assert.strictEqual(transition, "disabled");
});

test("already auto-disabled + still dead: counts up, no re-transition", () => {
  const { body, transition } = computeCamUpdate(cam({ is_active: false, auto_disabled: true, consecutive_failures: 5 }), false);
  assert.strictEqual(body.consecutive_failures, 6);
  assert.strictEqual(transition, null);
  assert.ok(!("is_active" in body));
});

test("auto-disabled cam comes back: recovers", () => {
  const { body, transition } = computeCamUpdate(cam({ is_active: false, auto_disabled: true, consecutive_failures: 4 }), true);
  assert.strictEqual(body.is_active, true);
  assert.strictEqual(body.auto_disabled, false);
  assert.strictEqual(body.consecutive_failures, 0);
  assert.strictEqual(transition, "recovered");
});

test("MANUALLY disabled cam is never re-enabled, alive or not", () => {
  const alive = computeCamUpdate(cam({ is_active: false, auto_disabled: false }), true);
  assert.ok(!("is_active" in alive.body));
  assert.strictEqual(alive.transition, null);
  const dead = computeCamUpdate(cam({ is_active: false, auto_disabled: false, consecutive_failures: 9 }), false);
  assert.ok(!("is_active" in dead.body));
  assert.strictEqual(dead.transition, null);
});
```

- [ ] **Step 2: RED** — `node --test scripts/cam-health-check.test.mjs` fails (no export; guard missing means `main()` fires — add the guard before running if needed to observe the import failure safely; never let the test run hit the live DB).

- [ ] **Step 3: Implement.** In `scripts/cam-health-check.mjs`:

(a) add near the top:

```javascript
export const DISABLE_THRESHOLD = 3;

/**
 * Pure state transition for one cam's health check result.
 * Returns { body, transition } — body is the PATCH payload,
 * transition is null | "disabled" | "recovered" (for logging).
 * Never touches manually-disabled cams (is_active=false && !auto_disabled).
 */
export function computeCamUpdate(cam, isAlive) {
  const body = { last_checked_at: new Date().toISOString() };
  const manuallyDisabled = !cam.is_active && !cam.auto_disabled;
  if (isAlive) {
    body.consecutive_failures = 0;
    if (manuallyDisabled) return { body: { last_checked_at: body.last_checked_at }, transition: null };
    if (cam.auto_disabled) {
      body.is_active = true;
      body.auto_disabled = false;
      return { body, transition: "recovered" };
    }
    return { body, transition: null };
  }
  const failures = (cam.consecutive_failures ?? 0) + 1;
  body.consecutive_failures = failures;
  if (manuallyDisabled) return { body: { last_checked_at: body.last_checked_at }, transition: null };
  if (cam.is_active && failures >= DISABLE_THRESHOLD) {
    body.is_active = false;
    body.auto_disabled = true;
    return { body, transition: "disabled" };
  }
  return { body, transition: null };
}
```

(b) change `fetchAllCams()`'s select to include the new fields (`select=id,name,embed_type,embed_url,youtube_id,is_active,auto_disabled,consecutive_failures,...` — match the existing select and append the two new columns).

(c) replace `updateCamStatus(camId, isAlive)`'s body construction: call `computeCamUpdate(cam, isAlive)`, PATCH `body`, and return `transition`; in `main()`'s loop, tally and log transitions, and print a run summary line: `[cam-health] N disabled this run, M recovered`.

(d) wrap the trailing `main()` call:

```javascript
import { pathToFileURL } from "node:url";
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => { console.error("[cam-health] Fatal:", err); process.exit(1); });
}
```

- [ ] **Step 4: GREEN** — `node --test scripts/cam-health-check.test.mjs` → 7/7.

- [ ] **Step 5: Convergence runs.** Run `node scripts/cam-health-check.mjs` **three times back-to-back** (live; sanctioned by the spec — the ~45 dead cams have months of failure history). Then verify in prod: `select count(*) from cams where is_active = true` dropped by roughly the dead count, and `select count(*) from cams where auto_disabled = true` ≈ the number of cams that failed all 3 runs. Spot-check one disabled cam's URL manually to confirm it is genuinely dead.

- [ ] **Step 6: Commit** `feat(cam-health): auto-disable dead cams after 3 consecutive failures, with auto-recovery`

---

### Task 3: `CamEmbed` extraction + image-cam polish

**Files:**
- Create: `components/cam/CamEmbed.tsx`
- Modify: `components/resort/ResortDetailPage.tsx` (delete the inline `ImageCam` at lines ~33-53; replace the loaded-state embed JSX inside `CamPlayer`'s image/youtube/iframe branches with `<CamEmbed …/>`)

**Interfaces:**
- Produces: `CamEmbed({ cam, resortSlug, variant }: { cam: Cam; resortSlug: string; variant: "tile" | "lightbox" })` — renders the MEDIA ONLY (fills its parent; parent supplies aspect/rounding/overlays). Click-to-play gating, report/favorite overlays, and link-type rendering stay in `CamPlayer` untouched.
- Task 4 consumes `CamEmbed` with `variant="lightbox"`.

- [ ] **Step 1: Create `components/cam/CamEmbed.tsx`:**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Cam } from "@/lib/types";

const REFRESH_MS = { tile: 30_000, lightbox: 15_000 } as const;

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

/** Auto-refreshing image feed: freshness badge, manual refresh,
 *  paused while the tab is hidden, placeholder on load failure. */
function ImageFeed({ url, name, refreshMs }: { url: string; name: string; refreshMs: number }) {
  const [src, setSrc] = useState(url);
  const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);
  const [, forceTick] = useState(0);
  const timers = useRef<{ refresh?: ReturnType<typeof setInterval>; tick?: ReturnType<typeof setInterval> }>({});

  const refresh = () => {
    const sep = url.includes("?") ? "&" : "?";
    setSrc(`${url}${sep}_t=${Date.now()}`);
    setRefreshedAt(Date.now());
    setFailed(false);
  };

  useEffect(() => {
    const start = () => {
      timers.current.refresh = setInterval(refresh, refreshMs);
      timers.current.tick = setInterval(() => forceTick((n) => n + 1), 5_000);
    };
    const stop = () => {
      clearInterval(timers.current.refresh);
      clearInterval(timers.current.tick);
    };
    const onVisibility = () => {
      stop();
      if (!document.hidden) {
        refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, refreshMs]);

  if (failed) {
    return (
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/cam-placeholder.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="px-3 py-1.5 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp font-mono text-[11px] font-bold text-ink uppercase tracking-[0.12em]">
            Feed unavailable
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={name}
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5">
        <span className="px-2 py-0.5 bg-ink/80 rounded-full font-mono text-[10px] font-bold text-cream-50 uppercase tracking-[0.12em]">
          Live · {timeAgo(refreshedAt)}
        </span>
        <button
          onClick={refresh}
          aria-label="Refresh feed"
          className="p-1 bg-ink/80 rounded-full text-cream-50 hover:text-alpen transition-colors"
        >
          <RefreshCw size={11} />
        </button>
      </div>
    </>
  );
}

/** Shared cam media renderer for youtube / iframe / image embeds.
 *  Renders media only; the parent owns sizing, chrome, and overlays.
 *  Link-type cams have nothing to embed and are the caller's concern. */
export function CamEmbed({ cam, variant }: { cam: Cam; resortSlug: string; variant: "tile" | "lightbox" }) {
  if (cam.embed_type === "youtube" && cam.youtube_id) {
    return (
      <iframe
        src={`https://www.youtube.com/embed/${cam.youtube_id}?autoplay=1&mute=1`}
        title={cam.name}
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full"
      />
    );
  }
  if (cam.embed_type === "iframe" && cam.embed_url) {
    return (
      <iframe
        src={cam.embed_url}
        title={cam.name}
        allow="autoplay; encrypted-media"
        allowFullScreen
        className="absolute inset-0 w-full h-full"
      />
    );
  }
  if (cam.embed_type === "image" && cam.embed_url) {
    return <ImageFeed url={cam.embed_url} name={cam.name} refreshMs={REFRESH_MS[variant]} />;
  }
  return null;
}
```

**Fidelity requirement:** before deleting `CamPlayer`'s inline youtube/iframe JSX, read it and carry over its exact iframe attributes (`allow`, sandbox flags, URL params) into `CamEmbed` if they differ from the above — the embed behavior must not change. The above reflects the expected convention; the file is the source of truth.

- [ ] **Step 2: Rewire `CamPlayer`** — in each loaded-state branch (image/youtube/iframe), replace the inline media element with `<CamEmbed cam={cam} resortSlug={resortSlug} variant="tile" />`; delete the now-unused inline `ImageCam` function. Keep click-to-play state, thumbnails, report button, favorite button, and analytics calls exactly as they are.

- [ ] **Step 3: Verify** `npx tsc --noEmit` clean; `npm run build` succeeds.

- [ ] **Step 4: Commit** `feat(cam): shared CamEmbed with freshness badge, hidden-tab pause, placeholder fallback`

---

### Task 4: `CamLightbox` + resort-page integration

**Files:**
- Create: `components/cam/CamLightbox.tsx`
- Modify: `components/resort/ResortDetailPage.tsx` (lightbox state + expand affordance on loaded tiles)

**Interfaces:**
- Consumes: `CamEmbed` (Task 3).
- Produces: `CamLightbox({ cams, initialIndex, resortSlug, resortName, onClose })` where `cams` is pre-filtered to embeddable types (`embed_type !== "link"`).

- [ ] **Step 1: Create `components/cam/CamLightbox.tsx`:**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { Cam } from "@/lib/types";
import { CamEmbed } from "./CamEmbed";

interface Props {
  cams: Cam[];
  initialIndex: number;
  resortSlug: string;
  resortName: string;
  onClose: () => void;
}

export function CamLightbox({ cams, initialIndex, resortSlug, resortName, onClose }: Props) {
  const [index, setIndex] = useState(() => Math.min(Math.max(initialIndex, 0), cams.length - 1));
  const dialogRef = useRef<HTMLDivElement>(null);
  const cam = cams[index];

  const prev = () => setIndex((i) => (i - 1 + cams.length) % cams.length);
  const next = () => setIndex((i) => (i + 1) % cams.length);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prevFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!cam) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${resortName} webcams`}
      tabIndex={-1}
      className="fixed inset-0 z-[200] bg-ink/95 flex flex-col outline-none"
      onClick={onClose}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="font-mono text-[10.5px] font-bold text-cream-50/70 uppercase tracking-[0.14em]">{resortName}</p>
          <h2 className="font-display font-black text-cream-50 text-xl leading-tight truncate">{cam.name}</h2>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[11px] text-cream-50/70">{index + 1} / {cams.length}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp text-ink hover:-translate-y-0.5 transition-transform"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Media */}
      <div className="flex-1 flex items-center justify-center px-4 pb-4 min-h-0" onClick={(e) => e.stopPropagation()}>
        {cams.length > 1 && (
          <button onClick={prev} aria-label="Previous cam"
            className="p-2.5 mr-3 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp text-ink hover:-translate-y-0.5 transition-transform shrink-0">
            <ChevronLeft size={18} />
          </button>
        )}
        <div className="relative w-full max-w-6xl aspect-video bg-ink rounded-[18px] overflow-hidden border-[1.5px] border-cream-50/20">
          <CamEmbed key={cam.id} cam={cam} resortSlug={resortSlug} variant="lightbox" />
        </div>
        {cams.length > 1 && (
          <button onClick={next} aria-label="Next cam"
            className="p-2.5 ml-3 bg-cream-50 border-[1.5px] border-ink rounded-full shadow-stamp text-ink hover:-translate-y-0.5 transition-transform shrink-0">
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrate in `ResortDetailPage`:** add `const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);` and `const embeddableCams = activeCams.filter((c) => c.embed_type !== "link");` in the main component. On each loaded cam tile (inside `CamPlayer`, which needs an optional `onExpand?: () => void` prop), render an expand button (bottom-right, `Maximize2` icon, same ghost-pill styling as the existing overlay buttons, `aria-label="Open fullscreen"`) that calls `onExpand`. The page passes `onExpand={() => setLightboxIndex(embeddableCams.findIndex((c) => c.id === cam.id))}` and renders `{lightboxIndex !== null && <CamLightbox cams={embeddableCams} initialIndex={lightboxIndex} resortSlug={resort.slug} resortName={resort.name} onClose={() => setLightboxIndex(null)} />}` at the end of the component. Track opens: `trackCamClick(resort.slug, cam.name, "lightbox")` in the expand handler.

- [ ] **Step 3: Verify** `npx tsc --noEmit` clean; `npm run build` succeeds; `npm start` + curl a resort page → HTML contains the expand button's aria-label.

- [ ] **Step 4: Commit** `feat(cam): fullscreen lightbox with keyboard navigation on resort pages`

---

### Task 5: SA cam coverage — Pillán + leads + re-verification

**Files:**
- Modify: `data/resorts.csv` (possibly +1 row: Pillán), `data/cams.csv` (new verified cam rows)

**Interfaces:**
- Consumes: importer (safe upsert per migration 012 key `resort_id,embed_url,name`).

- [ ] **Step 1: Research (WebSearch/WebFetch)** — for each item, only include what you can verify: (a) **Pillán / Volcán Villarrica (Pucón, Chile)**: 2026 operating status, base-area lat/lng cross-checked from two sources, base/summit elevation in FEET, official site, cam page, and cam URLs classified per the embed taxonomy (fetch each candidate URL to confirm it responds; YouTube via oEmbed). (b) **Cerro Mirador, Batea Mahuida, Cerro Perito Moreno**: chase the snow-forecast.com webcam pages found by the SA research critic — determine whether they wrap a directly-embeddable source (direct image URL or iframe) and only add cams whose direct source you verified; snow-forecast.com's own pages are NOT embeddable — do not add link-type rows pointing at them. (c) **Re-verify the 5 "unverifiable" sets** (Valle Nevado, La Parva, El Colorado ×3 YouTube — use oEmbed; Corralco ×4 ipcamlive — fetch player pages with a browser UA and check for `embedOnline`; Volcán Osorno ×2 YouTube — oEmbed; Cerro Castor ×1 YouTube — oEmbed): mark each working/dead; for dead YouTube streams, search for the resort's current live stream ID and substitute it in the CSV.
- [ ] **Step 2: Apply to CSVs** — append/patch only verified rows (Pillán resort row needs `country=CL`, `state=Chile`, elevations; follow the exact 16-column format of the existing SA rows).
- [ ] **Step 3: Run the importer** (`node scripts/import-resorts-standalone.mjs`) and verify counts by country in prod.
- [ ] **Step 4: Commit** `feat(data): Pillán/Pucón + SA cam coverage improvements from verified research`
  (If research disproves Pillán's operability or finds zero verifiable new cams, commit whatever subset was verified and report the outcome honestly — an empty outcome is possible and acceptable.)

---

### Task 6: E2E verification + deploy (controller-run)

- [ ] All test suites green (`conditions-engine`, `open-meteo`, `analytics-events`, `import-resorts-standalone`, `cam-health-check`); `npx tsc --noEmit`; `npm run build`.
- [ ] `npm start` + curl: resort page renders lightbox affordance; dead-cam count check in prod (`select count(*) from cams where is_active=true and auto_disabled=false and consecutive_failures>=3` → 0).
- [ ] Merge to `main`, push (Vercel auto-deploy), confirm deployment READY, spot-check prod resort page.
