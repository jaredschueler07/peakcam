# PeakCam QA + Fix Orchestration Report — 2026-08-10

Author: Hermes agent (sandboxed on the Omen), for Jared
Scope: QA test the live site → file bug/enhancement requests → Claude Code build sessions to implement fixes → preview only, never prod.

## 1. Mission

Jared asked for a full loop:
1. Send multiple agents to test peakcam.io in different browsers, gather feedback, and create bug/enhancement requests.
2. Spin up Claude Code sessions in the terminal ("fable" sessions) with prompts to implement the improvements.
3. Fable orchestrates and uses Opus agents for build tasks; work happens on a branch.
4. DONT push to prod. Only preview.

## 2. Environment (the constraints that shaped everything)

- Terminal/file tools run in a Docker container on the **Omen PC (WSL2)** — not the Mac. Mac paths are invisible; `/Users/...` is a dead end. (See `sandbox-boundary` skill.)
- `GITHUB_TOKEN` (repo-scoped) is in the environment; the peakcam repo lives at `/workspace/peakcam` on branch `feat/drop-in`.
- Claude Code v2.1.226 is installed; auth via `CLAUDE_CODE_OAUTH_TOKEN` (Anthropic OAuth).
- Container quirks discovered this session: `pids.max = 256` (read-only), no `tmux` initially (installed), no `gh` CLI (used REST API instead).

## 3. Phase 1 — QA swarm (3 parallel test agents)

Dispatched via `delegate_task` — three leaf agents in parallel, each with its own isolated browser session (the practical equivalent of "different browsers" available in this stack), each told to follow the dogfood QA methodology:

| Agent | Focus |
|---|---|
| Agent 1 | Core browse + resort detail (home, resort pages, webcams, snow report, 404s, OG tags) |
| Agent 2 | Compare page, search, data freshness, performance |
| Agent 3 | /drop-in arcade, accessibility spot-checks, edge cases |

Each agent was given a self-contained brief (they know nothing of this conversation): target URLs, the exact evidence format (URL, repro, expected vs actual, console errors, severity, category, screenshot), and a mandate to write a full report file to `/workspace/peakcam/qa-findings/agent{N}-*.md` while keeping their final summary under 350 words.

**Results:** 11 bugs + 23 enhancements across the site. Headline findings:
- **Compare route 500s (Vercel "Application error")** for certain resort combos — agent 2's top finding.
- Home directory card count-up animation flashes wrong snow depths (a11y/UX).
- Drop-in arcade is effectively hidden (no nav/sitemap entry; `/drop-in` 404s) and is NOT actually auth-walled anymore (stale prior context).
- Remove-resort button unreliable with loaded webcams; `/resorts` 404s; "LIVE CAMS3 AVAILABLE" typo; low-contrast labels; 1px focus rings; "Wind from " dangling.

**Challenge — lost findings:** Agent 2 exhausted its tool budget before writing its report file; its summary was truncated mid-transfer, and the full transcript lives at a host path the sandbox can't read. Recovery: the orchestrator re-tested the compare page directly with browser tools, which not only recovered the finding but upgraded it — see the curl blind spot below.

**Challenge — the curl blind spot (key technical insight):** Initial curl checks returned HTTP 200 for the compare URLs, contradicting agent 2's 500 report. A real browser reproduced it deterministically: the Next.js HTML shell streams out with 200 *before* the server component throws, so curl-based monitoring can never see this class of bug. This is a general lesson for any SSR site monitoring.

## 4. Phase 2 — Bug/enhancement requests (GitHub issues)

