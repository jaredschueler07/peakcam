# Media Permissions + Feature Roadmap

> **Status: DRAFT 2026-07-24.** Product/ops design for permission-first resort photography, plus a consolidated PeakCam feature roadmap. Not yet implemented. Ownership: product + ops outreach first; eng builds form/schema when Phase 1 cam-stills is greenlit.

---

## Part A — Permission-first local images

### Goal

Replace AI “mountain mood” photography with **real place images** PeakCam has rights to show: cam stills first, then **official/local photos after a written yes**. Human (or carefully assisted) outreach asks; a form captures the grant; the site hosts credited images only.

### Non-goals (v1)

- Scraping Instagram/Facebook/X and hotlinking without a grant
- Automated mass cold DMs via unofficial APIs
- Hashtag UGC firehoses
- Replacing live cams with a social gallery
- AI upscaling/faking weather on real photos

### Principles

1. **Cams first, social second** — conditions truth stays on webcams + snow numbers.
2. **No display without a rights path** — cam feed, resort grant, creator license, or clear CC/press license.
3. **Attribution always** — credit name + outbound link on detail surfaces.
4. **Revocable** — remove within 72h of revoke request.
5. **Anti-brochure** — prefer terrain/storm/base; demote lifestyle/ads.
6. **Bot runs the pipeline, human runs the relationship** — CRM + form + drafts, not spam bots.

### Layered sources

| Layer | Source | Rights basis | Phase |
|-------|--------|--------------|-------|
| 0 | PeakCam cam still capture | `cam_feed` | P1 eng |
| 1 | Official resort social / press | `resort_grant` | P2 outreach |
| 2 | Local photographers / creators | `creator_license` | P2–P3 |
| 3 | CC / press kit | `cc_license` | opportunistic |

---

## A1. Database schema (draft migration 015)

Apply by hand (SQL Editor / MCP), consistent with repo practice. Number is documentation-only.

