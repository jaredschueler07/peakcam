# PeakCam — cam still capture + fallback pipeline (design)

Date: 2026-10-14. Repo: `/Users/totcho_admin/hermes-studio/workspace/peakcam` at `02e814e` (= `origin/main`). Nothing in the repo was edited.
Live data was read with the anon key (public rows only) and one read-only SQL query via the Supabase MCP (project `owsxnogvufankayfwczl`).

---

## 0. TL;DR

1. **The problem is bigger than "a few cards", and most of it doesn't need capture.** Live DB: 148 active resorts, 345 active cams (iframe 132, youtube 90, image 104, link 19). **37 resorts have cams but no derivable still.** The resolver only knows `player.brownrice.com/embed/*`, Roundshot and YouTube (`lib/cam-preview.ts:16-29`).
2. **Quick win, with no infrastructure (fixes 11 of 37).** Map the `live{N}.brownrice.com/embed/<stream>` hosts and `player.brownrice.com/{snapshot,embed/<stream>/timelapse/…}` to `player.brownrice.com/snapshot/<stream>`. Map `{www,gN}.ipcamlive.com/player/player.php?alias=X` to `…/player/snapshot.php?alias=X`. I probed 39 such cams: 34 returned `image/*` with HTTP 200 and 5 are dead streams. Every provider tested served the same bytes with and without a `Referer`, so **no hotlink proxy is needed today**.
3. **18 of the remaining 26 are `link`-only resorts** (a resort's webcam *page*). Capture can't fix these. A screenshot of a marketing page is not a camera still. Someone has to find the real cam URL for each one.
4. **The capture pipeline is for the last 8 resorts** (wetmet, rtsp.me, camstreamer, Ski Cooper HLS, Las Leñas HLS, livespotting/explore.org, Bretton Woods). It is also the **"never blank" safety net** for every cam: a mirrored copy is kept daily, so a provider outage shows "Still from Oct 13, 7:40 AM" and the card is never empty.
5. **Run it on the Mac mini via launchd**, next to the existing `com.peakcam.cam-health-check`. The mini already has `yt-dlp`, Node 26, Google Chrome, Playwright Chromium and `sharp`, and runs 24/7. **Prerequisite:** the mini's `ffmpeg` is currently broken because a dylib is missing (§3c).
6. **Schema (migration 022):** add `still_*` columns on `cams` (the card reads them for free through the existing `select("*")`), a `cam_stills` history table that only the service role can access, and a public `cam-stills` bucket with immutable dated paths. **Rule: `cams.still_url` only moves forward on a capture that passes the blank-frame check.** That one rule gives you "yesterday's still" without a history join on the read path.

---

## 1. What exists today (grounded)

| Area | Finding | Source |
|---|---|---|
| Preview resolver | `previewSource()` covers: `image` with an https URL; YouTube via `i.ytimg.com/vi/<id>/hqdefault.jpg`; `player.brownrice.com/embed/<stream>` mapped to `/snapshot/<stream>`; Roundshot through a static JSON map. Everything else returns `null`. | `lib/cam-preview.ts:16-29` |
| Newer resolver (seo branch) | `origin/feat/seo-audit-fixes:lib/cam-preview.ts` adds an exported `CameraPreview` interface and a `cameraPreview(cam)` that never throws (try/catch around `previewSource`). Provider logic is unchanged. **Build on that version.** | `git show origin/feat/seo-audit-fixes:lib/cam-preview.ts` lines 16-32 |
| Availability | `availableCameras` requires `is_active && !auto_disabled` and a valid id/URL. | `lib/cam-preview.ts:10-14` |
| Card | Plain `<img>` (not `next/image`). `object-contain`. On `onError` the card adds the src to `failed` and moves to the next preview (`:11,26`). Label is hard-coded `${preview.label} · Capture time unavailable` (`:38`). Empty state: "Preview unavailable · Open cameras" (`:31`). | `components/browse/CardCameraPreview.tsx` |
| Card host | `SummitResortCard` passes `availableCameras(resort.cams)`. | `components/browse/SummitResortCard.tsx:83,115` |
| Data path | Browse loads cams with `.from("cams").select("*")…eq("is_active", true)`, so new columns flow through with no query change. The catalog is cached for 1 h. | `lib/supabase.ts:89-93`, `:22` |
| Cam type | No still fields. The test fixture builds a full `Cam`, so new fields must be **optional** to keep `tsc` green. | `lib/types.ts:32-45`, `lib/cam-preview.test.ts:5` |
| Brownrice HLS resolver (reusable) | Player page → script → `camera['streamurl']` → `.m3u8`, with host and path allow-listing. Only accepts the `player.brownrice.com` origin. | `lib/cam-status/brownrice.ts:3-29` |
| Health check | Daily probe. YouTube via oEmbed, image via GET plus a content-type check, iframe via GET. Retries twice, but never TLS or 4xx failures (`:247-266`). `computeCamUpdate` stamps `last_checked_at`, `consecutive_failures`, and `auto_disabled` after 3 failures. It never touches manually disabled cams (`:186-219`). Uses the service role key because the anon RLS hides inactive cams (`:223-236`). Refuses `NODE_TLS_REJECT_UNAUTHORIZED=0` (`:56-61`). | `scripts/cam-health-check.mjs` |
| Health-check scheduling (ground truth) | Mac mini plist `com.peakcam.cam-health-check`, `StartCalendarInterval` 06:00 daily, `/opt/homebrew/bin/node`, logs to `scripts/cam-health-check.log`. Last run: 345/374 healthy. | `ssh mac-mini-ha-1 cat ~/Library/LaunchAgents/com.peakcam.cam-health-check.plist`; `CLAUDE.md:96`. `docs/runbook.md:45` says "weekly" and is stale (`AGENTS.md:133`) |
| Other schedulers | `vercel.json` has one cron, `/api/alerts/trigger` at `0 13 * * *`. **There is no `.github/` directory**, so no GitHub Actions. | `vercel.json`, `ls .github` |
| Cams schema / RLS | `cams` has RLS on, with policy "Public cams read" `using (is_active = true)`. Writes go through the service role only. | `supabase/migrations/001_initial.sql:32-44,73,81-83`; `014_cam_health_tracking.sql`; `005_add_image_embed_type.sql` |
| Storage | **No buckets and 0 objects** (`storage.buckets` returns null, `storage.objects` count is 0). No `pg_cron` or `pg_net` extensions. No migration references storage. | MCP `execute_sql`; `grep -rl "storage\.\|bucket" supabase/` returns nothing |
| Migrations | Local files go up to `020_resort_openings.sql`. **Two different `021_*` files exist on branches:** `origin/feat/weathernext-powder-probability:021_powder_probabilities.sql` and `origin/wip/air-ios-browser-ui-2026-09-19:021_function_hardening.sql`. That is a collision to resolve separately. **Use 022.** | `git ls-tree` |
| next.config | `images: { domains: [] }`, so no remote image hosts are configured (and `domains` is the deprecated key). CSP is report-only with `img-src 'self' data: blob: https:`, so a Supabase Storage URL is already allowed. | `next.config.ts:146-148`, `:46`, `:84` |
| sharp | `sharp@0.34.5` is present as a transitive dependency of `next` (`npm ls sharp`) and also on the mini (`node_modules/sharp`). | |
| Playwright | `@playwright/test@1.61.1` devDependency (`package.json`). Local: `chromium-1248` and `chromium_headless_shell-1248`. Mini: `chromium-1228/1234` and Google Chrome.app. | |
| Local tools | `ffmpeg` 9.0.2 at `/opt/homebrew/bin/ffmpeg`. `yt-dlp` is **not installed** locally. | `which` |
| Mini tools | `yt-dlp 2026.07.04`, `node v26.5.0`, sleep prevented (`pmset`: "sleep prevented by caffeinate"), 26 GiB free, timezone CDT. **`ffmpeg` is broken:** `Library not loaded: /opt/homebrew/opt/x265/lib/libx265.216.dylib` (ffmpeg 8.1.2_1 linked against an x265 that was since upgraded). | `ssh mac-mini-ha-1` |
| Embed rendering | YouTube and iframe cams render through `<StreamFeed>` (a plain `<iframe>`). There is no HLS player in-app. Image cams use `ImageFeed` with periodic `?_t=` cache-busting. | `components/cam/CamEmbed.tsx:21-60,167-179`, `components/cam/StreamFeed.tsx:36` |
| Existing honesty rule | "These are previews, not proof of a live stream… No capture timestamps are inferred" | `scripts/data/camera-previews/README.md` |
| `scripts/generate-images.mjs` | Irrelevant here: it generates marketing images through xAI. | `:1-13` |

### Live inventory of the 37 empty-card resorts (2026-10-14)

- **Fixed by URL mapping (11):** Taos (live2/live3 brownrice), Sunlight (ipcamlive), Wolf Creek (live2 brownrice, `&em=1` suffix), Mt. Rose (live3), China Peak (ipcamlive g1), Windham (`player.brownrice.com/embed/windhammountainclub/timelapse/24hr`), Ski Santa Fe (`player.brownrice.com/snapshot/*` stored *as an iframe*), Angel Fire (live1/live3), Corralco (www.ipcamlive), Portillo (g3.ipcamlive), Nevados de Chillán (g3.ipcamlive).
- **Need capture (8):** Wachusett and Mt. Hood Meadows (`api.wetmet.net` frame; signed `wms-prod-N.wetmet.net/…/playlist.m3u8?wmsAuthSign=…` in the HTML; plain ffmpeg got **404**, so it needs the browser path), Burke (`rtsp.me/embed`), Bear Valley (`camstreamer.com/embed`), Ski Cooper (`skicooper.com:8443/<cam>/index.m3u8`, **ffmpeg verified: frame in 1.45 s**), Las Leñas (`tv.streamcasthd.com:3895/live/laslenaslive.m3u8`, **ffmpeg verified: 0.48 s**), Homewood (livespotting player publishes `og:image` = `video.skyfiberinternet.com/memfs/alta1aac.jpg`; brownrice `homewood5` snapshot returns HTML; explore.org), Bretton Woods (ipcamlive alias `63c1cffd31643` returns **404 on snapshot**, probably a dead stream).
- **Link-only, a data problem (18):** Deer Valley, Powder Mountain, Solitude, Granby Ranch (`camstreamer.com/live/stream/1865`, which *is* capturable by the browser path if reclassified as iframe), Monarch, Sugar Bowl, Snow Summit, Tahoe Donner, Donner Ski Ranch, Ski Bowl, Red Lodge, Mt. Ashland, Lookout Pass, Camelback, Seven Springs, Jiminy Peak, Nub's Nob, Red River.

---

## 2. Quick wins first (ship before the pipeline)

### 2a. Provider URL mapping in `lib/cam-preview.ts`

Verified on 2026-10-14. For all of these, a request with no `Referer` and one with `Referer: https://www.peakcam.io/` returned identical bytes.

- `player.brownrice.com/snapshot/{tsvbav,mtrose1,wolfcreeksummit,afbasearea,windhammountainclub,santafe,tsv,wolfcreektreasure}` returned 200 `image/jpeg`. `santafechair5` returned `image/png`. `homewood5` returned 200 `text/html` (362 B), so the stream is gone. The `<img>` `onError` already handles that case.
- `gN.ipcamlive.com/player/snapshot.php?alias=X` returns a 302 to `sNNN.ipcamlive.com/streams/<id>/snapshot.jpg` with a **real `Last-Modified` capture time** and `no-store`. Dead aliases return 404.

```ts
// lib/cam-preview.ts — inside previewSource(), replacing the brownrice block
const brown = url.pathname.match(/^\/(?:embed|snapshot)\/([A-Za-z0-9_-]{1,80})(?:\/|&|$)/)?.[1];
if (url.protocol === "https:" && brown &&
    (url.hostname === "player.brownrice.com" || /^live\d{1,3}\.brownrice\.com$/.test(url.hostname))) {
  return { cam, src: `https://player.brownrice.com/snapshot/${brown}`, label: "Camera still" };
}
// ipcamlive publishes a per-alias snapshot endpoint next to its player.
const alias = url.searchParams.get("alias");
if (url.protocol === "https:" && /^(?:www|g\d{1,2})\.ipcamlive\.com$/.test(url.hostname)
    && url.pathname === "/player/player.php" && alias && /^[\w-]{1,64}$/.test(alias)) {
  return { cam, src: `https://${url.hostname}/player/snapshot.php?alias=${alias}`, label: "Camera still" };
}
```

Note the Wolf Creek URL `live2.brownrice.com/embed/wolfcreektreasure&em=1`: the `&em=1` is part of the *path*, which is why the regex allows `&` as a terminator.

Tests to update: `lib/cam-preview.test.ts` currently asserts that `g1.ipcamlive.com/player/player.php?alias=x` resolves to `null` (seo-branch version of the test). Flip it, and keep the lookalike-host negative tests (`ipcamlive.com.evil.example`, `live1.brownrice.com.evil.example`).

`StreamFeed`'s status probe (`lib/cam-status/brownrice.ts:6`) has the same blind spot for the `liveN` hosts. That is a separate, small follow-up.

### 2b. YouTube: use `hqdefault_live.jpg`

I tested 4 live cam ids (`MwHWDokyUhw`, `gelXqzE1Xi0`, `ELdPHcv-2vI`, `xaf6OzA-i6M`). Right now `hqdefault` and `hqdefault_live` return **byte-identical** images. The difference is caching: `_live` always has `cache-control: max-age=300`, while plain `hqdefault`/`maxresdefault`/`mqdefault` returned `max-age=7200` for `MwHWDokyUhw`. YouTube refreshes the `_live` variant during a broadcast, and CDNs and browsers hold plain `hqdefault` for up to 2 h.

- Use `https://i.ytimg.com/vi/${id}/hqdefault_live.jpg` (480×360, about 8-48 KB).
- `maxresdefault*` is 1280×720 and 90-230 KB. That is too heavy for a grid.
- `mqdefault_live` is a true 16:9 image but only 320×180 (21 KB), which looks soft on retina.
- `hqdefault` is 4:3 with letterbox bars baked in. With the card's `aspect-[16/9]` box, switch YouTube previews to `object-cover`: it crops exactly the baked bars (12.5% top and bottom). The card uses `object-contain` today (`CardCameraPreview.tsx:24`), which shows the bars.
- A `_live` URL for a stream that has ended can go stale or 404. The capture job's mirror (§3b) covers that case.

