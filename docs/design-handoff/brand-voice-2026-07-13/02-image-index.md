# 02 — Image index

All files live in `images/`. Generated 2026-07-13 via xAI Imagine (`grok-imagine-image` family).  
**No production wiring** — exploration assets for Claude Design.

**Convention:** Prefer type overlays in Figma/code. These files are atmosphere + design objects.

**Aesthetic filter:** PeakCam = **rugged REI outdoor catalog**, not luxury travel.  
See `00-aesthetic-lock.md`. Prefer **Grade A** assets for primary brand comps.

---

## Catalog

| File | Aspect | REI grade | Kind | Primary use | Copy pairing |
|------|--------|-----------|------|-------------|--------------|
| `01-cam-truth.jpg` | 16:9 | **A** | Mood / product metaphor | “See before you go” / anti-brochure | *Check the cams.* · *See the mountain.* |
| `02-hero-rockies.jpg` | 16:9 | **A** | Hero candidate | Homepage hero (NA / default) | ★ *Where’s it good?* |
| `03-hero-andes.jpg` | 16:9 | **B** | Hero / SA launch | SA geographic (keep warm, not glossy) | *Winter’s always on.* · Andes story |
| `04-dawn-patrol.jpg` | 16:9 | **A** | Decision mood | Hero alt · “worth the drive” story | *Where’s it good?* · *Check before you go.* |
| `05-card-texture-vintage.jpg` | ~2:3 | **A** | Card object | Resort card bg · featured strip frame | *Best right now.* |
| `06-poster-blank-topo.jpg` | 3:4 | **A** | Poster field | Type-first poster comps · deck covers | Any tagline on cream paper |
| `07-powder-banner.jpg` | ~2:1 | **A** | Banner | Powder strip · alert marketing · ultrawide | *Pow day* (badge only) |
| `08-texture-topo-paper.jpg` | 1:1 | **A** | Texture | Backgrounds · patterns · UI paper feel | N/A (texture) |
| `09-object-stamp-ring.jpg` | 1:1 | **A** | Design object | Badge / stamp language · empty center for type | Mono eyebrow labels |
| `10-andes-lake.jpg` | 16:9 | **C** | SA iconography | Secondary SA only — can read postcard | SA launch (crop / scrim hard) |
| `11-social-og-mood.jpg` | 16:9 | **A** | Social | OG / Twitter share base (add type later) | Meta: cams + snow reports |
| `12-las-lenas-volcanic.jpg` | 16:9 | **B** | SA terrain | Las Leñas character — keep rugged, not resort-luxury | SA featured resorts |
| `13-dual-hemisphere.jpg` | 16:9 | **C** | Concept | Concept only — blend can feel “campaign epic” | *Rockies to the Andes* |
| `14-object-map-still-life.jpg` | 1:1 | **A** | Still life | About / brand story · REI-planning-desk energy | *Check before you go.* |

---

## Quality notes for designers

| File | Strengths | Watch-outs |
|------|-----------|------------|
| 01 | Honest cam/vignette energy | Slightly resort-run look — good for “truth,” not luxury |
| 02 | Strong PeakCam intimacy, pine frame, alpenglow peak | Keep type light on dark tree edges |
| 03 | Clearly Andes (red rock + snow) | Epic — don’t let type compete with peak highlight |
| 04 | Decision-morning narrative | Road/bench elements — fine for mood, maybe crop for pure brand |
| 05 | Vintage postcard card frame built in | Already has cream border — may double-frame in UI |
| 06 | Perfect type field; topo + stamp language | Keep center empty for headline |
| 07 | Warm powder corridor, ultrawide | Slightly “fantasy trail” — use for emotion not literal cam |
| 08 | Paper + topo texture | Brown smudges can read dirty — crop if needed |
| 09 | Physical stamp for system language | Empty center ready for short mono labels |
| 10 | High-Andes lake, cinematic | Touristic if overused — pair with tool copy |
| 11 | Quiet, factual ridge — good OG base | Soft light; test type contrast |
| 12 | Distinct volcanic SA character | Strong red — respect alpen accent, don’t add neon |
| 13 | Explicit dual-hemisphere concept | Center blend is soft — type may prefer left or right third |
| 14 | Planning still life | Has map labels / stamp art — treat as mood not literal UI chrome |

---

## Suggested pairings for comps

### Comp set A — Default brand (recommended, strongest REI fit)

1. Hero: `02-hero-rockies.jpg` + “Where’s it good?”  
2. Featured card texture: `05-card-texture-vintage.jpg` + “Best right now.”  
3. Footer/about: `14-object-map-still-life.jpg` + “Check before you go.”  
4. OG: `11-social-og-mood.jpg` + product meta line  
5. Cam-truth story: `01-cam-truth.jpg`  
6. Powder strip: `07-powder-banner.jpg`  

### Comp set B — SA launch (keep rugged — avoid luxury Andes travel ad)

1. Prefer: `03-hero-andes.jpg` or `12-las-lenas-volcanic.jpg` with heavy cream/ink type scrim  
2. Use sparingly: `10-andes-lake.jpg`, `13-dual-hemisphere.jpg` (Grade C — postcard risk)  
3. Banner: `07-powder-banner.jpg` only if powder narrative, not “Andes = powder always”  
4. Always pair SA photos with **tool copy**, not travel-brochure copy  

### Comp set C — System / poster (on-brand UI language)

1. `06-poster-blank-topo.jpg` + full type hierarchy specimen  
2. `09-object-stamp-ring.jpg` + badge experiments  
3. `08-texture-topo-paper.jpg` as page bg  

---

## Generation log (prompts abbreviated)

| # | Intent | Prompt gist |
|---|--------|-------------|
| 01 | Cam truth | Webcam-like ski mid-mountain, vignette, honest not brochure |
| 02 | Rockies hero | Peak through pines, dawn peach light, film grain |
| 03 | Andes hero | High Andes red rock + snow + alpenglow |
| 04 | Dawn patrol | Snowy road to peaks, blue hour + first light, falling snow |
| 05 | Card texture | Vertical snowy ridge, cream vintage frame |
| 06 | Poster blank | Cream paper, green topo lines, bark mountain silhouette, empty center |
| 07 | Powder banner | Ultrawide forest corridor, golden mist, falling snow |
| 08 | Paper texture | Cream paper, topo lines, stamp smudges |
| 09 | Stamp ring | Forest green circular rubber stamp on cream, empty center |
| 10 | Andes lake | High alpine lake + steep snow peaks (Portillo-atmosphere) |
| 11 | Social OG | Quiet snow ridge, soft overcast, type room up top |
| 12 | Volcanic SA | Las Leñas–style red volcanic rock + snow faces |
| 13 | Dual hemisphere | Split cool Rockies / warm Andes diptych |
| 14 | Still life | Topo map, ruler, pencil, stamped paper on desk |

---

## Naming for Claude Design imports

Import as a single folder. Suggested Figma page structure:

```
PeakCam Brand Handoff 2026-07-13
├── 00 Brief
├── 01 Copy
├── 02 Images (this set)
├── Surfaces
│   ├── Hero
│   ├── Browse featured
│   ├── Footer
│   ├── OG / social
│   └── SA launch
└── Specimens (type on 06-poster-blank)
```
