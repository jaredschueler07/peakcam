# Cam Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anonymous users report broken webcams (with optional "I know a working link" URL) from the resort detail page; write to a new RLS-locked `cam_reports` table and send a per-submission notification email to the admin.

**Architecture:** One migration, one API route (service-role writes only), two small client components (button + modal), one surgical edit to the resort page to mount the button on each cam tile. Validation + email helpers live in `lib/cam-reports/*` so the route stays thin. No test runner is configured in this repo, so each task ends with a manual check that mirrors the existing `user_conditions` / `alerts/subscribe` routes.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (service role from API route), Resend (via existing `lib/email.ts`), Tailwind CSS with PeakCam design tokens.

**Spec:** `docs/superpowers/specs/2026-04-19-cam-reports-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/011_cam_reports.sql` — table, indexes, RLS
- `lib/cam-reports/validate.ts` — request-body validation + URL safety
- `lib/cam-reports/email.ts` — Resend notification with rollup subject + in-process volume guard
- `app/api/cam-reports/submit/route.ts` — POST endpoint
- `components/cam/CamReportButton.tsx` — ghost pill, session-aware state
- `components/cam/CamReportModal.tsx` — the form

**Modify:**
- `lib/types.ts` — add `CamReportReason`, `CamReport` interfaces
- `components/resort/ResortDetailPage.tsx` — render `<CamReportButton>` inside each `CamPlayer` tile
- `.env.local.example` — document `CAM_REPORT_ADMIN_EMAIL` and `CAM_REPORT_SALT`

Each file has a single responsibility:
- `validate.ts` is pure (no I/O) so it's easy to reason about without running it.
- `email.ts` owns the volume counter and the rollup-subject math so the API route stays declarative.
- The button owns session-state (localStorage key `peakcam_cam_reports`) so the modal stays dumb.

---

## Task 1: Set up branch off main

**Files:**
- No code changes. Working-tree setup only.

- [ ] **Step 1: Push local main (with spec commit) to origin**

```bash
git push origin main
```

Expected: fast-forward push succeeds. The spec commit (`docs: cam-reports feature design spec`) lands on `origin/main`.

- [ ] **Step 2: Cut feat/cam-reports off main**

```bash
git checkout -b feat/cam-reports main
```

Expected: `Switched to a new branch 'feat/cam-reports'`.

- [ ] **Step 3: Confirm clean state**

```bash
git status --short
```

Expected: empty output (no uncommitted changes).

---

## Task 2: Apply migration 011 to Supabase

**Files:**
- Create: `supabase/migrations/011_cam_reports.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/011_cam_reports.sql
-- ─────────────────────────────────────────────────────────────
-- PeakCam — Cam Reports
-- Anonymous user-submitted reports that a webcam is broken,
-- with optional suggested replacement URL. Admin-read only
-- (Supabase UI + notification email). Reports are server-trusted:
-- RLS denies all direct writes; the submit API route uses the
-- service role.
-- ─────────────────────────────────────────────────────────────

create table if not exists cam_reports (
  id                   uuid primary key default gen_random_uuid(),
  cam_id               uuid not null references cams(id) on delete cascade,
  session_id           uuid not null,
  reason               text not null
                       check (reason in ('broken','wrong_view','other')),
  resort_link_dead     boolean not null default false,
  suggested_url        text,
  user_agent           text,
  ip_hash              text,
  resolved             boolean not null default false,
  resolved_at          timestamptz,
  admin_note           text,
  created_at           timestamptz not null default now()
);

create index if not exists cam_reports_cam_idx
  on cam_reports (cam_id, created_at desc);
create index if not exists cam_reports_unresolved_idx
  on cam_reports (resolved) where resolved = false;
create index if not exists cam_reports_session_idx
  on cam_reports (session_id, cam_id, created_at);

alter table cam_reports enable row level security;
-- No policies = default deny for anon and authenticated.
-- The API route uses the service role and bypasses RLS.
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with:
- `project_id`: `owsxnogvufankayfwczl`
- `name`: `cam_reports`
- `query`: the full SQL body above

Expected: migration returns success. Verify with:

```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='cam_reports'
order by ordinal_position;
```

Run via `mcp__claude_ai_Supabase__execute_sql`. Expected: 13 rows back.

- [ ] **Step 3: Commit the migration file**

```bash
git add supabase/migrations/011_cam_reports.sql
git commit -m "feat(cam-reports): migration 011 — cam_reports table + RLS"
```

---

## Task 3: Add types to lib/types.ts

**Files:**
- Modify: `lib/types.ts` (append after the existing cam-related types)

- [ ] **Step 1: Append types**

Add this block near the other domain types in `lib/types.ts`. Put it after the `Cam` interface definition, before any aggregate types.

```ts
// ── Cam reports ──────────────────────────────────────────────
export type CamReportReason = "broken" | "wrong_view" | "other";