### 2c. Is a Referer-stripping proxy needed? Not today.

Every provider host I probed (brownrice, ipcamlive, i.ytimg.com) served the same bytes with no Referer and with the referer the site actually sends. The site sends `strict-origin-when-cross-origin`, so only the origin goes out (`next.config.ts:106-107`). If a future provider blocks hotlinking, a cached route handler is enough. It needs no storage and no cron:

```ts
// app/api/cam-still/[id]/route.ts  (sketch; only if a provider blocks hotlinks)
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { cameraPreview } from "@/lib/cam-preview";
import type { Cam } from "@/lib/types";

export const revalidate = 600; // Data-cache the upstream fetch for 10 min
const MAX_BYTES = 2_000_000;
const PROXY_HOSTS = new Set(["example-blocking-provider.com"]); // allow-list ONLY hosts that need it

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 400 });
  const { data: cam } = await supabase.from("cams").select("*").eq("id", id).eq("is_active", true).maybeSingle();
  const src = cam && cameraPreview(cam as Cam)?.src;
  if (!src || !PROXY_HOSTS.has(new URL(src).hostname)) return new Response(null, { status: 404 });
  const upstream = await fetch(src, {
    headers: { Referer: (cam as Cam).embed_url ?? "", "User-Agent": "PeakCam/1.0 (https://peakcam.io) cam-still" },
    redirect: "follow", signal: AbortSignal.timeout(8000), next: { revalidate: 600 },
  });
  const type = upstream.headers.get("content-type") ?? "";
  const len = Number(upstream.headers.get("content-length") ?? 0);
  if (!upstream.ok || !type.startsWith("image/") || len > MAX_BYTES) return new Response(null, { status: 502 });
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response(null, { status: 502 });
  return new Response(body, { headers: {
    "Content-Type": type, "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
  }});
}
```

