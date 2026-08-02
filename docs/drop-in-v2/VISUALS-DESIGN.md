# Drop In v2 — Visual Program Design

> Design decided 2026-08-02 (Jared delegated the call after reviewing the research).
> Grounded in three parallel research reports under `.superpowers/sdd/research/`:
> `grok-rendering-libs.md`, `assets-and-licensing.md`, `terrain-data-and-tools.md`.
> Companion to `DESIGN.md` / `P11-P12-DESIGN.md`.

## 1. Why now

Playtest feedback: the game "kind of worked, but was still a little awkward — maybe
the camera should be way more zoomed out." Wider cameras (`?cam=high|wide|cinematic`,
shipped) confirm the framing helps, but they expose the far field: real terrain stops
~600 m out (5×5 grid of 200 m tiles), then nothing until two procedurally-painted ridge
bands at 1750 m and 2900 m. Priority therefore shifts from physics to visuals.

**Total spend for this program: $0.** Every adopted tool, asset and data source is CC0,
public domain, or a permissive open licence. See §7 for what we deliberately did not buy.

## 2. Phase 0 — Licence compliance (standalone, do first)

Independent of the visual work and already owed:

1. **Copernicus GLO-30 notices.** We ship GLO-30-derived heightfields today and carry none
   of the three mandatory notices. Article 6(c) requires the liability-disclaimer sentence
   in a licence/legal notice covering distribution — a README credit does not satisfy it —
   and Article 9 permits termination of all granted rights on breach. Exact text in
   `terrain-data-and-tools.md` §4.
2. **Demote AWS Terrarium to fallback.** It is not one licence but a blend of ~13, several
   CC-BY. Harmless while our three resorts resolve to 3DEP/SRTM; it activates the moment
   anyone bakes a European, Kiwi, Australian or Norwegian resort. Pull 3DEP and GLO-30
   directly instead.
3. **Review the OSM/ODbL question.** Our runs, lifts and landmarks are OSM-derived; ODbL is
   share-alike *on the database*. Needs its own assessment before rollout — flagged, not
   resolved, by this design.

## 3. Phase 1 — Far field and DEM upgrade

**The horizon becomes the real mountain.**

- **Technique: pre-baked, radially-graded static coarse mesh to 30 km**, split into 16
  angular wedges for frustum culling. No streaming, no LOD state machine. Cell sizes
  16/48/128/256 m at 0.5/2/6/15/30 km. Budget: ~158k stored verts, ~50–60k drawn after
  culling, ~5 MB GPU, ~250 KB brotli per resort.
- **The panoramic impostor is rejected on arithmetic, not taste.** Angular drift is d/D, so
  even a slack 1° tolerance requires imagery beyond 114 km while one ski run translates the
  player 1–3 km. It also freezes shading, which for snow is nearly the entire visual signal
  because albedo carries almost none. The mesh costs about the same per frame as
  re-rendering a stale panorama, so the impostor buys nothing and inherits every failure mode.
- **DEM upgrade**: Breckenridge → USGS 3DEP 1 m lidar (`CO_Central_and_WesternCO_2016_A16`);
  Heavenly → 3DEP 1 m (`CA_SierraNevada_B22`, published 2025). Both US public domain, no
  restrictions, derived redistribution fine. Portillo stays Copernicus GLO-30: **no free
  public DEM better than 30 m exists for the Chilean Andes** — the widely-cited Chilean
  "12.5 m" products are ALOS PALSAR RTC resampled from SRTM 30 m (pixel spacing, not
  resolution), and real 12 m TanDEM-X is scientific-use-only.
  The 1 m value is not detail we draw directly; it is that averaging 1 m down to our 4 m grid
  beats interpolating 30 m.
- **Fixes a live bug**: we currently sample in Web Mercator, where X spacing is
  latitude-dependent, so a single metres-per-sample constant is wrong for at least two of our
  three resorts. Warping to each resort's UTM zone corrects it and comes free with the GDAL
  step this phase needs anyway.
- **Constraint to respect**: 3DEP is bare-earth, GLO-30 is a DSM. Never blend them inside one
  resort — the seam produces a canopy-height step. Each resort uses a single source.
- **Tooling**: GDAL via `child_process` (VRT mosaic → single warp kills the seam-artefact
  class), plus `delatin`/`martini` (ISC, pure JS) in the existing `scripts/bake-resort.ts`.