export interface CamReport {
  id: string;
  cam_id: string;
  session_id: string;
  reason: CamReportReason;
  resort_link_dead: boolean;
  suggested_url: string | null;
  user_agent: string | null;
  ip_hash: string | null;
  resolved: boolean;
  resolved_at: string | null;
  admin_note: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "feat(cam-reports): CamReport + CamReportReason types"
```

---

## Task 4: Write validation helper

**Files:**
- Create: `lib/cam-reports/validate.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/cam-reports/validate.ts
import type { CamReportReason } from "@/lib/types";

const REASON_VALUES: CamReportReason[] = ["broken", "wrong_view", "other"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// Block localhost, loopback, and RFC1918 private ranges.
// We don't want the admin clicking a suggested URL that points inside
// our own infra or at a private network.
const BLOCKED_HOST_RE =
  /^(localhost|0\.0\.0\.0|::1|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i;

export function isSafePublicUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  if (raw.length > 500) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (BLOCKED_HOST_RE.test(u.hostname)) return false;
  return true;
}

export interface ParsedCamReport {
  cam_id: string;
  session_id: string;
  reason: CamReportReason;
  resort_link_dead: boolean;
  suggested_url: string | null;
}

export type ParseResult =
  | { ok: true; value: ParsedCamReport }
  | { ok: false; error: string };

export function parseCamReportBody(body: unknown): ParseResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON body" };
  }
  const b = body as Record<string, unknown>;

  if (!isUuid(b.cam_id)) {
    return { ok: false, error: "cam_id must be a UUID" };
  }
  if (!isUuid(b.session_id)) {
    return { ok: false, error: "session_id must be a UUID" };
  }
  if (
    typeof b.reason !== "string" ||
    !REASON_VALUES.includes(b.reason as CamReportReason)
  ) {
    return { ok: false, error: "Invalid reason" };
  }
  if (typeof b.resort_link_dead !== "boolean") {
    return { ok: false, error: "resort_link_dead must be boolean" };
  }

  let suggested_url: string | null = null;
  if (b.suggested_url !== undefined && b.suggested_url !== null && b.suggested_url !== "") {
    if (!isSafePublicUrl(b.suggested_url)) {
      return { ok: false, error: "suggested_url must be a public http(s) URL" };
    }
    suggested_url = b.suggested_url;
  }