The allow-list and the fact that the upstream URL comes from `cameraPreview` (DB-derived, never from a query param) prevent turning this into an open proxy. The trade-off: every grid image becomes a Vercel function invocation plus bandwidth. Use it only for hosts that need it.

---

## 3. Capture pipeline

### 3a. Schema — `supabase/migrations/022_cam_stills.sql`

```sql
-- ─────────────────────────────────────────────────────────────
-- Migration 022 — captured cam stills
-- scripts/cam-capture-stills.ts captures a frame per cam, stores it in the
-- public `cam-stills` bucket at an immutable dated path, appends a row to
-- cam_stills, and — ONLY when the frame passes the blank-frame check —
-- advances cams.still_url / still_captured_at. A failed or blank capture
-- touches only still_attempted_at / still_failures, so the card keeps
-- showing the last good still ("Still from Oct 13, 7:40 AM").
-- ─────────────────────────────────────────────────────────────

alter table cams add column if not exists still_url          text;
alter table cams add column if not exists still_captured_at  timestamptz;
alter table cams add column if not exists still_method       text;
alter table cams add column if not exists still_attempted_at timestamptz;
alter table cams add column if not exists still_failures     integer not null default 0;

alter table cams drop constraint if exists cams_still_method_check;
alter table cams add constraint cams_still_method_check
  check (still_method is null or still_method in ('mirror','hls','youtube','browser'));
-- A still URL must be our own storage object, never an arbitrary host.
alter table cams drop constraint if exists cams_still_url_check;
alter table cams add constraint cams_still_url_check
  check (still_url is null or still_url like 'https://%.supabase.co/storage/v1/object/public/cam-stills/%');

-- History: lets ops see capture cadence, enables pruning, future time-lapse.
create table if not exists cam_stills (
  id            bigint generated always as identity primary key,
  cam_id        uuid not null references cams(id) on delete cascade,
  captured_at   timestamptz not null default now(),
  storage_path  text not null unique,           -- '<cam_id>/<yyyy-mm-dd>/<hhmmss>.webp'
  method        text not null check (method in ('mirror','hls','youtube','browser')),
  width         integer,
  height        integer,
  bytes         integer,
  luma_stdev    real
);
create index if not exists cam_stills_cam_captured_idx on cam_stills (cam_id, captured_at desc);

-- Service-role only: no anon/auth policies. The card never reads this table;
-- it reads cams.still_* through the existing "Public cams read" policy.
alter table cam_stills enable row level security;

-- Public-read bucket. No storage.objects policies are added, so anon/auth
-- cannot write; the capture script writes with the service role (bypasses RLS).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cam-stills', 'cam-stills', true, 524288, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
```

