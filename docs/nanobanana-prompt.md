# PeakCam — Nanobanana Image Generation Prompt

Save all outputs to `/Users/maestro_admin/peakcam/peakcam/public/images/`

## Brand Direction

"Summit Light" theme — raw, cold, fast, alive. Think Powder Magazine meets Bloomberg Terminal.

**Color system:**
- Deep navy background: `#080D14`
- Ice blue accent: `#60C8FF`
- Alpenglow warm accent: `#FF7B5E`
- Snow-white text: `#E8F0F8`
- Powder green: `#2ECC8F`

**Target audience:** Serious skiers who care about SNOTEL data and powder days, not tourists.

---

## Image 1: Homepage Hero

```
/generate 'hero-mountain.jpg — 1920x1080. Dramatic dawn shot of a snow-covered mountain peak. Golden alpenglow hitting fresh powder on a steep north face. Deep blue-black sky transitioning to warm orange at the horizon line. No people, no buildings, no ski infrastructure — just raw untouched mountain. Mist in the valley below. Cinematic wide angle lens, shallow depth of field on the ridgeline. Color palette: deep navy shadows (#080D14), warm alpenglow highlights (#FF7B5E). Editorial photography, not stock photo. The mood is the 20 minutes before first chair when the mountain is silent.'
```

## Image 2: Powder Day Banner

```
/generate 'powder-banner.jpg — 1920x400 ultrawide banner. Extreme close-up of fresh powder snow exploding from a ski turn. Frozen motion, individual snow crystals catching ice-blue light (#60C8FF). Deep black shadows, bright crystalline highlights. No skier visible — just the powder explosion against darkness. Background fades to near-black (#080D14) at edges. Feels alive, kinetic, cold.'
```

## Image 3: Card Texture — Colorado

```
/generate 'card-texture-co.jpg — 800x1200 portrait. Abstract aerial view of Colorado snow-covered ridgelines at twilight. Cool blue-grey tones, subtle warm undertone. Gradient from #0D1F35 (top) to #0A1628 (bottom). Very subtle, almost topographic pattern. Must work as a dark card background with white text overlaid. Moody, atmospheric, minimal detail.'
```

## Image 4: Card Texture — Utah

```
/generate 'card-texture-ut.jpg — 800x1200 portrait. Same concept as above but for Utah — slightly cooler, more blue-white tones suggesting Wasatch powder. Steeper ridgeline angles. Gradient from #0E1825 to #080D14.'
```

## Image 5: Card Texture — California

```
/generate 'card-texture-ca.jpg — 800x1200 portrait. Same concept for California Sierra — slightly warmer blue-grey, suggestion of granite beneath snow. More textured surface. Gradient from #0D1F35 to #0A1628.'
```

## Image 6: Webcam Loading Placeholder

```
/generate 'cam-placeholder.jpg — 1200x675 (16:9). Mountain silhouette at dusk with a subtle horizontal scanning line effect — like radar sweeping across. Minimal, geometric. Angular mountain peaks as simple shapes against a gradient sky (navy to near-black). One thin ice-blue (#60C8FF) horizontal line at 1/3 height suggesting a scan/loading state. Clean, technical, serious. This is shown while webcam feeds are loading.'
```

## Image 7: Open Graph / Social Share

```
/generate 'og-image.jpg — 1200x630 (Open Graph). The PeakCam social share image. Dark background (#080D14). "PEAKCAM" in large condensed sans-serif centered. Below: "Real conditions. No marketing noise." in smaller text. Subtle mountain silhouette in background. Ice blue (#60C8FF) subtle glow behind the text. Professional, editorial, no emojis or playful elements.'
```

## Iteration Tips

- Use `--resume latest -p "..."` for all follow-up generations to keep visual memory warm
- The hero-mountain is the most important — spend extra time getting the alpenglow lighting right
- Card textures should be very subtle — they'll have white text overlaid
- All images save to `./nanobanana-output/` — move them to `public/images/` when finalized