```sql
-- supabase/migrations/015_resort_media_permissions.sql
-- PeakCam — resort media + permission grants
-- RLS: public read approved media; grants/admin writes service-role only.

-- ── Permission grants (the “yes” on file) ─────────────────────
create type media_grant_scope as enum (
  'single_posts',      -- only listed post URLs / assets
  'official_account',  -- curator may pick from named official accounts
  'upload_pack'        -- they uploaded files; only those assets
);

create type media_grant_status as enum (
  'pending',    -- form submitted, not yet reviewed
  'active',
  'revoked',
  'expired',
  'rejected'
);

create table if not exists media_permissions (
  id                   uuid primary key default gen_random_uuid(),
  resort_id            uuid references resorts(id) on delete set null,
  -- null resort_id allowed for photographer grants spanning multiple resorts
  status               media_grant_status not null default 'pending',
  scope                media_grant_scope not null,

  -- grantor
  grantor_name         text not null,
  grantor_email        text not null,
  grantor_role         text,                    -- "marketing", "photographer", etc.
  authorized_checkbox  boolean not null default false,
  -- "I have rights / am authorized to grant this"

  -- accounts & posts covered
  instagram_handle     text,
  x_handle             text,
  facebook_url         text,
  website_url          text,
  post_urls            text[] not null default '{}',  -- for single_posts
  credit_name          text not null,                 -- shown in UI
  credit_url           text not null,                 -- link-out

  -- license terms (checkbox snapshot at grant time)
  allows_site_display  boolean not null default true,
  allows_peakcam_social boolean not null default true, -- PeakCam IG/email promoting the page
  allows_marketing_ads boolean not null default false, -- Meta ads, etc. — opt-in
  commercial_ack       boolean not null default false, -- they know PeakCam is commercial

  notes                text,                    -- freeform from form
  proof_kind           text,                    -- 'form' | 'email' | 'dm_screenshot'
  proof_ref            text,                    -- storage path or message id
  source_ip_hash       text,
  user_agent           text,

  reviewed_at          timestamptz,
  reviewed_by          text,
  reject_reason        text,
  revoked_at           timestamptz,
  revoke_reason        text,
  expires_at           timestamptz,             -- optional time-boxed grant

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists media_permissions_resort_idx
  on media_permissions (resort_id, status);
create index if not exists media_permissions_email_idx
  on media_permissions (grantor_email);
create index if not exists media_permissions_status_idx
  on media_permissions (status) where status in ('pending', 'active');

alter table media_permissions enable row level security;
-- No anon/auth policies: deny-all. Service role for form API + admin.

-- ── Media assets (what we actually show) ─────────────────────
create type media_source as enum (
  'cam_still',
  'resort_official',
  'creator',
  'press_license',
  'upload'
);

create type media_platform as enum (
  'peakcam_cam',
  'instagram',
  'x',
  'facebook',
  'youtube',
  'upload',
  'other'
);

create type media_rights_basis as enum (
  'cam_feed',
  'resort_grant',
  'creator_license',
  'cc_license',
  'embed_only'
);

create type media_kind as enum (
  'conditions',
  'terrain',
  'base_area',
  'lifestyle',
  'unknown'
);

create type media_status as enum (
  'pending',
  'approved',
  'rejected',
  'revoked',
  'expired'
);

create table if not exists resort_media (
  id                   uuid primary key default gen_random_uuid(),
  resort_id            uuid not null references resorts(id) on delete cascade,
  permission_id        uuid references media_permissions(id) on delete set null,
  -- null only for cam_still / clear cc with license_note

  source               media_source not null,
  platform             media_platform not null,
  status               media_status not null default 'pending',
  rights_basis         media_rights_basis not null,

  -- storage (prefer our copy)
  storage_path         text,                 -- Supabase Storage path
  thumb_path           text,
  remote_url           text,                 -- original post CDN or cam URL
  original_post_url    text,                 -- human-visible source link
  width                int,
  height               int,
  focal_point          jsonb,                -- {"x":0.5,"y":0.4}
  taken_at             timestamptz,
  captured_at          timestamptz not null default now(),

  credit_name          text not null,
  credit_url           text not null,
  license_note         text,

  kind                 media_kind not null default 'unknown',
  score                smallint not null default 0,
  is_hero              boolean not null default false,
  is_card              boolean not null default false,

  cam_id               uuid references cams(id) on delete set null, -- if cam_still
  moderated_by         text,
  moderated_at         timestamptz,
  reject_reason        text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists resort_media_resort_status_idx
  on resort_media (resort_id, status);
create index if not exists resort_media_hero_idx
  on resort_media (resort_id) where is_hero = true and status = 'approved';
create unique index if not exists resort_media_one_hero_per_resort
  on resort_media (resort_id) where is_hero = true and status = 'approved';

alter table resort_media enable row level security;

-- Public can read approved, non-revoked, non-expired display rows
create policy resort_media_public_read on resort_media
  for select
  using (
    status = 'approved'
    and (permission_id is null or exists (
      select 1 from media_permissions p
      where p.id = permission_id and p.status = 'active'
        and (p.expires_at is null or p.expires_at > now())
    ))
  );

-- Writes: service role only (no insert/update policies for anon/auth)
```

### TypeScript mirrors (`lib/types.ts` — add when implementing)

```ts
export type MediaGrantScope = "single_posts" | "official_account" | "upload_pack";
export type MediaGrantStatus = "pending" | "active" | "revoked" | "expired" | "rejected";
export type MediaSource = "cam_still" | "resort_official" | "creator" | "press_license" | "upload";
export type MediaPlatform = "peakcam_cam" | "instagram" | "x" | "facebook" | "youtube" | "upload" | "other";
export type MediaRightsBasis = "cam_feed" | "resort_grant" | "creator_license" | "cc_license" | "embed_only";
export type MediaKind = "conditions" | "terrain" | "base_area" | "lifestyle" | "unknown";
export type MediaStatus = "pending" | "approved" | "rejected" | "revoked" | "expired";

export interface MediaPermission { /* fields as above */ }
export interface ResortMedia { /* fields as above */ }
```

