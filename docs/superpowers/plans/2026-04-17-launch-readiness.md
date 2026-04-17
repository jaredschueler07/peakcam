# PeakCam V0 Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five launch gates (alerts verified, QA clean, data pipeline populating, PostHog funnels firing, runbook written) so PeakCam V0 can ship.

**Architecture:** Five parallel streams, each independently verifiable. Streams 1–4 run concurrently; Stream 5 (runbook) consolidates their findings. Verification-heavy sprint — tests are manual E2E + live dashboard checks where code isn't being written, TDD where it is (backfill script, event constants).

**Tech Stack:** Next.js 15 (App Router), Supabase (Postgres + Auth), Vercel (hosting + cron), PostHog (analytics), Resend (email), MapLibre GL, launchd (Mac Mini crons).

---

## File Structure

**New files:**
- `docs/alerts-verification.md` — Stream 1 output
- `scripts/alert-e2e-test.mjs` — Stream 1 helper (real-email E2E)
- `docs/qa-smoke-2026-04-17.md` — Stream 2 output
- `scripts/pipeline-inspect.mjs` — Stream 3 read-only row-count helper
- `scripts/pipeline-backfill.ts` — Stream 3 one-shot backfill runner (TS because it imports the orchestrator)
- `supabase/migrations/010_drop_resort_metadata.sql` — Stream 3, conditional on no consumers
- `lib/analytics-events.ts` — Stream 4 central event-name + helper
- `docs/runbook.md` — Stream 5 output
- `docs/data-pipeline-status.md` — Stream 3 output

**Modified files (Stream 4 event wiring):**
- `components/alerts/PowderAlertSignup.tsx` — capture `alert_signup_submitted`
- `components/alerts/AlertManagePage.tsx` — capture `alert_confirmed`
- `app/auth/page.tsx` (or whatever auth UI file exists) — capture `auth_signup_started/completed`
- Favorite toggle component — capture `favorite_added/removed`
- `components/resort/ConditionVoter.tsx` — capture `condition_voted`
- `vercel.json` — potentially add pipeline cron (Task 3.3 decides)

**Modified files (Stream 2 bug fixes):**
- Unknown until smoke runs — recorded in `qa-smoke-2026-04-17.md`, fixed in follow-on micro-tasks.

---

## Task 1 — Stream 1: Alerts End-to-End Verification

**Owner:** alerts-verifier teammate
**Files:**
- Create: `scripts/alert-e2e-test.mjs`
- Create: `docs/alerts-verification.md`

### Task 1.1 — Inspect email provider

- [ ] **Step 1:** Read `lib/email.ts` to identify provider (Resend / Postmark / nodemailer / other) and the `from` address.

```bash
cat lib/email.ts
```

Expected: see import like `import { Resend } from "resend"` and API key env var name.

- [ ] **Step 2:** Confirm provider API key env var is set in Vercel prod and in local `.env.local`.

```bash
grep -E "RESEND_API_KEY|POSTMARK|EMAIL" .env.local
vercel env ls production
```

Expected: both locations contain the key identified in Step 1.

- [ ] **Step 3:** Record findings in `docs/alerts-verification.md`:

```markdown
# Alerts E2E Verification — 2026-04-17

## Provider
- Service: <Resend | Postmark | ...>
- From address: <verified sender>
- API key env var: <RESEND_API_KEY | ...>
- Prod status: configured | missing
```

- [ ] **Step 4:** Commit.

```bash
git add docs/alerts-verification.md
git commit -m "docs: start alerts verification log"
```

### Task 1.2 — Write E2E test script

- [ ] **Step 1:** Create `scripts/alert-e2e-test.mjs` with real-email subscribe → trigger → verify flow.

