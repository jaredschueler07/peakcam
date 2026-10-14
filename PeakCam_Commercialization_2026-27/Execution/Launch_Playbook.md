# Launch work and acceptance criteria

September 13 readiness review. Use the [action register](Action_Register.csv) for status, dates and evidence. The briefs below make the next work concrete without committing to every conditional feature in the research portfolio.

## Engineering work packets

### 1. Source trust and permission controls — R02, R09, R11, R18, C06

**Outcome:** a promoted camera page always offers an accurately described permitted source or useful official fallback; a revoked asset stays removed even when a health check succeeds.

Start with the 20 existing Colorado pages. First certify 12 with real source utility; repair or clearly present fallback for Loveland, Ski Cooper and Powderhorn. Do not add empty camera rows to inflate coverage. Sources marked unavailable or without suitable permitted use should not be promoted as playable live feeds.

Implementation targets: `lib/types.ts`, `lib/supabase.ts`, `lib/cam-preview.ts`, `components/browse/CardCameraPreview.tsx`, `components/cam/CamEmbed.tsx`, `components/cam/StreamFeed.tsx`, `components/resort/ResortDetailPage.tsx`, `scripts/cam-health-check.mjs`, and applicable metadata/OG surfaces.

The CSV is the initial working register, not a license or automatic production policy. Store grantor/proof privately. Public reads need only the permitted display/credit fields. Before adding schema, inspect the live database and existing migrations; the proposed July schema is not deployed. Do not assume migration numbering is authoritative.

Use distinct controls for operational availability and rights eligibility. The health job currently restores `is_active` when an auto-disabled source recovers. It must never override an explicit rights restriction. Deactivation must include preview derivatives and mobile variants, not just the main player. The Palisades mobile still and Brownrice/YouTube/Roundshot preview behavior are included in the source register.

Acceptance:

- Every promoted source records owner/licensor authority, actual use, applicable scope, attribution, proof/reference or reviewed link-only basis, expiry, withdrawal route and last manual check.
- Image load time, last automated URL check, snow-report update time and camera capture time have distinct labels. A missing capture timestamp stays unknown.
- A simulated revocation removes the player and preview across browse/detail/lightbox/metadata and any caches within the agreed operating window; official fallback follows the reviewed source policy.
- A subsequent successful health check cannot republish the revoked use. Expiry and recovery paths are verified.
- Reject malformed and placeholder URLs before activation. Preview fallback and provider errors produce useful source links, including keyboard access.
- New camera capture/storage/social reuse is not enabled by the mere fact that a public image is reachable. Counsel reviews the exact use, not a generic “public camera” category.

### 2. Honest analytics — R05, C03

**Outcome:** the team can measure a real camera decision without reporting a click or iframe load as a video view.

Extend the existing PostHog integration. Do not install another analytics platform. Keep compatible existing event names where their meaning is useful, with a documented transition for changed semantics; avoid double-counting old/new names. [Event_Mapping.csv](Event_Mapping.csv) covers all 29 portfolio events and defers events for unbuilt commercial features.

Current code has `cam_clicked`, `resort_viewed`, `search_performed`, `filter_applied`, `favorite_added`, `favorite_removed`, `alert_signup_submitted` and `alert_confirmed`. Camera clicks need stable IDs and reason/mode. Direct captures in `lib/posthog.tsx` bypass the readiness queue in `lib/analytics-events.ts`; test cold arrivals explicitly. `alert_confirmed` on `AlertManagePage` is not verified double opt-in; retain historical interpretation and use a new correctly named server event if a true confirmation flow is introduced. Do not infer confirmed opt-in from subscriber count or manage-page visits.

Minimum launch payload: event name/version, UTC timestamp from the analytics system, stable resort/camera ID, display mode, page/placement, source host, deliberate action reason and controlled acquisition tags. Do not attach bearer tokens, token prefixes, email, raw search/free text, or precise user coordinates. Audit final outbound payloads because sanitizer behavior and declared properties may differ.

Provider playback callbacks qualify only where they actually exist and can be validated. For a generic third-party iframe, load is diagnostic; official-source click is measurable intentional handoff. Image load also does not prove recency. Report unsupported playback as unmeasurable.

QA journeys: direct resort arrival; SPA navigation; image success/error/retry; YouTube intent versus supported playback; generic iframe timeout/fallback; link-only source; mobile back navigation; two saved-resort visits; consent/opt-out/DNT as applicable; analytics blocked entirely. Verify no duplicate events from effects, rerenders, retries or double clicks. Core navigation must work when measurement is unavailable.

### 3. Commercial weather access — C01

**Outcome:** the current weather product can operate under its commercial source terms without exposing credentials or corrupting freshness.

Trace `lib/open-meteo.ts`, its consumers in resort pages and `scripts/model-sync.ts`, and the forecast alert trigger. Keep one shared server-side endpoint/configuration path. Obtain actual commercial account/contract details before choosing endpoint and credentials. Do not invent a working paid API key or purchase a plan in this preparation step.

