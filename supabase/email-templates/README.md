# PeakCam authentication emails

These are **prepared templates**, not evidence of live configuration. `templates.json` contains the documented Supabase Management API fields; HTML files are readable dashboard-ready sources. No credentials or real tokens belong here.

Use dedicated sender `PeakCam <login@auth.peakcam.io>` after verifying `auth.peakcam.io` in Resend. Keep snow alerts on `send.peakcam.io`. Configure `smtp.resend.com`, port 465, username `resend`, and a dedicated sending key permitted for the auth domain. Do not reuse or widen the existing alerts key without checking its domain scope. Disable link and open tracking on authentication mail.

## Coordinated rollout

1. Read and privately back up the current Supabase SMTP/template/URL/password/rate-limit configuration. Preserve settings outside this change. The project is `owsxnogvufankayfwczl`.
2. Verify the auth subdomain in Resend using its exact generated DKIM and return-path SPF/MX records. DNS is hosted by Vercel. Add DMARC on the auth subdomain after inventorying senders; start with `p=none`. A verified reporting destination is needed for aggregate monitoring. Do not invent DNS public-key values or a report mailbox.
3. Deploy the account UI first with `NEXT_PUBLIC_AUTH_EMAIL_CODE_ENABLED` unset/false. This keeps the existing link flow working. Verify shared sign-in, signup resend, password recovery, account access, and logout using mocked email requests.
4. Switch custom SMTP only after domain verification. Apply the templates together with the email-code UI rollout. `magic_link.html` deliberately contains only `{{ .Token }}`—no authentication link for a mail scanner to consume. Set `NEXT_PUBLIC_AUTH_EMAIL_CODE_ENABLED=true` and rebuild the app. The staged UI already accepts a code under “Enter a code instead” while the flag is false, so template changes can precede the final label change without removing an available sign-in path. Existing tabs running the previous application release should refresh before requesting email sign-in.
5. Keep confirmation, recovery, invitation and email-change templates on `{{ .ConfirmationURL }}` for compatibility with the existing PKCE callback. Those flows still depend on the originating browser and may be affected by scanner prefetch. The code alternative specifically addresses passwordless sign-in; do not claim every email action is scanner-proof.
6. Confirm server password minimum is at least 8 characters, keep email confirmation enabled, enable leaked-password protection if supported by the plan, and inspect rate limits, redirect allowlist, CAPTCHA, secure email change and session policy before changing them. New paid services/plans are not authorized by this bundle.
7. With explicit authorization and designated test inboxes, test confirmation, login code, resend, recovery, expired/reused credentials and security notifications in Outlook and Gmail. Confirm SPF/DKIM/DMARC alignment from received headers. Provider acceptance is not inbox placement. No real email was sent while preparing these files.

Rollback: restore the privately saved SMTP/templates and rebuild with the code flag disabled. Do not reset accounts, passwords or sessions as part of rollback.

## Template constraints

No promotional material, tracking pixels, remote images, user-supplied names, or hardcoded expiration promise. Codes are never placed in URL parameters or logs. Supabase controls code expiry and length; the app accepts 6–10 digit codes. The native HTML templates are the configured content; no separate plain-text API field is assumed.

References: [Supabase templates](https://supabase.com/docs/guides/auth/auth-email-templates), [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless), [Resend SMTP](https://resend.com/docs/send-with-smtp).