### Storage bucket

- Bucket: `resort-media` (private write, public read via signed or public paths under `/approved/`)
- Path convention: `{resort_slug}/{yyyy}/{media_id}.jpg` and `.../thumb.jpg`
- Cam stills: `{resort_slug}/cams/{cam_id}/{yyyy-mm-dd-HH}.jpg`

---

## A2. Public permission form

### Routes

| Path | Purpose |
|------|---------|
| `GET /media-permission` | Public form (optional `?resort=slug&utm_...`) |
| `POST /api/media-permission/submit` | Service-role insert `media_permissions` status=`pending` |
| `GET /media-permission/thanks` | Confirmation |
| `GET /media-permission/revoke?token=...` | Optional later: tokenized revoke |

### Form fields (UI)

1. **I am** — Resort staff / Photographer / Other  
2. **Resort** — searchable select (from active resorts); optional multi later  
3. **Name, email, role**  
4. **Handles** — Instagram, X, Facebook URL, website  
5. **Scope**  
   - Single posts → dynamic list of post URLs (1–10)  
   - Official account → “curate from these handles”  
   - Upload pack → file inputs (max 10, 8MB, jpeg/png/webp)  
6. **Credit name** + **Credit URL** (required)  
7. **Checkboxes (required for submit)**  
   - ☐ I own these rights or am authorized by the rights holder  
   - ☐ PeakCam may display selected images on peakcam.io with credit + link  
   - ☐ PeakCam may use them on PeakCam’s own social/email promoting that resort page  
   - ☐ I understand PeakCam is a commercial product (free for users; we may sell sponsorships)  
   - ☐ Optional: PeakCam may use in paid ads (`allows_marketing_ads`)  
8. **Notes** (optional)  
9. **Honeypot** + rate limit (same pattern as cam-reports)

### API behavior

- Validate URLs, email, resort slug, at least one handle or upload or post URL  
- Hash IP with existing cam-report salt pattern  
- Insert `media_permissions`  
- Resend email: admin notify + grantor confirmation (“we’ll review within a few days”)  
- Do **not** auto-publish images from form alone — human moderation for social/upload; cam stills use separate job

### Revocation

- Email `hello@` / form note → set `media_permissions.status = revoked`, cascade `resort_media.status = revoked` for that permission_id, delete or unpublish storage objects within 72h  
- Log `revoked_at` / reason for audit

---

## A3. Outreach system (human + light “bot”)

### What the bot/agent may do

| Allowed | Not allowed |
|---------|-------------|
| Maintain outreach queue CSV/DB | Unofficial IG/FB mass DMs |
| Draft personalized emails/DMs | Send social DMs without human approve |
| Track status / follow-up dates | Scrape private content |
| Generate form deep links | Claim implied license from “public post” |
| Notify Slack/email on form grant | Auto-approve lifestyle spam |

### Queue schema (Sheet v0 or table later)

| Column | Example |
|--------|---------|
| resort_slug | valle-nevado |
| resort_name | Valle Nevado |
| priority | 1 |
| ig_url | https://instagram.com/valle_nevado/ |
| x_url | … |
| email | marketing@… (if known) |
| channel | email \| ig_dm \| x_dm |
| status | todo \| messaged \| form_sent \| yes \| no \| no_response \| live |
| last_touch | 2026-07-24 |
| next_touch | 2026-07-29 |
| permission_id | uuid once granted |
| proof_link | … |
| notes | … |

### Priority outreach list (v1 — 24 targets)

**SA featured (P0)**  
1. ski-portillo · @skiportillo  
2. valle-nevado · @valle_nevado  
3. cerro-catedral · (Catedral Alta Patagonia official)  
4. las-lenas · official Las Leñas  

**SA secondary (P1)**  
5–10. la-parva, el-colorado, chapelco, nevados-de-chillan, corralco, cerro-bayo  

