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

## 5. Sample layers (Phase 7.2)

`SampleLayers` is complete as structure; **no audio files ship yet.**

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

### Sourcing the samples

Files land in `public/game/audio/`, streamed `.ogg` with an `.mp3` fallback only if a
target browser needs it (per the architecture report's asset table). Candidates, both
usable without attribution friction:

- **Freesound** — filter to the CC0 licence explicitly; per-file licences vary and
  CC-BY files would put an attribution obligation in the shipped page.
- **Sonniss GDC Game Audio Bundle** — royalty-free for commercial game use, high
  quality, large files that will need trimming and re-encoding.

Wanted: alpine wind gusts, ski/board edge on hardpack and on ice, powder swish,
landing thumps, chairlift machinery, sparse per-resort ambience (lift hum at
Breckenridge, wind at Portillo, birds in Heavenly's pines — DESIGN §3.5). Record the
source URL and licence for each file alongside the manifest when they land.

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