Design notes:

- **Why both columns and a table.** The card needs exactly one value: the last good still. Putting it on `cams` means zero extra queries (`lib/supabase.ts:89-93` already selects `*`) and no new RLS surface. The fallback to "yesterday" is a write-side rule (only advance on success), not a read-side join. The history table exists for pruning, debugging and a future "24 h time-lapse" feature.
- I deliberately left **no `still_error` column** on `cams`. `cams` is world-readable (`001_initial.sql:81-83`), and error strings can contain signed provider URLs (the wetmet `wmsAuthSign=` token). Errors go to the launchd log instead.
- **Immutable dated paths, not an overwritten `latest.webp`.** Each capture gets a new URL, so the bucket can be served with `cacheControl: 31536000` and cached forever by Supabase's CDN and browsers. Overwriting a `latest.webp` would fight CDN caching. It would also create a window where the card renders a half-propagated object.
- `lib/types.ts` addition (optional fields, so existing fixtures at `lib/cam-preview.test.ts:5` still type-check):

```ts
export type StillMethod = "mirror" | "hls" | "youtube" | "browser";
// in interface Cam:
  still_url?: string | null;
  still_captured_at?: string | null;
  still_method?: StillMethod | null;
  still_attempted_at?: string | null;
  still_failures?: number;
```

### 3b. Capture job — `scripts/cam-capture-stills.ts`

I chose `.ts` (run with `npx tsx`, the same way `com.peakcam.model-sync.plist` runs `model-sync.ts`) so the script can **import `cameraPreview` from `lib/cam-preview.ts` and the brownrice resolver from `lib/cam-status/brownrice.ts`** instead of duplicating provider logic. `lib/cam-preview.ts` uses relative imports plus a JSON import, which tsx supports.

**Which cams get captured, and when (`due()`):**
- Cams with **no derived still** (`cameraPreview(cam) === null`, embed_type iframe/youtube): every run.
- Cams **with** a derived still: mirror it once a day (`still_captured_at` older than 20 h). This is a cheap server-side fetch of the provider snapshot and the backup for when the provider snapshot later 404s.
- Backoff: after 12 consecutive failures (about 1.5 days at 8 runs/day), try only once per 24 h.
- Skipped: `link` cams (there is no frame to capture), `auto_disabled` cams, and inactive cams.

