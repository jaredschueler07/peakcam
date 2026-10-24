# Signup conversion — Colorado hub and mountain lineup (2026-10-24)

Implementation notes for review. This branch is product UI, signup/favorites continuity,
instrumentation, tests and copy only. No ad account, campaign, spend, production config,
migration or service-role change is included.

Implemented through the installed DeepSeek Harness CLI (`@deepseek-ai/dsh`) on the
Mac mini in three implementation/review passes, then independently reviewed, tested and
visually checked on the Mac Studio. The independent review also refined camera attribution,
mobile chooser sizing and the same-document/cross-tab browser regressions.

## What is implemented

- **Colorado hub first screen.** `/ski-cams/colorado` (and every other `/ski-cams/[hub]`
  page, naturally) now puts a compact free-account benefit card directly under the H1:
  - H2: “Your mountains. One quick morning check.”
  - Body: “Keep your favorite Colorado webcams and snow reports together in a free dashboard.”
  - Primary CTA: “Choose my mountains”. Supporting line: “Free account. No credit card.”
  - Secondary link: “Powder alerts don’t need an account →”, pointing at the existing
    powder-alert card, whose no-account promise is unchanged.
  H1, canonical URL, metadata, JSON-LD (Breadcrumb, ItemList, WebPage, FAQ), summary strip,
  resort table and editorial/FAQ content are preserved. The exact SEO H1 copy is unchanged;
  it renders a step smaller on phones (`text-3xl`, 30 px) so the primary action fits without
  crowding. The long “ranked by base depth…” introduction is unchanged text but now sits
  below the account benefit card, beside the stats strip, instead of between the H1 and the
  CTA. At 320×700 the “Choose my mountains” button’s real bounding box is inside the first
  screen with no scroll (asserted from `boundingBox()`, not CSS visibility). The redundant
  perks line is hidden on phones only, where the description already carries the same
  promise. The existing real featured-webcam tiles moved above the long resort table;
  nothing autoplays.
- **Mountain lineup before signup.** “Choose my mountains” opens a native dialog with a
  search field and keyboard-accessible checkboxes. Each row shows the resort’s real base
  depth, 24-hour new snow and active-cam count. A visitor can pick any number from 1 to 8
  (no forced choice of three), see the running count and selected names, then press
  “Save my mountains”. The signup heading is personalised: “Save Breckenridge.” for one,
  “Save your 4 mountains.” for several. Signed-in visitors save immediately and see an
  “Open My Peak” link; they are never asked to sign in again. Changing the selection after
  an inline success clears that result and brings back the save button, so a success for an
  earlier selection never sits on screen without an action. On small phones the list
  shrinks and scrolls within the chooser, keeping “Save my mountains” visible even with
  eight selections. Each hidden checkbox is positioned relative to its visible row so
  focusing it cannot scroll the surrounding dialog away from its controls.
- **Save intent across auth.** A guest’s selection is written to a versioned, bounded,
  typed browser record (`peakcam:lineup-intent:v2`). Resorts and cameras are distinct item
  types, so a camera saved before signup stays that camera. The record is not deleted
  before the network write: the tab first writes a short-lived claim, re-reads it, and only
  a successful insert for the matching record clears it. A failure releases the claim and
  keeps the items, and the UI reports a recoverable error with a Retry button. A newer
  selection gets a new record id, so an older in-flight save can neither clear it nor
  overwrite it. Picks expire after 30 days; the serialized payload is capped well above the
  largest legitimate alert selection.
- **Intent-aware restore, not a per-user latch.** `LineupIntentBridge` remembers the exact
  attempt (`account id + intent id`), not “this user was attempted once”. A different
  selection is consumed without remounting the provider-level bridge, including after a
  sign-out/sign-in cycle and when a newer record is left while an older save is still in
  flight; after every save settles the effect re-reads storage, and a `storage` event picks
  up changes made by another tab. A failed write for the same record is latched and never
  auto-loops; Retry, a reload, or a new sign-in is required. Another tab’s fresh claim is
  retried exactly when its 30 s lease expires (not one full TTL later), and the retry timer
  is cleared on unmount, sign-out, success and record replacement.
