# Mobile adaptive far-field budget follow-up

Base 20e0ec9. User requests adaptive detail and mobile budget verification.
Hermes measured >200k total mobile scene triangles with both baseline and the
first adaptive prototype; coarse-pointer rung 2 still uses desktop far-field
indices. Keep the existing baked low far-field topology throughout shader
quality changes ONLY for the opt-in Breckenridge mobile adaptive renderer.
Other visits/mountains remain unchanged. This belongs to the same near/far
terrain resolution owner. No materials, source data, physics or clock changes.

The same recordings reached 80 mobile draw calls, at the strict <80 gate. Batch
visible low far-field wedges into one draw with fixed index compaction storage,
retaining identical source triangles and wedge culling.

Review the batch topology/visibility, buffer reuse/disposal, optional geometry policy, propagation at late far-field attachment,
default isolation and both backend tests. Prior prototype review is recorded
in docs/reviews/adaptive-terrain-prototype.md. New live verification is pending.

Verification: 1,401 tests passed; TypeScript and ESLint passed. P1 source review
reported no accepted/actionable findings. Production build passed on retry;
the first attempt failed to fetch Google Fonts, without an application compile
error. The mobile budget retest must use the follow-up deployment, keeping the
20e0ec9 failure artifacts intact.