```javascript
#!/usr/bin/env node
/**
 * alert-e2e-test.mjs — subscribe a test email, force-trigger the cron,
 * print diagnostic output. Run against prod or local.
 *
 * Usage: node scripts/alert-e2e-test.mjs --email you+peakcamtest@domain.com --resort-slug jackson-hole
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !(k in process.env)) process.env[k] = v;
  }
}
loadEnv(path.join(ROOT, ".env.local"));

const SITE = process.env.SITE_URL || "https://www.peakcam.io";
const CRON_SECRET = process.env.CRON_SECRET;
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => {
    if (v.startsWith("--")) acc.push([v.slice(2), a[i + 1]]);
    return acc;
  }, [])
);
if (!args.email || !args["resort-slug"]) {
  console.error("Usage: --email X --resort-slug Y");
  process.exit(1);
}

async function j(url, init) {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; }
  catch { return { status: r.status, body: t }; }
}

console.log("[1/4] Subscribing test email...");
const sub = await j(`${SITE}/api/alerts/subscribe`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: args.email, resort_slug: args["resort-slug"], threshold_inches: 1 }),
});
console.log("  status:", sub.status, "body:", sub.body);

console.log("[2/4] Triggering alert cron...");
const trig = await j(`${SITE}/api/alerts/trigger`, {
  method: "POST",
  headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
});
console.log("  status:", trig.status, "body:", trig.body);

console.log("[3/4] Re-triggering (dedup check)...");
const trig2 = await j(`${SITE}/api/alerts/trigger`, {
  method: "POST",
  headers: { Authorization: `Bearer ${CRON_SECRET}`, "Content-Type": "application/json" },
});
console.log("  status:", trig2.status, "body:", trig2.body);
if (trig.body?.sent > 0 && trig2.body?.sent > 0) {
  console.error("  FAIL: dedup did not prevent second send");
  process.exit(1);
}

console.log("[4/4] Done. Check inbox for email; use manage link to test edit/unsubscribe.");
```

- [ ] **Step 2:** `chmod +x scripts/alert-e2e-test.mjs`

- [ ] **Step 3:** Commit.

```bash
git add scripts/alert-e2e-test.mjs
git commit -m "feat: add alerts E2E test script"
```

### Task 1.3 — Run the E2E script against prod

- [ ] **Step 1:** Pick a resort known to have fresh snow (low threshold works too):

```bash
node scripts/alert-e2e-test.mjs --email <your-inbox>+peakcamtest@<domain>.com --resort-slug jackson-hole
```

Expected output:
- `[1/4]` → status 200, body with subscriber created
- `[2/4]` → status 200, body `{ sent: N, failed: 0 }` where N ≥ 1
- `[3/4]` → status 200, body `{ sent: 0 }` (dedup worked)
- `[4/4]` → "Done"

- [ ] **Step 2:** Verify inbox. Record in `docs/alerts-verification.md`:

```markdown
## E2E Run — <timestamp>
- [ ] Subscribe 200
- [ ] First trigger sent email
- [ ] Email received in inbox (subject, sender, content looks right)
- [ ] Second trigger did NOT resend (dedup)
- [ ] Manage link opens /alerts/manage with preferences editable
- [ ] Unsubscribe removes subscriber row
```

Check each box as you verify.

- [ ] **Step 3:** Clean up test subscriber:

```bash
# Via Supabase SQL editor or psql:
delete from alert_subscribers where email = '<your-test-email>';
```

- [ ] **Step 4:** Commit findings.

```bash
git add docs/alerts-verification.md
git commit -m "docs: alerts E2E verification complete"
```

### Task 1.4 — Verify failed-send log behavior (spec open question)

- [ ] **Step 1:** Read `app/api/alerts/trigger/route.ts` around the `sendPowderAlertEmail` try/catch block (roughly lines 120–160). Confirm that on failure, the code does NOT insert into `powder_alert_log` (because dedup would then suppress a retry the next day).

- [ ] **Step 2:** Record the finding:

```markdown
## Failed-send behavior
Confirmed: powder_alert_log insert is inside try block, after successful send. A failed send does NOT log, so the next day's cron will retry. Correct behavior.
```

OR, if the code logs before the send succeeds:

```markdown
## Failed-send behavior — BUG
powder_alert_log inserts before/outside the send. A failed send would still dedup future retries.
Fix: move log insert to after await sendPowderAlertEmail(...).
```

- [ ] **Step 3:** If bug found, fix it in `app/api/alerts/trigger/route.ts` and add a unit test in `app/api/alerts/trigger/route.test.ts` (only if a bug is found).

- [ ] **Step 4:** Commit (whether doc-only or with fix).

```bash
git add docs/alerts-verification.md [app/api/alerts/trigger/route.ts]
git commit -m "docs: verify failed-send log behavior" # or "fix: ..." if patched
```

---