**NA traffic / brand (P1)**  
11–24. vail, breckenridge, mammoth, jackson-hole / jh-mountain, whistler, park-city, palisades-tahoe, aspen, big-sky, steamboat, killington, stowe, alta, snowbird  

Pull exact handles from `data/resort_socials.csv` / `resorts` at send time.

### Email template (final draft)

**Subject:** Feature [Resort] on PeakCam — real photos, full credit

```
Hi [Name / team],

I'm [Name] from PeakCam (https://www.peakcam.io) — a free site for live
mountain webcams and real snow numbers across ~150 resorts from the Rockies
to the Andes.

When skiers open your page, we'd rather show a real photo from your mountain
than stock or AI art. We're asking for non-exclusive permission to feature
selected images from your official social accounts (or a small press pack
you send) on peakcam.io only, always with credit and a link back to you.

• Free for you — we just need a written yes
• You can revoke anytime (we remove within 72 hours)
• We won't sell your photos to third parties
• Optional: allow use in PeakCam's own social posts about your mountain

Easiest path (2 minutes):
https://www.peakcam.io/media-permission?resort=[slug]&utm_source=outreach

Or reply "yes" + preferred credit line, and we'll send a short confirmation.

Thanks for considering it —
[Name]
PeakCam
```

### Instagram / X DM template (final draft)

```
Hey — [Name] from PeakCam (peakcam.io). Free live cams + snow conditions
for ~150 resorts (Rockies → Andes).

May we feature a couple photos from this account on your PeakCam resort
page? Full credit + link, revocable anytime — not an ad, just real mountain
context next to the cams.

Yes / pick posts → peakcam.io/media-permission?resort=[slug]
```

### Follow-up (day 5–7)

```
Quick bump on featuring [Resort] photos on PeakCam with credit — form is
here if useful: [link]. Totally fine if not; thanks either way.
```

### Cadence rules

- Max **1 initial + 1 bump** per channel  
- No third ping  
- 5–10 quality asks/week for a solo operator  
- SA season pitch window: **March–May** (planning) and **June** (live season)  
- NA: **September–November**

### Proof handling

| Reply type | Action |
|------------|--------|
| Form submit | `proof_kind=form`, auto pending |
| Email “yes” | Save thread ref; still send form or paste terms in reply for clarity |
| DM “yes” | Screenshot to Storage `proofs/`; push form link once |
| “Send a deck” | Share one-pager media kit; no images live until grant |

---

## A4. Product surfaces (when media exists)

| Surface | Behavior |
|---------|----------|
| Resort detail | Optional hero still under scrim; credit footer; cams remain primary |
| Browse cards | Soft photo only if `is_card` + approved; else poster UI |
| `/south-america` | Featured resorts use hero media |
| OG image | Prefer approved hero or cam still + type |
| Fallback | Current cream/condition UI — never random stock |

### UI credit line

```
Photo: @skiportillo · Instagram ↗
```
or
```
Still from Plateau cam · 07:14 local · Live feed →
```

### Moderation checklist (human)

- [ ] Grant `active` and matches asset  
- [ ] Kind ≠ pure lifestyle unless intentional  
- [ ] No stolen watermark from third party  
- [ ] Credit correct  
- [ ] Set `is_hero` / `is_card` sparingly (one hero)  
- [ ] Prefer landscape for hero  

---

## A5. Implementation phases (media)

### Phase M0 — Ops only (this week, no eng)

- [ ] Create outreach Sheet from CSV + 24 targets  
- [ ] Use **Typeform/Tally** interim form → email inbox (until native form)  
- [ ] Send 5 pilot asks (Portillo, Valle Nevado, Catedral, Las Leñas, one NA)  
- [ ] Log replies  

### Phase M1 — Cam stills (eng, no permission needed)

- [ ] Migration 015 (or split: media table first, permissions second)  
- [ ] Capture job for healthy `image` cams → Storage + `resort_media`  
- [ ] Quality gates (size, not black frame, cam not auto_disabled)  
- [ ] Resort detail optional hero from latest cam still  