  return {
    ok: true,
    value: {
      cam_id: b.cam_id,
      session_id: b.session_id,
      reason: b.reason as CamReportReason,
      resort_link_dead: b.resort_link_dead,
      suggested_url,
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/cam-reports/validate.ts
git commit -m "feat(cam-reports): request validation + URL safety helper"
```

---

## Task 5: Write email helper

**Files:**
- Create: `lib/cam-reports/email.ts`

- [ ] **Step 1: Write the file**

```ts
// lib/cam-reports/email.ts
//
// Fire-and-forget notification email for a new cam report.
// Uses the shared Resend wrapper in lib/email.ts.
//
// - Per-submission email (no batching).
// - Rollup subject when a cam has ≥ 2 prior reports in 24h (so this is the 3rd+).
// - In-process volume guard: if > 20 reports land in any 10-minute rolling
//   window across all cams, pause email sending for the next hour. DB is
//   unaffected; this is just to stop us from burning Resend quota during a
//   bot flood on a warm serverless instance.

import { Resend } from "resend";
import type { CamReportReason } from "@/lib/types";

const SUPABASE_PROJECT = "owsxnogvufankayfwczl";
const FALLBACK_ADMIN_EMAIL = "jaredschuelerspotify@gmail.com";
const MAX_REPORTS_PER_10M = 20;
const PAUSE_MS = 60 * 60 * 1000;     // 60 min
const WINDOW_MS = 10 * 60 * 1000;    // 10 min

// Rolling-window counter + pause flag. Module-level = shared across requests
// on the same warm Lambda instance. Resets on cold start, which is fine.
const recentSendTimestamps: number[] = [];
let emailPausedUntil = 0;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function recipient(): string {
  return (
    process.env.CAM_REPORT_ADMIN_EMAIL ||
    process.env.ALERT_ADMIN_EMAIL ||
    FALLBACK_ADMIN_EMAIL
  );
}

const REASON_LABEL: Record<CamReportReason, string> = {
  broken: "Broken / won't load",
  wrong_view: "Wrong view / wrong location",
  other: "Something else",
};

export interface CamReportEmailInput {
  reportId: string;
  createdAt: string;
  sessionId: string;
  reason: CamReportReason;
  resort_link_dead: boolean;
  suggested_url: string | null;
  cam: {
    id: string;
    name: string;
    embed_type: string;
    embed_url: string | null;
    youtube_id: string | null;
  };
  resort: { name: string; state: string };
  priorReportsIn24h: number;    // count EXCLUDING the one we just wrote
  priorReportsIn7d: number;     // count INCLUDING the one we just wrote
}

function buildSubject(input: CamReportEmailInput): string {
  const base = `Cam report · ${input.resort.name} — ${input.cam.name}`;
  if (input.priorReportsIn24h >= 2) {
    const nth = input.priorReportsIn24h + 1;
    return `🔥 ${base} (${nth}${ordinalSuffix(nth)} in 24h)`;
  }
  return `🚨 ${base} (${REASON_LABEL[input.reason].toLowerCase()})`;
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function buildBody(input: CamReportEmailInput): string {
  const lines = [
    `Reason:        ${REASON_LABEL[input.reason]}`,
    `Resort site:   ${input.resort_link_dead ? "also dead" : "not flagged"}`,
    `Suggested:     ${input.suggested_url ?? "(none)"}`,
    "",
    `Cam:    ${input.cam.name}`,
    `Resort: ${input.resort.name} · ${input.resort.state}`,
    `Embed:  ${input.cam.embed_type} · ${input.cam.youtube_id || input.cam.embed_url || "(no url)"}`,
    "",
    `Session: ${input.sessionId.slice(0, 8)}… · ${input.createdAt} · ${input.priorReportsIn7d} report(s) in last 7d`,
    `Supabase: https://supabase.com/dashboard/project/${SUPABASE_PROJECT}/editor?table=cam_reports&filter=cam_id:eq:${input.cam.id}`,
  ];
  return lines.join("\n");
}

function volumeGuardPermits(now: number): boolean {
  if (now < emailPausedUntil) return false;

  // prune old timestamps out of the rolling window
  const cutoff = now - WINDOW_MS;
  while (recentSendTimestamps.length && recentSendTimestamps[0] < cutoff) {
    recentSendTimestamps.shift();
  }

  if (recentSendTimestamps.length >= MAX_REPORTS_PER_10M) {
    emailPausedUntil = now + PAUSE_MS;
    console.warn(
      `[cam-reports] email paused for 60m — ${recentSendTimestamps.length} reports in last 10m`,
    );
    return false;
  }
  return true;
}

export async function sendCamReportEmail(input: CamReportEmailInput): Promise<void> {
  const now = Date.now();
  if (!volumeGuardPermits(now)) return;

  const client = getResend();
  if (!client) {
    console.warn("[cam-reports] RESEND_API_KEY not set; skipping email");
    return;
  }

  recentSendTimestamps.push(now);

  const subject = buildSubject(input);
  const text = buildBody(input);

  try {
    await client.emails.send({
      from: "PeakCam <alerts@peakcam.io>",
      to: recipient(),
      subject,
      text,
    });
  } catch (err) {
    console.error("[cam-reports] Resend send failed:", err);
  }
}
```

- [ ] **Step 2: Verify the Resend `from:` domain matches what the rest of the app uses**

```bash
grep -rE "from:.*peakcam\.io" lib app/api --include="*.ts"
```

Expected: at least one match confirming the domain. If `lib/email.ts` uses a different sender (e.g. `PeakCam Alerts <...>`), update the `from` string above to match exactly so Resend doesn't reject with "domain not verified".

- [ ] **Step 3: Commit**

```bash
git add lib/cam-reports/email.ts
git commit -m "feat(cam-reports): Resend notification with rollup + volume guard"
```

---

## Task 6: Implement the API route

**Files:**
- Create: `app/api/cam-reports/submit/route.ts`

- [ ] **Step 1: Write the file**

```ts
// app/api/cam-reports/submit/route.ts
//
// POST /api/cam-reports/submit
// Anonymous cam report submission. Session-based rate limit (1 per
// cam per session per 24h). Writes via service role; RLS denies
// direct anon writes.

import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseCamReportBody } from "@/lib/cam-reports/validate";
import { sendCamReportEmail } from "@/lib/cam-reports/email";

export const runtime = "nodejs";

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase service role env not configured");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.CAM_REPORT_SALT;
  if (!salt) return null;
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  return crypto.createHash("sha256").update(`${ip}${salt}${today}`).digest("hex");
}

function extractIp(req: NextRequest): string | null {
  // Vercel sets x-forwarded-for; first hop is the original client.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

export async function POST(req: NextRequest) {
  // 1. Parse body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 2. Validate shape
  const parsed = parseCamReportBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { cam_id, session_id, reason, resort_link_dead, suggested_url } = parsed.value;

  const supabase = getServiceClient();

  // 3. Verify cam exists and fetch context for the email
  const { data: cam, error: camErr } = await supabase
    .from("cams")
    .select("id, name, embed_type, embed_url, youtube_id, resort_id")
    .eq("id", cam_id)
    .single();

  if (camErr || !cam) {
    return NextResponse.json({ error: "Cam not found" }, { status: 404 });
  }

  const { data: resort, error: resortErr } = await supabase
    .from("resorts")
    .select("name, state")
    .eq("id", cam.resort_id)
    .single();

  if (resortErr || !resort) {
    return NextResponse.json({ error: "Resort not found" }, { status: 404 });
  }

  // 4. Rate limit: one report per cam per session per 24h
  const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: recent } = await supabase
    .from("cam_reports")
    .select("id")
    .eq("cam_id", cam_id)
    .eq("session_id", session_id)
    .gte("created_at", since24h)
    .limit(1);

  if (recent && recent.length > 0) {
    return NextResponse.json(
      { error: "Already reported recently" },
      { status: 429 },
    );
  }

  // 5. Insert
  const ip = extractIp(req);
  const ip_hash = hashIp(ip);
  const user_agent = (req.headers.get("user-agent") || "").slice(0, 500) || null;

  const { data: inserted, error: insertErr } = await supabase
    .from("cam_reports")
    .insert({
      cam_id,
      session_id,
      reason,
      resort_link_dead,
      suggested_url,
      user_agent,
      ip_hash,
    })
    .select("id, created_at")
    .single();

  if (insertErr || !inserted) {
    console.error("[cam-reports] insert failed:", insertErr?.message);
    return NextResponse.json({ error: "Failed to save report" }, { status: 500 });
  }

  // 6. Counts for email context — fire-and-forget, don't block client
  (async () => {
    try {
      const since7d = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const [{ count: n24 }, { count: n7d }] = await Promise.all([
        supabase
          .from("cam_reports")
          .select("id", { count: "exact", head: true })
          .eq("cam_id", cam_id)
          .gte("created_at", since24h)
          .neq("id", inserted.id),
        supabase
          .from("cam_reports")
          .select("id", { count: "exact", head: true })
          .eq("cam_id", cam_id)
          .gte("created_at", since7d),
      ]);

      await sendCamReportEmail({
        reportId: inserted.id,
        createdAt: inserted.created_at,
        sessionId: session_id,
        reason,
        resort_link_dead,
        suggested_url,
        cam: {
          id: cam.id,
          name: cam.name,
          embed_type: cam.embed_type,
          embed_url: cam.embed_url,
          youtube_id: cam.youtube_id,
        },
        resort: { name: resort.name, state: resort.state },
        priorReportsIn24h: n24 ?? 0,
        priorReportsIn7d: n7d ?? 1,
      });
    } catch (err) {
      console.error("[cam-reports] post-insert email/context failed:", err);
    }
  })();

  return NextResponse.json({ ok: true }, { status: 201 });
}
```

- [ ] **Step 2: Local smoke — boot dev server and hit the route with curl**

```bash
npm run dev
```

In a second terminal:

```bash
# Missing fields → 400
curl -sS -X POST http://localhost:3000/api/cam-reports/submit \
  -H "content-type: application/json" -d '{}' | jq .
```

Expected: `{"error":"cam_id must be a UUID"}` with HTTP 400.

```bash
# Invalid suggested_url → 400
curl -sS -X POST http://localhost:3000/api/cam-reports/submit \
  -H "content-type: application/json" \
  -d '{"cam_id":"00000000-0000-0000-0000-000000000000","session_id":"11111111-1111-4111-8111-111111111111","reason":"broken","resort_link_dead":false,"suggested_url":"file:///etc/passwd"}' | jq .
```

Expected: `{"error":"suggested_url must be a public http(s) URL"}` with HTTP 400.

Stop the dev server with Ctrl+C before committing.

- [ ] **Step 3: Commit**

```bash
git add app/api/cam-reports/submit/route.ts
git commit -m "feat(cam-reports): POST /api/cam-reports/submit endpoint"
```

---

## Task 7: Client — `CamReportButton`

**Files:**
- Create: `components/cam/CamReportButton.tsx`

- [ ] **Step 1: Write the file**

```tsx
// components/cam/CamReportButton.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { Flag } from "lucide-react";
import type { Cam } from "@/lib/types";
import { CamReportModal } from "./CamReportModal";

const STORAGE_KEY = "peakcam_cam_reports";       // { [cam_id]: isoTimestamp }
const REPORT_COOLDOWN_MS = 24 * 3600 * 1000;

type Status = "idle" | "submitted" | "alreadyReported";

interface Props {
  cam: Cam;
  resortName: string;
}

function readReportedMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeReportedAt(camId: string, iso: string) {
  if (typeof window === "undefined") return;
  const map = readReportedMap();
  map[camId] = iso;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota exceeded — ignore */
  }
}

export function CamReportButton({ cam, resortName }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);