## Task 2 — Stream 2: QA Cross-Browser Smoke

**Owner:** qa-tester teammate
**Files:**
- Create: `docs/qa-smoke-2026-04-17.md`

### Task 2.1 — Scaffold smoke template

- [ ] **Step 1:** Create `docs/qa-smoke-2026-04-17.md`:

```markdown
# QA Cross-Browser Smoke — 2026-04-17

**Target:** https://www.peakcam.io
**Browsers:** Mobile Safari (iOS latest), Chrome (desktop + mobile), Firefox (desktop)

## Routes

| Route | Purpose |
|---|---|
| `/` | Home / hero |
| `/browse` | Resort list + filters |
| `/[resort]` | Resort detail |
| `/snow-report` | Sortable snow table |
| `/compare` | Side-by-side compare |
| `/auth` | Signup / login |
| `/dashboard` | My Peak dashboard |
| `/alerts/manage?token=...` | Alert preferences |
| `/about` | Brand page |

## Interactions (per browser)

- [ ] Search on /browse returns results
- [ ] Filter chips on /browse toggle correctly
- [ ] Tap resort card → detail page loads
- [ ] Resort detail: cam, snow data, conditions, vote, alert signup all render
- [ ] Condition vote increments visibly
- [ ] Alert signup on resort detail posts 200
- [ ] Auth signup with new email works
- [ ] Logout clears session
- [ ] Login with that email works
- [ ] Favorite toggle persists across reload
- [ ] Compare: add 2 resorts, layout renders
- [ ] Map: pan, zoom, cluster expand, marker tap → resort detail
- [ ] Snow report: sortable columns work; filter chips work

## Findings

### P0 (blocking)
(none yet)

### P1 (fix before launch if ≤4h)
(none yet)

### P2 (triage to V0.5)
(none yet)
```

- [ ] **Step 2:** Commit the template.

```bash
git add docs/qa-smoke-2026-04-17.md
git commit -m "docs: start QA smoke template"
```

### Task 2.2 — Run smoke per browser

- [ ] **Step 1:** On **Mobile Safari** (real device or iOS simulator): walk every interaction. For each, mark `[x]` on pass, or record the bug under the right priority with:
  - Route + interaction
  - Screenshot (attach inline if possible)
  - Expected vs actual
  - Severity reasoning

- [ ] **Step 2:** Repeat on **Chrome desktop**.

- [ ] **Step 3:** Repeat on **Chrome mobile** (DevTools device emulation is acceptable).

- [ ] **Step 4:** Repeat on **Firefox desktop**.

- [ ] **Step 5:** Commit the populated smoke doc.

```bash
git add docs/qa-smoke-2026-04-17.md
git commit -m "docs: QA smoke results across 4 browser configs"
```

### Task 2.3 — Fix P0/P1 bugs

For each P0 and each ≤4h P1 found in 2.2, create a follow-on micro-task:

- [ ] **Step 1:** Reproduce the bug locally.
- [ ] **Step 2:** Write a test (Playwright / unit) if feasible; if purely visual/CSS, skip test.
- [ ] **Step 3:** Fix.
- [ ] **Step 4:** Retest on the browser that found it.
- [ ] **Step 5:** Update `docs/qa-smoke-2026-04-17.md` — move the bug from "P0/P1" to a "Fixed" section with the commit SHA.
- [ ] **Step 6:** Commit.

```bash
git add <changed files> docs/qa-smoke-2026-04-17.md
git commit -m "fix: <description> (QA P0/P1)"
```

### Task 2.4 — File P2s to V0.5

- [ ] **Step 1:** For each P2, add a bullet to `TASKS.md` under the V0.5 backlog section.
- [ ] **Step 2:** Commit.

```bash
git add TASKS.md
git commit -m "chore: file QA P2 findings to V0.5 backlog"
```

---

## Task 3 — Stream 3: Data Pipeline Table Population

**Owner:** data-engineer teammate
**Files:**
- Create: `scripts/pipeline-inspect.mjs`
- Create: `scripts/pipeline-backfill.mjs`
- Create: `docs/data-pipeline-status.md`
- Possibly create: `supabase/migrations/010_drop_resort_metadata.sql`
- Possibly modify: `vercel.json`

### Task 3.1 — Read-only row-count inspector