Acceptance: server-only credential handling; no key in public URLs, logs, telemetry or client bundles; approved endpoint actually used by all consumers; explicit attribution and model-versus-observation labels; request timeout/failure preserves an honest unavailable or stale state; basic forecast, ingestion and alert tests cover configuration and failures. Record measured API usage and metering assumptions in the cost worksheet. Do not activate the dormant multi-source pipeline as a shortcut.

### 4. Guest return and sharing — R12

**Outcome:** a signed-out skier can save a mountain and return to it quickly; existing account favorites still work.

Reuse current resort IDs and UI. Add a small versioned browser-local set for signed-out users, validate it on read, and handle blocked/full storage gracefully. Keep existing account favorites in Supabase. If the user signs in, offer or apply a clearly defined merge without erasing either set; sign-out must not expose another account’s private data. Decide this behavior before implementation.

Add a deliberate share control using the canonical resort URL, native share where available and a copy fallback. Exclude session/alert/auth tokens. Treat canceled native share as canceled, and count an opened share sheet separately from a confirmed clipboard copy. A copied link still does not prove referral traffic.

Acceptance: signed-out save persists after reload; removal persists; stale IDs do not break the page; account save still follows RLS; share copies only canonical public URLs; screen-reader names and keyboard focus are clear. E05 observes a 50-person beta and 14-day return; favorite users self-select, so do not claim causal lift.

### 5. One approved referral offer — R15, R16

**Outcome:** an eligible visitor can follow a relevant, disclosed offer, and the team can reconcile payable results.

Build only after program acceptance. A small typed configuration keyed by resort ID can serve the first pilot; a general ad marketplace or billing system is unnecessary. Fields: program/merchant, approved destination/deep link, allowed placement, campaign/sub-ID scheme, disclosure text, valid dates and enabled status. Use a separate labeled module so payment cannot affect snow ratings or organic ordering.

Acceptance: valid eligible offer only; nearby material-connection disclosure; stable opaque sub-ID without PII; click log distinct from camera-source click; disabled/expired offer disappears; network-approved and reversed transactions reconcile to net earned commission and later cash. Test only as permitted by network rules; no self-booking or fabricated conversion.

A frontend thank-you page or click is never a sale. Start with manual network reconciliation; automate only once volume warrants it.

### 6. Product release and operations — R18, R24, R28, C04, C05

Baseline was run on the working tree at the start of this review: TypeScript passed; four tests require missing `gdal_translate`; lint errors are in pre-existing untracked descent code. Do not hide those failures with blanket skips or assume current production is failing from an unrelated local tool prerequisite. Reproduce on the intended release branch and make the GDAL requirement explicit for terrain checks.

Triage open issues by current reproduction. In particular: #68 condition-rating inconsistency; #30/#32 compare resilience; #63 alerts Continue control; #65 mobile crowding; #18 displayed number accuracy; #38/#39/#45/#46 contrast/focus. #64 forecast alerts, #62 Palisades fallback and #34/#40 Drop In discovery have relevant implementations now; close only after validating actual behavior.

Check the live scheduler on its actual host. This environment contains no `com.peakcam.*` launchd plists; fresh database rows demonstrate successful ingestion but not the scheduling configuration, backup quality or future recovery. Verify latest successful execution, failure notification, host ownership, single-writer rules, recovery instructions and restore evidence. Test alert delivery only with an authorized test recipient and isolated test data; do not trigger a broad production email send as a smoke test.

Required release evidence: targeted tests for changed behavior, TypeScript, appropriate lint/build checks, mobile/desktop source journey, production deploy SHA, post-deploy spot-check and rollback instructions. Do not deploy during an unrelated dirty working tree without an isolated reviewed change set. Keep the unauthenticated ops dashboard private.

## Core metric definitions

**Qualified camera action:** deliberate click to the correct official camera destination, or validated provider playback where measurable. Intent and technical load are separate diagnostics. A source click is successful handoff, not proof that the destination played a stream.

**Weekly returning camera decision-makers:** measurable non-test/non-bot visitors with qualified actions on at least two distinct days in the trailing 28 days, with one action in the reporting week. Use a documented reporting timezone and consistent identity rules. Do not fingerprint people who decline measurement or imply tracked cohorts represent all visitors.

**Qualified-action rate:** distinct measured eligible visitors with at least one qualified action / distinct measured eligible visitors, same cohort and period. Keep numerator and denominator visible. A denominator of zero is unavailable, not a 0% failure or 100% pass.

**14-day return:** share of an acquisition cohort that returns and completes the defined action on another day within days 1–14. Only include cohorts that have had the full opportunity window. Define 7- and 28-day views similarly. Segment by destination, acquisition source and relevant ski/weather window; report sample sizes.

**Commercial outcomes:** approved net commission after reversals; sponsor invoice issued; sponsor cash collected; merchant-confirmed aggregate leads/bookings; paid renewals / eligible expiring pilots. Keep these separate. A source permission, creator mention or affiliate application is not a revenue partnership.

## Research scripts and recording templates

### Ten observed camera journeys — R04 / E01

