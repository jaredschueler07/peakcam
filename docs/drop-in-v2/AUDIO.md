# Drop In v2 — Audio

> Companion to `DESIGN.md` §3.5 and `PLAN.md` Phase 7. Covers the module landed in
> Phase 7.1 (`lib/game/audio/`): the procedural graph ported from v1, the facade the
> runtime will call, and the structure the Phase 7.2 sample layers drop into.
> **Nothing here is wired into `GameRuntime` yet** — that is Phase 7.2.

---

## 1. Principles

1. **Procedural is the floor, samples are the ceiling.** The v1 WebAudio graph is a
   complete mix on its own. Samples layer *over* it and may fail to load at any point
   without the game noticing: a failed fetch, a decode error, an abort or an offline
   device all leave the procedural bed playing. Audio never blocks Start.
2. **Nothing happens before a gesture.** Importing `lib/game/audio` constructs no
   `AudioContext` and touches no audio global. `AudioEngine.init()` must be called
   from a user gesture (the Start press); until then every method is a safe no-op.
3. **The engine stores nothing.** Volumes, mute flags and the enable flag are set by
   the caller, which owns persistence (localStorage lives in the settings layer).
4. **Audio is orthogonal to `prefers-reduced-motion`.** A user who reduces motion has
   said nothing about sound. Audio has its own enable flag; the runtime must not
   derive one from the other.

---

## 2. Bus graph

```
                                 ┌──────────────┐
                                 │ destination  │
                                 └──────▲───────┘
                                        │
                              ┌─────────┴─────────┐
                              │  master  (0.85)   │  volume · mute · global enable
                              └──┬─────────────┬──┘
                                 │             │
                 ┌───────────────┴──┐       ┌──┴────────────────┐
                 │   music  (0.60)  │       │    sfx   (1.00)   │
                 └─────────▲────────┘       └──┬─────────────┬──┘
                           │                   │             │
                           │        ┌──────────┴──┐     ┌────┴────────────┐
                           │        │ procedural  │     │   sampleSfx     │
                           │        │  1 → 0.35   │◄───►│    0 → 1        │  crossfade
                           │        └──────┬──────┘     └────▲────────────┘
                           │               │                 │
                           │     ┌─────────┴──────────┐      │
                           │     │ ProceduralSoundBank│      │
                           │     │  · wind bed        │      │
                           │     │  · edge/carve bed  │      │
                           │     │  · lift hum        │      │
                           │     │  · one-shot voices │      │
                           │     └────────────────────┘      │
                           │                                 │
              sample layers with bus:"music"     sample layers with bus:"sfx"
              (resort ambience, soundtrack)      (wind/carve/impact enrichment)
```

`procedural` and `sampleSfx` are the two sides of the crossfade
(`SampleLayers.setMix`). At full sample mix the procedural bed ducks to **0.35** — it
is never silenced, because it is the layer that actually tracks speed, carve and air
state frame by frame. Music-bus layers have no procedural counterpart and so bypass
the crossfade entirely.

Master gain, and both child buses, are driven through `setTargetAtTime` with a 20 ms
constant so volume-slider drags do not click.

---

## 3. The listener-state contract

The runtime pushes a `ListenerState` at **15 Hz** (`LISTENER_UPDATE_HZ`, the same rate
as the HUD publish in `UiBridge`); `setListenerState` throttles internally and returns
whether the call reached the graph, so the caller may safely call it every frame.
Partial updates are merged into the retained state and clamped.

| Field | Range | Drives |
|---|---|---|
| `speed` | m/s, saturating at 55 | Wind bed gain `0.02 + sp·0.30` and cutoff `320 + sp·950 Hz`; scales the edge layer |
| `carve` | 0..1 | Edge layer gain `carve · 0.24 · (0.35 + sp)` and cutoff |
| `airborne` | bool | Cuts the edge layer to zero (no snow contact) |
| `surface` | `powder`\|`packed`\|`firm`\|`ice` | Edge filter type, resonance, brightness and level — see below |
| `windLevel` | 0..1 | Ambient weather-preset wind, added on top of the speed term |
| `liftProximity` | 0..1 | Lift machinery hum, `× 0.075` at full |