- [ ] **Step 1:** Create `scripts/pipeline-inspect.mjs`:

```javascript
#!/usr/bin/env node
/**
 * pipeline-inspect.mjs — report row counts for data-pipeline tables.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (k && !(k in process.env)) process.env[k] = v;
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing Supabase env"); process.exit(1); }

const TABLES = [
  "data_source_readings",
  "resort_conditions_summary",
  "resort_metadata",
];

for (const table of TABLES) {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact", Range: "0-0" },
  });
  const count = r.headers.get("content-range")?.split("/")[1] ?? "?";
  const latest = await fetch(
    `${URL}/rest/v1/${table}?select=*&order=fetched_at.desc.nullslast&limit=1`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  ).then((x) => x.json()).catch(() => null);
  console.log(`${table}: ${count} rows; latest:`, latest?.[0]?.fetched_at ?? latest?.[0]?.created_at ?? "n/a");
}
```

- [ ] **Step 2:** Run it:

```bash
node scripts/pipeline-inspect.mjs
```

Expected output (example):
```
data_source_readings: 0 rows; latest: n/a
resort_conditions_summary: 0 rows; latest: n/a
resort_metadata: 128 rows; latest: ...
```

- [ ] **Step 3:** Commit.

```bash
git add scripts/pipeline-inspect.mjs
git commit -m "feat: add pipeline row-count inspector"
```

### Task 3.2 — Scaffold status doc

- [ ] **Step 1:** Create `docs/data-pipeline-status.md` with the output from 3.1:

```markdown
# Data Pipeline Status — 2026-04-17

## Row counts (from scripts/pipeline-inspect.mjs)
| Table | Rows | Latest row |
|---|---|---|
| data_source_readings | <N> | <date or n/a> |
| resort_conditions_summary | <N> | <date or n/a> |
| resort_metadata | <N> | <date or n/a> |

## Analysis
<fill in after inspection>
```

- [ ] **Step 2:** Commit.

```bash
git add docs/data-pipeline-status.md
git commit -m "docs: capture pipeline row counts"
```

### Task 3.3 — Locate the pipeline entry point

- [ ] **Step 1:** Find where `lib/pipeline/orchestrator.ts`'s exported function is called:

```bash
grep -r "from ['\"].*pipeline/orchestrator" app scripts lib
grep -r "runPipeline\|orchestrate" scripts app lib
```

- [ ] **Step 2:** Record in `docs/data-pipeline-status.md` under `## Analysis`:
  - Entry point file and function name
  - Whether it's wired to any cron (Vercel `vercel.json`, launchd plist, Supabase Edge Function)
  - If not wired → reason `data_source_readings` is empty

- [ ] **Step 3:** Commit.

```bash
git add docs/data-pipeline-status.md
git commit -m "docs: identify pipeline entry + schedule"
```

### Task 3.4 — Build backfill script (if needed)

**Skip this task if 3.3 shows the pipeline is already scheduled and producing rows.**

- [ ] **Step 1:** Create `scripts/pipeline-backfill.ts` that imports the orchestrator's main function and runs it once across all resorts:

```typescript
#!/usr/bin/env tsx
/**
 * pipeline-backfill.ts — run orchestrator once for all resorts.
 * Run via: npx tsx scripts/pipeline-backfill.ts
 */
import "dotenv/config";
import { runAllResorts } from "../lib/pipeline/orchestrator"; // adjust to actual export

const result = await runAllResorts();
console.log(JSON.stringify(result, null, 2));
```

Adjust the import to match the real export from `lib/pipeline/orchestrator.ts`. If the orchestrator only exports per-resort, wrap it in a loop here.

- [ ] **Step 2:** Run once:

```bash
npx tsx scripts/pipeline-backfill.ts 2>&1 | tee /tmp/backfill-$(date +%s).log
```

Expected: log shows per-resort fetches; final summary lists success/failure counts.

- [ ] **Step 3:** Re-run inspector:

```bash
node scripts/pipeline-inspect.mjs
```

Expected: `data_source_readings` and `resort_conditions_summary` now non-zero.

- [ ] **Step 4:** Commit.

```bash
git add scripts/pipeline-backfill.ts docs/data-pipeline-status.md
git commit -m "feat: pipeline backfill script; initial rows loaded"
```

