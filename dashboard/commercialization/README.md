# PeakCam commercialization tracker

## Tailnet access

Open **https://maestro-air-15.tailbf9a1a.ts.net** from a device connected to your tailnet. Tailscale Serve forwards private HTTPS traffic to this tracker's loopback port, 3334. The configured endpoint uses Serve, not public Funnel access. [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve).

On Maestro-Air-15, the user LaunchAgent `com.peakcam.commercialization-tracker` starts the tracker at login and restarts it if it exits. The Mac must be awake, connected to Tailscale, and logged into this user session. Tracking data stays in the same `.local/state.json` file for both local and tailnet access.

```sh
# Restart the installed tracker after code changes
launchctl kickstart -k gui/$(id -u)/com.peakcam.commercialization-tracker

# Inspect the private HTTPS proxy
tailscale serve status

# Disable this HTTPS proxy
tailscale serve --https=443 off
```

The LaunchAgent plist is in `~/Library/LaunchAgents/com.peakcam.commercialization-tracker.plist`; logs are `.local/service.log` and `.local/service-error.log`. Its `PEAKCAM_TRACKER_ORIGIN` environment variable allows the exact HTTPS hostname while preserving request-origin checks. If the device hostname changes, update that origin and the Serve configuration together.

## Manual local start

The installed background service already owns port 3334. Use the commands below only when it is stopped or when choosing another port.

Run from the repository root:

```sh
npm run commercialization
```

Open **http://127.0.0.1:3334**. Use `PORT=3335 npm run commercialization` if that port is occupied. This is a separate local application; it does not need the PeakCam website, Supabase credentials, or the older operations dashboard to run. Install the repository dependencies with `npm ci` on a fresh checkout.

## Weekly workflow

1. Review upcoming actions, overdue work, and unfinished dependencies on Overview.
2. Open a record to update its workflow status, owner, due date, notes, and evidence reference. A Done status requires evidence.
3. Record actual permission scope, outreach follow-ups, experiment results, cost inputs, and season-gate decisions in their respective registers.
4. Export the full JSON snapshot for a portable review, or export the selected register as CSV.

The source is the September 13 execution review in [Execution](../../PeakCam_Commercialization_2026-27/Execution/README.md). The dashboard reads all 11 CSV registers, plus seven seasonal checkpoints from [Season_Gates.csv](Season_Gates.csv). Counts and business outcomes are based on these records, not live production feeds. Workflow completion is separate from permission clearance, resort certification, or revenue evidence. Empty financial inputs remain unknown; scenario values are estimates.

## Saved work and recovery

Edits are saved on this computer in `dashboard/commercialization/.local/state.json`, with the prior state in `state.backup.json`. The directory is ignored by Git. Back it up along with your other business records. Do not run multiple tracker processes against the same state directory.

The original portfolio and execution CSVs are not overwritten. Reopening the dashboard restores saved edits. Use Refresh data to pick up source changes; tracked overrides continue to take precedence. Keep source IDs stable. Exports include original columns plus `Tracker_status`, `Tracker_owner`, `Tracker_due`, `Tracker_notes`, and `Tracker_evidence`; the tracked due date is the current working deadline. There is no automatic synchronization to Excel, GitHub, a CRM, or the production site.

If two tabs edit an old revision, the later save is rejected so it cannot silently overwrite newer work. Refresh the data, review the latest record, and reapply the intended edit.

To restore a backup: stop the server, preserve a copy of the current `.local` directory, then copy `state.backup.json` over `state.json` and restart. JSON exports are review snapshots; restore uses the state files rather than importing an export.

The server listens only on `127.0.0.1`. Its routes are limited to tracker data and allowlisted source documents. Keep private evidence in restricted storage and record references here.

## Validation

```sh
npm run commercialization:test
npm run commercialization:test:browser
```

API and browser tests use temporary state directories, preserving your real tracking work. Browser verification requires the repository's Playwright Chromium installation (`npx playwright install chromium` on a fresh machine).
