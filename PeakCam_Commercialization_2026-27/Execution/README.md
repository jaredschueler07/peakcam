# PeakCam commercialization: execution readiness

**Execution dashboard:** run `npm run commercialization` from the repository root and open http://127.0.0.1:3334. The [tracker guide](../../dashboard/commercialization/README.md) explains local saves, evidence, exports, and recovery.

Reviewed September 13, 2026, America/Chicago. Start the proposed execution cycle September 14. Original September 9 research, workbooks, exports and manifest remain unchanged.

**The commercial strategy is usable, but the portfolio is not an accurate implementation checklist for today’s product.** Production already has the broad product it describes as absent. The work now is to certify a commercially usable cohort, establish honest measurement, resolve source rights and commercial service access, and test buyers. Building every suggested feature would duplicate work and outrun the evidence.

## Verified baseline

| Item | September 13 evidence | Implication |
|---|---|---|
| Code and deployment | Local HEAD, remote main and production deployment all match `6211ff8c2eba53281de22fc2d2ef59a5edb19b51`; Vercel production READY | Portfolio audited `61c5f264…`, a different implementation |
| Inventory | 148 active resorts; 351 camera records, of which 306 active, 42 automatically disabled and 3 manually inactive | Use active records, not historical seeds, for the commercial audit |
| Colorado | 20 resorts; 46 active camera records across 17 resorts | Certify quality within the existing region; page count is already met |
| Colorado gaps | Loveland, Ski Cooper and Powderhorn have no active camera records | Confirm useful official fallback and repair permitted sources before promoting them |
| Other inventory gaps | 15 resorts overall have no active camera records; one duplicate active Red River link destination | See [resort coverage](Resort_Coverage.csv); do not blindly rerun the importer |
| Placeholder URLs | Zero active records match the reviewed example/placeholder patterns; Breckenridge has four active records | Original R01 is satisfied for the current catalog scan, not proof all sources work |
| Source health | All active cameras have September 13 automated checks and no accumulated failures; all 148 latest snow reports are under 24 hours old | Availability does not establish valid playback, image capture time or rights |
| Snow supply | 89 latest reports from SNOTEL; 59 from Open-Meteo | Model-sync is active; the original “no weather/database” cost model is obsolete |
| Existing features | Auth, account favorites, maps, comparisons, dashboard, forecasts, email alerts, reports and Drop In | Validate and improve; do not rebuild them as missing features |
| Early account counts | 7 auth records; 2 alert subscriber records, including any founder/test records | These are neither active users nor proof of market demand or confirmed newsletter opt-in |
| Hosting | Vercel Pro team verified | Actual invoices, CDN plan selection and spend remain unknown |
| Public HTTP/SEO | Home and sitemap return 200; sitemap contains 155 URLs including 148 resorts | Indexation and interactive performance remain unverified; public `/alerts` is absent from sitemap |

Production project `owsxnogvufankayfwczl` and deployment `dpl_31mp2xB4TVEBtgfLQhkeLc4uPosx` were inspected read-only. [Baseline evidence](evidence/Baseline_2026-09-13.json) records the results, timestamps and scope. UTC snow timestamps cross into September 14 while the local review date remains September 13.

## Findings that change execution