### Phase M2 — Native form + permissions

- [ ] `/media-permission` + `POST /api/media-permission/submit`  
- [ ] Admin review path (Supabase Table Editor or minimal `/admin` later)  
- [ ] Manual ingest of granted social/upload images  
- [ ] Credit UI on detail  

### Phase M3 — Scale

- [ ] Claim-resort / sponsor photo pack in sponsorship deals  
- [ ] Agent drafts outreach from queue (human approve send)  
- [ ] Optional Graph API only for **connected** official accounts  

---

## A6. Success criteria (media)

- ≥1 approved non-AI hero on each of the 4 SA featured resorts  
- Every non-cam image has `permission_id` or documented `cc_license`  
- Zero scraped-without-grant images in prod  
- Revoke test: image gone ≤72h  
- Attribution visible on detail for all social/creator media  

---

# Part B — Feature roadmap

Consolidated from `TASKS.md`, `docs/NEXT-STEPS.md`, SA expansion, cam-viewing, monetization research, and this media work. Ordered by **user value × brand fit × feasibility**, not by age of the doc.

## North-star product

> The fastest honest glance: **live cams + real snow numbers** across both hemispheres — free core, no ad noise — so you decide where to ski.

Roadmap themes:

1. **Trust the cams**  
2. **Trust the numbers**  
3. **Both hemispheres always live**  
4. **Trip decision tools**  
5. **Sustainable revenue without selling the soul**

---

## Now — Ship / stabilize (0–6 weeks)

Things that make the live product believable this season.

| ID | Feature | Why | Status notes |
|----|---------|-----|--------------|
| N1 | **Cam health auto-disable + recovery** | Dead cams destroy trust | Spec’d 2026-07-13; migration 014 pattern |
| N2 | **Cam lightbox + image-cam polish** | Core identity interaction | Spec’d; CamEmbed partially present |
| N3 | **SA live in prod** — model-sync, 20 resorts, homepage feature | Summer product | Design approved; verify deploy/sync |
| N4 | **SA cam coverage pass** | Pillán, cam-light leads, unverifiable sets | In cam-viewing scope fence |
| N5 | **Powder alerts reliable E2E** | Retention hook | Launch-era; re-verify |
| N6 | **Analytics baseline** | PostHog funnels: browse → resort → cam → alert signup | Required before monetization claims |
| N7 | **Media Phase M0** | Outreach Sheet + pilot asks | Ops |

**Exit criteria:** Dead cams not shown; SA resorts appear with ratings/cams; alerts fire; you know which pages get traffic.

---

## Next — Differentiation (6–16 weeks)

| ID | Feature | Why |
|----|---------|-----|
| X1 | **Cam still heroes (Media M1)** | Real place imagery without IG ToS |
| X2 | **Media permission form + grants (M2)** | Rights-safe local/official photos |
| X3 | **`/south-america` hub** | Seasonal SEO + monetization surface |
| X4 | **Contextual affiliate CTAs** | “Plan trip / stay nearby” — first revenue |
| X5 | **Historical SWE / depth charts** | % of normal band from `snowpack_daily` + normals (NA first) |
| X6 | **Snow report + browse deeper conditions** | Trend, % normal, outlook fully polished everywhere |
| X7 | **Lift status (Liftie) in UI** | Pipeline had fetcher; surface open lifts where available |
| X8 | **Hemisphere-flip email** | Apr–May: redirect NA alert users to Andes |

**Exit criteria:** SA hub live; at least affiliate links live; 4 SA resorts have real heroes; charts on SNOTEL resorts.

---

## Later — Growth product (4–9 months)