  // On mount: if this cam was reported in the last 24h from this device,
  // start in the disabled state.
  useEffect(() => {
    const map = readReportedMap();
    const iso = map[cam.id];
    if (!iso) return;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return;
    if (Date.now() - t < REPORT_COOLDOWN_MS) {
      setStatus("alreadyReported");
    }
  }, [cam.id]);

  const handleSubmitted = useCallback(() => {
    writeReportedAt(cam.id, new Date().toISOString());
    setStatus("submitted");
  }, [cam.id]);

  const disabled = status !== "idle";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className={`absolute top-3 right-3 z-10 inline-flex items-center gap-1.5
          px-2.5 py-0.5 rounded-full border-[1.5px] text-[11px] font-bold
          uppercase tracking-[0.14em] shadow-[2px_2px_0_#2a1f14]
          transition-[transform,box-shadow] duration-100
          ${disabled
            ? "bg-cream border-bark text-bark cursor-not-allowed shadow-none"
            : "bg-cream-50 border-ink text-ink hover:bg-ink hover:text-cream-50 hover:-translate-x-[1px] hover:-translate-y-[1px]"
          }`}
        aria-label={
          status === "submitted"
            ? "Report submitted"
            : status === "alreadyReported"
            ? "Already reported"
            : `Report ${cam.name} broken`
        }
      >
        <Flag size={11} strokeWidth={2.5} />
        {status === "submitted"
          ? "Reported"
          : status === "alreadyReported"
          ? "Reported"
          : "Report"}
      </button>

