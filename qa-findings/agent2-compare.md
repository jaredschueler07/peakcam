# Agent 2 — Compare, Search & Data

QA of live site https://peakcam.io, focused on the Compare page, resort search, and data freshness. Tested 2026-08-10 by QA agent 2 (browser) + verified/re-tested by the orchestrator (real browser + curl).

NOTE: Agent 2 exhausted its tool budget before writing this file; its original summary was truncated mid-transfer. Findings 1–2 below are from its verified observations; finding 1 was re-verified by the orchestrator in a real browser. Findings 3–6 from agent 2's run were unrecoverable (host transcript paths are not readable from the sandbox). Areas agent 2 reported as clean: autocomplete search (partial match, no-results state, keyboard interaction all behaved), zero console errors on all navigations.

## BUGS

1. **Compare route throws a server-side 500 (Vercel application error) for certain resort combinations**
   - severity: High
   - category: Functional (server error) / Console
   - url: https://www.peakcam.io/compare?resorts=vail&resorts=bear-mountain (reproduces consistently); https://peakcam.io/compare?resorts=white-pass (intermittent — agent 2 hit it, orchestrator got 200/rendered page later)
   - repro: Open the URL in a real browser (headless Chromium via Browserbase reproduced it; any browser rendering the RSC stream will hit it). Curl DOES NOT reproduce — the HTML shell streams out with HTTP 200 before the server component throws, so curl-based monitoring will miss this bug entirely.
   - expected: Compare page renders both resorts side-by-side (single-resort compare renders fine: /compare?resorts=vail and /compare?resorts=white-pass both render).
   - actual: "Application error: a server-side exception has occurred while loading www.peakcam.io" with a Vercel digest (observed digests: 2932603362 consistently for vail+bear-mountain; 2604962303@E394 for white-pass). Deterministic for vail+bear-mountain across multiple reloads. Data-source hypothesis: vail uses snotel, bear-mountain uses open_meteo (per resort pages) — combining resorts with differing data shapes appears to throw in the server renderer. A combination that works: 49-degrees-north + bear-mountain (agent 2 rendered it and interacted with panels).
   - console: none client-side (error is server-side)
   - screenshot: agent 2 captured the 500 page (host cache path unreachable from sandbox)
   - note: Needs an error boundary + graceful empty/error state for the compare route regardless of fix; server logs on Vercel will have the stack trace.

2. **Remove-resort button is unreliable when a panel has a loaded live webcam**
   - severity: Medium
   - category: Functional / UX
   - url: https://www.peakcam.io/compare (multi-resort compare with loaded webcam panels)
   - repro: Add two resorts (e.g. 49 Degrees North + Bear Mountain); wait for the webcam image to load in a panel; click that panel's "Remove" button with a real mouse click. Fails ~2/2 attempts (resort stays, URL keeps both slugs). Programmatic .click() and keyboard Enter both remove the resort fine; clicking Remove on a panel WITHOUT a loaded cam (placeholder) also works.
   - expected: Real mouse click on Remove always removes the resort.
   - actual: Click is unreliable — suspected layout shift from the lazy webcam image load moving the button, or pointer interception on the cam panel.
   - console: none
   - screenshot: n/a

## ENHANCEMENTS

1. **Compare error resilience** — the route should render a graceful "couldn't load one of these resorts" state with a retry, never a bare Vercel 500 page (see Bug 1).
2. **Remove-button stability** — pin/defend the Remove hit target against lazy-load layout shift (reserve image space, or move Remove outside the cam panel).

## Testing notes

- What agent 2 tested: compare with white-pass/vail/multi-resort add+remove+URL sync, autocomplete search (partial, no-results, keyboard), data freshness (compare + homepage cards), console checks, performance signals. Zero console errors everywhere.
- What the orchestrator re-verified (real browser): vail+bear-mountain → deterministic 500; single vail and single white-pass → render fine; curl of all combos → 200 (streaming-shell blind spot).
- Unrecovered: agent 2 findings 3–6 (lost to truncation). Freshness/performance specifics from agent 2 are not available.