| ID | Feature | Why |
|----|---------|-----|
| L1 | **Freemium Pro** (~$30/yr) | Extended forecast, custom alert thresholds, multi-cam dashboards, history — free core unchanged |
| L2 | **Push notifications** | Powder alerts beyond email |
| L3 | **Multi-resort trip planner** | Compare + dates + rough drive/fly framing |
| L4 | **Claim / enhanced resort listing** | B2B light; photo pack + badge |
| L5 | **Embeddable cam/conditions widget** | Distribution + backlinks |
| L6 | **Destination sponsorship packages** | Native “presented by,” not display ads |
| L7 | **Creator upload portal** | Scale local photogs beyond email |
| L8 | **BC + non-SNOTEL NA data parity** | model-sync already aimed here — productize quality |

**Exit criteria:** Registered-user base large enough to justify Pro; 1–3 paid sponsors or meaningful affiliate $; widget in wild.

---

## Someday / optionality

| ID | Feature | Notes |
|----|---------|-------|
| S1 | B2B conditions API / MCP for agents | Architect clean reads now; sell later |
| S2 | SERNATUR / INPROTUR co-marketing | After traffic proof |
| S3 | Spanish/Portuguese i18n | Explicit non-goal for SA v1 |
| S4 | SNODAS / melt visualizations | Research depth, not core glance |
| S5 | Europe / NZ / Japan resorts | Only after dual-hemisphere NA+SA is excellent |
| S6 | Hard paywall on cams | **Rejected** brand-wise |
| S7 | Programmatic display ads | **Rejected** unless deliberate brand reset |
| S8 | Concierge storm-chase service | Labor-heavy; avoid |

---

## Explicitly not doing (near term)

- Resurrecting dormant `lib/pipeline/` blender as the live feed (SNOTEL + model-sync path wins)  
- Expanding AI mountain photography for resort identity  
- Building a full CMS for resorts before claim/sponsor demand  
- i18n before English SA hub + permissions work  

---

## Suggested sequencing diagram

```text
NOW                    NEXT                     LATER
─────────────────────  ───────────────────────  ──────────────────
Cam trust (N1–N2)  ──▶ Cam stills (X1)      ──▶ Pro + push (L1–L2)
SA live (N3–N4)    ──▶ SA hub + affiliate   ──▶ Sponsors (L6)
Alerts + analytics ──▶ Permissions (X2)     ──▶ Claim/widget (L4–L5)
                       Charts / lift UI (X5–X7)
                       Hemisphere email (X8)
```

---

## Roadmap metrics (what to watch)

| Metric | Why |
|--------|-----|
| Weekly active resort-page views | Monetization + SEO |
| Cam play rate / lightbox opens | Core product engagement |
| Alert subscribers + open rate | Retention |
| SA hub views (Jun–Sep) | Seasonal strategy |
| Outbound affiliate clicks | Revenue signal |
| Active media grants / heroes live | Media program health |
| Registered users (favorites/dashboard) | Pro gate |

---

## Doc map (related)

| Doc | Role |
|-----|------|
| `docs/superpowers/specs/2026-07-12-south-america-expansion-design.md` | SA product |
| `docs/superpowers/specs/2026-07-13-cam-viewing-design.md` | Cam UX |
| `docs/superpowers/specs/research/2026-07-13-monetization-research.md` | Revenue models |
| This doc | Media rights + consolidated roadmap |

---

## Open decisions (need your call)

1. **Interim form:** Typeform/Tally now vs wait for native `/media-permission`?  
2. **Hero priority:** cam still always beats social when both exist? (**Recommend yes.**)  
3. **Card photos:** featured/SA only vs all resorts? (**Recommend featured/SA only at first.**)  
4. **Contact email for grants:** which inbox receives admin notify?  
5. **Pro pricing:** lock ~$29.99/yr when registered base hits ~5–10k?  

---

## Immediate next actions (checklist)

- [ ] Approve this draft (or mark changes)  
- [ ] Stand up outreach Sheet + send 5 pilot permission asks  
- [ ] Verify N1–N4 (cams + SA) state in prod  
- [ ] Spec/implement Media M1 (cam stills) when cam-viewing is stable  
- [ ] Native form + migration 015 when first “yes” replies arrive (or earlier if preferred)
