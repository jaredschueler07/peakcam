# Resort card camera previews

The homepage resort cards now lead with a lightweight provider image, a count of available cameras, and a Live look action. Opening a camera keeps the visitor in the resort grid; closing the overlay restores focus and scroll position. Snow statistics, favorites, comparison, and resort navigation remain available.

## Behavior

- Camera counts include active, non-auto-disabled cameras with a usable source. They describe availability in our catalog, not proof that a broadcast is currently live.
- Grid cards load images lazily and never mount video players. Preview sources include direct HTTPS stills, YouTube thumbnails, Brownrice snapshots, and verified Roundshot thumbnail metadata.
- Loading images have an explicit loading label. Failed thumbnails advance to another candidate and ultimately show a camera placeholder with the working quick-view action.
- A card image is labeled Camera still or Stream preview. Capture timestamps are not inferred from HTTP loads or camera-health checks.
- The modal mounts one selected feed, supports previous/next and Escape, traps keyboard focus through a native dialog, and provides an original-provider link. HTTP-only and external-link cameras open through a provider-link fallback.
- Image-feed refresh labels report when an image successfully loaded, not when it was captured. Failed image feeds offer a retry.

## Validation

- 16 focused unit tests cover camera eligibility, provider URL selection, fallback ordering, name cleanup, and forecast freshness.
- Four Playwright cases cover on-demand loading, camera switching, focus/scroll restoration, failed thumbnails, and 390px/320px phone layouts.
- TypeScript and targeted ESLint checks pass.
- Actual provider screenshots were inspected on desktop and mobile. Vail/Brownrice and Aspen/Roundshot images loaded successfully. Provider loading times and feed availability can vary.

## Isolation and delivery

Implementation lives on `feat/resort-card-live-look` in `.worktrees/resort-card-live-look`. The branch includes committed main through `2ba6133` and the completed Drop In preview changes. The primary checkout's ongoing snowing-now/design edits were not changed.

Local preview: http://127.0.0.1:3114/

Vercel preview: https://peakcam-6hk8rlnt2-jaredschuelerspotify-3622s-projects.vercel.app

- Deployment: `dpl_524tha4nbxYw6x3t3b4nL3b4bnua`
- Deployed source: `133d2c7`
- Target: Preview; status: Ready; homepage HTTP 200 through authenticated Vercel verification.
- Deployed-browser smoke check passed: 24 initial cards, zero grid iframes, one camera iframe after opening Live look, successful Escape close, and no browser page errors.
- The remote production build passed. It logs an existing `user_conditions.submitted_at` schema mismatch; this task does not change database schemas.
- Existing Vercel preview protection remains enabled; a Vercel sign-in may be required. Production is not changed.