Recruit a mix of iPhone, Android and desktop users; include five who did not help build PeakCam. Ask: “You’re deciding whether to drive to a mountain you ski. Starting here, show me how you would check its camera.” Do not point to controls. Start the timer at page availability; stop when the correct intended source is reached. Separately record whether the intended current view was actually usable.

Record anonymized participant ID, device/browser/network, resort, start time, completion seconds, success/failure reason, fallback used, whether the view was current/unknown, and one observed obstacle. Try failed-image/iframe and keyboard journeys in product QA as well; those are not substitutes for human sessions. Target 9/10 reaching the intended source in 20 seconds. A miss leads to one concrete fix and a fresh validation cohort.

### Twelve behavioral interviews — R10 / E02

Ask about the last actual ski decision: where and when; what changed the plan; which sources were checked in what order; what was slow or misleading; what they did when a camera was stale; whether they saved/shared sources; what they paid for, if anything. Ask them to show their present workflow if comfortable. Finish with an optional test of PeakCam, after understanding the existing behavior.

Capture anonymized ID, dates, local/traveler/organizer role, actual repeated job, workaround, frequency during the season, observed purchase behavior, quotes with consent, and recruitment channel. Avoid personal contact details in the public repo. A recurring multi-site camera check reported by 8/12 is the portfolio target; contradictory evidence should change the pilot hypothesis.

### Three distribution pilots — R17 / E06

Use one club, one lodging concierge and one other relevant organizer where feasible. Offer a short useful camera list for their actual destination. Only ask them to share if helpful. Give each a distinct nonpersonal UTM and reuse canonical maintained pages. Record partner permission to distribute, date, destination, visits, qualified visitors, matured return cohort, preparation hours and feedback. No automatic newsletter enrollment.

## Commercial material briefs

These are draft structures to populate from evidence, not public pages or signed offers.

| Material | Required content | Gate |
|---|---|---|
| Resort/source one-pager | Current listing, exact sources/modes, credit, correction route, separate requested rights and withdrawal process | R02/R07; no “partner” badge without approval |
| Advertiser media kit | Dated destination visitors, measurement limits, sample period, one placement mock, rate and reporting example | R03/R17/R21; unknown audience stays blank internally |
| Local sponsor pilot | One labeled destination placement for 30 days; proposed $50–150; actual reach report; click/outcome definitions; ending date | R23 plus business/rights readiness; no guaranteed bookings or exclusivity |
| DMO proposal | One maintained regional guide and useful source introductions; shared measurement goals | R11/R14/R17; distribution first |
| Affiliate application | Accurate live scope, relevant destination audience if measured, intended placement/disclosure, attribution question | R09/R15; no claimed acceptance |
| Provider proposal | Named cameras, commercial player/preview uses, owner consent authority, permitted domains, fees, expiry and takedown | R02/R06/R07 |
| Creator/media brief | One honest product evaluation or permitted content test; disclosure and production budget if any | R19; no paid positive reviews or copied footage |
| Business overview | Free core utility, actual source/data model, current commercial experiment, concise founder contact | Current baseline only; no unearned testimonials |

For a first sponsor, specify placement, destination, start/end dates, deliverables, price/tax handling, payment due date, cancellation/refund or make-good conditions, permission to use the sponsor’s supplied logo, reporting, lack of editorial influence and signing authority. Have reusable terms reviewed before offering a binding contract. Renewal is an explicit later decision by default.

## Weekly operating rhythm

Monday: inspect promoted-source health, aged failures and cash commitments. Tuesday: verify and prepare up to five relevant permission/partner messages; send only under the founder’s authorization. Wednesday: conduct two user sessions and handle existing replies. Thursday: deliver the highest-impact product fix and a partner call. Friday: reconcile metrics, network outcomes and actual effort, then choose the next experiment.

Keep no more than 25 active prospects. Follow-up dates start at **actual** send date. Default to one useful follow-up around day 7, then stop; reconcile this intentionally with the original playbook’s optional day-16 third contact. Honor refusals and opt-outs immediately across channels. Do not work through every named employee at the same company.

Weekly record:

| Field | Value to record |
|---|---|
| Week / reporting timezone | Start and end dates |
| Sources | Certified pages, active promoted sources, unresolved rights and dead destinations |
| Core utility | Qualified visitors / measured eligible visitors; source versus confirmed-playback split |
| Return | Weekly returning decision-makers; mature 14/28-day cohorts with sample sizes |
| Commercial | Approved/reversed commission, collected sponsor cash, eligible renewal asks/results |
| Cost | Bills paid, new commitments, remaining approved discretionary cash |
| Time | Planned work, maintenance and game/other work separately |
| Decision | One continue/change/stop decision and next evidence deadline |

On a credible rights/accuracy issue, identify the asset/source, preserve restricted evidence, disable the disputed use through the agreed control, verify public and cached removal, determine the permitted fallback, and log the decision. Escalate material legal or privacy issues to the relevant professional. Do not promise a universal legal response deadline from this template.

At April close, use actual cash, hours, renewal commitments and source access to decide whether the commercial model deserves another season. A passed research experiment may justify the next test; it does not automatically justify every “Later” feature.