**Method ladder (first success wins, all failures logged):**
1. `mirror`: GET the derived still URL. Content type must be `image/*`, size under 5 MB.
2. `youtube`: `yt-dlp -g` to get the HLS URL, then ffmpeg grabs one frame. Only reached if the thumbnail fetch failed.
3. `hls`: find an `.m3u8` (brownrice resolver, or a regex over the player HTML resolved relative to the page, which covers Ski Cooper's relative `index.m3u8` and Las Leñas), then ffmpeg grabs one frame with `Referer` set to the embed URL.
4. `browser`: Chrome via Playwright (`channel: "chrome"`). It **sniffs network requests for `.m3u8`** and hands the URL to ffmpeg (this handles wetmet's signed URL). If no manifest appears, it screenshots the `<video>` element or the viewport. Use `channel: "chrome"` and **not** bundled Chromium: Playwright's Chromium builds lack proprietary codecs (H.264/AAC), so a `<video>` screenshot from them is black. Chrome.app is installed on the mini.

**Timeouts, retries, concurrency:**
- ffmpeg: `-rw_timeout 15s`, with a process timeout of 30 s.
- HTTP: 12 s, the same as `cam-health-check.mjs:248`.
- Browser: 20 s for navigation plus an 8 s settle.
- Hard budget of 75 s per cam.
- No inner retries. The next run, 2 h later, *is* the retry, and the old still stays up in the meantime.
- Concurrency 4. One shared Chrome instance with a fresh context per cam.
- launchd never starts a second instance of a job that is still running, so runs can't overlap.

**Blank-frame check (calibrated on real frames today with `sharp().greyscale().resize(160).stats()`):**

| frame | luma stdev | entropy |
|---|---|---|
| Ski Cooper HLS, normal | 59.4 | 7.35 |
| Las Leñas HLS, normal | 66.2 | 7.18 |
| **Sunlight "sopris" in dense fog (a real, valid frame)** | **6.9** | 4.50 |
| Wolf Creek summit whiteout (valid, 9 KB) | 17.7 | 5.05 |
| synthetic black | 0 | 0 |

A naive "stdev < 10" threshold would reject fog and whiteouts, which are exactly what a skier wants to see. Use these rules:
- reject if stdev < 2.5 (a uniform frame: black, grey or "no signal" slate);
- reject if mean < 12 and stdev < 8 (night or black);
- reject if entropy < 1.5.

Rejecting night frames is intentional. The card keeps the afternoon still, labelled with its time, which is more useful than a black rectangle.

**Output:**
- `sharp().rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 72 })`. Measured today: 2-41 KB per still (fog 4.9 KB, busy scene 41 KB).
- Upload to `cam-stills/<cam_id>/<yyyy-mm-dd>/<hhmmss>.webp` with `cacheControl: "31536000"` and `upsert: false`.
- Insert a `cam_stills` row, then update `cams.still_*`.

```ts
#!/usr/bin/env tsx
/**
 * cam-capture-stills.ts — capture one still per due cam, store it in Supabase
 * Storage (`cam-stills`), and advance cams.still_* ONLY on a good frame.
 *
 *   npx tsx scripts/cam-capture-stills.ts            # due cams only
 *   npx tsx scripts/cam-capture-stills.ts --all      # ignore schedule/backoff
 *   npx tsx scripts/cam-capture-stills.ts --cam <uuid> --dry-run
 *   npx tsx scripts/cam-capture-stills.ts --prune    # delete history > 7 days
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Needs on PATH: ffmpeg (required), yt-dlp (optional). Chrome for the browser path.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "dotenv";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import type { Browser } from "@playwright/test";
import { cameraPreview } from "../lib/cam-preview";
import { brownriceCamera, playerScript, streamURL } from "../lib/cam-status/brownrice";
import type { Cam, StillMethod } from "../lib/types";

config({ path: ".env.local" });
const run = promisify(execFile);
const BUCKET = "cam-stills";
const CONCURRENCY = 4;
const CAM_BUDGET_MS = 75_000;
const MIRROR_EVERY_MS = 20 * 3600_000;
const BACKOFF_AFTER = 12;
const UA = "PeakCam/1.0 (https://peakcam.io; contact@peakcam.io) cam-capture-stills";
const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const ONLY = flag("--cam") ? argv[argv.indexOf("--cam") + 1] : null;
const DRY = flag("--dry-run"), ALL = flag("--all") || Boolean(ONLY);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const redact = (s: string) => s.replace(/\?\S*/g, "?…").slice(0, 200); // never log signed tokens

/** Pure. null = usable frame; otherwise why it was rejected. Calibrated so fog/whiteout pass. */
export async function blankReason(img: Buffer): Promise<string | null> {
  const { channels, entropy } = await sharp(img).greyscale().resize(160).stats();
  const { mean, stdev } = channels[0];
  if (stdev < 2.5) return `uniform frame (mean ${mean.toFixed(0)})`;
  if (mean < 12 && stdev < 8) return `near-black (mean ${mean.toFixed(0)})`;
  if (entropy < 1.5) return `low entropy ${entropy.toFixed(2)}`;
  return null;
}

/** Pure. Should this cam be attempted now? */
export function due(cam: Cam, now = Date.now()): boolean {
  if (!cam.is_active || cam.auto_disabled || cam.embed_type === "link") return false;
  if (ALL) return true;
  const last = cam.still_attempted_at ? Date.parse(cam.still_attempted_at) : 0;
  if ((cam.still_failures ?? 0) >= BACKOFF_AFTER && now - last < 24 * 3600_000) return false;
  if (cameraPreview(cam) === null) return true; // nothing else to show: every run
  const good = cam.still_captured_at ? Date.parse(cam.still_captured_at) : 0;
  return now - good > MIRROR_EVERY_MS; // has a provider still: daily backup copy
}

async function fetchBuf(url: string, referer?: string, max = 5_000_000): Promise<{ buf: Buffer; type: string }> {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(referer ? { Referer: referer } : {}) }, redirect: "follow", signal: AbortSignal.timeout(12_000) });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (buf.length > max) throw new Error("too large");
  return { buf, type: res.headers.get("content-type") ?? "" };
}

async function ffmpegFrame(input: string, referer?: string): Promise<Buffer> {
  const headers = referer ? ["-headers", `Referer: ${referer}\r\nUser-Agent: ${UA}\r\n`] : [];
  const { stdout } = await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-rw_timeout", "15000000", ...headers,
    "-i", input, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "pipe:1"],
    { encoding: "buffer", timeout: 30_000, maxBuffer: 20_000_000 });
  if (!stdout.length) throw new Error("ffmpeg produced no frame");
  return stdout;
}

/** Brownrice via the shared resolver; otherwise the first .m3u8 referenced in the player HTML. */
async function findHls(embed: string): Promise<string | null> {
  const camera = brownriceCamera(embed);
  if (camera) {
    const script = playerScript((await fetchBuf(embed)).buf.toString("utf8"), camera);
    return script ? streamURL((await fetchBuf(script)).buf.toString("utf8"), camera) : null;
  }
  const html = (await fetchBuf(embed, undefined, 1_000_000)).buf.toString("utf8");
  const m = /["'(=\s]((?:https?:)?[^"'()\s]*?\.m3u8(?:\?[^"'()\s]*)?)/i.exec(html);
  if (!m) return null;
  const url = new URL(m[1].replaceAll("&amp;", "&"), embed);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
}

let browser: Browser | null = null;
async function browserFrame(embed: string): Promise<{ buf: Buffer; method: StillMethod }> {
  if (!browser) {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: UA });
  try {
    const page = await ctx.newPage();
    let hls: string | null = null;
    page.on("request", r => { if (!hls && /\.m3u8(\?|$)/i.test(r.url())) hls = r.url(); });
    await page.goto(embed, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(8_000);
    if (hls) { try { return { buf: await ffmpegFrame(hls, embed), method: "hls" }; } catch { /* fall through */ } }
    const video = await page.$("video");
    return { buf: video ? await video.screenshot({ timeout: 5_000 }) : await page.screenshot(), method: "browser" };
  } finally { await ctx.close(); }
}

async function capture(cam: Cam): Promise<{ buf: Buffer; method: StillMethod; stdev: number }> {
  const ladder: [StillMethod, () => Promise<Buffer | { buf: Buffer; method: StillMethod }>][] = [];
  const derived = cameraPreview(cam)?.src;
  if (derived) ladder.push(["mirror", async () => {
    const { buf, type } = await fetchBuf(derived, cam.embed_url ?? undefined);
    if (!type.startsWith("image/")) throw new Error(`not an image (${type})`);
    return buf;
  }]);
  if (cam.embed_type === "youtube" && cam.youtube_id) ladder.push(["youtube", async () => {
    const { stdout } = await run("yt-dlp", ["-g", "-f", "best[height<=720]", `https://www.youtube.com/watch?v=${cam.youtube_id}`], { timeout: 30_000 });
    return ffmpegFrame(stdout.trim().split("\n")[0]);
  }]);
  if (cam.embed_type === "iframe" && cam.embed_url) {
    const embed = cam.embed_url;
    ladder.push(["hls", async () => { const m = await findHls(embed); if (!m) throw new Error("no m3u8 in player HTML"); return ffmpegFrame(m, embed); }]);
    ladder.push(["browser", () => browserFrame(embed)]);
  }
  const errors: string[] = [];
  for (const [method, attempt] of ladder) {
    try {
      const out = await attempt();
      const buf = Buffer.isBuffer(out) ? out : out.buf;
      const used = Buffer.isBuffer(out) ? method : out.method;
      const blank = await blankReason(buf);
      if (blank) { errors.push(`${used}: ${blank}`); continue; }
      const { channels } = await sharp(buf).greyscale().resize(160).stats();
      return { buf, method: used, stdev: channels[0].stdev };
    } catch (e) { errors.push(`${method}: ${redact((e as Error).message)}`); }
  }
  throw new Error(errors.join(" | ") || `no capture method for ${cam.embed_type}`);
}

