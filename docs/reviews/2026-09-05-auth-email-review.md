# PeakCam account and authentication review

Reviewed 2026-09-05 against released application code at `45ca630`, the live Supabase public auth settings and security advisor, database access policies, public DNS, and the login email supplied by the owner. This was a read-only review; no auth settings, DNS records, accounts, passwords, or email templates were changed. No test emails were sent.

## Assessment

The received email uses Supabase's stock sender (`noreply@mail.app.supabase.io`), the generic subject “Magic Link,” and a minimal unbranded login message. Its authentication link belongs to this project's Supabase host and redirects to PeakCam's callback. The supplied one-time token was not opened, reproduced, or saved in this report.

The message is consistent with the application's real login flow, but does little to establish trust in PeakCam. Its junk placement cannot be attributed conclusively without the original Authentication-Results and Microsoft filtering headers. The message alone does not establish an SPF/DKIM failure. PeakCam's own DMARC gap is a separate issue: that policy does not govern mail whose From domain is Supabase's.

## Findings and priorities

| Priority | Finding | Evidence and effect | Recommended action |
| --- | --- | --- | --- |
| High | Authentication mail uses a generic provider identity | Owner-supplied sender, subject, and body contain no PeakCam identity. Auth calls go directly to Supabase; the Resend email module is for snow alerts. | Configure custom auth SMTP with a verified PeakCam sender and branded transactional templates. Supabase explicitly describes its default SMTP as unsuitable for production. |
| High | Password and passwordless sign-in are inconsistent | `app/auth/page.tsx` offers password sign-in/signup; `components/auth/AuthModal.tsx` sends an email link. Favorites use the modal; the header uses the password page. | Use the same sign-in component and choices at every entry point. Preserve existing password accounts while adding a consistent email-code alternative. |
| High | Password recovery and account management are missing | No `resetPasswordForEmail`, password-update flow, or recovery page was found. Signup confirmation has no resend action. No central account settings screen was found. | Add Forgot password, a safe recovery callback, set/change password, resend confirmation, and a clear account menu. Test expired and already-used tokens. |
| Medium | Current email links have scanner and browser-context failure modes | The supplied message is wrapped by Microsoft Safe Links. The callback exchanges a PKCE code. Supabase documents scanner prefetch consuming email links; PKCE depends on the originating browser's verifier. Neither failure was demonstrated on this user's message. | Offer a typed email OTP; alternatively use a deliberate confirmation page before consuming a link. Keep auth click tracking disabled. Provide actionable errors and a resend route. |
| Medium | Leaked-password protection is disabled | Live Supabase security advisor reports this setting disabled. Signup copy advertises a six-character minimum; the live enforced minimum was not independently visible. | Confirm and strengthen server-enforced password requirements, match the UI, and enable compromised-password checks if the current plan supports them. Do not change users' existing passwords. |
| Medium | PeakCam's sending domain lacks DMARC | DNS has DKIM at `resend._domainkey.send.peakcam.io` and SPF at `send.send.peakcam.io`. No TXT answers were returned for `_dmarc.peakcam.io` or `_dmarc.send.peakcam.io`, including a check through 1.1.1.1. | Inventory legitimate senders, add monitored DMARC, verify alignment on received messages, then tighten policy when safe. This improves the branded sending setup but is not a diagnosis of the Supabase email's junk placement. |
| Lower | Auth presentation and usability are incomplete | Standalone auth uses the older cyan styling, while the modal uses the current cream/ink palette. The modal lacks dialog semantics, focus containment, and Escape handling. Raw backend errors are shown to users. | Apply the current brand, accessible dialog behavior, clearer errors, and consistent confirmation/resend states. |

## What is already sound

- The live public settings enable email authentication and signup, require confirmation (`mailer_autoconfirm: false`), and disable anonymous, phone, and social providers.
- The app uses Supabase SSR cookie clients and PKCE code exchange. The proxy validates/refreshes identity with `getUser()`.
- `safeNext` rejects off-origin redirects, including control-character and backslash variants. The callback verifies origin again at the redirect itself.
- Auth-related URL parameters are redacted from analytics by the existing sanitizer.
- `user_favorites`, `user_conditions`, and `alert_subscribers` have row-level security enabled. Favorites SELECT, INSERT, and DELETE policies restrict access to the current user. Subscriber records deny public access; public conditions are intentional, with writes/deletes tied to their author.
- Nineteen existing redirect and analytics-redaction tests passed during this review.

