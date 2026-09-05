# Drop In forest assets

`pine-atlas.webp` is an offline resized orthographic render of **Pine Tree 01**,
by Rico Cilliers (modeling) and Rob Tuytel (photography), Poly Haven, **CC0**.

- Asset/license: https://polyhaven.com/a/pine_tree_01
- License policy: https://docs.polyhaven.com/en/faq
- Source: https://cdn.polyhaven.com/asset_img/renders/pine_tree_01/orth_front.png
- Retrieved 2026-09-05. Source PNG retained in scripts/data/textures.
- Rebuild: `node scripts/bake-forest-assets.mjs` (sharp ships with Next.js).
- Powered by Poly Haven (metadata was inspected using their API).

Runtime uses crossed alpha-tested impostors: slender crown in Breckenridge,
broader crown in Heavenly. These are art-directed pine silhouettes; the source
asset does not certify lodgepole or Jeffrey pine species. Botanical specificity
remains an art acceptance limitation. No textures are hotlinked at runtime.