async function store(cam: Cam, frame: { buf: Buffer; method: StillMethod; stdev: number }, at: Date) {
  const { data, info } = await sharp(frame.buf).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer({ resolveWithObject: true });
  const iso = at.toISOString();
  const path = `${cam.id}/${iso.slice(0, 10)}/${iso.slice(11, 19).replaceAll(":", "")}.webp`;
  if (DRY) return console.log(`  DRY  ${cam.name}: ${frame.method} ${info.width}x${info.height} ${info.size}B → ${path}`);
  const up = await db.storage.from(BUCKET).upload(path, data, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
  if (up.error) throw up.error;
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const hist = await db.from("cam_stills").insert({ cam_id: cam.id, captured_at: iso, storage_path: path, method: frame.method, width: info.width, height: info.height, bytes: info.size, luma_stdev: frame.stdev });
  if (hist.error) throw hist.error;
  const upd = await db.from("cams").update({ still_url: url, still_captured_at: iso, still_method: frame.method, still_attempted_at: iso, still_failures: 0 }).eq("id", cam.id);
  if (upd.error) throw upd.error;
}

async function processCam(cam: Cam): Promise<boolean> {
  const at = new Date();
  try {
    const frame = await Promise.race([capture(cam), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("cam budget exceeded")), CAM_BUDGET_MS))]);
    await store(cam, frame, at);
    console.log(`  OK   [${frame.method}] ${cam.name}`);
    return true;
  } catch (e) {
    // The previous good still_url is deliberately left untouched.
    console.log(`  FAIL ${cam.name} — ${redact((e as Error).message)}`);
    if (!DRY) await db.from("cams").update({ still_attempted_at: at.toISOString(), still_failures: (cam.still_failures ?? 0) + 1 }).eq("id", cam.id);
    return false;
  }
}

async function prune(days = 7) {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: keep } = await db.from("cams").select("still_url").not("still_url", "is", null);
  const live = new Set((keep ?? []).map(r => String(r.still_url).split(`/${BUCKET}/`)[1]));
  const { data: old, error } = await db.from("cam_stills").select("id,storage_path").lt("captured_at", cutoff).limit(1000);
  if (error) throw error;
  const doomed = (old ?? []).filter(r => !live.has(r.storage_path)); // never delete a still a card points at
  if (!doomed.length) return console.log("[cam-stills] prune: nothing to do");
  const rm = await db.storage.from(BUCKET).remove(doomed.map(r => r.storage_path));
  if (rm.error) throw rm.error;
  await db.from("cam_stills").delete().in("id", doomed.map(r => r.id));
  console.log(`[cam-stills] pruned ${doomed.length} stills older than ${days}d`);
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("missing Supabase env");
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("refusing to run with TLS verification off");
  await run("ffmpeg", ["-version"], { timeout: 10_000 }); // fail loudly if the dylib is broken again
  if (flag("--prune")) return prune();
  let q = db.from("cams").select("*").eq("is_active", true).eq("auto_disabled", false);
  if (ONLY) q = q.eq("id", ONLY);
  const { data, error } = await q;
  if (error) throw error;
  const queue = (data as Cam[]).filter(c => due(c));
  console.log(`[cam-stills] ${queue.length}/${data!.length} cams due`);
  let ok = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => { for (let cam; (cam = queue.shift()); ) if (await processCam(cam)) ok++; });
  await Promise.all(workers);
  await browser?.close();
  console.log(`[cam-stills] done: ${ok} captured`);
}