These are positive checks, not a penetration test or a guarantee that every account operation is secure.

## Proposed email and login direction

Use a dedicated authentication subdomain, for example `auth.peakcam.io`, verified in Resend and connected to Supabase SMTP. Keep snow alerts on `send.peakcam.io`. Proposed sender: `PeakCam <login@auth.peakcam.io>`; this address is a proposal, not configured yet.

For the existing link flow, use subject “Sign in to PeakCam,” a small PeakCam wordmark, “Use the button below to finish signing in,” one Sign in to PeakCam button, the real configured expiration, and “If you didn't request this, you can ignore this email.” Use restrained cream/ink styling and a plain-text equivalent where the delivery mechanism supports it. Avoid promotional content, tracking, and invented expiration claims.

The next UX iteration should offer the same email/password and email-code choices everywhere. Add complete password recovery before presenting passwords as a supported account lifecycle. A code email should say “Your PeakCam sign-in code,” present the code prominently, and clearly explain where to enter it. Codes reduce dependence on scanner-sensitive clickable tokens but do not solve inbox placement by themselves.

## Verification before rollout

1. Read the authenticated SMTP configuration, all email templates, redirect allowlist, rate limits, CAPTCHA settings, password policy, session limits, and security notification settings.
2. Verify the auth sender domain and DKIM/SPF/DMARC alignment before enabling it.
3. With explicit permission to send test messages, test confirmation, login, resend, password recovery, and expired/used tokens in Gmail and Outlook. Inspect the received headers and delivery events; provider acceptance is not proof of inbox placement.
4. Test links or codes across desktop/mobile and email apps, especially Outlook Safe Links. Test account enumeration-resistant responses, resend cooldowns, rate-limit errors, focus handling, logout, and per-user favorites access.
5. Roll out the shared auth UI and templates together, with a reversible configuration record. Monitor bounce, complaint, and authentication failure rates.

## Unverified configuration and secondary advisor findings

The Supabase management dashboard required a login in the available browser. The connected database tools expose policies and advisors but not the full SMTP/template/session configuration. Current SMTP credentials, redirect allowlist, exact password minimum, CAPTCHA, token expiry, and session settings therefore remain unverified. The original received email is the evidence for the sender/template finding.

The advisor also flags two owner-privileged views (`resort_conditions_live`, `latest_snow_reports`), an executable privileged function (`rls_auto_enable`), extensions in `public`, and `cam_reports` RLS without policies. These need a separate review of intended public exposure and execution semantics; the notices alone do not demonstrate a user-data leak. No schema changes were made.

## References

- [Supabase custom SMTP and delivery guidance](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase email templates, Safe Links, and tracking](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase password security and plan requirements](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [Supabase SSR and PKCE](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- [Resend domain authentication and subdomain guidance](https://resend.com/docs/dashboard/domains/introduction)
- [Owner-privileged view remediation](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
- [Public privileged-function remediation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)

## September 6 implementation follow-up

The shared password/sign-in UI, native dialog behavior and password recovery landed in `a74cbbf`. The continuation branch `review/auth-email-setup` adds a guarded account page, password/session controls, confirmation resend with a client cooldown, curated error messages, and staged code-based email sign-in. Six branded templates and a rollout record are prepared in `supabase/email-templates/`.

The live Supabase project is healthy; its organization is on Pro. Leaked-password protection remains disabled according to the refreshed security advisor. The available Resend API key is correctly restricted to sending and rejects domain-management reads (401); no attempt was made to bypass that scope. `peakcam.io` uses Vercel DNS. Public lookups still returned no DMARC record on the apex or auth subdomain and no Resend DKIM at the proposed auth subdomain.

Dashboard sign-in to Supabase and Resend was requested before live SMTP/password-policy/domain changes. These external settings and inbox placement are not fixed by the prepared code. No real emails, accounts, passwords, sessions, or DNS records were changed during this follow-up's synthetic tests.