`speed`, `carve` and the two 0..1 terms come straight from `SimulationState`;
`surface` and `windLevel` come from the conditions snapshot / weather preset
(DESIGN §3.6). The engine never reads simulation state itself.

### Surface shaping

| Surface | Filter | Base Hz | + carve Hz | Q | Level |
|---|---|---|---|---|---|
| `powder` | lowpass | 900 | 1400 | 0.7 | ×0.85 |
| `packed` | bandpass | 1500 | 2600 | 1.1 | ×1.00 (v1's values) |
| `firm` | bandpass | 2300 | 3000 | 1.9 | ×1.15 |
| `ice` | bandpass | 3000 | 3200 | 2.8 | ×1.30 |

Powder is a soft, dark hiss; ice is a bright resonant scrape. `packed` reproduces the
v1 tuning exactly, so an unspecified surface sounds like the pilot build.

---

## 4. Event vocabulary

`playEvent(name, { gain?, variant? })`. Recipes live in `EVENT_RECIPES`
(`ProceduralSoundBank.ts`); each value with a v1 counterpart is copied from
`public/drop-in/engine.html` §8 unchanged, and the v1 call site is cited in the source.

| Name | Variants | Recipe | v1 origin |
|---|---|---|---|
| `jump` | — | burst 0.16 / 900 Hz / 0.18 s / lowpass | engine.html:2088 |
| `land` | `hard` (default), `soft` | burst 0.22/320/0.3 + burst 0.09/260/0.16, both lowpass; `soft` is the second alone | :2163, :2173 |
| `crash` | — | burst 0.36/180/0.55 lowpass + burst 0.22/1400/0.3 bandpass | :2185–2186 |
| `gate` | `hit` (default), `miss` | blip 760 Hz/0.14/0.13 s; miss is 180 Hz/0.12/0.18 s | :2230, :2236 |
| `lift` | — | burst 0.18 / 520 Hz / 0.16 s / bandpass | :1965 |
| `trick` | — | blip 1180 Hz/0.12/0.16 s | new — an octave above the gate blip |
| `ui` | `confirm` (default), `back` | blip 520 Hz/0.06/0.08 s; back is 300 Hz | new — deliberately below the gameplay layer |

`gain` scales the whole recipe (clamped 0..2); `gain: 0` allocates nothing. An unknown
variant falls back to `default` rather than going silent.

Two primitives back all of it, both verbatim from v1:

- **`burst(vol, freq, dur, filterType)`** — the shared brown-noise buffer through a
  biquad (Q 0.8) and an exponential 12 ms-attack envelope.
- **`blip(freq, vol, dur)`** — a triangle oscillator sweeping up ×1.9 over `dur`.

One-shot voices are tracked so `dispose()` can cut off anything still ringing; the set
is swept on each new voice, so a long run does not accumulate dead nodes.

---

## 5. Sample layers (Phase 7.2 — landed)

`SampleLayers` is the structure; **ten CC0 recordings now ship** in
`public/game/audio/`, described by a committed `manifest.json` and read through
`lib/game/audio/manifest.ts`.

```ts
interface SampleManifest {
  version: number;              // bump to invalidate a cached asset set
  layers: readonly {
    name: string;               // stable id for play()/stop()
    url: string;                // /game/audio/<file>.ogg
    gain?: number;              // 0..2, default 1
    loop?: boolean;             // default true (ambience beds)
    bus?: "music" | "sfx";      // default "sfx"
  }[];
}
```

`loadLayers(manifest, fetchImpl?, signal?)` fetches and decodes every layer
concurrently and independently, returning a per-layer report of
`loaded | failed | aborted`. One failure never cancels the others. Every load owns an
internal `AbortController`, so `abort()` (or `dispose()`, or starting a newer load)
cancels in flight; an external signal can be passed in as well — the runtime's
teardown path should hand it the same abort signal it uses for terrain assets.
`AudioEngine.loadSampleLayers` crossfades in only if at least one layer decoded.

### The shipped layer set

Five loop beds and five one-shots, all on the **`sfx`** bus. Nothing sits on the
`music` bus yet: every layer here has a procedural counterpart, so all ten should
participate in the crossfade duck rather than bypass it. Per-resort ambience and any
soundtrack (DESIGN §3.5) are the first `music`-bus candidates and are not in this set.

| Layer | Loop | Gain | s | LUFS | Peak | .ogg | .m4a |
|---|---|---|---|---|---|---|---|
| `wind-bed` | ✓ | 0.90 | 10.0 | −18.2 | −9.3 | 145 K | 160 K |
| `wind-gust` | ✓ | 0.70 | 12.2 | −18.2 | −5.1 | 130 K | 195 K |
| `carve-packed` | ✓ | 1.25 | 5.0 | −20.7 | −1.3 | 46 K | 62 K |
| `carve-powder` | ✓ | 1.00 | 9.5 | −19.3 | −6.9 | 91 K | 114 K |
| `lift-hum` | ✓ | 0.45 | 4.7 | −18.7 | −2.0 | 44 K | 57 K |
| `jump-whoosh` | | 0.70 | 0.73 | −14.4 | −2.6 | 10 K | 10 K |
| `land-soft` | | 0.90 | 1.33 | −20.7 | −3.3 | 16 K | 17 K |
| `crash-impact` | | 1.30 | 1.44 | −25.9 | −3.0 | 17 K | 18 K |
| `ui-tick` | | 0.60 | 0.74 | −26.0 | −3.0 | 10 K | 10 K |
| `trick-chime` | | 1.40 | 2.50 | −31.5 | −3.4 | 22 K | 31 K |

**1.2 MB total**, against a 2.5 MB budget. The two wind beds are stereo; everything
else is mono, which is what keeps the payload at half the budget — the procedural bed
is the layer that carries reactivity, so stereo width only earns its bytes on the
ambience.

Layer names deliberately mirror the vocabulary already in the engine: the loops match
the `ProceduralSoundBank` beds (wind, edge/carve, lift hum) and the one-shots match
`AudioEventName` (§4), so a Phase 7.3 wiring layer can map an event to a sample by
name without a translation table.

### Sourcing

Every file is **CC0 1.0**, from *The Designer's Choice UCS Collection* by Nicholas A.
Judy, self-published to the Internet Archive. `public/game/audio/CREDITS.md` records
the archive.org item and in-item path for all ten, plus the three layers that are
texture substitutes (the carve bed is nails on a plastic tray; the lift hum is an
escalator; the crash is a body falling on grass) and the sources that were tried and
rejected.

CC0 was a hard filter, not a preference: a CC-BY file would put a permanent
attribution obligation into the shipped page, and the collection's own items that
carried *no* licence field were skipped rather than assumed. Freesound needs an API
token this environment does not have; Pixabay and Sonniss refuse non-browser clients;
Wikimedia Commons' alpine wind recordings are almost all CC BY-SA.

### Encoding

`scripts/build-audio-samples.sh` regenerates the whole set from the
downloaded masters (which are *not* committed — ~30 MB of WAV, some at 192 kHz).
Everything lands at 44.1 kHz, Ogg Vorbis `q4` with an AAC `.m4a` twin.

Three decisions worth carrying forward:

- **Loops are loudness-matched, one-shots are peak-matched.** The beds get a two-pass
  linear `loudnorm` to −18 LUFS. One-shots do *not*: EBU R128 integrates over gated
  400 ms blocks, so on a sub-3 s transient it measures the decay tail more than the
  hit and lands short samples 5–10 dB too quiet — the first pass put the chime at
  −31 LUFS and it was inaudible next to the bed. They are normalised to −3 dBFS true
  peak instead, and relative balance is set by the manifest `gain` column above.
  That is why the LUFS column looks ragged for the one-shots and tight for the loops;
  it is the intended result, not drift.
- **Loop seams are folded, not faded.** Rather than fading a clip in and out (which
  makes the loop point audible as a dip), the tail is crossfaded back over the head
  and the result is `(tail × head) ++ middle`. The seam the loop actually plays is a
  transition the recording already contained.
- **A peak guard, not a limiter, protects the beds.** `loudnorm` left `carve-packed`
  touching 0 dBFS, which Vorbis then overshot into clipping. The fix attenuates the
  whole bed to −2 dBFS; limiting would have flattened the scrape transients that are
  the only reason that layer reads as an edge.

Homebrew's ffmpeg 8 ships no `libvorbis` (only the experimental native encoder), so
the Ogg leg goes through `oggenc` from `vorbis-tools`.

### Reading the manifest (`lib/game/audio/manifest.ts`)

`manifest.json` is a **superset** of `SampleManifest`: each layer also carries a
`fallbackUrl` pointing at the `.m4a` twin. `SampleLayers` has no opinion about codecs
— it fetches whatever `url` says — so codec choice lives in the loader, and
`SampleLayers`/`AudioEngine` are untouched by Phase 7.2.

```ts
const file = await loadSampleManifest();        // null on any failure, never throws
const manifest = file && toSampleManifest(file); // picks .ogg or .m4a, drops fallbackUrl
```

`toSampleManifest` defaults to `canPlayOggVorbis()`, which probes
`canPlayType('audio/ogg; codecs="vorbis"')` and returns `true` when there is no
`document`, so SSR never bakes a Safari-shaped choice into markup. The zod schema
pins names to kebab-case, gains to 0..2, and URLs to `/game/audio/*.{ogg,m4a}` — an
off-origin URL is a validation failure, not a fetch.

`manifest.test.ts` validates the *committed* file against the schema, asserts every
referenced asset exists on disk, and enforces the byte budgets (150 KB per one-shot,
400 KB per loop, 2.5 MB total), so an oversized re-encode fails the build.

### Phase 7.3 wiring note

Nothing loads the manifest yet — `GameRuntime` is still untouched. The Phase 7.3 hook
is: **after the Start gesture has called `engine.init()`**, fire and forget

```ts
const file = await loadSampleManifest(SAMPLE_MANIFEST_URL, fetch, teardownSignal);
if (file) await engine.loadSampleLayers(toSampleManifest(file), fetch, teardownSignal);
```

Order matters — `loadSampleLayers` returns `{ anyLoaded: false }` before `init()`
because there is no graph to attach to, so calling it eagerly at module scope silently
does nothing. Pass the same `AbortSignal` the runtime uses for terrain assets; the
`await` must not gate the first frame, and a `null` file or an all-failed report is a
non-event that leaves the procedural bed playing.

---

## 6. Testing

`testAudioContext.ts` is a hand-rolled Web Audio stub (test-only; nothing in the
runtime imports it) that records every node created and every parameter automation
call. Because the modules are typed against the structural `AudioContextLike` rather
than the DOM `AudioContext`, the stub is injected without a cast — and
`AudioEngine.test.ts` carries a type-level assertion that a real `AudioContext` still
satisfies the interface.

Covered: gesture-deferred and idempotent init, no context at module import, the bus
graph shape, monotonic speed→wind mapping, carve and surface mapping, the exact node
recipe of every event, volume/mute/enable behaviour, the 15 Hz throttle, crossfade
gains, sample-load failure and abort paths, and disconnect/stop spy counts on dispose.