(Commit uses `.ts` extension consistent with Task 3.5 launchd plist.)

### Task 3.5 — Schedule ongoing pipeline run

**If 3.3 showed no schedule:** decide launchd (Mac Mini) vs Vercel cron.

- [ ] **Step 1:** Recommendation: **launchd**, because (a) SNOTEL sync already runs there, (b) Vercel functions have a 10s–60s cap which may not fit a full 128-resort pipeline run, (c) rate-limits to external APIs (NWS, SNOTEL) are better managed from a single host.

- [ ] **Step 2:** Create `~/Library/LaunchAgents/com.peakcam.pipeline.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.peakcam.pipeline</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/npx</string>
        <string>tsx</string>
        <string>/Users/maestro_admin/peakcam/peakcam/scripts/pipeline-backfill.ts</string>
    </array>
    <key>WorkingDirectory</key><string>/Users/maestro_admin/peakcam/peakcam</string>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
    <key>StandardOutPath</key><string>/Users/maestro_admin/peakcam/peakcam/logs/pipeline.log</string>
    <key>StandardErrorPath</key><string>/Users/maestro_admin/peakcam/peakcam/logs/pipeline.err</string>
</dict>
</plist>
```

- [ ] **Step 3:** Load it:

```bash
mkdir -p /Users/maestro_admin/peakcam/peakcam/logs
launchctl load ~/Library/LaunchAgents/com.peakcam.pipeline.plist
launchctl list | grep com.peakcam.pipeline
```

Expected: entry appears.

- [ ] **Step 4:** Document in `docs/data-pipeline-status.md` under a `## Schedule` section with the plist path and cron expression.

- [ ] **Step 5:** Commit doc.

```bash
git add docs/data-pipeline-status.md
git commit -m "docs: schedule pipeline daily via launchd"
```

### Task 3.6 — Decide on `resort_metadata`

- [ ] **Step 1:** Grep for any code that reads from `resort_metadata`:

```bash
grep -rn "resort_metadata" app components lib scripts supabase
```

- [ ] **Step 2a (has readers):** populate it. Write the population logic in `scripts/seed-resort-metadata.ts` using whichever canonical source exists (resort static CSV or existing `resorts` table). Run it. Record row count.

- [ ] **Step 2b (no readers):** drop it. Create `supabase/migrations/010_drop_resort_metadata.sql`:

```sql
-- Migration 010 — resort_metadata had no consumers after launch audit 2026-04-17.
drop table if exists resort_metadata cascade;
```

Apply:

```bash
# Via Supabase MCP apply_migration, or supabase CLI
supabase migration up 010
```

- [ ] **Step 3:** Record decision + action in `docs/data-pipeline-status.md` under `## resort_metadata`.

- [ ] **Step 4:** Commit.

```bash
git add supabase/migrations/ docs/data-pipeline-status.md [scripts/seed-resort-metadata.ts]
git commit -m "chore: resolve resort_metadata — <drop | populate>"
```

---

## Task 4 — Stream 4: PostHog Event Instrumentation

**Owner:** analytics-engineer teammate
**Files:**
- Create: `lib/analytics-events.ts`
- Modify: `components/alerts/PowderAlertSignup.tsx`
- Modify: `components/alerts/AlertManagePage.tsx`
- Modify: auth UI file (discover via grep)
- Modify: favorite toggle component (discover via grep)
- Modify: `components/resort/ConditionVoter.tsx`

### Task 4.1 — Event name constants (TDD)

- [ ] **Step 1:** Write the failing test `lib/analytics-events.test.ts`:

```typescript
import { describe, it, expect } from "vitest"; // or jest — match repo convention
import { EVENTS, track } from "./analytics-events";
import posthog from "posthog-js";

describe("analytics-events", () => {
  it("exports the 9 required event names", () => {
    expect(EVENTS).toMatchObject({
      BROWSE_OPENED: "browse_opened",
      RESORT_VIEWED: "resort_viewed",
      ALERT_SIGNUP_SUBMITTED: "alert_signup_submitted",
      ALERT_CONFIRMED: "alert_confirmed",
      AUTH_SIGNUP_STARTED: "auth_signup_started",
      AUTH_SIGNUP_COMPLETED: "auth_signup_completed",
      FAVORITE_ADDED: "favorite_added",
      FAVORITE_REMOVED: "favorite_removed",
      CONDITION_VOTED: "condition_voted",
    });
  });

  it("track() calls posthog.capture with name and props", () => {
    const spy = vi.spyOn(posthog, "capture").mockImplementation(() => {});
    track(EVENTS.RESORT_VIEWED, { slug: "jackson-hole" });
    expect(spy).toHaveBeenCalledWith("resort_viewed", { slug: "jackson-hole" });
    spy.mockRestore();
  });
});
```

