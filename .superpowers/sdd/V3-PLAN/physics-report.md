# Phase 2 physics and ranked contracts

Implemented on feat/drop-in-v3-physics, isolated from the primary checkout. Terrain dependency d7aad7b merged explicitly; COURSE_VERSION 3 belongs to that phase. PHYSICS_VERSION is 2.

## Physics

- Restored only the shared integrator and its wrappers/goldens from reachable daac3f5. The initial seam passed 110 physics/parity tests.
- Enabled v2 by default with explicit offline phys=v1 support. Progressive analog tuck now scales thrust and air drag. Existing progressive edge lag, surface grip, skid drag, air authority and aligned landing absorption remain on the common strategy seam.
- Conditions quantify depth (0–100cm), wind (0–40m/s), morning ice, visibility (200/800/20000m) and geographic north sign. Off-piste gets depth drag, ridgeline exposure increases wind resistance, north-facing groomers recover more lateral slip when icy, and off-piste powder increases landing absorption. Unaligned landings lose 18% lateral/forward velocity when using a conditions snapshot.
- Powder float is a deliberately modest arcade support pad: depth×0.0015 metres, at most 15cm above DEM, fading out in groomed corridors. Both ground samples use the same deterministic effective height. It does not modify the rendered terrain mesh.
- Free Ride morning ice uses actual resort-local time, with timestamp injection for tests. Daily capture explicitly uses 07:00. Afternoon/night regressions prevent the prior default 09:00 bug.
- Removed grounded-step CarveContext and CarveOutcome allocations with reusable scratch. checkRealGates now uses an out-parameter nearest-point scratch. Streamed obstacle construction and existing recorder keyframes still allocate outside the integrator solve; whole-game heap/GPU performance remains an integration gate.
- All 36 historical v1 Object.is scenarios remain unchanged. 136 total golden scenarios cover both models, four surfaces, original behaviors plus explicit off-piste slalom/jump depth/wind/ice cases. Updated eight v2 full-simulation fixtures for the intentional analog-tuck change.

## Authoritative ranked path

The baseline brief overstated the old server: resimulateGhost only checked trajectory envelopes; PCGH had no input tape. This phase adds actual authoritative replay rather than treating those envelopes as integration.

- Runtime records four bytes per fixed 120 Hz step (signed steer, tuck, brake, jump held). It quantizes inputs before simulation, so replay consumes exactly what the browser skied. Buffer allocation happens once per runtime; no per-tick recorder allocation. The tape and frozen finish score accompany FinishedRunRecording.
- Ranked starts reset all state from a fresh canonical spawn, preventing jump-charge/crouch/timer leaks across restarts. Ranked mode disables trail switching/lift hotkeys throughout runtime lifetime. createGame accepts mode and canonical trailId; world config allows proximity lifts only in Free Ride. Real terrain no longer uses the teleport lift key.
- Server loads the same committed terrain, finds signed RealRun.id, steps the same core and compares every quantized ghost field. It requires a real finish with no trailing input, matches score/time, rejects missing/noncanonical tapes, and persists the tape and conditions for audit. V 2 acceptance is fail-closed and never gated by DROP_IN_RESIM. Historical v1 envelope tests remain separately preserved.
- Actual Imperial Bowl recording over the committed DEM is accepted by full replay and by the HTTP handler. Changed input, a 1cm ghost edit, truncation, trailing ticks, changed signed wind, score inflation and missing tape are rejected. HTTP tests use an in-memory writer; no deployed DB submission has been claimed.
- Server ignores client-selected surface/model. Time Trial uses immutable packed/calm/clear conditions. Daily Line signs and persists a single resort-local date snapshot using atomic insert-if-absent and a DB immutability trigger. It captures only during the actual 07:00 hour; later requests with no captured morning fail 503 rather than invent an afternoon snapshot.
- Daily leaderboard filtering uses conditions_date. Clients can pass the frozen ticket conditionsDate; omitted date resolves to current resort-local date. Config matching also compares every quantized environment field, preventing remints from attaching a different snapshot to an existing world.
- Canonical OSM courses resolve current real start/finish points. Legacy COURSE_GATES remain only for historical aliases/tests. New version tickets are rejected when their physics/course version is obsolete; no historical rows are deleted.
- next.config traces all server terrain packs/catalogs into Drop In API deployment bundles.

## Validation and remaining gates

- Combined physics/parity/conditions and server/competition suite: 407 passed, 0 failed. Three later focused regressions (ranked reset, environment remint, daily board date) also pass.
- npx tsc --noEmit passes. Changed/new-file ESLint has no errors (two existing unused-argument warnings in legacy validate-run remain).
- Full npm test run:978 tests,972 passed,0 failed, 6 cancelled in pre-existing lib/supabase.test.ts async fixtures. The process exits 1 for those cancellations. Subsequent scoped tests include the later morning/float fixes.
- Keyboard/touch feel, actual browser ranked submission, full production-build integration and hardware performance remain parent integration/browser gates. A deterministic scripted run is not a human feel sign-off.

## Needs Jared / deployment

- Apply supabase/migrations/017_drop_in_morning_conditions.sql manually before v3 ranked deployment. It adds immutable morning capture storage plus conditions_date, conditions_snapshot and input_tape columns/index; it does not rewrite/delete historical scores. No migration has been applied here.
- Keep DROP_IN_TICKET_KEYS, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured. No secrets were read or changed.
- Schedule authenticated GET /api/drop-in/morning hourly with the existing CRON_SECRET (or an equivalent free scheduler). The handler captures only resorts currently in their 07:00 hour; no scheduler/deployment changes were applied. Missing capture fails closed until a valid morning capture exists.
- NWS serves the US resorts. Portillo currently has no weather source in the authorized data path, so its locked snapshot records weather_available=false and explicit calm/clear/no-temperature-ice fallback. Snowfall depth still comes from the stored snow report. Do not describe Portillo wind/visibility as live until an approved source is wired.
- NWS high/low forecast provides a morning freezing proxy, not an observed surface-temperature sensor; visibility is a documented categorical estimate from forecast wording, not a measured optical range.