- **The write is bound to the claimed account.** `addFavoriteItems` accepts the claimed
  `expectedUserId` and rejects a different store session *before* reading that account’s
  favourites or inserting anything, so a session switch mid-flight cannot copy account A’s
  pending selection into account B. The bridge passes the claimed `intent.user_id`.
  A mismatch keeps an actionable “Switch account →” link (to the existing `/account`
  sign-out) instead of a dead end, and the bridge never renders raw provider/runtime error
  text. `useAuthUser` settles as signed out if its initial auth read rejects, so callers
  stop showing “Checking account…” and a later auth event can still sign the visitor in.
- **Contextual save entry points.** The resort hero save (“Save mountain” / “Saved”), the
  browse-card heart gate and the camera heart gate now persist the clicked item before they
  open `AuthModal`. Those gates are personalized (“Save Breckenridge.”, “Save Main Street.”)
  and only promise persistence after the browser write actually succeeded. When storage is
  refused, the modal says so and still offers account creation, without presenting
  “turn off private browsing” as the remedy.
- **Alert-success account nudge.** The optional nudge after a successful powder-alert
  subscription explains the benefit (“saves them as favorites, syncs across devices, and
  opens My Peak”), still prefills the email, and writes the same typed intent. The alert
  subscription itself remains account-free and the nudge remains optional.
- **Alert selections are not silently truncated.** The chooser’s eight-mountain limit is a
  UI limit only. The pending-intent/write bound uses the alert API’s own ceiling
  (`MAX_RESORTS_PER_REQUEST`, 200), so a hub’s full preselection (for example all Colorado
  resorts) is carried in full. If a selection were ever larger than that bound, the flow
  says so truthfully instead of saving the first eight and claiming success.
- **Partial writes are reported truthfully.** Adding favourites is sequential and
  idempotent. If an insert succeeds and a later one fails, the UI says how many were saved,
  keeps the selection recoverable, and a retry only inserts what is still missing. Auth,
  network and provider failures are caught as thrown errors as well as returned ones; every
  store call has a timeout, so a hung request becomes an actionable error rather than a
  permanent “Saving…” state.
- **Existing favourites consumers are refreshed.** A successful save or toggle dispatches a
  small `peakcam:favorites-changed` event (same tab) and a `BroadcastChannel` message
  (other tabs). `useFavorites`, the dashboard hook and the standalone heart button refetch
  from `user_favorites`, so a dashboard already mounted during auth does not stay empty and
  hearts do not stay stale.
- **Shared header.** Signed out, the mobile header now keeps a compact primary “Create free
  account” link visible beside the hamburger at every phone/tablet width; the menu contains
  the secondary “Sign in” entry, so the two account paths are both one tap away without a
  second, duplicate create-account link in the open menu. Desktop (`lg`+) keeps both links
  visible in the nav. Signed-in navigation (Account, Favorites, My Peak, and the menu’s
  Account settings / Sign out) is unchanged; the mobile create link only renders after the
  initial auth read settles, so a signed-in visitor does not flash a signup CTA. At 320 px
  the logo, create link and 44 px menu button fit on one row with no horizontal overflow;
  the same is asserted at 768, 1024 and 1440 px.
- **Instrumentation.** New events in the existing `lib/analytics-events.ts` catalog:
  `account_cta_clicked`, `lineup_selected`, `lineup_saved`, `lineup_save_failed`.
  Signup prompt views reuse `auth_gate_shown`; submit and confirmed-account events remain
  `auth_signup_submitted` / `auth_signup_completed`; favourite writes reuse
  `favorite_added`. When a pending lineup exists, the prompt, signup-start, signup-submit
  and confirmed-signup events also carry a bounded `lineup_source` (an allowlisted surface
  label) and `lineup_count`. `AUTH_SIGNUP_COMPLETED` still fires only from the callback’s
  fresh-confirmation path (or the email-confirmation-disabled completion), never from a
  save or a returning sign-in, and it remains the only trigger for Meta
  CompleteRegistration and the Google signup conversion. A StrictMode effect guard keeps
  one prompt view from producing two `auth_gate_shown` rows.
