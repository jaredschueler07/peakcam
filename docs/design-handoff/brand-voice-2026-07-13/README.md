# PeakCam — Brand Voice & Design Handoff

**Date:** 2026-07-13  
**Audience:** Claude Design (or any designer iterating PeakCam brand/copy/visual system)  
**Status:** Exploration package — not yet wired into production app code  
**Repo path:** `docs/design-handoff/brand-voice-2026-07-13/`

---

## CRITICAL: Aesthetic is locked

**Copy may change. Look-and-feel must not.**

Keep the **same aesthetic PeakCam already has**:

> **Rugged REI / outdoor-catalog feel** + **retro ski-poster UI**  
> (cream paper, forest/bark stamps, warm film mountains — *not* luxury travel, *not* cold SaaS, *not* ski-bro neon)

Read **`00-aesthetic-lock.md` first** before anything else.  
If a comp wouldn’t sit next to the live site’s browse cards and stamp chips, it’s wrong.

---

## What this folder is

A self-contained handoff for **rethinking PeakCam’s verbal brand** (one-liners, microcopy) and providing **mood/design-object images** that stay inside the existing rugged REI aesthetic.

Context that led here:

1. South America launch (Chile/Argentina) is shipping in parallel — site is no longer “North America only.”
2. Current taglines feel lame: **“Got the goods”** and **“The lift’s spinning somewhere.”**
3. Competitive research shows those lines are **resort-social cosplay**, not tool voice. (Whistler literally used `#GetTheGoods`.)
4. PeakCam’s product job is clearer than its copy: **live cams + real snow numbers → decide where to go, without brochure spin.**
5. **Founder note:** keep the rugged REI feel — do not “premium-ize” or modern-minimal the brand while fixing words.

This package gives you:

| Path | Contents |
|------|----------|
| `README.md` | This file — how to use the handoff |
| `00-aesthetic-lock.md` | **NON-NEGOTIABLE visual direction (REI rugged + poster UI)** |
| `00-brand-brief.md` | Positioning, competitive map, voice principles |
| `01-copy-system.md` | Full proposed copy bank (hero → footer → meta) |
| `02-image-index.md` | Catalog of every generated image + REI fit grades |
| `images/` | 14 net-new brand/mood/design-object images |
| `surfaces/` | Per-UI-surface specs (what copy + which image + layout notes) |
| `research/` | Research notes distilled for design |

**Images intentionally have no (or minimal) baked-in marketing type.** Overlay real Fraunces / DM Sans / JetBrains Mono in design tools. Image models garble long text; keep type production-side.

---

## Brand system constraints (do not invent a new palette)

From `docs/design-system/tokens.css` and live app:

| Token | Hex | Role |
|-------|-----|------|
| Cream 50 | `#faf4e6` | Lightest paper |
| Cream | `#f1e7cf` | Body paper |
| Ink | `#2a1f14` | Body text / stamp |
| Bark | `#7a5a3a` | Secondary text |
| Forest | `#3c5a3a` | Primary brand green |
| Alpenglow | `#d9552f` | Only hot accent |
| Mustard | `#e2a740` | Fair / secondary accent |

**Type:** Fraunces (display, italic accents), DM Sans (body), JetBrains Mono (data, eyebrows).  
**Shadows:** hard stamp offsets, not soft glassmorphism.  
**Legacy Tailwind aliases exist** (`bg`, `cyan`→forest) — new work uses `pc-*` / current tokens only.

---

## Recommended voice in one line

> **Looks like a rugged REI ski poster. Talks like a conditions board.**

Not lifestyle ski-bro. Not NOAA-cold. Warm utility — same visual soul, clearer words.

**Preferred hero line (for exploration):**  
**Where’s it good?**

Full copy bank: `01-copy-system.md`.

---

## How Claude Design should use this

1. Read **`00-aesthetic-lock.md`** — visual is locked.  
2. Read `00-brand-brief.md` and `01-copy-system.md` for words only.  
3. Skim `02-image-index.md`; prefer **Grade A (REI-fit)** images for primary comps.  
4. For each UI surface, use the matching file in `surfaces/`.  
5. Produce comps with **real type** over images — cream/forest/stamp system unchanged.  
6. Flag / reject anything that feels luxury travel, glossy postcard, or tech-dashboard.  
7. Do **not** reintroduce: “got the goods,” “lift’s spinning,” “get the goods,” ski-bro swagger as brand personality.  
8. **Pow day** is fine as a *data badge*, not a lifestyle slogan.

---

## What is *not* in this folder

- Production app code changes (copy still partially uses old lines until we ship a brand PR).
- Backend SA seed data / migrations.
- Final locked brand decision (founder has not formally approved a single hero line yet; recommendation is documented).

---

## Related live product paths (for context only)

- Hero: `components/home/PeakHero.tsx`
- Browse / featured: `components/browse/BrowsePage.tsx`
- Footer: `components/home/PeakFooter.tsx`
- Auth modal: `components/auth/AuthModal.tsx`
- Design system: `docs/design-system/`
- SA design: `docs/superpowers/specs/2026-07-12-south-america-expansion-design.md`