(If repo uses Jest, swap `vitest` imports for `@jest/globals` and `jest.spyOn`.)

- [ ] **Step 2:** Run — expect fail:

```bash
npm test -- analytics-events
```

Expected: FAIL (module not found).

- [ ] **Step 3:** Create `lib/analytics-events.ts`:

```typescript
import posthog from "posthog-js";

export const EVENTS = {
  BROWSE_OPENED: "browse_opened",
  RESORT_VIEWED: "resort_viewed",
  ALERT_SIGNUP_SUBMITTED: "alert_signup_submitted",
  ALERT_CONFIRMED: "alert_confirmed",
  AUTH_SIGNUP_STARTED: "auth_signup_started",
  AUTH_SIGNUP_COMPLETED: "auth_signup_completed",
  FAVORITE_ADDED: "favorite_added",
  FAVORITE_REMOVED: "favorite_removed",
  CONDITION_VOTED: "condition_voted",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export function track(event: EventName, properties?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  posthog.capture(event, properties);
}
```

- [ ] **Step 4:** Re-run test — expect pass.

```bash
npm test -- analytics-events
```

Expected: PASS.

- [ ] **Step 5:** Commit.

```bash
git add lib/analytics-events.ts lib/analytics-events.test.ts
git commit -m "feat: central analytics event names + track helper"
```

### Task 4.2 — Wire `alert_signup_submitted`

- [ ] **Step 1:** Read `components/alerts/PowderAlertSignup.tsx` to find the submit handler.

- [ ] **Step 2:** Add import at top:

```typescript
import { track, EVENTS } from "@/lib/analytics-events";
```

- [ ] **Step 3:** In the submit handler, immediately after the API POST succeeds, add:

```typescript
track(EVENTS.ALERT_SIGNUP_SUBMITTED, { resort_slug: resortSlug, threshold_inches: threshold });
```

- [ ] **Step 4:** Visually verify in browser: sign up on a local dev instance, open PostHog live events, confirm event appears within ~10 seconds.

- [ ] **Step 5:** Commit.

```bash
git add components/alerts/PowderAlertSignup.tsx
git commit -m "feat(analytics): capture alert_signup_submitted"
```

### Task 4.3 — Wire `alert_confirmed`

- [ ] **Step 1:** Read `components/alerts/AlertManagePage.tsx`.

- [ ] **Step 2:** Add `import { track, EVENTS } from "@/lib/analytics-events";`.

- [ ] **Step 3:** In a `useEffect(() => { ... }, [])` on initial mount (after the token is validated), add:

```typescript
track(EVENTS.ALERT_CONFIRMED, { token: manageToken.slice(0, 8) }); // truncate for privacy
```

- [ ] **Step 4:** Verify in PostHog live events.

- [ ] **Step 5:** Commit.

```bash
git add components/alerts/AlertManagePage.tsx
git commit -m "feat(analytics): capture alert_confirmed"
```

### Task 4.4 — Wire auth events

- [ ] **Step 1:** Locate auth UI:

```bash
grep -rn "signUp\|signInWithPassword" app components | head -20
```

- [ ] **Step 2:** In the signup form submit handler:
  - Before calling `supabase.auth.signUp(...)`: `track(EVENTS.AUTH_SIGNUP_STARTED, { email_domain: email.split("@")[1] });`
  - After success: `track(EVENTS.AUTH_SIGNUP_COMPLETED, {});`

- [ ] **Step 3:** Verify in PostHog.

- [ ] **Step 4:** Commit.

```bash
git add <auth-file>
git commit -m "feat(analytics): capture auth_signup_started/completed"
```

### Task 4.5 — Wire favorite events

- [ ] **Step 1:** Locate favorite toggle:

```bash
grep -rn "favorite" components hooks | head -20
```

