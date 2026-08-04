# Terrain sampling contract (Drop In v2, Phase 5.2)

How the game asks the mountain how tall it is. One height function, shared by the
mesh builder, the physics step, prop scattering, the minimap and the server-side run
validator — that single-source invariant is inherited from v1 and is not negotiable.

Modules: `lib/game/terrain/{bicubic,noise-grad,real-heightfield,terrain-source}.ts`.
Asset decoding lives in `formats.ts` (Phase 5.1) and is not duplicated here.

## Two terrains, one interface

| Path | Module | When |
|---|---|---|
| procedural | `heightfield.ts` (`createProceduralTerrain`) | no baked assets — the v1-parity path, pinned bit-for-bit by `tests/fixtures/drop-in-v1/` |
| real | `real-heightfield.ts` (`createRealTerrain`) | baked DEM + trails present |

Both satisfy `TerrainSampler` (`lib/game/core/types.ts`): `height(x, z)`,
`normal(x, z, out)`, `trailField(x, z)`, `nearestTrail(x, z, out)`, plus `profile`,
`seed` and `noiseOffset`. `terrain-source.ts` picks one:

```ts
const { kind, sampler, real } = createTerrainSource({ profile, assets });
```

`createTerrainSource` is **pure** — it takes an `ArrayBuffer` and parsed JSON that are
already in memory. Fetching, brotli and caching belong to the runtime loader (later
phase); keeping them out is what lets the same factory serve the browser, the tests
and the run validator.

The real path is a strict superset: `RealTerrainSampler` also exposes `macroHeight`,
`microDetail`, `nearestRun`, and the decoded `field` / `meta` / `runs` / `lifts`.

## Units and coordinates

- Distances and elevations are **metres**. Elevations are absolute (metres above sea
  level, ~2300–4200 m at Portillo) — not relative to a base.
- Game frame (three.js style): **x east, y up, z south**.
- Asset frame (`formats.ts`, `HEIGHTFIELD_ORIENTATION`): **x east, y north**, metres
  from `meta.center`, row 0 = north edge, col 0 = west edge.

The bridge between them is one sign flip:

```
gameX = assetX        gameZ = -assetY        gameY = elevation
```

which makes both grid indices grow with their coordinate:

```
col = (x + sizeM/2) / cellSizeM
row = (z + sizeM/2) / cellSizeM        cellSizeM = sizeM / (grid - 1)
```

At Portillo that is a 4096 m box on a 1024² grid → **4.0039 m per cell**;
Breckenridge and Heavenly are 6144 m boxes → 6.0059 m per cell.

Samples outside the box clamp to the edge value, and the corresponding derivative is
reported as **zero** — the surface really is flat out there, and a nonzero slope would
disagree with the heights the same function returns.

## The height function

```
height(x, z) = bicubic(heightfield, x, z) + microDetail(x, z)
```

### Macro: bicubic

Catmull-Rom tensor product over the decoded u16 grid, indices clamped at the edges.
Chosen over bilinear because bilinear normals are piecewise constant per cell: a skier
at 25 m/s crosses a 4 m cell every 160 ms and would get a normal discontinuity each
time — visible chatter and a spike in the contact response. Catmull-Rom is C1 across
cell boundaries (the tangent at a knot is `(p[i+1] − p[i−1])/2` from either side), and
has linear precision, so a planar DEM stays planar.

Bicubic can overshoot by a few metres at sharp ridges. That is accepted: the
alternative (monotone filtering) costs the C1 property that physics needs more.

### Micro: seeded fbm

`microDetail` restores the gameplay texture a 4–6 m DEM cannot carry. Rules, all
enforced in code:

- **Amplitude** `amplitudeM`, default 0.5 m, constrained to **[0.3, 0.8]** (DESIGN §3.3).
  Construction throws outside that band.
- **Wavelengths strictly below one DEM cell.** `baseWavelengthM` defaults to 75 % of
  `cellSizeM` and construction throws if it is ≥ a cell. Higher octaves are finer
  (`fbm` steps frequency by 2.03). The layer adds detail the DEM cannot hold; it must
  never fight the real morphology at the DEM's own scale.
- **Zero mean.** `fbm` is remapped from [0, 1] to [−1, 1], so detail neither raises nor
  lowers the mountain.
- **Corridor damping.** Inside a groomed run's corridor the amplitude falls to
  **15 %** (`CORRIDOR_DAMPING`), relaxing back to 100 % over `corridorFalloffM` (10 m)
  beyond the corridor half-width (14 m). Pistes stay skiable; off-piste stays rough.
  A run counts as groomed unless it is `gladed` or `piste:grooming=backcountry`.
- **Deterministic.** Everything derives from `profile.terrainSeed` (overridable via
  `options.seed`) through `mulberry32`, exactly as the procedural path seeds itself.
  Two samplers with the same seed produce identical heights; different seeds differ.

## Normals

`normal(x, z, out)` returns a unit vector, `out.y > 0`, computed **analytically**:

```
n ∝ (−∂H/∂x, 1, −∂H/∂z)
```

Both terms of `H` are differentiated in closed form — the Catmull-Rom basis for the
macro surface (`bicubic.ts`), and the value-noise fbm plus the corridor damping weight
for the micro layer (`noise-grad.ts`). No finite differences: sampled differences of a
C1 surface are only C0, which reintroduces exactly the normal chatter the bicubic was
chosen to remove. `noise-grad.ts` returns values bit-identical to `noise.ts`, so the
gradient work cannot drift from the heights it claims to describe.

Tests assert analytic and central-difference normals agree to 1e-3 (2e-3 across a
corridor falloff, where the damping gradient is in play).

## Trails

Polylines from `<slug>.trails.json` are decoded by `decodeTrails`, converted to game
coordinates, and **draped once at construction**: each vertex gets `y = macroHeight`
— the macro surface only, so a change to the micro-detail options cannot move the
centrelines, and corridor detail is damped anyway.

Two queries:

- `trailField(x, z)` → groomed-corridor membership in [0, 1], from the **real**
  centrelines. This is what damps the micro-detail and what physics reads for
  groomed-ness.
- `nearestRun(x, z, out)` → nearest real run: index, centreline distance, closest
  point, and whether the query is inside the half-width. Fill `out` with
  `createNearestRun()` and reuse it; the sampler allocates nothing per call.

`nearestTrail(x, z, out)` still answers from the profile's v1 sine corridors so the
existing physics, gates and trail-select UI keep working unchanged. **Phase 5.3
replaces it** with a selection over the real runs; `nearestRun` is the real-geometry
query available today.

## Performance notes

- The corridor lookup uses a uniform bucket grid over groomed-run segments, sized so a
  query inspects exactly one bucket: every segment is registered into all buckets its
  AABB touches once expanded by its influence radius, so any segment within that radius
  is guaranteed to be in the query point's own bucket.
- `height` and `normal` allocate nothing; scratch objects are per-sampler closures
  (and module-level inside `bicubic.ts`). The modules are single-threaded by
  construction — no worker may share a sampler instance.

## Guards

`createRealTerrain` throws when `meta.orientation` is not the exact
`HEIGHTFIELD_ORIENTATION` string, when the trails file's `center`/`sizeM` disagree with
the meta, or when the micro-detail options break the amplitude or wavelength rules.
`createTerrainSource` additionally throws when the assets' slug is not the profile's,
and when `mode: "real"` is requested with no assets. These are all bake/wiring
mistakes that would otherwise show up as a silently wrong mountain.