- **Existing pending-intent handling.** The repository had no pre-auth favourites queue;
  the only existing marker is `?welcome=signup` from `/auth/callback`, which
  `SignupWelcomeTracker` consumes to fire `auth_signup_completed`. The new queue sits
  beside it and leaves that marker, the callback and `safeNext` redirect validation
  unchanged.

## Cross-tab and cross-device behaviour

The pending intent lives in `localStorage`, so every tab of the same browser (and the same
profile) can see it. A confirmation link opened in a new tab works: the new tab claims the
record, saves it and clears it. Supabase shares the authenticated session with the original
tab, so either tab may finish first. The winning tab shows the success message; the original
signup modal closes once it observes the signed-in session. The browser regression checks
the exact persisted favorites and a success message in either tab rather than assuming a
particular tab wins the claim. An abandoned claim from a closed/crashed tab blocks other
tabs only for the 30-second lease; the other tab re-reads the shared record after the lease
and finishes the save without a reload (covered by a browser test that short-advances the
clock). A completed save in one tab clears the record; a newer record written meanwhile is
left for the next intent-aware pass.

Two limits are deliberate and documented rather than hidden:

- `localStorage` has no atomic compare-and-swap. The claim is read, modified and written
  back as separate operations, so two tabs writing at the same instant can both believe
  they hold it. The claim is a best-effort de-duplication of the common case, not a lock.
  The database’s `UNIQUE (user_id, item_type, item_id)` and insert-and-handle-23505 path
  remain the final idempotency protection, and a retry never deletes an existing favourite.
- The queue is browser-local. A different browser or device cannot see the picks, and a
  private/incognito session that is closed cannot carry them. Fixing that would require a
  server-side pending table keyed before authentication (a schema change), which is out of
  scope. A failed attempt also binds the record to the account that attempted it, so a
  later different account in the same browser is not handed the previous user’s pending
  work.

## Ad copy (ready to use)

Both options describe only shipped behaviour.

### Utility

Headline: **Your mountains. One quick check.**

Body:
> A-Basin, Loveland or Keystone? Keep your favorite cams and snow reports in one free
> dashboard. Build your mountain lineup on PeakCam.

The body mirrors the hub’s actual offer: real resort/cam data, a 1–8 mountain lineup,
favorites, and My Peak. The on-page H2 is the longer “Your mountains. One quick morning
check.”; the ad headline is the same line shortened to fit the ad slot.

### Preseason

Headline: **Build your winter watchlist**

Body:
> Get your Colorado mountain list ready for ski season. Save your favorites and check
> their cams and conditions in one place.

The page already shows off-season copy and the current season’s projected/confirmed
openings; it makes no claim that a list will be measured or compared across seasons.

## Verification

DeepSeek's final implementation pass ran these focused checks before handing the branch
to independent review:

- `npx tsc --noEmit` — passes.
- `npm run lint` — 0 errors (the repository’s pre-existing warnings remain).
- `npx tsx --test lib/lineup.test.ts lib/lineup-favorites.test.ts lib/favorites-events.test.ts`
  — 27 tests pass. They cover the eight-item chooser limit against a ninth option, the
  larger alert/write bound, typed camera items, expired/malformed/blocked storage,
  claim exclusivity and lease takeover, interrupted work, failure → retry → reload,
  a newer selection during an in-flight save, partial inserts, thrown provider errors,
  store timeouts, idempotent retry, the expected-account mismatch check before any read or
  insert, and attribution allowlisting.