- [ ] **Step 2:** In the toggle handler, after the DB write succeeds:

```typescript
track(isAdding ? EVENTS.FAVORITE_ADDED : EVENTS.FAVORITE_REMOVED, { resort_slug: resort.slug });
```

- [ ] **Step 3:** Verify in PostHog.

- [ ] **Step 4:** Commit.

```bash
git add <favorite-file>
git commit -m "feat(analytics): capture favorite_added/removed"
```

### Task 4.6 — Wire `condition_voted`

- [ ] **Step 1:** Read `components/resort/ConditionVoter.tsx`. Find the vote handler.

- [ ] **Step 2:** After a successful vote POST:

```typescript
track(EVENTS.CONDITION_VOTED, { resort_slug: resortSlug, rating });
```

- [ ] **Step 3:** Verify in PostHog.

- [ ] **Step 4:** Commit.

```bash
git add components/resort/ConditionVoter.tsx
git commit -m "feat(analytics): capture condition_voted"
```

### Task 4.7 — Build PostHog dashboard (no code)

- [ ] **Step 1:** In PostHog UI, create a new dashboard named "PeakCam V0 Launch".

- [ ] **Step 2:** Add four funnels:
  - **Alert funnel:** `browse_opened` → `resort_viewed` → `alert_signup_submitted` → `alert_confirmed`
  - **Auth funnel:** `auth_signup_started` → `auth_signup_completed`
  - **Favorite funnel:** `resort_viewed` → `favorite_added`
  - **Discovery funnel:** `snow_report_opened` → `resort_viewed`

