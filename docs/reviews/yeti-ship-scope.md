# Yeti and rider locker landing scope

Request: ship the completed Yeti/avatar, outfits, board/ski graphics and saved customization to main. The implementation worktree predates extensive changes already on main. Landing is built on 828cfa2 and ports the latest avatar feature without reverting those changes. The older physics/terrain branch remains preserved separately.

Owner boundary: rider rendering, its cosmetic catalog, pre-descent/pause UI and options carried directly through runtime to renderer. Preserve current main's real mountain/lift systems, named-course UI, mobile controls, ranked conditions and input replay contracts, 120 Hz physics, versions and gameplay tuning. Snowboard equipment/stance in this landing is cosmetic; it uses the existing arcade physics. The old snowboard physics strategy is not part of this landing.

Behavior: Yeti default and optional Human; three visibly different outfits; separate board and ski graphics; live rotatable preview; device-local preferences; pause-to-locker action clearly starts a new run. Character and outfit selection never change simulation config or tickets. Preserve rendered-ground contact, lift root alignment, and always-visible immunity from main.

Review relevant siblings: SkierRenderer, Renderer, GameRuntime, createGame, DropInGame, PauseDialog and existing ski-contact regressions. No backend, schema, external messages, account storage, payments, or release-process changes. Main is the authorized push target; no force push.
