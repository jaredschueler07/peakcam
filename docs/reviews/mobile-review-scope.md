# Review scope baseline

User request: execute the recommendations in the September 5 mobile/game review, including drag-anywhere/right-thumb controls and camera previews that feel too zoomed. Branch `review/mobile-layout`, target `main` after validation. Base `45ca630`.

Violated invariants: mobile visitors can reach the primary task, all supported touch input methods survive rotation, visible steering matches finger direction, camera images preserve useful scene content, dialogs behave modally, account entry is consistent, and dashboard ordering can be changed without dragging.

Owner boundaries: shared game input and HUD/shell; shared camera media; mobile page/header/filter composition; shared account/modal components; dashboard client layout. Sibling pages covered by the review are included. No database/schema changes, simulation sign-convention changes, ranked-run protocol changes, or SMTP configuration changes are intended. Existing SSR session validation, safe redirects, and RLS remain authoritative.

Non-test production changes currently span roughly 35 files; line counts are measurements, not a requested scope expansion. The review report and implementation status describe the authorized cross-page work. Existing `main` checkout has unrelated snowing-now work and has not been changed.

Validation: 1,121 unit tests, TypeScript, and a successful 181-page production build. Chromium and WebKit mobile interaction matrix and existing Drop In/camera regressions are running. Synthetic credentials and endpoints in test files are intentionally non-production fixtures.