main().catch(e => { console.error("[cam-stills] fatal:", redact(e.message)); process.exit(1); });
```

That is about 185 lines. Tests (`scripts/cam-capture-stills.test.ts`, which `npm test` already globs via `scripts/*.test.ts`):
- `blankReason` accepts the fog fixture (stdev 6.9) and rejects black and solid grey;
- `due()` covers every branch: link, auto_disabled, no derived still, mirror after 20 h, backoff.

To make those pure functions importable, guard `main()` with the same `isDirectRun` pattern as `cam-health-check.mjs:445-453`. I omitted the guard above for brevity.

### 3c. Where it runs — recommendation: **Mac mini, launchd**

| | Vercel cron | GitHub Actions | **Mac mini (launchd)** |
|---|---|---|---|
| ffmpeg / yt-dlp / Chrome | None. You would have to bundle `ffmpeg-static` (~70 MB) and a serverless Chromium, and yt-dlp is Python. | Available (apt, or `setup-ffmpeg`); Chrome is preinstalled on ubuntu runners. | **Already installed** (`yt-dlp 2026.07.04`, Chrome.app, Playwright browsers, `sharp`), but **ffmpeg needs a reinstall (see below)**. |
| Run time | About 80 cams × up to 25 s for browser cams, which won't fit one function invocation. It would need fan-out. | Fine (6 h job cap). | Fine. |
| Schedule | One cron already exists. Per-plan limits (I didn't verify which plan PeakCam is on). | 5-min minimum, and best-effort timing (often delayed). | Exact times via `StartCalendarInterval`. |
| Cost | Function GB-s plus bundle size. | Free on public repos. On a private repo: 8 runs/day × ~5 min = ~1,200 min/month against the 2,000-min free allowance (visibility not verified). | $0 marginal. |
| Ops fit | Different from every other data job. | The repo has **no `.github/` directory at all**. That means new secrets (service role key) in GitHub, plus a new surface. | **Matches the established pattern.** `CLAUDE.md:96`: snotel, model-sync and cam-health all run here with logs in `scripts/*.log`, and the mini's `.env.local` is the canonical secrets file. |
| Network | AWS IPs. | Azure IPs; some cam CDNs throttle datacenter ranges. | Residential IP, like a real viewer. |
| Risk | — | — | Single box. That is mitigated because the read path degrades gracefully: a stale still with a timestamp, never an empty card. |

**Prerequisite fix on the mini:** `brew reinstall ffmpeg` (or `brew upgrade ffmpeg x265`). Current error:
`dyld: Library not loaded: /opt/homebrew/opt/x265/lib/libx265.216.dylib … Referenced from …/ffmpeg/8.1.2_1/bin/ffmpeg`.
The script's startup `ffmpeg -version` check makes this fail loudly in the log instead of silently producing zero captures.

New plist `~/Library/LaunchAgents/com.peakcam.cam-capture-stills.plist`. It follows `com.peakcam.model-sync.plist` (`npx tsx`, PATH set) and the cam-health plist (`StartCalendarInterval`). The mini is on CDT, so 06:20 to 20:20 every 2 h covers daylight from Chile/Argentina through the US Pacific. Minute 20 avoids colliding with cam-health at 06:00. One daily prune runs at 03:30.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.peakcam.cam-capture-stills</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/npx</string><string>tsx</string>
    <string>/Users/maestro_admin/peakcam/peakcam/scripts/cam-capture-stills.ts</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/maestro_admin/peakcam/peakcam</string>
  <key>StartCalendarInterval</key><array>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>16</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>20</integer></dict>
    <dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>20</integer></dict>
  </array>
  <key>StandardOutPath</key><string>/Users/maestro_admin/peakcam/peakcam/scripts/cam-capture-stills.log</string>
  <key>StandardErrorPath</key><string>/Users/maestro_admin/peakcam/peakcam/scripts/cam-capture-stills.log</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict></plist>
```

The prune job is a sibling plist, `com.peakcam.cam-stills-prune`, with `--prune` at 03:30. Add `"cam-stills": "tsx scripts/cam-capture-stills.ts"` to `package.json` scripts, and update the `CLAUDE.md:96` launchd list.

### 3d. Read path — fallback order and labels

Order of candidates, consumed by the card's existing `onError` chain (`CardCameraPreview.tsx:11,26`):
1. **Provider still** (derived, `kind: "provider"`), ranked by health as today.
2. **Captured still** (`cams.still_url`, `kind: "captured"`), ranked by freshness. This is always the last *good* capture, so it is "today's" or "yesterday's" automatically.
3. Existing empty state.

"Most recent historical still" needs no extra branch. `still_url` only advances on success, so it *is* the most recent good still. `cam_stills` is never read by the site.

Diff sketch against the **seo-branch** `lib/cam-preview.ts`:

```diff
-export interface CameraPreview { cam: Cam; src: string; label: string }
+export interface CameraPreview {
+  cam: Cam; src: string; label: string;
+  /** provider = third-party still with unknown capture time; captured = our copy with a real timestamp */
+  kind: "provider" | "captured";
+  capturedAt: string | null;
+}
+export const STALE_AFTER_MS = 48 * 3600_000;
+const STILL_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/cam-stills/`;
+
+/** Our own stored still: only ever a storage URL we wrote, with its capture time. */
+export function capturedStill(cam: Cam): CameraPreview | null {
+  if (!cam.still_url?.startsWith(STILL_PREFIX) || !cam.still_captured_at) return null;
+  if (!Number.isFinite(Date.parse(cam.still_captured_at))) return null;
+  return { cam, src: cam.still_url, label: "Captured still", kind: "captured", capturedAt: cam.still_captured_at };
+}

 export function cameraPreview(cam: Cam): CameraPreview | null {
   try {
-    return previewSource(cam);
+    return previewSource(cam) ?? capturedStill(cam);
   } catch {
-    return null;
+    return capturedStill(cam);
   }
 }

 function previewSource(cam: Cam): CameraPreview | null {
-  if (cam.embed_type === "image" && …) return { cam, src: cam.embed_url, label: "Camera still" };
-  if (cam.embed_type === "youtube") return { cam, src: `https://i.ytimg.com/vi/${cam.youtube_id}/hqdefault.jpg`, label: "Stream preview" };
+  const p = (src: string, label: string): CameraPreview => ({ cam, src, label, kind: "provider", capturedAt: null });
+  if (cam.embed_type === "image" && …) return p(cam.embed_url, "Camera still");
+  if (cam.embed_type === "youtube") return p(`https://i.ytimg.com/vi/${cam.youtube_id}/hqdefault_live.jpg`, "Stream preview");
   … brownrice / ipcamlive / roundshot → p(…) …
 }

