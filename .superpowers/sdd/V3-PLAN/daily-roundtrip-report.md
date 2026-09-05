# Daily Line honest replay verification

The real session handler issues HTTP 201 for Imperial Bowl (`osm:way:1224657749:0`), using a Map-backed implementation of the morning snapshot store and genuine test HMAC signing. The stored September 5 Breckenridge 07:00 conditions remain immutable when requested at 19:00 local (September 6 UTC). The handler ignores the client's powder/v1 claims and signs stored packed/v2 conditions. The current contract validates a catalog trail, assigns the server Daily seed, and locks the selected course in the UI; this test preserves that course policy.

A fresh top-of-course world consumes that ticket's conditions and seed. Analog controller inputs are quantized at 120 Hz before stepping the real integrator, with a recorded input tape and 30 Hz ghost. The run actually finishes after 3,377 ticks (28,142 ms), scoring 5,832. The real submission handler re-simulates it and returns HTTP 201. The in-memory writer receives the original local conditions date, signed environment, score and tape. This is handler/replay evidence, not a deployed database or browser claim.

Changing wind in the signed payload without re-signing returns HTTP 401 and produces no additional write. Replaying the honest tape/ghost against changed wind also fails deterministic validation.

Validation: 36 tests pass across daily-roundtrip, replay-inputs, ranked-conditions and RuntimeAudio; TypeScript and focused ESLint pass. No GPU or deployed database actions.

## Progressive audio review

Reviewed `2f9c0d6`: sample loading moves after successful game creation while retaining the existing audio instance and abort signal. Gesture-time audio initialization remains intact; cancellation disposes the created game before sample loading. Existing sample loaders and disposed-engine guards preserve resource ownership. No blocking issue found; RuntimeAudio tests are included above.
