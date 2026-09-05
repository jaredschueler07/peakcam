# Three-resort authoritative replay QA

Test-only expansion after explicit final forest world dependency mergef24c234 (including5c75e72). No production handler, physics, source forest placement, or renderer edits in this QA commit.

`lib/game/server/replay-inputs.test.ts` now exercises six full ranked runs. Client fixtures construct their world through the runtime conditions-config seam, with real committed DEM/trails/forest and signed seed. The validator independently reconstructs its own ranked world. Every fixture starts at canonical top with time0/courseProgress0, never a debug arc spawn, then supplies only quantized120Hz controls until the actual finish. The simple feedback controller targets30m ahead: keyboard steering{-1,0,1} and full tuck; touch fractional steering and0.8 tuck. Tests assert both input classes are actually represented in the tape.

| Resort / selectable run | Input | Fixed ticks | Time ms | Score | Handler |
|---|---|---:|---:|---:|---|
| Breckenridge / Imperial Bowl (`osm:way:1224657749:0`,764m) | keyboard |2533|21108|6212|201|
| Breckenridge / Imperial Bowl | touch |2783|23192|5928|201|
| Heavenly / Milky Way Bowl (`osm:way:313466629:0`,368m) | keyboard |1230|10250|2412|201|
| Heavenly / Milky Way Bowl | touch |1276|10633|2340|201|
| Portillo / Plateau (`osm:way:26598529:0`,359m) | keyboard |1112|9267|1080|201|
| Portillo / Plateau | touch |1159|9658|2092|201|

For every run, the actual reviewed `handleSubmitRun` accepts the signed request with201 and receives the exact tape/score at the writer seam. Inflated score, altered tape, and absent tape return422 and never call persistence. Pure authoritative replay additionally rejects a1cm ghost edit, truncated tape, extra ticks after finish, and changed signed wind. The writer is a deterministic in-memory test double: no deployed API or database claim.

Three additional tests compare every committed mapped tree site's client/server collision chunk (positions, radii, scales and rotations) and verify the actual site is represented. Empty inventories remain explicit. Reviewed source path: both runtime and ranked server call `createWorld`; mapped forest buckets are seeded identically and consumed through shared `getChunk` by physics collision. Final world merge leaves signed config/environment unchanged. Sensory clipping only affects rendering (fog/visibility retention); it does not change the simulation, tape, or replay.

Validation:27 tests pass in the expanded replay suite; TypeScript no-emit and ESLint for changed test pass. No GPU/browser was launched. These prove a representative selectable run per resort for both input classes, not every possible trail or human-playability/device-input acceptance. Fixed Time Trial environment tested here; existing snapshot/replay environment tests cover authority and mutation rejection.