(If `browse_opened` and `snow_report_opened` aren't firing, they auto-fire via pageview events filtered by `$current_url contains /browse` or `/snow-report` — configure as such in each funnel step.)

- [ ] **Step 3:** Add three trends tiles:
  - DAU (unique distinct_ids per day)
  - Pageviews by route (top 10 `$current_url`)
  - Top resorts viewed (`resort_viewed` grouped by `slug`)

- [ ] **Step 4:** Copy the dashboard URL. Add it to `docs/runbook.md` under "Where to look" (handoff to Stream 5).

- [ ] **Step 5:** Commit any unrelated doc updates (no code for this step).

---

## Task 5 — Stream 5: Runbook

**Owner:** lead (runs after Streams 1–4 have findings available)
**Files:**
- Create: `docs/runbook.md`

### Task 5.1 — Scaffold the runbook

- [ ] **Step 1:** Create `docs/runbook.md`:

```markdown
# PeakCam Runbook

> Last updated: 2026-04-17

## Environments

| Environment | URL |
|---|---|
| Production | https://www.peakcam.io |
| Vercel dashboard | https://vercel.com/<team>/peakcam |
| Supabase | https://supabase.com/dashboard/project/<project-id> |
| PostHog | <URL from Stream 4.7> |
| GitHub | https://github.com/jaredschueler07/peakcam |

## Secrets

All secrets live in three places:
1. Local dev: `.env.local` (never commit)
2. Vercel prod: `vercel env ls production`
3. Launchd jobs (Mac Mini): loaded via `.env.local` at script start

See `~/.claude/projects/-Users-maestro-admin-peakcam/memory/reference_env_keys.md` for the full secrets inventory.

**Rotation:** to rotate a key, update in all three places above, then redeploy (Vercel) / restart launchd agent. Test with the appropriate health check.

## Deploy & Rollback

**Deploy:** `git push origin main` triggers Vercel auto-deploy. Watch deployment URL in the Vercel dashboard.

**Rollback:** Vercel dashboard → Deployments → find last known good → "Promote to Production".

**Verify deploy health:**
- `curl -sI https://www.peakcam.io` → 200
- Visit `/`, `/browse`, a resort page, `/snow-report`
- Check PostHog live events for recent pageviews

## Incident Scenarios

### 1. Agent loop crashed
Symptom: no recent heartbeat in `~/peakcam/peakcam/agents/loop.log`.
Recover:
```bash
launchctl stop com.peakcam.agents
launchctl start com.peakcam.agents
tail -f ~/peakcam/peakcam/agents/loop.log
```
Look for: Slack auth failures (rotate token), Supabase connection errors.

### 2. SNOTEL sync failing
Symptom: `snow_reports` not updating; dashboard stale.
Recover:
```bash
cd ~/peakcam/peakcam
node scripts/snotel-sync.mjs 2>&1 | tee /tmp/snotel.log
```
Look for: specific station IDs failing. If one station bad, check `data/resorts-with-snotel.json` for stale ID.

### 3. Vercel deploy broken
Symptom: site returns 500 or blank.
Recover: Vercel dashboard → Deployments → last good → Promote.
Then: investigate logs (Vercel → Functions → Logs).

### 4. Supabase outage
What breaks: auth, favorites, votes, alert writes, condition reads.
What still works: static cams (hosted on resort domains), cached SSG pages until revalidation.
Mitigation: check https://status.supabase.com; no self-recover.

### 5. Powder alerts not firing
Symptom: subscribers report no emails despite fresh snow.
Recover:
```bash
# Verify secret is set
vercel env ls production | grep CRON_SECRET

# Manually trigger from local
CRON_SECRET=<value> SITE_URL=https://www.peakcam.io node scripts/powder-alert-check.mjs

# Check Resend dashboard for delivery status (from docs/alerts-verification.md)
```
If manual trigger succeeds but scheduled doesn't: check Vercel cron dashboard.

## Where to look

| Signal | Location |
|---|---|
| Agent loop health | `~/peakcam/peakcam/agents/loop.log` |
| Pipeline health | `~/peakcam/peakcam/logs/pipeline.log` |
| Vercel function logs | Vercel dashboard → Functions → Logs |
| Supabase query logs | Supabase dashboard → Logs |
| Analytics | PostHog dashboard (URL above) |
| Launchd jobs | `launchctl list \| grep com.peakcam` |

## Known issues

(populated from `docs/qa-smoke-2026-04-17.md` P2 triage)
```

- [ ] **Step 2:** Commit.

```bash
git add docs/runbook.md
git commit -m "docs: runbook v1 with 5 incident scenarios"
```

### Task 5.2 — Backfill runbook with stream findings

- [ ] **Step 1:** Wait for Streams 1, 3, 4 to land their docs. (Stream 2's P2 list feeds the "Known issues" section.)

- [ ] **Step 2:** Replace placeholders in `docs/runbook.md`:
  - Email provider details from `docs/alerts-verification.md` (incident scenario 5)
  - PostHog dashboard URL from Stream 4.7 output
  - Pipeline scheduling details from `docs/data-pipeline-status.md`
  - Known issues from `docs/qa-smoke-2026-04-17.md`

- [ ] **Step 3:** Commit.

```bash
git add docs/runbook.md
git commit -m "docs: backfill runbook with stream findings"
```

### Task 5.3 — Final launch gate check

- [ ] **Step 1:** Create `docs/launch-gate-check.md`:

```markdown
# Launch Gate Check — 2026-04-17

| Gate | Status | Evidence |
|---|---|---|
| Alerts verified | ☐ | docs/alerts-verification.md |
| QA smoke | ☐ | docs/qa-smoke-2026-04-17.md |
| Data pipeline | ☐ | docs/data-pipeline-status.md |
| PostHog funnels | ☐ | PostHog dashboard: <URL> |
| Runbook | ☐ | docs/runbook.md |

## Decision

☐ All five green → SHIP (proceed to sub-project #2 Soft Launch Rollout)
☐ Blockers remain → list them below and reschedule
```

- [ ] **Step 2:** Tick the boxes as each stream reports done. When all five are checked, make the ship/no-ship call.

- [ ] **Step 3:** Commit.

```bash
git add docs/launch-gate-check.md
git commit -m "docs: V0 launch gate check — <SHIP | BLOCKED>"
```

---

## Parallelism Plan

**Phase 1 (parallel, 4 teammates + lead kicking off):**
- Teammate A: Task 1 (alerts verification)
- Teammate B: Task 2 (QA smoke)
- Teammate C: Task 3 (data pipeline)
- Teammate D: Task 4 (PostHog)
- Lead: Task 5.1 (runbook scaffold)

**Phase 2 (sequential, lead only):**
- Lead: Task 5.2 (backfill runbook from Phase 1 outputs)
- Lead: Task 5.3 (launch gate check)

Phase 2 is gated on Phase 1 completion because 5.2 needs the outputs of 1, 3, and 4.
