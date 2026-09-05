# Drop In forest assets

`pine-atlas.webp` is an original offline assembly of seeded trunks, branch paths
and foliage cards. Needle imagery comes from the **actual downloadable CC0
texture files** of **Pine Tree 01**, Poly Haven, by Rico Cilliers (modeling) and
Rob Tuytel (photography). No website example render is included or used as input.

- Asset: https://polyhaven.com/a/pine_tree_01
- Asset license: https://polyhaven.com/license (CC0 assets; website example renders are excluded).
- Catalogue: https://api.polyhaven.com/files/pine_tree_01
- Diffuse source: https://dl.polyhaven.org/file/ph-assets/Models/png/1k/pine_tree_01/pine_tree_01_twig_diff_1k.png
  - MD5 `a4fa4a55aab9231915a4023ea9841577`; 3,208,228 bytes.
- Alpha source: https://dl.polyhaven.org/file/ph-assets/Models/png/1k/pine_tree_01/pine_tree_01_twig_alpha_1k.png
  - MD5 `641911a5a3f543911dad04ebb26e7bca`; 351,928 bytes.
- Retrieved 2026-09-05. Both original texture files are retained in `scripts/data/textures`.
- Rebuild: `node scripts/bake-forest-assets.mjs`. This verifies source checksums,
  extracts the twig alpha island, authors tree structures with a fixed seed,
  composites the textured foliage offline and writes the runtime WebP. Sharp is
  supplied by the existing Next.js dependency.
- `pine-atlas-assembly.svg` records the original authored trunk/branch paths;
  the bake script records foliage placement. Both are PeakCam-authored work.

Runtime uses crossed alpha-tested impostors and three non-overlapping atlas
cells: slender lodgepole-inspired crowns in Breckenridge, a broader
Jeffrey-inspired crown in Heavenly. Species silhouette is art direction, not a
botanical identification of the generic source needle texture. No texture is
hotlinked at runtime. The superseded website preview and its retained source
have been removed.

The authored crown layout uses separated needle-bearing outer boughs, exposed
inner branches and sparse lower limbs. Breckenridge's crown tapers upward from
wide lower tiers; Heavenly's broader, irregular boughs leave a longer bare trunk.
These silhouette choices and seed are reproducible in the bake script.
