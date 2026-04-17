# Alerts E2E Verification — 2026-04-17

## Provider
- Service: Resend
- From address: `PeakCam Alerts <alerts@peakcam.io>` (verified sender)
- API key env var: `RESEND_API_KEY`
- Local .env.local: configured
- Prod (Vercel): unverified (check dashboard) — `vercel` CLI is installed but the local checkout is not linked to a project (`vercel env ls production` returned "Your codebase isn't linked to a project on Vercel"). User should verify `RESEND_API_KEY` and `CRON_SECRET` are set in the Vercel production env via the dashboard.