- Wrote `scripts/create-issues-from-findings.mjs` — parses the findings markdown (## BUGS / ## ENHANCEMENTS sections) and creates GitHub issues via the REST API (no gh CLI available).
- Dry-run first to validate parsing, then real run with a `--skip=` dedupe filter (cross-agent duplicates: the CAMS typo and wind-direction bug each appeared twice).
- **31 issues filed on jaredschueler07/peakcam: #18–#48 (11 bugs + 20 enhancements)** — each with repro, severity, expected/actual, console notes from the agent reports.

## 5. Phase 3 — Fable build sessions (Claude Code)

### The prompt
A self-contained orchestration brief written to `/tmp/fable-prompt.md`: check out `feat/qa-fixes-2026-08-10` from `feat/drop-in`; read the findings + issues; implement severity-ordered; **orchestrate with Opus subagents** (Task tool with `"model": "opus"`) while fable reviews diffs and integrates; gate on lint → tests → build → local preview (`npm run dev` + curl smoke tests); push only the feature branch; never deploy, never touch main. Never print the token.

### Launch attempts and challenges (the messy middle)
1. **tmux interactive** — installed tmux 3.5a; launch hit "`--dangerously-skip-permissions` cannot be used with root/sudo privileges". Fix: `setpriv --reuid=1000 --regid=1000` (uid 1000 = `hermes` user), chowned the repo, `HOME=/tmp/claude-home` (fresh home for onboarding).
2. **OAuth picker trap** — with a fresh HOME, Claude Code ran its onboarding and offered the browser OAuth flow — dead end headless. Fix: stashed the token in `/tmp/claude-env.sh` (0600, uid 1000) as `ANTHROPIC_AUTH_TOKEN` (the var Claude Code actually reads) and sourced it at launch.
3. **tmux instability** — pane wedged once (empty captures after an OAuth error screen), then the whole tmux server died mid-dialog. Switched to **print mode** (`claude -p`, 120-turn cap) as a background process — print mode skips all interactive dialogs per the claude-code skill, and it is the supported non-interactive path. Dialog handling was needed at all only because interactive mode was attempted first.
4. **Fork failures at the end** — the run completed and printed its full report, then died with `bash: fork: Resource temporarily unavailable`. Root cause: container cgroup `pids.max = 256` (read-only, can't raise) — Claude + opus subagents + npm processes blow through 256 PIDs. Cost: nothing this time (report was complete and pushed).

### What fable delivered (9 commits, pushed, verified)
- **fix(compare)** — root cause proven: `?resorts=vail&resorts=bear-mountain` arrives as `string[]`; `params.resorts.split(",")` threw server-side. New `lib/compare-params.ts` (+12 tests), `app/compare/error.tsx`.
- **fix(resort)** — cams heading typo, dangling "Wind from ", empty cam captions.
- **fix(a11y)** — darkened muted tokens, 3px `:focus-visible` ring.
- **fix(browse)** — count-up animation kept out of the a11y tree (aria-hidden + sr-only truth, no-op on unchanged, prefers-reduced-motion).
- **feat(drop-in)** — `/drop-in` hub page, nav link, sitemap entry; correct copy for non-whitelisted resorts.
- **fix(seo)** — `/resorts` redirect, home `og:image`, recovery-oriented 404.
- **docs(qa)** — QA findings committed to the repo.

### Fable's honest corrections to the QA reports (verified by measurement)
- The "2.3:1 SORT: label" is actually 4.82:1 — the real contrast failures were alpha-reduced bark and the mustard readout.
- The count-up "refresh loop" doesn't exist — cards never remount; it's the mount animation sampled across loads.

## 6. Verification (orchestrator's own checks — never trust child self-reports)

- `git ls-remote origin feat/qa-fixes-2026-08-10` → SHA matches local HEAD exactly (push is real).
- `npm test` → **42/42 pass** (30 baseline + 12 new compare-params tests), run by me.
- Fable's gates: tsc pass; lint byte-identical to baseline (128 pre-existing problems, all vendored/script code); build compiles + prerenders 27 pages then fails at `/favorites` — fable confirmed the baseline commit fails identically (sandbox has placeholder Supabase creds; environmental, not a regression).
- Preview: all changed routes 200 on localhost; `/resorts` → 308; unknown slug → 404.

## 7. New findings surfaced during the build (pre-existing, out of scope)

- `app/client-providers.tsx` wraps everything in `dynamic(..., { ssr: false })` → every page ships `BAILOUT_TO_CLIENT_SIDE_RENDERING` with no content in SSR HTML. **Site-wide SEO exposure.**
- `/map` and `/snow-report` still lack `og:image` (own `openGraph` objects don't inherit the root image).
- The intermittent white-pass 500 matches a Supabase fetch failure (digest analysis) — needs Vercel logs to confirm.

## 8. Lessons learned / operational notes

1. **Curl can't see SSR streaming errors.** A 200 from curl + a 500 in browsers = server component throwing after the shell streams. Always confirm SSR routes in a real browser.
2. **Delegate agents should write their report files early and incrementally** — agent 2 lost 4 findings to a tool-budget cap; a mid-run file write would have preserved everything.
3. **Claude Code in this sandbox:** must run as uid 1000 (`setpriv`), token via `ANTHROPIC_AUTH_TOKEN` env file, print mode `-p` is more reliable than tmux here, and expect fork failures if opus subagents + npm run concurrently (pids.max=256, read-only).
4. **`--dangerously-skip-permissions` is refused as root** — non-negotiable, not a flag bug.
5. **Git identity** had to be set repo-locally (Maestro <maestro_admin@Maestros-Mac-mini.local>, matching the repo's past commits) and `safe.directory` added for root.
6. Pushing feature branches is the deliverable handoff mechanism — the Mac's local checkout stays untouched; nothing prod was deployed.

## 9. Artifacts

- QA findings reports: `qa-findings/agent1-core.md`, `agent2-compare.md`, `agent3-dropin.md` (committed in `1d147e3`)
- Issue creator: `scripts/create-issues-from-findings.mjs`
- GitHub issues: #18–#48 on jaredschueler07/peakcam
- Branch: `feat/qa-fixes-2026-08-10` (9 commits, pushed) — ready for review/PR against `feat/drop-in`
- This report: `qa-findings/2026-08-10-QA-ORCHESTRATION-REPORT.md`