-export function cameraPreviews(cams: readonly Cam[]): CameraPreview[] {
-  return availableCameras(cams).map(previewSource)
-    .filter((item): item is NonNullable<typeof item> => item !== null)
-    .sort((a, b) => (a.cam.consecutive_failures ?? 0) - (b.cam.consecutive_failures ?? 0) || Number(a.cam.embed_type === "youtube") - Number(b.cam.embed_type === "youtube"));
+/** Every still a resort card may try, best first. The card walks this list on <img> error. */
+export function cameraPreviews(cams: readonly Cam[]): CameraPreview[] {
+  const safe = (cam: Cam) => { try { return previewSource(cam); } catch { return null; } };
+  const all = availableCameras(cams).flatMap(cam => [safe(cam), capturedStill(cam)])
+    .filter((item): item is CameraPreview => item !== null);
+  const time = (p: CameraPreview) => (p.capturedAt ? Date.parse(p.capturedAt) : 0);
+  return all.sort((a, b) =>
+    Number(a.kind === "captured") - Number(b.kind === "captured")      // provider stills first
+    || (a.cam.consecutive_failures ?? 0) - (b.cam.consecutive_failures ?? 0)
+    || Number(a.cam.embed_type === "youtube") - Number(b.cam.embed_type === "youtube")
+    || time(b) - time(a));                                              // freshest capture first
 }
```

`process.env.NEXT_PUBLIC_SUPABASE_URL` is inlined at build time, so the prefix check works client-side. In the unit test, set it or inject the prefix.

**Card labels** (`CardCameraPreview.tsx:38`):

```tsx
function stillCaption(p: CameraPreview, now: number): { text: string; stale: boolean } {
  if (p.kind === "provider") return { text: `${p.label} · From camera operator`, stale: false };
  const t = Date.parse(p.capturedAt!), age = now - t;
  const time = new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
  if (age > STALE_AFTER_MS) return { text: `Last still ${day} · Camera offline?`, stale: true };
  if (new Date(t).toDateString() === new Date(now).toDateString()) return { text: `Still from today, ${time}`, stale: false };
  return { text: `Still from ${day}, ${time}`, stale: false };
}
```

- **"Live still" wording:** I'd **not** label provider stills "Live". The repo's own rule says these are not proof of a live capture (`scripts/data/camera-previews/README.md`, and the existing "Capture time unavailable" text). Only our captured stills carry a real time, so only they get a timestamp. If the owner wants "Live" anywhere, it should only appear on a captured still under ~2 h old: `Captured 7:40 AM`.
- **Stale (> 48 h):** keep the image, but add `grayscale opacity-75` on the `<img>`. Add an amber stamp chip top-right, "STALE · OCT 11", styled like the existing count chip at `:42`. Change the aria-label to "Last available still from Oct 11". This tells the user honestly that the cam is down without showing an empty card.
- **Hydration:** `CardCameraPreview` is a client component but is still server-rendered. `toLocale*` and `Date.now()` differ between the Vercel server (UTC) and the browser. Compute `now` in a `useEffect` (render the caption without a time on first paint), or put `suppressHydrationWarning` on the caption span. Times show in the viewer's local zone; resort time zones are not in the schema (`lib/types.ts:11-29`).
- **Freshness ceiling:** the browse catalog is cached for 1 h (`lib/supabase.ts:22`), so a new capture reaches cards within 1 h. That is fine at a 2 h cadence.

### 3e. `next.config.ts` images

**Nothing is required.** Cards use a raw `<img>` (`CardCameraPreview.tsx:21-23`), and the CSP `img-src … https:` (`next.config.ts:46`) already allows `owsxnogvufankayfwczl.supabase.co`. If you later move cards to `next/image` (that would mean Vercel Image Optimization cost; the stills are already 640 px webp, so there's little gain), replace the deprecated `images.domains: []` (`:146-148`) with:

```ts
images: {
  remotePatterns: [
    { protocol: "https", hostname: "owsxnogvufankayfwczl.supabase.co", pathname: "/storage/v1/object/public/cam-stills/**" },
  ],
},
```

### 3f. Cost and size

| Input | Value |
|---|---|
| Still size (640 w, webp q72, measured) | 2-41 KB, so plan on about 25 KB average |
| Cams with no provider still after the quick wins | about 25 iframe cams (wetmet 5, camstreamer 6, rtsp.me 2, skicooper 3, ozolio 2, livespotting, explore, streamcasthd, dead ipcamlive and brownrice…) |
| Captures per day | 25 cams × 8 runs = 200, plus a daily mirror of about 300 provider-still cams = **~500 per day** |
| Storage written | 500 × 25 KB ≈ **12.5 MB/day**. 7-day retention ≈ **90 MB**; 30 days ≈ 375 MB |
| DB | 500 `cam_stills` rows/day, pruned to about 3.5k rows. Negligible. |
| Run time | HLS 0.5-1.5 s per cam (measured). Browser path ~15-30 s. Mirror under 1 s. Concurrency 4 gives roughly **2-4 min per run**. |
| Egress | Only cards whose provider still fails or doesn't exist load from Supabase: roughly 8-19 resorts. Each impression is ~25 KB, and immutable URLs plus `max-age=31536000` mean repeat visitors hit the browser cache. At 10k such impressions a day that is 250 MB/day, about 7.5 GB/month. **That is above the Supabase Free plan's 5 GB egress** if the project is on Free. I could not verify the plan, so check it. If it is a problem, serve the bucket through a Vercel rewrite with long CDN caching, or cut to 480 px. |

---

## 4. Rollout order

1. **PR 1 (no infra):** provider mapping (§2a) plus `hqdefault_live` and `object-cover` for YouTube (§2b), with tests. This fixes 11 of 37 empty cards.
2. **Data task:** replace the 18 `link`-only resorts' URLs with real cam URLs, or reclassify them as `iframe` where the link is actually a player (Granby's `camstreamer.com/live/stream/1865`). Capture can't help these.
3. **On the mini:** `brew reinstall ffmpeg`, then verify with `ffmpeg -version`.
4. **PR 2:** migration 022, `lib/types.ts` fields, `scripts/cam-capture-stills.ts` plus tests, the plist (committed next to `com.peakcam.model-sync.plist`), and the `CLAUDE.md` launchd list.
5. Apply 022. Resolve the duplicate `021_*` numbering between branches first.
6. Run `--dry-run --all` on the mini, then a real run, and watch the log for a day.
7. **PR 3:** the read-path fallback and labels in `lib/cam-preview.ts` and `CardCameraPreview.tsx` (§3d).

## 5. What I could not verify

- **Whether the browser path actually yields frames** for wetmet (signed m3u8 returned 404 to plain ffmpeg even with a Referer, so the request may also need `Origin` or cookies), rtsp.me, camstreamer and ozolio. I did not run Playwright against them.
- **Whether `channel: "chrome"` launches headless under the `maestro_admin` launchd session.** It should, as a LaunchAgent in the GUI domain, but I did not test it.
- The `yt-dlp -g` path for YouTube. It isn't installed locally and I did not run it on the mini.
- The Supabase plan, so storage and egress limits, and Vercel plan or cron limits.
- GitHub repo visibility, which affects Actions minutes.
- That tsx resolves `lib/cam-preview.ts`'s JSON import under Node 26 on the mini. I expect it to, but did not run it.
- That `hqdefault_live` stays fresher than `hqdefault` over time. Today they were byte-identical, and only the cache headers differ.
- The 5 dead quick-win targets (Homewood `homewood5`, Bretton Woods `63c1cffd31643`, ipcamlive `663aa2e1bf523`, `pistanovicios`, `tiobobs`) may be temporarily offline rather than retired.
- Real traffic numbers for the egress estimate. PostHog was not queried.