**Why first**: it is what the wider camera exposed; it is cheaper than assumed; it sets the
frame budget every later phase lives within; and at Portillo it puts **Aconcagua** — 23.1 km
out at +10°, the highest peak outside Asia — on the skyline as real geometry instead of a
painted band. That is likely the single largest visual upgrade available to this project.

## 4. Phase 2 — Lighting and surface depth

**Use what already ships in our bundle.** three r185 provides first-party TSL nodes on the
WebGPU pipeline we standardised on, at zero new dependency risk (verified present in our
installed `node_modules`): `GTAONode`, `GodraysNode`, `SkyMesh`, `DepthOfFieldNode`,
`DenoiseNode`, `Lut3DNode`, `FilmNode`, `BleachBypass`.

- **GTAO** for ambient occlusion — the direct answer to "surfaces look flat/plasticky".
  (`SSAONode` is not in 0.185.1; GTAO is the AO path.)
- **SkyMesh** (Preetham) replacing the 3-stop gradient sky.
- **Godrays** — light shafts, strongly on-brand for a ski poster.
- **ambientCG snow/rock materials** (CC0) through the KTX2/Basis pipeline we built in P11 and
  have never fed. Keep normal + roughness, discard albedo: procedural noise cannot fake snow
  sparkle, and albedo carries almost no signal on snow anyway.
- **Rejected**: N8AO, realism-effects, pmndrs/postprocessing — all WebGL-only EffectComposer
  ecosystems that would fight our WebGPU default; realism-effects is additionally stale
  (last npm release 2023).

## 5. Phase 3 — Scene density

- **Quaternius Stylized Nature MegaKit** (CC0, glTF): 40 trees, 27 rocks, already flat-shaded
  — a closer match to the poster look than any paid pack.
- Placement driven by the OSM data we already parse; **Blender-baked octahedral impostors**
  for distant instances, which is what makes thousands of instances affordable on mobile Safari.
- **glTF Transform** (MIT) as the pipeline spine — generates the LODs no kit ships, packs ORM
  channels, and finally feeds `emitKtx2Texture`.
- **Poly Haven HDRI** via Basis HDR (`basisu -hdr_4x4`) for alpenglow ambient: ~95% less VRAM
  than a naive 4K HDRI, reusing the `KTX2Loader` already in place.

## 6. Phase 4 — Art direction

Grade, time of day, alpenglow, weather drama, silhouette strength — tuned last, against a world
worth grading. Moving this to the end is a deliberate reversal of the initial instinct: grading a
fake horizon would mean grading it twice.

## 7. What we deliberately did not buy

- **Synty / KayKit / Fab-Megascans.** Combined they would cost real money to make the game look
  *less* like itself. More decisively: **browser games publish their assets** — every `.glb` we
  serve is downloadable from the network tab, and commercial asset EULAs restrict distribution in
  extractable form. Synty's explicit Roblox/VRChat carve-out shows vendors treat this as live.
- **Gaea / World Creator / Instant Terra.** All Windows-only, which alone disqualifies them from a
  macOS bake step; all are procedural-generation tools whose value is *inventing* terrain, the
  opposite of this project's premise. Gaea's free tier is explicitly non-commercial.
- **FABDEM** (CC BY-NC-SA — both clauses fatal), **TanDEM-X 12 m** (scientific-use-only),
  **Poly Pizza** (CC-BY: a permanent credits obligation on the game canvas),
  **OpenGameArt** (unfiltered GPL/share-alike contamination risk).
- **Quixel/Megascans stopped being free on 31 Dec 2024** — any guidance predating 2025 is wrong.
- **Sketchfab's CC0 corpus is orphaned** (those licence types do not exist on Fab). If used at all,
  vendor into the repo immediately with author and licence recorded; never fetch at build time.

## 8. Sequencing and gates

Phase 0 → 1 → 2 → 3 → 4. Each phase ends at an orchestrator browser-review round (the P11 lesson
holds: sandboxed agents cannot see rendering bugs) plus the existing perf guards — dual-backend e2e,
the heap growth budget, and the per-resort canvas-luminance calibration, which will need
re-baselining as a *deliberate* change whenever a phase moves the shading baseline.

Physics work (physicsV2 default flip) and Phase 10b rollout continue to wait on Jared's feel gate;
this program does not block them, and they do not block it.
