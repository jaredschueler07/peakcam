# Physical lifts implementation report

## Implemented

- Pure cached cable path initialization with true cosh catenary spans and a shared two-metre arc-length lookup. Simulation and visible occupied carriers sample the same path. DEM clearance raises default support heights; surface tows follow terrain. Source towers retain their projected locations; absent towers use documented synthetic 90 m spacing, and line bends need additional supports.
- Every current baked lift is represented: 34 Breckenridge, 23 Heavenly, 15 Portillo. Boarding is explicit Free Ride config opt-in, within a bounded genuine base station, grounded, not crashed, and at <=10 m/s. Incomplete clipped lines and lines without both genuine stations cannot board.
- Uphill ride distance advances by real fixed-step time times source speed or documented type default. Unload is at that lift's actual terminal terrain, with forward momentum and cooldown; no selected-run reset or summit teleport. The procedural legacy parity branch remains isolated.
- State exposes liftIndex, liftProgress, liftDistanceM, liftCooldown and liftRide (remaining seconds). Reset clears all ride state. Initialize paths in createSimulation, before the frame loop.
- Extracted LiftRenderer draws all lines with shared instanced textured carriers, culled moving furniture, baked static cables/towers, named station signs and open loading lanes. Chairs use known occupancy; missing occupancy uses a marked visual default, not fabricated OSM data. Gondolas use enclosed carriers; platter bars circulate; rope tows use reciprocal va-et-vient bars. Camera looks uphill with the occupied carrier; skier uses a seated or standing tow pose.
- No GameRuntime edits. Parent must pass config.allowLifts=true only for Free Ride and remove legacy real-terrain lift-key initiation. Parent owns overlay/minimap/audio integration.

## Validation

- 157/157 targeted tests passed: all 72 current complete lifts board, follow cable at speed, remain above DEM, unload at their own terminal; deterministic replay, catenary, reverse source orientation, all tow/carrier types, loading bounds, clipped lines; all v1/v2 integrator goldens; headless runtime scene construction.
- TypeScript and touched-file ESLint passed before final clipped-line guard; rerun at final commit preparation.
- Full suite first run: 973/981. One new headless canvas failure fixed and targeted runtime suite passed. Seven remaining integration-baseline failures concern changed course-gate catalogue, old rollout-off expectation, four honest resim tapes and teleport-resim assertion. No claims those unrelated failing tests are resolved here.

## Gates and limitations

- Real GPU station/carrier screenshots and actual keyboard/touch boarding on every lift are pending parent integration. No desktop or phone FPS/heap sign-off is claimed.
- Speeds, missing occupancy and tower heights/spacings use explicit engineering/visual defaults when OSM metadata is absent. Va-et-vient tow handles are schematic, not a claim of verified missing occupancy.
- Station ramps use the real DEM terminal surface, rather than new fabricated ramp coordinates. Source does not identify a separate unload-ramp polygon.
- Shared textured procedural carrier/station geometry is authored in this repository; no downloaded assets or new licensing obligations. Signs are canvas textures; carrier paint uses an authored deterministic ribbed texture.
- Occupied carrier is represented explicitly at ride distance. Unoccupied carrier spacing is decorative; loading does not wait for a global scheduled chair arrival. This preserves immediate auto-boarding with continuous actual line-speed travel.

## Review correction

Merged terrain correction `46f4bad` with the `complete` field retained once. Boarding/ride now clears `jumpCharge`, preventing a held jump released on the lift from triggering after unload. Inventory regression charges 0.4 seconds before each board, rides, then applies a neutral fixed step after unload and verifies no jump event. All 72 source lines remain complete with both genuine stations (34/23/15); tests assert these counts rather than silently skipping an empty inventory. 143 lift/golden tests and TypeScript pass after the merge and correction.