      {open && (
        <CamReportModal
          cam={cam}
          resortName={resortName}
          onClose={() => setOpen(false)}
          onSubmitted={() => {
            handleSubmitted();
            setOpen(false);
          }}
          onAlreadyReported={() => {
            setStatus("alreadyReported");
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/cam/CamReportButton.tsx
git commit -m "feat(cam-reports): CamReportButton — ghost pill + session memory"
```

---

## Task 8: Client — `CamReportModal`

**Files:**
- Create: `components/cam/CamReportModal.tsx`

- [ ] **Step 1: Write the file**

```tsx
// components/cam/CamReportModal.tsx
"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Cam, CamReportReason } from "@/lib/types";

interface Props {
  cam: Cam;
  resortName: string;
  onClose: () => void;
  onSubmitted: () => void;
  onAlreadyReported: () => void;
}

const SESSION_KEY = "peakcam_session";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Matches the secure-context fallback pattern from ConditionVoter.
function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(SESSION_KEY);
  if (id && UUID_RE.test(id)) return id;
  id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
  try {
    window.localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

const REASONS: { value: CamReportReason; label: string }[] = [
  { value: "broken", label: "Broken / won't load" },
  { value: "wrong_view", label: "Wrong view / wrong location" },
  { value: "other", label: "Something else" },
];

export function CamReportModal({
  cam,
  resortName,
  onClose,
  onSubmitted,
  onAlreadyReported,
}: Props) {
  const [reason, setReason] = useState<CamReportReason | null>(null);
  const [resortLinkDead, setResortLinkDead] = useState(false);
  const [suggestedUrl, setSuggestedUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || !sessionId) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/cam-reports/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cam_id: cam.id,
          session_id: sessionId,
          reason,
          resort_link_dead: resortLinkDead,
          suggested_url: suggestedUrl.trim() || null,
        }),
      });

      if (res.status === 201) {
        onSubmitted();
        return;
      }
      if (res.status === 429) {
        onAlreadyReported();
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Something went wrong. Try again in a moment.");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Report · ${resortName} — ${cam.name}`}
    >
      <form onSubmit={handleSubmit} className="px-6 pt-5 pb-6 space-y-5">
        <fieldset className="space-y-2">
          <legend className="pc-eyebrow mb-1.5" style={{ color: "var(--pc-bark)" }}>
            What&rsquo;s wrong?
          </legend>
          {REASONS.map((r) => (
            <label
              key={r.value}
              className="flex items-center gap-3 cursor-pointer text-ink text-[14px] font-medium"
            >
              <input
                type="radio"
                name="reason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
                className="w-4 h-4 accent-alpen"
              />
              {r.label}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-3 cursor-pointer text-ink text-[14px] font-medium">
          <input
            type="checkbox"
            checked={resortLinkDead}
            onChange={(e) => setResortLinkDead(e.target.checked)}
            className="w-4 h-4 accent-alpen"
          />
          Resort&rsquo;s own site link is also dead
        </label>

        <div>
          <label
            htmlFor="suggested-url"
            className="pc-eyebrow block mb-1.5"
            style={{ color: "var(--pc-bark)" }}
          >
            Know a working link? (optional)
          </label>
          <input
            id="suggested-url"
            type="url"
            value={suggestedUrl}
            onChange={(e) => setSuggestedUrl(e.target.value)}
            placeholder="https://…"
            maxLength={500}
            className="w-full bg-snow text-ink placeholder:text-bark
                       border-[1.5px] border-ink rounded-full shadow-stamp-sm
                       px-4 py-2 text-[14px] font-medium
                       focus:shadow-[3px_3px_0_#a93f20] focus:border-alpen-dk
                       outline-none transition-shadow duration-100"
          />
        </div>

        {error && (
          <p className="text-poor text-[12px] font-semibold">{error}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center px-4 py-2 rounded-full
                       text-ink text-[13px] font-semibold hover:bg-ink/5
                       transition-colors duration-150"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!reason || submitting}
            className={`inline-flex items-center px-4 py-2 rounded-full
              border-[1.5px] border-ink text-[14px] font-bold
              transition-[transform,box-shadow] duration-100
              ${!reason || submitting
                ? "bg-cream text-bark border-bark cursor-not-allowed shadow-none"
                : "bg-alpen text-cream-50 shadow-stamp hover:shadow-stamp-hover hover:-translate-x-[1px] hover:-translate-y-[1px]"
              }`}
          >
            {submitting ? "Sending…" : "Send report"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/cam/CamReportModal.tsx
git commit -m "feat(cam-reports): CamReportModal — form with reason, url, checkbox"
```

---

## Task 9: Wire the button into `ResortDetailPage`

**Files:**
- Modify: `components/resort/ResortDetailPage.tsx`

- [ ] **Step 1: Find the `CamPlayer` internal component**

Open `components/resort/ResortDetailPage.tsx`. Around line 57 there is a function component:

```tsx
function CamPlayer({ cam, resortSlug, index = 99 }: { cam: Cam; resortSlug: string; index?: number }) {
```

Every rendering branch inside `CamPlayer` (link / image / iframe / link-out) wraps content in a relatively-positioned container. We want a single absolutely-positioned report button anchored to the outermost cam container, regardless of branch.

- [ ] **Step 2: Add the import at the top of the file**

Locate the existing component imports (e.g. `import { Heart } from "lucide-react"`). Add:

```tsx
import { CamReportButton } from "@/components/cam/CamReportButton";
```

- [ ] **Step 3: Thread the resort name through `CamPlayer` props**

The component prop signature currently takes `resortSlug`. Change it to also accept `resortName`:

```tsx
function CamPlayer({
  cam,
  resortSlug,
  resortName,
  index = 99,
}: {
  cam: Cam;
  resortSlug: string;
  resortName: string;
  index?: number;
}) {
```

- [ ] **Step 4: Render the button inside each CamPlayer branch**

Inside `CamPlayer`, each branch returns a `<div className="relative …">` wrapper. Immediately inside every such wrapper (before the existing children), insert:

```tsx
<CamReportButton cam={cam} resortName={resortName} />
```

There are three branches — `embed_type === "link"`, `embed_type === "image"`, and the default iframe/youtube branch. Add the button to all three. The button is `absolute top-3 right-3 z-10`, so it sits above iframes and overlays cleanly.

- [ ] **Step 5: Update the caller that mounts `<CamPlayer>`**

Find where `<CamPlayer>` is rendered in `ResortDetailPage` (grep for `<CamPlayer`). The call currently passes `cam={cam}`, `resortSlug={resort.slug}`, and `index`. Add `resortName={resort.name}`:

```tsx
<CamPlayer
  cam={cam}
  resortSlug={resort.slug}
  resortName={resort.name}
  index={idx}
/>
```

- [ ] **Step 6: Verify it builds**

```bash
npm run build
```

Expected: build succeeds, 148 pages generated. If TypeScript complains about `resortName`, double-check Step 3 and Step 5.

- [ ] **Step 7: Commit**

```bash
git add components/resort/ResortDetailPage.tsx
git commit -m "feat(cam-reports): mount CamReportButton on every cam tile"
```

---

## Task 10: Document env vars

**Files:**
- Modify: `.env.local.example`

- [ ] **Step 1: Append the new vars**

Open `.env.local.example`. Append this block at the end:

```
# ─── Cam reports ──────────────────────────────────────────────
# Who receives the "cam reported broken" notification emails.
# Falls back to ALERT_ADMIN_EMAIL, then to the hardcoded default.
CAM_REPORT_ADMIN_EMAIL=

# Salt used for daily-rotating SHA-256 IP hashing (abuse triage only).
# Optional — if unset, ip_hash is left NULL.
CAM_REPORT_SALT=
```

- [ ] **Step 2: Add the same vars to your local `.env.local`**

This is a manual edit outside git — open `.env.local` and fill in real values:

```
CAM_REPORT_ADMIN_EMAIL=jaredschuelerspotify@gmail.com
CAM_REPORT_SALT=<generate a random string, e.g. `openssl rand -hex 16`>
```

- [ ] **Step 3: Commit the example**

```bash
git add .env.local.example
git commit -m "docs(cam-reports): env var example for admin email + ip salt"
```

---

## Task 11: End-to-end smoke on local dev

**Files:**
- None. Manual verification only.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Click through a resort**

Open http://localhost:3000/resorts/alta (or any resort with cams). Each cam tile should show a `⚑ Report` pill in the top-right corner.

- [ ] **Step 3: Submit a report**

Click the button. In the modal:
- select `Broken / won't load`
- check the "resort's own site link is also dead" box
- paste `https://example.com/working-stream` into the URL field
- click "Send report"

Expected:
- modal closes
- button flips to `Reported` and is disabled
- within ~10s, an email arrives at `CAM_REPORT_ADMIN_EMAIL`
- a new row is visible in Supabase → `cam_reports` table

- [ ] **Step 4: Verify the 24h rate limit**

Click the same cam's `Report` button again. Expected: button is already disabled (via localStorage) and shows `Reported`.

Force a direct POST to prove the server enforces it too (the button is only a UX hint):

```bash
curl -sS -X POST http://localhost:3000/api/cam-reports/submit \
  -H "content-type: application/json" \
  -d '{"cam_id":"<paste a real cam uuid>","session_id":"<paste peakcam_session from DevTools>","reason":"broken","resort_link_dead":false}' \
  -w "\nstatus: %{http_code}\n"
```

Expected: `status: 429` with `{"error":"Already reported recently"}`.

- [ ] **Step 5: Validation errors**

```bash
curl -sS -X POST http://localhost:3000/api/cam-reports/submit \
  -H "content-type: application/json" \
  -d '{"cam_id":"not-a-uuid","session_id":"also-not","reason":"broken","resort_link_dead":false}' \
  -w "\nstatus: %{http_code}\n"
```

Expected: `status: 400`, `{"error":"cam_id must be a UUID"}`.

```bash
curl -sS -X POST http://localhost:3000/api/cam-reports/submit \
  -H "content-type: application/json" \
  -d '{"cam_id":"<real cam uuid>","session_id":"11111111-1111-4111-8111-111111111111","reason":"nope","resort_link_dead":false}' \
  -w "\nstatus: %{http_code}\n"
```

Expected: `status: 400`, `{"error":"Invalid reason"}`.

```bash
curl -sS -X POST http://localhost:3000/api/cam-reports/submit \
  -H "content-type: application/json" \
  -d '{"cam_id":"<real cam uuid>","session_id":"22222222-2222-4222-8222-222222222222","reason":"broken","resort_link_dead":false,"suggested_url":"http://localhost:3000/evil"}' \
  -w "\nstatus: %{http_code}\n"
```

Expected: `status: 400`, `{"error":"suggested_url must be a public http(s) URL"}`.

- [ ] **Step 6: Rollup subject check (optional, if you want to see 🔥)**

Insert two older reports directly via Supabase to simulate history, then submit via UI. Fastest way:

```sql
insert into cam_reports (cam_id, session_id, reason, resort_link_dead, created_at)
values
  ('<real cam uuid>', '33333333-3333-4333-8333-333333333333', 'broken', false, now() - interval '2 hours'),
  ('<real cam uuid>', '44444444-4444-4444-8444-444444444444', 'broken', false, now() - interval '1 hour');
```

Run via `mcp__claude_ai_Supabase__execute_sql`. Then submit via UI. Expected: the email subject starts with `🔥` and says `(3rd in 24h)`.

- [ ] **Step 7: Clean up test rows**

```sql
delete from cam_reports
where session_id in (
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);
```

Also delete your own real test submissions if you want a clean prod table. No commit here — verification only.

---

## Task 12: Open PR and merge

**Files:**
- None. Git + GitHub only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/cam-reports
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base main --head feat/cam-reports \
  --title "Cam reports: users can flag broken cams + suggest replacement links" \
  --body "$(cat <<'EOF'
## Summary
- Adds `⚑ Report` pill to every cam tile on the resort detail page.
- Opens a modal asking reason, whether the resort's own site link is dead, and an optional replacement URL.
- Stores anonymous session-based reports in a new RLS-locked `cam_reports` table.
- Sends a per-submission email to the admin (rollup subject at the 3rd+ report in 24h, in-process volume guard at 20 reports per 10 min).

## Design
- Spec: `docs/superpowers/specs/2026-04-19-cam-reports-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-19-cam-reports.md`

## Env vars (set in Vercel Production + Preview before merge)
- `CAM_REPORT_ADMIN_EMAIL` — notification recipient
- `CAM_REPORT_SALT` — daily-rotating IP hash salt

## Test plan
- [x] Local dev end-to-end flow (Task 11 in plan)
- [ ] Preview deploy: submit a real report, confirm email lands
- [ ] Verify row in Supabase `cam_reports` table
- [ ] Re-submit same cam → 429 and button stays disabled
- [ ] Invalid body shapes → 400

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Add the env vars to Vercel**

Vercel dashboard → Project `peakcam` → Settings → Environment Variables → add both vars for Production and Preview. Trigger a redeploy of the `feat/cam-reports` preview so the preview has the vars.

- [ ] **Step 4: Smoke the preview**

Open the preview URL from the PR. Click through one cam report, confirm the email lands.

- [ ] **Step 5: Merge**

```bash
gh pr merge --merge --delete-branch
```

Vercel auto-deploys `main` to production within a minute.

- [ ] **Step 6: Verify production**

Open https://peakcam.io/resorts/alta, submit one report, confirm email + Supabase row.