1. **Commercial weather access is a present dependency.** `lib/open-meteo.ts` uses the free hosted API; forecast alerts consume this integration too. The provider distinguishes its noncommercial free endpoint from commercial customer access. Confirm the appropriate agreement, configure the commercial endpoint server-side, and budget it before monetization. Data attribution remains relevant. [Open-Meteo](https://open-meteo.com/en/pricing)
2. **Rights must cover existing previews as well as players.** `lib/cam-preview.ts` generates Brownrice snapshots and YouTube previews and uses Roundshot metadata. The July media spec labels cam-still capture “no permission needed”; do not rely on that assumption. No `media_permissions` or `resort_media` table exists in the inspected live public schema. Every seeded register row remains **unknown**, not cleared or adjudged infringing. Resolve scope with the owner/provider and counsel.
3. **The app cannot yet substantiate the portfolio’s core usage metric.** Current `cam_clicked` combines intent and some outbound actions without stable camera IDs. `alert_confirmed` fires on manage-page mount, not a server-confirmed opt-in event. Direct PostHog helper captures bypass the readiness queue. Map and validate existing events before using them in partner reports.
4. **A 20-page pilot is a quality task.** Three Colorado pages have zero active records, and unknown rights are not cured by a successful HTTP check. Target 12 certified useful pages first, then up to 20. Preserve existing national/South America coverage while concentrating commercial work.
5. **The financial base case conflicts with stated operating choices.** It includes $2,600 first-year marketing and $1,600.50 ad revenue. An older roadmap rejects programmatic ads. The workbook prices premium at $4.99/month while the research proposes $19–29/season. Resolve those choices and add actual Supabase, weather, maps, email and analytics costs. [Financial review](Financial_Review.md)
6. **The first-wave copy is not send-ready as supplied.** Several drafts paste internal research instructions into recipient-facing prose and describe three-resort coverage. Contact routes also differ between CRM tabs. [Refreshed drafts](Outreach_First_Wave.md) use the current listing and verified routes without claiming an audience or partnership.
7. **The release backlog needs reconciliation.** Thirty-nine open issues were retrieved. Some describe already-shipped work, such as forecast alerts, a Drop In hub and the Palisades mobile fallback. Other claims, including conditions quality and compare failures, need reproduction. [Issue triage](Issue_Triage.csv) preserves them as unverified reports.

The existing [July media/roadmap spec](../../docs/superpowers/specs/2026-07-24-media-permissions-and-roadmap.md), root task list and supplied AGENTS overview also contain historical implementation assumptions. Resolve those against current code and production evidence; their checkboxes are not completion evidence.

## Operating decisions and assumptions

Pending founder confirmation, plan for **20 hours/week**, with **16 hours of planned work and 4 hours for maintenance/interruptions**; **$3,000–$5,000 total cash at risk**; and a **Colorado commercial pilot within the existing broader site**. These are provisional planning inputs, not spending authorization or commitments. Region and capacity questions were sent during the review; no answers were available when this plan was prepared.

Use approved contextual referrals and a few small local sponsorship pilots as the first revenue tests. Keep paid premium, display ads and additional commercial regions conditional. Drop In development remains a separate product initiative; do not silently charge its development hours to this capacity plan. Any allocation to it reduces commercialization capacity hour for hour.

Needed founder inputs: weekly available hours; total cash-at-risk and monthly stop limit; operating state and existing entity/bank/insurance status; authorized sender mailbox and business postal address; existing permissions/affiliate agreements; actual billing and 30-day analytics exports. Missing values remain unknown. Do not supply secret keys in these files.

## First two weeks: September 14–27

This is a **32-hour planned slice**, not a promise to finish all linked action rows. The remaining 8 hours across the fortnight are maintenance/interruptions. Existing recurring obligations must fit that reserve or the planned slice shrinks.

| Work slice | Hours | Deliverable / handoff |
|---|---:|---|
| Verify source catalog and define pilot | 1 | Close current-state R01 with snapshot; select first 12 candidates from existing Colorado cohort |
| Pilot source/permission review | 6 | Inspect first seven resort records and actual preview modes; log owners, unresolved scope and useful fallback |
| Actual baseline collection | 3 | R03 traffic and bills checklist completed as far as access permits; no invented numbers |
| First camera usability sessions | 4 | Begin R04; document completion times and failed source journeys, not a pass from HTTP status |
| Camera telemetry implementation and QA | 6 | R05 source-click/intent/load taxonomy, stable IDs and direct-arrival QA; scoped privacy decisions from C03 |
| Outreach preparation and controls | 2 | Verify drafts, exact source scopes, sender identity and suppression; send only after explicit authorization |
| Professional review brief | 1 | Send-ready request for a scoped quote and permitted-use review; no firm engagement assumed |
| First four behavioral interviews | 3 | Anonymized findings using the prepared script; remaining eight scheduled |
| Commercial weather access preparation | 4 | C01 endpoint/configuration plan and tests ready; activation waits on actual commercial access |
| Follow-up and sprint review | 2 | Record evidence, remaining blockers and next capacity allocation |
| **Planned work** | **32** | **16 hours/week** |

The original roadmap totals 255 hours and $2,800 in line-item allowances. Those hours exclude recurring operations and external waiting time, and the allowances are not a separate budget to add to the financial workbook. The original first phase schedules 46 hours; it no longer fits automatically into the remaining September window. The [action register](Action_Register.csv) preserves old dates and proposes new ones without falsely marking historical deadlines completed.

At 10 hours/week, use 8 planned + 2 maintenance and spread this slice over four weeks, deferring premium, paid acquisition and later guides. At 30 hours/week, use at most 24 planned + 6 maintenance; bring forward source verification and interviews, not speculative features. Re-estimate after the first week’s real maintenance load. External permissions and user recruitment can dominate elapsed time regardless of coding speed.

## Season gates

| Date | Required operating evidence | Business target and response if missed |
|---|---|---|
| September 27 | Current inventory/source register, baseline collection, core event QA underway, commercial weather path defined | First interviews and permission conversations; reduce cohort if access/verification is slow |
| October 18 | 12 certified useful Colorado pages; source/preview basis recorded; reliable guest return flow; reviewed current policies | Recurring job supported by interviews; initial written permissions or reviewed fallback paths; postpone distribution if source trust fails |
| November 23 | Holiday reliability pass; sources/rights/collection appropriate for promoted uses; on-call and rollback ready | Up to 20 certified pages and 100 measured repeat decision-makers target; missed audience goal means revise scope/spend, not fake readiness |
| December 15 | Approved/reversed transactions and invoices reconcile separately from cash | One attributable payable outcome **or** two paid pilots; otherwise narrow commercial spend and revisit offer |
| January 15–February 20 | Dated partner reports and mature return cohorts | Two paid renewals target, with eligible denominator reported; expand only after repeat buyer/user value |
| April 30 | Cash, obligations, maintenance hours, rights expiry and next-season commitments reconciled | Explicit continue, narrow, pivot or stop decision; summer spend receives its own cap |

## Use the execution files

| File | Purpose |
|---|---|
| [Action_Register.csv](Action_Register.csv) | All 36 original actions plus seven current-state gaps; dependencies, owner, proposed dates and completion evidence |
| [Chapter_Coverage.csv](Chapter_Coverage.csv) | All 21 chapters mapped to execution actions |
| [Launch_Playbook.md](Launch_Playbook.md) | Scoped engineering briefs, user research, commercial materials and operating cadence |
| [Camera_Source_Register.csv](Camera_Source_Register.csv) | 306 active cameras with actual URLs, preview variants and separate rights fields |
| [Resort_Coverage.csv](Resort_Coverage.csv) | 148 resorts, including zero-camera gaps and pilot certification fields |
| [Event_Mapping.csv](Event_Mapping.csv) | All 29 proposed events reconciled to current code and implementation gates |
| [Prospect_Queue.csv](Prospect_Queue.csv) | All 100 prospects, staged work and first-ten route verification; no automatic send dates |
| [Outreach_First_Wave.md](Outreach_First_Wave.md) | Seven resort and three provider drafts, plus a Brownrice inquiry because it serves many existing cams |
| [Experiment_Plan.csv](Experiment_Plan.csv) | All 15 experiments with dependencies and blank result/evidence fields |
| [Risk_Review.csv](Risk_Review.csv) | All 28 original risks with updated exposure and linked controls |
| [Financial_Review.md](Financial_Review.md) | Workbook reconciliation, material conflicts and spending decisions |
| [Operating_Cost_Inputs.csv](Operating_Cost_Inputs.csv) | Actual invoices and commitments to collect; blanks do not mean zero |
| [Financial_Stress_Scenarios.csv](Financial_Stress_Scenarios.csv) | Explicit snapshot stress tests, not new forecasts |
| [Issue_Triage.csv](Issue_Triage.csv) | Current open issues to reproduce or reconcile before scheduling fixes |

Use this folder as the execution overlay. The original XLSX files remain scenario/research sources. There is no automatic sync between them and these CSVs. Keep action IDs and prospect IDs stable, record evidence before changing status, and update dates from real activity. Keep permission proof and future private contact/billing records in restricted storage; this GitHub repository is public. Store restricted evidence references here, not agreements, bank documents, secrets or personal contact data.

## Verification and limits

- Original manifest: every recorded file hash matches; originals were preserved.
- Coverage validation: 43 actions, 21 chapters, 306 unique camera IDs, 148 resorts, 29 events, 100 original prospects, 15 experiments and 28 risks; action dependencies resolve.
- Workbooks: read-only Artifact Tool import/error scan; all 72 imported monthly financial rows match numeric JSON snapshot fields within `1e-6`; all nine scenario/horizon summaries reconcile. Native Excel input-change recalculation and visual review were not performed.
- Current working-tree TypeScript check passes. `npm test`: 1,442 pass / 4 fail because `gdal_translate` is absent. ESLint: 2 errors in existing untracked `lib/descent/render/Renderer.ts`, plus 54 warnings. These results precede any later concurrent edits to the game work.
- Production build is READY at the verified SHA. A fresh local production build was not run. Browser testing could not proceed because CUA reported no browser available. No claim of mobile/player QA completion is made.
- No production code/database changes, purchases, contracts, outbound messages, deployments or Git commits were made. Existing uncommitted game work was preserved.

**Next action:** begin the first-week source review and telemetry work from the launch playbook while Jared supplies the missing baseline and operating decisions. Commercial execution is prepared; source clearance, measured demand and paying outcomes remain to be earned.
