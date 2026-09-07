# Immutable elevation inputs

Each `.height.u16.br` is the preserved, pre-gameplay source grid. Decode it with
its adjacent `.meta.json`, never mutable runtime metadata. These are already
resampled and quantized outputs, not original LiDAR or GeoTIFF deliveries.

The adjacent `.provenance.json` pins SHA-256 of decompressed grid bytes and exact
metadata bytes and records what remains unverified. Runtime elevation bytes must
match these inputs exactly. Trees are seeded placement only; no wells/cuts/ramps
are written into the grid.

Follow [the mountain onboarding methodology](../../../docs/terrain/README.md)
for source replacement, datum verification, independent control and course versioning.
Do not overwrite these inputs from a runtime pack or update fingerprints merely to
make an audit pass.

`projection-controls.json` contains independent GDAL/PROJ transforms of each resort
centre and two surrounding points, captured using `gdaltransform -s_srs EPSG:4326
-t_srs EPSG:<resort>`. Tests compare the offline JS projection within 1 mm. These
are transform regression probes, not ground survey checkpoints.
