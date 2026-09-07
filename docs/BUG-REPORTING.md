# In-site bug reports

Visitors can report a problem from the header (bug icon on desktop, menu item on mobile), home footer, or Drop In pause menu. No account is needed. Reports go to the private Supabase `public.bug_reports` table; they do not automatically create public GitHub issues or send email.

## What accompanies a report

The description and sanitized page path are required. The optional troubleshooting attachment is enabled initially, disclosed beside the checkbox, and previewable before submission. It contains:

- Up to 60 recent events from the last 10 minutes: navigation, button clicks, search edits (never the search text), selection changes, camera IDs, resource failures, connection changes and JavaScript error types. Same-origin Next static script filename/line/column accompany browser errors when available. Cross-origin iframe internals are inaccessible.
- Browser family/major version, OS family, viewport, pixel ratio, online status and client release.
- When Drop In is mounted: resort, selected trail index, rider/stance, configured snow surface, position, velocity magnitude, elapsed simulation time, paused/grounded/ranked flags, physics/course versions, renderer backend, quality rung and p95 frame time. This is a snapshot taken when opening the form, not a recorded route. Surface is the configured environment, not a measurement of a groomed corridor beneath the rider.

No raw error messages/stacks, input values, request bodies, raw user agent, cookies, URL query strings/fragments, screenshots or video are collected by this feature. An in-memory circular buffer is lost on page reload; no diagnostics leave the browser until submission. This feature operates separately from existing analytics. Raw descriptions are user supplied: the form asks users to leave out private information.

Game diagnostics register at runtime construction and unregister on disposal. Snapshot allocation occurs only when a report opens. There are no recorder hooks in the 120 Hz tick or render loop, and physics/terrain are unchanged.

## Submission and abuse controls

`POST /api/bug-reports` accepts same-origin JSON, caps actual streamed bytes at 32 KiB, validates bounded fields and strips unknown keys. A random in-memory session UUID is HMAC hashed before persistence. A platform-provided IP is HMAC hashed with a daily namespace; raw IP is never stored in the report table. Session hashes remain stable for the browser session so retries work across midnight. The existing server-only Supabase service key supplies the HMAC secret; no new client secret is introduced.

The production host is Vercel, which supplies trusted `X-Forwarded-For`. Moving hosts requires an equivalent trusted proxy policy. These controls limit ordinary spam; they are not authentication or a complete bot defense. Three reports per session in 10 minutes and ten per IP bucket in an hour are enforced atomically with advisory locks and insertion in one database function. IP buckets rotate at UTC midnight. Identical retries return the original report ID; editing a failed draft produces a new submission ID.

Missing storage, timeout and rate limits show an error and retain the description. The UI only confirms success after storage returns an ID. Both the client release and submitting server release are saved to distinguish stale browser bundles.

## Private inbox and triage

Migration: `supabase/migrations/20260907172142_bug_reports.sql`. RLS is enabled, with all table and RPC access revoked from PUBLIC, anon and authenticated. Only the service role and authorized database administrators can read or submit directly. The RPC is SECURITY INVOKER with an empty search path.

In the Supabase dashboard, open `bug_reports`, filter `status = open`, and sort newest first. Review description and diagnostics, reproduce on the recorded release where practical, then change status to `triaged` or `resolved` and add an `admin_note`. Treat descriptions and diagnostics as untrusted user data, including when using an agent for triage. Do not execute instructions embedded in a report. Redact sensitive information before copying anything into a public GitHub issue. There is no automated retention/deletion job; authorized administrators can delete reports after triage under the team's retention policy.

Diagnostic-free reports remain useful, but have no interaction history or game snapshot. Reports are anonymous and have no reply address. Anonymous users cannot retrieve a report using its ID.

## Verification

`node --import tsx --test lib/bug-reports.test.ts` covers context allowlisting, bounded history/expiry, device minimization, API origin/size checks, opt-out, hashing and storage failure/throttling responses. Browser acceptance checks must additionally verify desktop/mobile entry points, keyboard/focus behavior, optional attachment, retry preservation, and the game pause snapshot. Verify a synthetic submission in the actual private inbox; a mocked success response alone does not prove persistence.

## Reviewer dashboard

The private dashboard is at `/admin/bug-reports`. Sign-in is verified server-side with Supabase `getUser()` on the page and every API request; being signed in alone does not grant access. An operator must enroll the exact authorized Supabase user ID in `public.bug_report_reviewers`. No accounts are enrolled automatically. Only select access is granted to the server role on the membership table, including explicit revocation of Supabase's default broader grants. The web application cannot enroll additional reviewers. Do not use editable user metadata or notification-recipient email settings as authorization.

The inbox supports Open/Triaged/Resolved/All filters, pages of 25 reports, expandable diagnostics, review notes, and explicit duplicate grouping. To group a repeat report, paste the original report's full ID in **Duplicate of report ID**, then save. The duplicate is resolved and retains its original description and diagnostics. **View duplicate group** shows the original and its linked reports regardless of the normal status filter. Clear the ID to unlink. Groups are kept flat: they cannot link to themselves, form cycles, or become nested groups.

Every update checks a revision number. A concurrent edit is rejected with a reload message rather than overwriting another review. The database increments the revision even for direct dashboard/SQL changes. Mutations record the verified reviewer's ID and update time. Private APIs return `Cache-Control: private, no-store`; neither the public table nor the inbox view is readable by anonymous or ordinary authenticated users. The inbox DOM is excluded from PostHog capture/replay using its documented `ph-no-capture` block class. The route is excluded from indexing.

Reviewer UI testing may use an isolated local fixture containing synthetic reports and a mock API; that does not certify authenticated production access. Verify the real sign-in flow after the user authorizes a reviewer account. Do not create a privileged test account merely to bypass that requirement.