- `npx playwright test -c playwright.auth.config.ts tests/e2e/signup-lineup.spec.ts` — 29
  tests per project pass on Chromium and WebKit (58 focused browser tests). New coverage in
  this pass: another tab’s fresh claim is reclaimed after its 30 s lease by advancing the
  browser clock; a newer intent written while an older save is in flight is saved after that
  save settles; a completed attempt does not block a new intent after sign-out/sign-in; an
  intent bound to another account shows the actionable “Switch account” link and performs
  zero writes; raw provider text is absent from failure UI; and at 320×700 the
  “Choose my mountains” button’s real bounds are inside the first screen, with the exact H1
  and the long introduction (now below the account card) still present. The 320/768/1024/
  1440 header cases assert the mobile create link is visible without opening the menu, the
  menu holds Sign in, exactly one create-account link is visible, and no width scrolls
  sideways. The fixture environment disables the Google Ads id/labels, Meta Pixel, PostHog
  and Reddit pixel, and the suite aborts any request to those hosts and asserts none
  occurred. No real emails, accounts or conversions are created.
- That implementation pass stopped after the focused browser suite, typecheck and lint.

Independent Mac Studio release checks after review:

- `npx tsc --noEmit` passed; `npm run lint` completed with 0 errors and 48 warnings.
- Full `npm test`: 2,245 tests, 2,238 passed, 6 skipped, 1 failure in the unrelated
  `lib/game/rendering/AdaptiveTerrainMesh.test.ts` atomic-swap test. A fresh `npm ci` and
  unchanged `origin/main` at `39417a2` reproduced the exact same failure (2,218 tests,
  2,211 passed, 6 skipped). No game code or dependencies were changed.
- Full `npx playwright test -c playwright.auth.config.ts`: **82/82 passed**, covering
  signup, account and reliability flows on Chromium and WebKit. The second sign-in in
  the repeat-session regression uses real client navigation and checks a window marker
  survives, so the test cannot pass by remounting the provider through a full reload.
- The cross-tab confirmation and 320×700 chooser regressions passed three consecutive
  runs in each browser (12/12). The mobile assertion includes eight selected mountains,
  checks the Save button's bounds, and verifies the outer dialog has not scrolled.
- Rendered screenshot review at 320, 768, 1024 and 1440 px covered the landing page,
  chooser and personalized signup modal; all four viewport checks passed. These use
  fixture snow data and are QA artifacts, not marketing images or real snow claims.
- `npm run build` passed, generating 1,260 static pages.
- An independent mutation check inverted the pending-intent expiry guard: its regression
  passed before the mutation, failed with it, and passed after restoring the exact source.
- Protected/generated source files, the auth callback, schema, dependency manifests and
  lockfile remain unchanged. All browser auth and favorites writes used the local fixture;
  no real accounts, emails or signup conversions were created by these checks.

## Known limitations

- Cross-device signup cannot carry the picks (see above). A visitor on a different device
  chooses the mountains again after signing in.
- If storage is blocked (private mode, policy), the lineup cannot follow the visitor through
  an OAuth/email redirect. The chooser and the contextual gates say so, keep account
  creation available, and the alert-success nudge explains the limitation instead of
  pretending.
- A tab that is killed after claiming but before writing keeps its claim for the lease
  window (30 seconds). Another tab or a reload then takes it over and retries automatically;
  until then it simply waits. This is the cost of not deleting the intent before the write.
- The lineup does not create a second dashboard. It writes the existing `user_favorites`
  rows, which `/dashboard` and `/favorites` already read.
- No measured uplift, conversion-rate change or revenue claim is made here. The
  instrumentation supports later measurement; it is not an experiment result.
- The implementation adds no database schema, service-role call, dependency or ad-account
  change. The authorized ad budget remains $150 total. Existing effective caps are Google
  $90 and Meta $55 ($145 combined, leaving a $5 reserve), with the campaigns ending October
  31. Those controls are managed outside this branch and were not changed here.
