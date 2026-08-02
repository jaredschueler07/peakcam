# Drop In v2 — pinned budgets

These are release gates, not aspirational targets. Desktop figures apply to the
mid-tier desktop/laptop target; mobile figures apply to iPhone-12/Pixel-7-class
devices unless a gate states otherwise.

| Resource | Desktop | Mobile |
|---|---:|---:|
| Draw calls | < 150 | < 80 |
| Triangles | < 400,000 | < 150,000 |
| Texture memory | < 128 MB | < 64 MB |
| KTX2 runtime texture (per asset) | ≤ 512 KB | ≤ 512 KB |
| Basis transcoder (shared, raw transfer) | < 600 KB | < 600 KB |
| Frame time | 16.6 ms | 33.3 ms |
| Post-processing share | ~3 ms | ~4 ms |
| Shadow share | ~3 ms | ~1 ms |

## Rollout gates

- Funnel conversion from `drop_in_opened → drop_in_ready → drop_in_started`
  must meet or exceed v1.
- Fatal error rate must remain below 0.5%.
- p75 frame rate must be at least 55 fps desktop and 30 fps on an
  iPhone-12-class device.
- First-ready must be below 3 seconds on a 4G profile.
- Each resort payload (engine chunk plus terrain pack) must be at most 3.5 MB
  brotli-compressed.
- Each baked resort terrain/trail pack must be at most 1.5 MB brotli-compressed.

## KTX2 asset inventory

Task 7 inventory found no eligible file textures: excluding `public/game/terrain`
and `public/game/audio`, `public/game` contained zero files, and no project loader
used `TextureLoader`. Current snow textures are procedural `DataTexture`s, while
the baked 16-bit terrain PNGs are inspection artifacts and are not loaded by the
runtime. They remain PNG rather than being relabeled or converted.

Future runtime raster outputs from `scripts/bake-resort.ts` must pass through its
KTX2 emission boundary, which validates the KTX2 identifier and emits a `.ktx2`
file. The shared Three.js Basis transcoder payload is 584,862 bytes total:
`basis_transcoder.js` is 57,529 bytes and `basis_transcoder.wasm` is 527,333
bytes. These files are served from `/game/basis/` and count once per cached app
version, not once per texture.

Production telemetry emits p50/p95 frame time, final quality rung, DPR, and
device tier once per run. It never emits per-frame samples. The quality ladder
drops post effects, shadow cascades, and glint before reducing pixel scale.
