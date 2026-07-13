# 00b — Aesthetic lock (NON-NEGOTIABLE)

**Copy can change. The visual system does not.**

PeakCam keeps the aesthetic we already ship: **rugged outdoor / REI-floor energy** with a **70s–80s ski-poster** graphic layer — not luxury travel, not cold SaaS, not neon ski-bro Instagram.

---

## North star (say this out loud)

> **REI catalog meets lodge bulletin board.**  
> Warm. Useful. Slightly worn. Home-in-the-mountains — not a five-star chalet ad.

Also valid references from existing brand work:

- Patagonia catalog / Mountain Gazette / Adventure Journal film stills  
- Cream paper trail maps, rubber stamps, topo lines  
- “Coffee at 6am looking at your local peak” — not “helicopter powder epic”

---

## What “rugged REI feel” means in practice

| Dimension | Do | Don’t |
|-----------|----|--------|
| **Color** | Cream paper, forest, bark, ink; alpenglow only as accent | Ice-blue tech, pure black UI, neon, Instagram filters |
| **Light** | Golden hour, soft dawn, overcast honesty, film grain | Over-HDR, crystal luxury gloss, cyberpunk night |
| **Subject** | Real-feeling peaks, pines, trail, cam honesty, paper objects | Spa resorts, champagne powder fantasy, influencer silhouettes |
| **Texture** | Paper fiber, stamp ink, wood, topo, grain | Glassmorphism, soft UI shadows only, flat corporate vectors |
| **Type** | Fraunces + DM Sans + JetBrains Mono; chunky stamp | Thin fashion sans, script, all-caps sports-broadcast |
| **Shadow** | Hard stamp offset (`3px 3px 0 ink`) | Soft floating Material cards |
| **Mood** | Prepared, practical, go-check-the-boards | Luxury escape, party, “lifestyle brand” |
| **People** | Usually none; if any, gear-real not model-pretty | Hero athletes, après party, fashion ski |

---

## Relationship: poster system + REI rugged

These are **one aesthetic**, not two competing brands:

1. **Photographic mood** = rugged REI / west-coast outdoor catalog (warm earth, film, intimate mountains).  
2. **UI chrome** = retro ski poster (cream paper, forest/bark stamps, Fraunces display, mono data).

Together: **looks like a lodge poster, feels like gear you’d actually buy and use.**

Voice work in this handoff only replaces **words** (drop “got the goods” cosplay). It does **not** restyle the product into:

- Minimal Swiss modern  
- Dark mode dashboard  
- Luxury travel magazine  
- Gen-Z streetwear ski brand  

---

## Existing production anchors (match these)

| Anchor | Path / note |
|--------|-------------|
| Tokens | `docs/design-system/tokens.css` — cream / forest / bark / alpen |
| Live UI | Browse cards, stamp chips, topo paper sections |
| Photo direction | `public/images/hero-mountain/` — backyard peak, film, warm |
| Image gen brief | Skill: “Rustic, warm, west-coast outdoor. Patagonia catalog, not Bloomberg.” |

If a new comp would look out of place next to the current homepage and browse cards, **reject it**.

---

## Image package — REI fit grades

Use these grades when picking assets from `images/`:

| Grade | Meaning | Files |
|-------|---------|--------|
| **A — on-brand rugged** | Safe default for comps | `02-hero-rockies`, `04-dawn-patrol`, `01-cam-truth`, `07-powder-banner`, `06-poster-blank-topo`, `08-texture-topo-paper`, `09-object-stamp-ring`, `05-card-texture-vintage`, `14-object-map-still-life`, `11-social-og-mood` |
| **B — usable with care** | True to place but can read “epic travel” if over-used | `03-hero-andes`, `12-las-lenas-volcanic` |
| **C — crop / secondary only** | Beautiful but leans postcard/cinematic | `10-andes-lake`, `13-dual-hemisphere` |

Prefer **A** for primary brand frames. Use **B/C** for SA geographic specificity, not as a new glossy direction.

---

## Design review checklist (print this)

Before approving any Claude Design output:

- [ ] Cream paper + forest/bark still dominate  
- [ ] Alpenglow used sparingly (one accent, not a rainbow)  
- [ ] Hard stamp shadows, not soft SaaS elevation  
- [ ] Photo feels **intimate / usable outdoors**, not luxury brochure  
- [ ] Type is Fraunces / DM Sans / JetBrains Mono  
- [ ] Would look at home in an REI email or lodge corkboard  
- [ ] Does **not** look like Vail luxury, Apple Weather, or ski-bro TikTok  

---

## One-line lock for Claude Design

**Keep PeakCam looking exactly like PeakCam — rugged REI outdoor catalog + ski-poster UI. Only the words are up for debate.**
